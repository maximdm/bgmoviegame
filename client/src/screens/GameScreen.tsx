import {
  chooseAiAction,
  isAiTurn,
  lacksCast,
  NO_CAST_PENALTY,
  realMovieBonus,
  scoreCreateCombo,
  scoreFindCombo,
  type Action,
  type PendingDeclaration,
} from '@movie-game/shared';
import { useEffect, useRef, useState } from 'react';
import { CardChip } from '../components/CardChip';
import { ClaimMovie } from '../components/ClaimMovie';
import { getMovieById } from '../data/movies';
import { PLAYER_COLORS } from '../game/setup';
import { useGameState, type GameStore } from '../game/store';
import { Board } from '../pixi/Board';
import { Results } from './Results';

interface GameScreenProps {
  store: GameStore;
  viewerId: string;
  hotseat: boolean;
  onExit: () => void;
  onRematch: () => void;
}

function phaseLabel(phase: 'draw' | 'discard' | 'gameOver'): string {
  if (phase === 'draw') return 'Draw a card';
  if (phase === 'discard') return 'Declare or discard';
  return 'Game over';
}

export function GameScreen({ store, viewerId, hotseat, onExit, onRematch }: GameScreenProps) {
  const state = useGameState(store);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  /** Naming stage: the declarer is typing the claimed title (pre-dispatch). */
  const [naming, setNaming] = useState<{ basePoints: number; bonusPoints: number } | null>(null);
  /** Which seat is acting inside the contest overlay (hotseat device-passing). */
  const [claimActorId, setClaimActorId] = useState<string | null>(null);

  const pending = state.pendingDeclaration;

  // Dev-only test hook: lets the browser smoke test read the live hand and
  // drive deterministic interactions. Stripped from production builds.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as { __movieGame?: unknown }).__movieGame = {
        store,
        state,
        selectedIds: [...selectedIds],
        naming,
        claimActorId,
        // Test helper: select a card from the active seat's hand so the real
        // "Declare movie" flow (and its naming overlay) can be reached via the DOM.
        selectCard: (cardId: string): void => toggleCard(cardId),
      };
    }
  }, [store, state, selectedIds, naming, claimActorId]);

  const current = state.players[state.currentPlayerIndex];
  // Hotseat: the viewer is whoever is on turn. vs AI: the seated human, regardless
  // of which bot is acting.
  const viewer = hotseat
    ? current
    : state.players.find((player) => player.id === viewerId) ?? current;
  const isViewersTurn = current.id === viewer.id && current.kind === 'human';
  const isAiTurnActive = isAiTurn(state);

  const selectedCards = viewer.hand.filter((card) => selectedIds.has(card.id));
  const categoryCount = new Set(selectedCards.map((card) => card.category)).size;
  const preview =
    selectedCards.length === 0
      ? null
      : state.mode === 'find'
        ? scoreFindCombo(selectedCards)
        : scoreCreateCombo(selectedCards);
  const allSelected = viewer.hand.length > 0 && selectedCards.length === viewer.hand.length;
  const canDeclare =
    isViewersTurn &&
    state.phase === 'discard' &&
    !pending &&
    selectedCards.length >= 2 &&
    !allSelected &&
    (preview?.valid ?? false);
  const canDiscard =
    isViewersTurn &&
    state.phase === 'discard' &&
    selectedCards.length === 1 &&
    viewer.hand.length >= state.handSize;
  const topDiscard = state.discardPile[state.discardPile.length - 1];

  // The real-movie bonus is held during verification; show the full stake.
  const bonus = realMovieBonus(state.mode, true);
  const pointsAtStake = preview ? preview.points + bonus : 0;
  // A combo with no cast (no Actor/Actress card) is docked a flat penalty.
  const previewCastPenalty = preview && lacksCast(selectedCards) ? NO_CAST_PENALTY : 0;

  // A new turn belongs to a different seat: drop the previous selection.
  useEffect(() => {
    setSelectedIds(new Set());
    setError(null);
  }, [state.turn]);

  // Bot seats act on their own, one action at a time, with a small pause so the
  // turn is legible. Re-runs whenever the state changes, so a bot that declares
  // then discards is animated step by step.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isAiTurnActive) return;
    timer.current = setTimeout(() => {
      const action = chooseAiAction(state, current.id);
      if (action) store.dispatch(action);
    }, 650);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state, isAiTurnActive, current.id, store]);

  const act = (action: Action, clearSelection = false): void => {
    const result = store.dispatch(action);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    if (clearSelection) setSelectedIds(new Set());
  };

  const toggleCard = (cardId: string): void => {
    if (!isViewersTurn || state.phase !== 'discard') return;
    if (!viewer.hand.some((card) => card.id === cardId)) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
    setError(null);
  };

  const draw = (source: 'deck' | 'discard'): void => {
    if (!isViewersTurn) return;
    act({ type: 'draw', playerId: current.id, source }, true);
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
    act(
      {
        type: 'declare',
        playerId: current.id,
        cardIds: selectedCards.map((card) => card.id),
        claimedTitle: title,
        claimedSynopsis: synopsis,
      },
      true,
    );
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

  const discardSelected = (): void => {
    const card = selectedCards[0];
    if (!card || !canDiscard) return;
    act({ type: 'discard', playerId: current.id, cardId: card.id }, true);
  };

  return (
    <div className="game">
      <header className="game__bar">
        <div className="game__identity">
          <span className={`badge badge--${state.mode}`}>
            {state.mode === 'find' ? 'Find a Movie' : 'Create a Movie'}
          </span>
          <span className="game__meta">
            Round {Math.min(state.round, state.maxRounds)} / {state.maxRounds}
          </span>
          {state.mode !== 'create' && <span className="game__meta">Target {state.targetScore}</span>}
          <span className="game__meta">Seed {state.seed}</span>
          {!hotseat && (
            <span className="game__meta game__meta--you">You: {viewer.name}</span>
          )}
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
        <span className={`phase-pill phase-pill--${state.phase}`}>{phaseLabel(state.phase)}</span>
      </div>

      <Board
        state={state}
        viewerId={viewer.id}
        selectedIds={selectedIds}
        onToggleCard={toggleCard}
        onDraw={draw}
        onDiscard={discardSelected}
      />

      {state.phase !== 'gameOver' && (
        <section className="controls">
          {isViewersTurn ? (
            state.phase === 'draw' ? (
              <>
                <div className="controls__group">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => draw('deck')}
                  >
                    Draw from deck
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!topDiscard}
                    onClick={() => draw('discard')}
                  >
                    Take from discard
                  </button>
                </div>
                <p className="controls__hint">
                  Draw one card to begin your turn.
                  {topDiscard
                    ? ` The top discard is “${topDiscard.label}”.`
                    : ' The discard pile is empty.'}
                </p>
              </>
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
                    disabled={!canDiscard || !!pending}
                    onClick={discardSelected}
                  >
                    Discard selected
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={selectedCards.length === 0}
                    onClick={() => setSelectedIds(new Set())}
                  >
                    Clear
                  </button>
                </div>

                <div className="selection">
                  {selectedCards.length === 0 ? (
                    <span className="muted">
                      Select one card to discard, or two or more to declare a combo.
                    </span>
                  ) : (
                    <>
                      <div className="selection__summary">
                        <strong>{selectedCards.length} selected</strong>
                        <span>{categoryCount} / 6 categories</span>
                        {allSelected ? (
                          <span className="warn">Keep at least one card to discard.</span>
                        ) : preview?.valid ? (
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
                              {pointsAtStake} held for verification
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
                          <CardChip key={card.id} card={card} onRemove={toggleCard} />
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <p className="controls__hint">
                  Click a card (or drag it up) to select it. Declaring a movie ends your turn and
                  regenerates your hand. Discarding is optional — only when you hold {state.handSize} or
                  more cards — and also ends your turn.
                </p>
              </>
            )
          ) : (
            <p className="controls__hint controls__hint--bot">
              {current.kind === 'ai'
                ? `${current.name} is thinking…`
                : `${current.name} is taking their turn…`}
            </p>
          )}

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <section className="panel combos">
        <header className="panel__header">
          <div>
            <h2>Declared combos</h2>
            <p className="muted panel__sub">Verified films and original pitches.</p>
          </div>
          <span className="panel__count">{state.declared.length}</span>
        </header>

        {state.declared.length === 0 ? (
          <p className="muted combos__empty">
            No combos yet. Build a hand worth declaring, then lock it in.
          </p>
        ) : (
          <div className="combo-grid">
            {state.declared.map((combo) => {
              const ownerIndex = state.players.findIndex((player) => player.id === combo.playerId);
              const movie = getMovieById(combo.movieId);
              return (
                <article key={combo.id} className="combo-card">
                  <header>
                    <span className="combo-card__owner">
                      <span
                        className="player-chip__dot"
                        style={{
                          background: PLAYER_COLORS[ownerIndex % PLAYER_COLORS.length],
                        }}
                      />
                      {state.players[ownerIndex]?.name ?? combo.playerId}
                    </span>
                    {state.mode === 'create' ? (
                      <span className="combo-card__points">
                        {combo.verified ? '👍 Passed' : '👎 Not passed'}
                      </span>
                    ) : (
                      <span className="combo-card__points">+{combo.points} pts</span>
                    )}
                    {combo.castPenalty > 0 && (
                      <span className="combo-card__penalty">
                        &minus;{combo.castPenalty} no cast
                      </span>
                    )}
                    {combo.verified && (
                      <span className="combo-card__badge combo-card__badge--verified">✓ Verified</span>
                    )}
                    {!combo.verified && (
                      <span className="combo-card__badge">Rejected</span>
                    )}
                  </header>
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
                        🎬 <strong>{movie.title}</strong>{' '}
                        <span className="muted">· {movie.year}</span>
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
        )}
      </section>

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
