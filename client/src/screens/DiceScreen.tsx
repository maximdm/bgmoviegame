import {
  chooseDiceAiAction,
  lacksCast,
  NO_CAST_PENALTY,
  realMovieBonus,
  scoreCreateCombo,
  scoreFindCombo,
  CATEGORIES,
  CATEGORY_CSS_COLORS,
  type Card,
  type Category,
  type DiceState,
  type PendingDeclaration,
} from '@movie-game/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CardChip } from '../components/CardChip';
import { ClaimMovie } from '../components/ClaimMovie';
import { Dice } from '../components/Dice';
import { categoryIconSvg } from '../components/categoryIcons';
import { MOVIES_BY_ID } from '../data/movies';
import { PLAYER_COLORS } from '../game/setup';
import { useDiceState, type DiceStore } from '../game/diceStore';
import { Results } from './Results';

interface DiceScreenProps {
  store: DiceStore;
  viewerId: string;
  hotseat: boolean;
  onExit: () => void;
  onRematch: () => void;
}

/** Per-category glyph + label used in the supply display. */
function categoryGlyph(category: Category): ReactNode {
  return (
    <span
      className="board-tile__icon"
      dangerouslySetInnerHTML={{ __html: categoryIconSvg(category, '#0c130f') }}
    />
  );
}

const CATEGORY_LABEL: Record<Category, string> = {
  Actor: 'Actor',
  Actress: 'Actress',
  Period: 'Period',
  Setting: 'Setting',
  ReleaseYear: 'Year',
  Genre: 'Genre',
};

export function DiceScreen({
  store,
  viewerId,
  hotseat,
  onExit,
  onRematch,
}: DiceScreenProps) {
  const state = useDiceState(store);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  /** Naming stage: the declarer is typing the claimed title (pre-dispatch). */
  const [naming, setNaming] = useState<{ basePoints: number; bonusPoints: number } | null>(null);
  /** Which seat is acting inside the contest overlay (hotseat device-passing). */
  const [claimActorId, setClaimActorId] = useState<string | null>(null);
  /** Exchange picks: cards the offerer proposes, and the responder's take/give. */
  const [exOfferIds, setExOfferIds] = useState<ReadonlySet<string>>(() => new Set());
  const [exTakeId, setExTakeId] = useState<string | null>(null);
  const [exGiveId, setExGiveId] = useState<string | null>(null);

  const pending = state.pendingDeclaration;
  const exchange = state.exchange;
  const exchangeActorId = exchange
    ? exchange.offeredCardIds.length === 0
      ? exchange.offererId
      : exchange.order[exchange.currentIndex]
    : null;
  const exchangeActor = state.players.find((player) => player.id === exchangeActorId) ?? null;
  const exchangeIsOfferer =
    !!exchange && exchange.offeredCardIds.length === 0 && exchangeActorId === exchange.offererId;
  const availableOffered =
    exchange?.offeredCardIds.filter((id) => !exchange.takenCardIds.includes(id)) ?? [];
  const findCard = (playerId: string, cardId: string): Card | undefined =>
    state.players.find((player) => player.id === playerId)?.hand.find((card) => card.id === cardId);

  // The real-movie bonus is held during verification; show the full stake.
  const bonus = realMovieBonus(state.mode, true);

  const current = state.players[state.currentPlayerIndex];
  const viewer = hotseat
    ? current
    : state.players.find((player) => player.id === viewerId) ?? current;
  const isViewersTurn = current.id === viewer.id;
  const hand = viewer.hand;
  const exchangeHand = exchangeActor?.hand ?? hand;
  const exchangeActing = !!exchange && (hotseat ? true : exchangeActorId === viewer.id);

  const selectedCards = hand.filter((card) => selectedIds.has(card.id));
  const preview =
    selectedCards.length >= 2
      ? state.mode === 'find'
        ? scoreFindCombo(selectedCards)
        : scoreCreateCombo(selectedCards)
      : null;
  // A combo with no cast (no Actor/Actress card) is docked a flat penalty.
  const previewCastPenalty = preview && lacksCast(selectedCards) ? NO_CAST_PENALTY : 0;
  const canDeclare = !pending && (preview?.valid ?? false);
  const canEndTurn = isViewersTurn && state.phase === 'declare';

  // Auto-play AI seats, one action at a time. This also covers AI seats acting
  // during an exchange (offerer proposing, or a responder answering).
  const acting = useRef(false);
  useEffect(() => {
    if (state.phase === 'gameOver') return undefined;
    const exchangeActor =
      state.exchange &&
      (state.exchange.offeredCardIds.length === 0
        ? state.exchange.offererId
        : state.exchange.order[state.exchange.currentIndex]);
    const actor = state.players.find((player) => player.id === exchangeActor);
    const aiActing = current.kind === 'ai' || actor?.kind === 'ai' === true;
    if (!aiActing) return undefined;
    if (acting.current) return undefined;
    acting.current = true;
    const timer = window.setTimeout(() => {
      acting.current = false;
      const action = chooseDiceAiAction(state);
      if (action) {
        const result = store.dispatch(action);
        if (!result.ok) setError(result.error);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state, current.kind, store]);

  // Reset exchange selections as the exchange progresses.
  useEffect(() => {
    setExTakeId(null);
    setExGiveId(null);
  }, [exchange?.currentIndex, exchange?.offeredCardIds.length]);
  useEffect(() => {
    setExOfferIds(new Set());
  }, [state.phase, exchange?.offeredCardIds.length]);

  const toggleCard = (cardId: string): void => {
    if (!isViewersTurn || state.phase !== 'declare') return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
    setError(null);
  };

  const requestDeclare = (): void => {
    if (!canDeclare) return;
    setNaming({ basePoints: preview?.points ?? 0, bonusPoints: bonus });
  };

  const onName = (title: string, synopsis: string): void => {
    if (!naming || !canDeclare) {
      setNaming(null);
      return;
    }
    const result = store.dispatch({
      type: 'declare',
      playerId: current.id,
      cardIds: selectedCards.map((card) => card.id),
      claimedTitle: title,
      claimedSynopsis: synopsis,
    });
    if (!result.ok) {
      setError(result.error);
      setNaming(null);
      return;
    }
    setError(null);
    setSelectedIds(new Set());
    setNaming(null);
  };

  const onVote = (vote: 'up' | 'down'): void => {
    if (!pending) return;
    store.dispatch({ type: 'vote', playerId: claimActor, declarationId: pending.id, vote });
  };

  const onCancelName = (): void => {
    setNaming(null);
  };

  const claimActor = claimActorId ?? viewer.id;
  const onContest = (proof: string): void => {
    if (!pending) return;
    store.dispatch({ type: 'contest', playerId: claimActor, declarationId: pending.id, proof });
  };

  const onResolve = (outcome: 'real' | 'fake'): void => {
    if (!pending) return;
    store.dispatch({ type: 'resolveDeclaration', playerId: claimActor, outcome });
    setClaimActorId(null);
  };

  const roll = (): void => {
    if (!isViewersTurn || state.phase !== 'roll') return;
    const result = store.dispatch({ type: 'roll', playerId: current.id });
    if (!result.ok) setError(result.error);
  };

  const endTurn = (): void => {
    if (!canEndTurn) return;
    const result = store.dispatch({ type: 'endTurn', playerId: current.id });
    if (!result.ok) setError(result.error);
  };

  const toggleExOffer = (cardId: string): void => {
    if (!exchange || exchange.offeredCardIds.length > 0) return;
    setExOfferIds((previous) => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else if (next.size < 2) next.add(cardId);
      return next;
    });
    setError(null);
  };

  const proposeExchange = (): void => {
    if (!exchange || exchange.offeredCardIds.length > 0) return;
    if (exOfferIds.size < 1 || exOfferIds.size > 2) return;
    const result = store.dispatch({
      type: 'offerExchange',
      playerId: exchange.offererId,
      cardIds: [...exOfferIds],
    });
    if (!result.ok) setError(result.error);
  };

  const acceptExchange = (): void => {
    if (!exchange || !exTakeId || !exGiveId) return;
    const result = store.dispatch({
      type: 'respondExchange',
      playerId: exchange.order[exchange.currentIndex],
      accept: true,
      giveCardId: exGiveId,
      takeCardId: exTakeId,
    });
    if (!result.ok) setError(result.error);
  };

  const declineExchange = (): void => {
    if (!exchange) return;
    const result = store.dispatch({
      type: 'respondExchange',
      playerId: exchange.order[exchange.currentIndex],
      accept: false,
    });
    if (!result.ok) setError(result.error);
  };

  const categoryCount = new Set(selectedCards.map((card) => card.category)).size;

  // Dev-only test hook (parity with BoardScreen). Stripped from production builds.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __movieGame?: unknown }).__movieGame = {
        store,
        state,
        selectedIds: [...selectedIds],
        naming,
        claimActorId,
        isDice: true,
      };
    }
  }, [store, state, selectedIds, naming, claimActorId]);

  return (
    <div className="app">
      <header className="game__header">
        <div className="game__title">
          <span className="game__eyebrow">
            {state.mode === 'find' ? 'Find a Movie' : 'Create a Movie'} · Dice
          </span>
          <span className="game__meta">Round {Math.min(state.round, state.maxRounds)} / {state.maxRounds}</span>
          {state.mode !== 'create' && <span className="game__meta">Target {state.targetScore}</span>}
          <span className="game__meta">Seed {state.seed}</span>
          {!hotseat && <span className="game__meta game__meta--you">You: {viewer.name}</span>}
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={onExit}>
          Main menu
        </button>
      </header>

      <div className="players">
        {state.players.map((player, index) => {
          const active = index === state.currentPlayerIndex;
          const isYou = player.id === viewer.id;
          const pitches = state.declared.filter((combo) => combo.playerId === player.id).length;
          return (
            <div
              key={player.id}
              className={`player-chip ${active ? 'is-active' : ''} ${player.kind === 'ai' ? 'is-bot' : ''}`}
            >
              <span
                className="player-chip__dot"
                style={{ background: PLAYER_COLORS[index % PLAYER_COLORS.length] }}
              />
              <span className="player-chip__name">{player.name}</span>
              {player.kind === 'ai' && <span className="player-chip__bot">BOT</span>}
              {isYou && <span className="player-chip__you">YOU</span>}
              <span className="player-chip__score">
                {state.mode === 'create' ? `${pitches} pitches` : `${player.score} pts`}
              </span>
              <span className="player-chip__hand">{player.hand.length} cards</span>
              {active && state.phase !== 'gameOver' && (
                <span className="player-chip__turn">Turn</span>
              )}
            </div>
          );
        })}
        <span className={`phase-pill phase-pill--${state.phase === 'roll' ? 'roll' : state.phase === 'exchange' ? 'exchange' : state.phase === 'declare' ? 'declare' : 'gameOver'}`}>
          {state.phase === 'roll'
            ? 'Roll the die'
            : state.phase === 'exchange'
              ? 'Trade'
              : state.phase === 'declare'
                ? 'Declare or end'
                : 'Game over'}
        </span>
      </div>

      <div className="dice-table">
        <Dice
          value={state.lastRoll ?? 1}
          onRoll={isViewersTurn && state.phase === 'roll' ? roll : undefined}
          faceColors={CATEGORIES.map((category) => CATEGORY_CSS_COLORS[category])}
        />
        <div className="dice-table__status">
          {state.phase === 'gameOver' ? (
            <span className="muted">Game over</span>
          ) : state.lastRoll && isViewersTurn && state.phase === 'declare' ? (
            <>
              <strong>Rolled {state.lastRoll}</strong>
              <span className="muted">
                Drew from {CATEGORY_LABEL[state.rolledCategory ?? 'Actor']}
              </span>
            </>
          ) : state.lastRoll && isViewersTurn && state.phase === 'exchange' ? (
            <>
              <strong>Rolled {state.lastRoll}</strong>
              <span className="muted">
                {state.rolledCategory ?? 'Category'} pile taken — trade instead
              </span>
            </>
          ) : (
            <span className={current.kind === 'ai' ? 'muted' : 'dice-table__hint'}>
              {current.kind === 'ai' ? `${current.name} is playing…` : 'Your turn'}
            </span>
          )}
        </div>
      </div>

      {/* Per-category supply: the die picks one of these each turn. */}
      <div className="dice-supply">
        {CATEGORIES.map((category) => {
          const count = state.piles[category].length;
          const isRolled = state.rolledCategory === category && state.phase !== 'roll';
          return (
            <div
              key={category}
              className={`dice-supply__item ${isRolled ? 'is-rolled' : ''} ${count === 0 ? 'is-empty' : ''}`}
              style={{ '--tile': CATEGORY_CSS_COLORS[category] } as CSSProperties}
            >
              {categoryGlyph(category)}
              <span className="dice-supply__label">{CATEGORY_LABEL[category]}</span>
              <span className="dice-supply__count">{count}</span>
            </div>
          );
        })}
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="controls">
        {exchange ? (
          <div className="exchange">
            <p className="exchange__role">
              <strong>{exchangeActor?.name ?? 'A player'}</strong> is at {state.handCap} cards, so they
              trade instead of drawing.
              {!exchangeIsOfferer && ' It is your turn to respond.'}
            </p>

            <div className="exchange__offered">
              <span className="exchange__label">On the table</span>
              <div className="chip-row chip-row--wrap">
                {exchange.offeredCardIds.length === 0 ? (
                  <span className="muted">No cards proposed yet.</span>
                ) : (
                  exchange.offeredCardIds.map((id) => {
                    const card = findCard(exchange.offererId, id);
                    const taken = exchange.takenCardIds.includes(id);
                    return card ? (
                      <span key={id} className={`exchange__card ${taken ? 'is-taken' : ''}`}>
                        <CardChip card={card} />
                      </span>
                    ) : null;
                  })
                )}
              </div>
            </div>

            {exchangeActing ? (
              exchangeIsOfferer ? (
                <div className="controls__group">
                  <p className="controls__hint">
                    Choose 1 or 2 cards from your hand to offer for trade.
                  </p>
                  <div className="chip-row chip-row--wrap">
                    {exchangeHand.map((card) => (
                      <button
                        type="button"
                        key={card.id}
                        className={`hand-card ${exOfferIds.has(card.id) ? 'is-selected' : ''}`}
                        onClick={() => toggleExOffer(card.id)}
                      >
                        <CardChip card={card} />
                      </button>
                    ))}
                  </div>
                  <div className="controls__group">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={exOfferIds.size < 1 || exOfferIds.size > 2}
                      onClick={proposeExchange}
                    >
                      Propose trade
                    </button>
                  </div>
                </div>
              ) : (
                <div className="controls__group">
                  <p className="controls__hint">
                    Take one of the offered cards and give one of yours in return — or pass.
                  </p>
                  <span className="exchange__label">Take</span>
                  <div className="chip-row chip-row--wrap">
                    {availableOffered.map((id) => {
                      const card = findCard(exchange.offererId, id);
                      return card ? (
                        <button
                          type="button"
                          key={id}
                          className={`hand-card ${exTakeId === id ? 'is-selected' : ''}`}
                          onClick={() => setExTakeId(id)}
                        >
                          <CardChip card={card} />
                        </button>
                      ) : null;
                    })}
                  </div>
                  <span className="exchange__label">Give</span>
                  <div className="chip-row chip-row--wrap">
                    {exchangeHand.map((card) => (
                      <button
                        type="button"
                        key={card.id}
                        className={`hand-card ${exGiveId === card.id ? 'is-selected' : ''}`}
                        onClick={() => setExGiveId(card.id)}
                      >
                        <CardChip card={card} />
                      </button>
                    ))}
                  </div>
                  <div className="controls__group">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={!exTakeId || !exGiveId}
                      onClick={acceptExchange}
                    >
                      Accept trade
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={declineExchange}>
                      Pass
                    </button>
                  </div>
                </div>
              )
            ) : (
              <p className="controls__hint">{exchangeActor?.name ?? 'A player'} is deciding…</p>
            )}
          </div>
        ) : isViewersTurn ? (
          state.phase === 'roll' ? (
            <div className="controls__group">
              <button type="button" className="btn btn--primary" onClick={roll}>
                Roll the dice
              </button>
              <p className="controls__hint">
                The die picks which of the six categories you draw from — 1 = Actor, 6 = Genre.
              </p>
            </div>
          ) : (
            <>
              <div className="controls__group">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={!canDeclare}
                  onClick={requestDeclare}
                >
                  {state.mode === 'find' ? 'Declare movie' : 'Pitch movie'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={selectedCards.length === 0}
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
                <button type="button" className="btn btn--ghost" disabled={!canEndTurn || !!pending} onClick={endTurn}>
                  End turn
                </button>
              </div>
              <div className="selection">
                {selectedCards.length === 0 ? (
                  <span className="muted">
                    Select two or more cards from your hand to declare a combo, or end your turn.
                  </span>
                ) : (
                  <>
                    <div className="selection__summary">
                      <strong>{selectedCards.length} selected</strong>
                      <span>{categoryCount} / 6 categories</span>
                      {preview?.valid ? (
                        state.mode === 'create' ? (
                          <span className="ok">
                            Ready to pitch — any combo of 2+ categories works.
                            {previewCastPenalty > 0 && (
                              <> (&minus;{previewCastPenalty} no cast: no Actor/Actress)</>
                            )}
                          </span>
                        ) : (
                          <span className="ok">
                            {preview.points} pts + {bonus} bonus ·{' '}
                            {preview.points + bonus} held for verification
                            {previewCastPenalty > 0 && (
                              <> (&minus;{previewCastPenalty} no cast: no Actor/Actress)</>
                            )}
                          </span>
                        )
                      ) : (
                        <span className="warn">{preview?.reason}</span>
                      )}
                    </div>
                    <div className="chip-row">
                      {selectedCards.map((card) => (
                        <CardChip key={card.id} card={card} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </>
          )
        ) : (
          <p className="controls__hint">{current.name}'s turn — {current.kind === 'ai' ? 'the bot is playing' : 'pass the device'}.</p>
        )}

        {hand.length > 0 && state.phase !== 'exchange' && (
          <div className="hand">
            <span className="hand__title">Your hand ({hand.length}/{state.handCap})</span>
            <div className="chip-row chip-row--wrap">
              {hand.map((card: Card) => (
                <button
                  type="button"
                  key={card.id}
                  className={`hand-card ${selectedIds.has(card.id) ? 'is-selected' : ''}`}
                  onClick={() => toggleCard(card.id)}
                  disabled={!isViewersTurn || state.phase !== 'declare'}
                >
                  <CardChip card={card} />
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {state.declared.length > 0 && (
        <section className="declared">
          <h3>Declared movies</h3>
          <div className="combo-grid">
            {state.declared.map((combo) => {
              const movie = combo.movieId ? MOVIES_BY_ID.get(combo.movieId) : undefined;
              const declarerIndex = state.players.findIndex((p) => p.id === combo.playerId);
              const declarer = declarerIndex >= 0 ? state.players[declarerIndex] : undefined;
              return (
                <article key={combo.id} className="combo-card">
                  {declarer && (
                    <span className="combo-card__owner">
                      <span
                        className="combo-card__dot"
                        style={{ background: PLAYER_COLORS[declarerIndex % PLAYER_COLORS.length] }}
                      />
                      {declarer.name}
                    </span>
                  )}
                  {state.mode === 'create' ? (
                    <span className="combo-card__points">
                      {combo.verified ? '👍 Passed' : '👎 Not passed'}
                    </span>
                  ) : (
                    <span className="combo-card__points">+{combo.points} pts</span>
                  )}
                  {combo.castPenalty > 0 && (
                    <span className="combo-card__penalty">&minus;{combo.castPenalty} no cast</span>
                  )}
                  {combo.verified && (
                    <span className="combo-card__badge combo-card__badge--verified">✓ Verified</span>
                  )}
                  {!combo.verified && (
                    <span className="combo-card__badge">Rejected</span>
                  )}
                  <div className="chip-row">
                    {combo.cards.map((card) => (
                      <CardChip key={card.id} card={card} />
                    ))}
                  </div>
                  <footer>
                    {combo.claimedTitle ? (
                      <>
                        🎬 <strong>{combo.claimedTitle}</strong>
                      </>
                    ) : movie ? (
                      <>
                        🎬 <strong>{movie.title}</strong> <span className="muted">· {movie.year}</span>
                      </>
                    ) : (
                      <span className="muted">
                        {combo.mode === 'create' ? 'Original pitch' : 'Movie unknown'}
                      </span>
                    )}
                    {combo.claimedSynopsis && (
                      <p className="combo-card__synopsis">{combo.claimedSynopsis}</p>
                    )}
                    <span className="combo-card__meta">Turn {combo.turn}</span>
                  </footer>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {state.phase === 'gameOver' && (
        <Results state={state} onRematch={onRematch} onExit={onExit} />
      )}

      {naming && (
        <ClaimMovie
          stage="naming"
          mode={state.mode}
          pointsAtStake={naming.basePoints + naming.bonusPoints}
          castPenalty={previewCastPenalty}
          cards={selectedCards}
          players={state.players}
          viewerId={viewer.id}
          onName={onName}
          onCancelName={onCancelName}
        />
      )}

      {!naming && pending && (
        pending.mode === 'create' ? (
          <ClaimMovie
            stage="vote"
            mode="create"
            pointsAtStake={0}
            pending={pending}
            players={state.players}
            viewerId={claimActor}
            hotseat={hotseat}
            onActingAsChange={setClaimActorId}
            onVote={onVote}
          />
        ) : (
          <ClaimMovie
            stage="contest"
            pointsAtStake={pending.basePoints + pending.bonusPoints}
            castPenalty={pending.castPenalty}
            pending={pending}
            players={state.players}
            viewerId={claimActor}
            hotseat={hotseat}
            onActingAsChange={setClaimActorId}
            onContest={onContest}
            onResolve={onResolve}
          />
        )
      )}
    </div>
  );
}
