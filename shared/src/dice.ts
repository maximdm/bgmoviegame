/**
 * Dice variant of the movie card game.
 *
 * A separate, self-contained engine that reuses the movie/card model and
 * scoring from the cards game, and the same declare/score/combo/peer-contest
 * rules as the Board variant. The difference is the **turn driver**:
 *
 *   - In the Board variant you roll a die to *move* a token around a 16-space
 *     loop, and the space you land on decides which category to draw.
 *   - In the Dice variant there is no board geometry. You roll a single die
 *     (1d6) and the face **directly picks the category** to draw from
 *     (1 = Actor … 6 = Genre). It is the die-rolled counterpart of the
 *     Board's "any" space.
 *
 * If the die-picked category's pile is already empty, the draw is skipped but
 * the turn is kept (you may still declare or end). When a full-handed player
 * rolls a category that still has cards, they cannot collect, so they open the
 * same full-hand **exchange** used by the Board variant. There is no discard —
 * cards are *collected*. When a player has a combo, they declare it (spending
 * those cards for points, held for peer verification). First to the target
 * score wins; otherwise the highest score after the round limit.
 *
 * Everything is deterministic: the die is seeded from the game seed plus an
 * action counter, so a given seed replays identically.
 */
import { buildDeck, createRng } from './deck';
import { bestCombo } from './ai';
import { CONTEST_PENALTY, CONTESTS_PER_PLAYER, THUMBS_UP_TO_WIN } from './constants';
import { lacksCast, NO_CAST_PENALTY, realMovieBonus, scoreCreateCombo, scoreFindCombo } from './scoring';
import type {
  Card,
  Category,
  ContestAction,
  DeclaredCombo,
  GameMode,
  Movie,
  PendingDeclaration,
  PlayerConfig,
  PlayerState,
  ResolveAction,
  VoteAction,
} from './types';
import { CATEGORIES } from './types';

/**
 * An open trade opened when a full-handed player rolls a category that still has
 * cards. The offerer puts 1–2 cards up; each other player, in seating order
 * starting after the offerer, may swap one of their own cards for one offered
 * card or pass.
 */
export interface DiceExchange {
  offererId: string;
  /** Cards the offerer put up for trade (1–2). They stay in hand until taken. */
  offeredCardIds: string[];
  /** Responder ids in seating order, starting with the player after the offerer. */
  order: string[];
  /** Index into `order` of the responder currently deciding. */
  currentIndex: number;
  /** Offered cards already taken by a responder. */
  takenCardIds: string[];
}

export const DICE_HAND_CAP = 12;
export const DICE_DEFAULT_TARGET = 100;
export const DICE_DEFAULT_MAX_ROUNDS = 50;

/** Minimum combo value the dice bot will cash in (avoids trivial 2-card scores). */
export const DICE_DECLARE_THRESHOLD = 6;

export interface DiceConfig {
  mode: GameMode;
  players: PlayerConfig[];
  targetScore?: number;
  maxRounds?: number;
  /** Card supply size; defaults to a generous pool so hands fill over a game. */
  deck?: { movieCount?: number };
  seed?: number;
  handCap?: number;
}

export interface DiceState {
  variant: 'dice';
  mode: GameMode;
  players: PlayerState[];
  /** Per-category draw piles (shuffled). */
  piles: Record<Category, Card[]>;
  declared: DeclaredCombo[];
  /** A declaration awaiting peer verification, if any (see `PendingDeclaration`). */
  pendingDeclaration?: PendingDeclaration;
  phase: 'roll' | 'declare' | 'exchange' | 'gameOver';
  currentPlayerIndex: number;
  turn: number;
  /** Monotonic counter; seeds the die for determinism. */
  actionCount: number;
  round: number;
  maxRounds: number;
  targetScore: number;
  handCap: number;
  seed: number;
  lastRoll?: number;
  /** The category the die selected this turn (so the UI can show it). */
  rolledCategory?: Category;
  /** Open trade, if a full-handed player rolled a drawable category this turn. */
  exchange?: DiceExchange;
  winnerId?: string;
  /** Set when the game ends at the round limit with no outright leader. */
  draw?: boolean;
}

export type DiceAction =
  | { type: 'roll'; playerId: string }
  | { type: 'offerExchange'; playerId: string; cardIds: string[] }
  | {
      type: 'respondExchange';
      playerId: string;
      accept: boolean;
      giveCardId?: string;
      takeCardId?: string;
    }
  | { type: 'declare'; playerId: string; cardIds: string[]; claimedTitle?: string; claimedSynopsis?: string }
  | { type: 'contest'; playerId: string; declarationId: string; proof?: string }
  | { type: 'resolveDeclaration'; playerId: string; outcome: 'real' | 'fake' }
  | { type: 'vote'; playerId: string; declarationId: string; vote: 'up' | 'down' }
  | { type: 'endTurn'; playerId: string };

export type DiceActionResult =
  | { ok: true; state: DiceState }
  | { ok: false; error: string };

function cloneDice(state: DiceState): DiceState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: [...player.hand] })),
    piles: {
      Actor: [...state.piles.Actor],
      Actress: [...state.piles.Actress],
      Period: [...state.piles.Period],
      Setting: [...state.piles.Setting],
      ReleaseYear: [...state.piles.ReleaseYear],
      Genre: [...state.piles.Genre],
    },
    declared: [...state.declared],
    pendingDeclaration: state.pendingDeclaration
      ? {
          ...state.pendingDeclaration,
          contests: [...state.pendingDeclaration.contests],
          votes: { ...state.pendingDeclaration.votes },
        }
      : undefined,
    exchange: state.exchange
      ? { ...state.exchange, takenCardIds: [...state.exchange.takenCardIds] }
      : undefined,
  };
}

function emptyPiles(): Record<Category, Card[]> {
  return {
    Actor: [],
    Actress: [],
    Period: [],
    Setting: [],
    ReleaseYear: [],
    Genre: [],
  };
}

/** Draw one card to a hand, respecting the hand cap. Returns the card or null. */
function drawToHand(hand: Card[], card: Card | undefined, handCap: number): Card | null {
  if (!card) return null;
  if (hand.length >= handCap) return null;
  hand.push(card);
  return card;
}

export function createDiceGame(movies: readonly Movie[], config: DiceConfig): DiceState {
  const seed = config.seed ?? 0;
  const rng = createRng(seed >>> 0);
  const movieCount = config.deck?.movieCount ?? Math.max(60, config.players.length * 12);
  const deck = buildDeck(movies, { movieCount }, rng);

  const piles = emptyPiles();
  for (const card of deck) {
    piles[card.category].push(card);
  }

  const players: PlayerState[] = config.players.map((player, index) => ({
    id: player.id ?? `p${index + 1}`,
    name: player.name,
    kind: player.kind ?? 'human',
    hand: [],
    score: 0,
    contestsUsed: 0,
  }));

  return {
    variant: 'dice',
    mode: config.mode,
    players,
    piles,
    declared: [],
    phase: 'roll',
    currentPlayerIndex: 0,
    turn: 1,
    actionCount: 0,
    round: 1,
    maxRounds: config.maxRounds ?? DICE_DEFAULT_MAX_ROUNDS,
    targetScore: config.targetScore ?? DICE_DEFAULT_TARGET,
    handCap: config.handCap ?? DICE_HAND_CAP,
    seed: seed >>> 0,
  };
}

/**
 * Resolve the die roll: the face (1–6) maps straight to a category, then a card
 * is drawn from that pile (if any remain). When the player's hand is already
 * full and the rolled category still has cards, `skippedBecauseFull` is set so
 * the caller opens an exchange instead of drawing. When the rolled category's
 * pile is empty the draw is skipped but the turn continues normally.
 */
function resolveRoll(
  state: DiceState,
  player: PlayerState,
): {
  roll: number;
  drawn: Card | null;
  category: Category;
  skippedBecauseFull: boolean;
} {
  const rng = createRng((state.seed + state.actionCount * 2654435761) >>> 0);
  const roll = 1 + Math.floor(rng() * 6);
  const category = CATEGORIES[roll - 1];
  const pile = state.piles[category];

  // Hand full + a card would have been drawn: open an exchange instead. We must
  // NOT pop the pile here, or the card would silently vanish.
  if (pile.length > 0 && player.hand.length >= state.handCap) {
    return { roll, drawn: null, category, skippedBecauseFull: true };
  }

  const drawn = pile.length > 0 ? drawToHand(player.hand, pile.pop(), state.handCap) : null;
  return { roll, drawn, category, skippedBecauseFull: false };
}

/** Build the responder order for a freshly opened exchange (next player first). */
function createExchange(state: DiceState, offererId: string): DiceExchange {
  const offererIndex = state.players.findIndex((player) => player.id === offererId);
  const order: string[] = [];
  for (let step = 1; step < state.players.length; step += 1) {
    const index = (offererIndex + step) % state.players.length;
    order.push(state.players[index].id);
  }
  return { offererId, offeredCardIds: [], order, currentIndex: 0, takenCardIds: [] };
}

function checkWin(state: DiceState): void {
  const leader = state.players.find((player) => player.score >= state.targetScore);
  if (leader) {
    state.phase = 'gameOver';
    state.winnerId = leader.id;
    state.draw = false;
    return;
  }
  if (state.round > state.maxRounds) {
    state.phase = 'gameOver';
    const top = Math.max(...state.players.map((player) => player.score));
    const leaders = state.players.filter((player) => player.score === top);
    // A winner only exists if someone actually scored AND there is a single leader.
    // All-zero scores and any tie are a draw, never an arbitrary "Player 1 wins".
    if (top > 0 && leaders.length === 1) {
      state.winnerId = leaders[0].id;
      state.draw = false;
    } else {
      state.winnerId = undefined;
      state.draw = true;
    }
  }
}

/**
 * A thumbs verdict on a Create-a-Movie pitch. The declarer cannot vote on their
 * own pitch. Reaching {@link THUMBS_UP_TO_WIN} distinct thumbs-up wins the game
 * for the declarer. If every other player has voted and the pitch is still short
 * of the threshold it fails — logged (un-verified) and the turn advances. A
 * thumbs-down has no penalty and no other effect.
 */
function vote(state: DiceState, action: VoteAction): DiceActionResult {
  const pending = state.pendingDeclaration;
  if (!pending || pending.id !== action.declarationId) {
    return { ok: false, error: 'No pitch is open to vote on.' };
  }
  if (pending.mode !== 'create') {
    return { ok: false, error: 'Only Create-a-Movie pitches are voted on.' };
  }
  const voter = state.players.find((player) => player.id === action.playerId);
  if (!voter) return { ok: false, error: 'Unknown player.' };
  if (voter.id === pending.playerId) {
    return { ok: false, error: 'You cannot vote on your own pitch.' };
  }
  if (pending.votes && pending.votes[voter.id]) {
    return { ok: false, error: 'You have already voted on this pitch.' };
  }

  const next = cloneDice(state);
  const pendingNext = next.pendingDeclaration;
  if (!pendingNext) return { ok: false, error: 'No pitch is open to vote on.' };
  const votes: Record<string, 'up' | 'down'> = { ...(pendingNext.votes ?? {}) };
  votes[voter.id] = action.vote;
  pendingNext.votes = votes;

  const ups = Object.values(votes).filter((value) => value === 'up').length;
  if (ups >= THUMBS_UP_TO_WIN) {
    next.declared.push({
      id: `combo-${next.declared.length + 1}`,
      playerId: pending.playerId,
      mode: 'create',
      cards: pending.cards,
      points: 0,
      claimedTitle: pending.claimedTitle,
      claimedSynopsis: pending.claimedSynopsis,
      verified: true,
      castPenalty: 0,
      turn: pending.turn,
    });
    next.pendingDeclaration = undefined;
    next.phase = 'gameOver';
    next.winnerId = pending.playerId;
    next.draw = false;
    return { ok: true, state: next };
  }

  const voters = next.players.filter((entry) => entry.id !== pending.playerId);
  const allVoted = voters.every((entry) => votes[entry.id]);
  if (allVoted) {
    next.declared.push({
      id: `combo-${next.declared.length + 1}`,
      playerId: pending.playerId,
      mode: 'create',
      cards: pending.cards,
      points: 0,
      claimedTitle: pending.claimedTitle,
      claimedSynopsis: pending.claimedSynopsis,
      verified: false,
      castPenalty: 0,
      turn: pending.turn,
    });
    next.pendingDeclaration = undefined;
    next.currentPlayerIndex = (next.currentPlayerIndex + 1) % next.players.length;
    if (next.currentPlayerIndex === 0) next.round += 1;
    next.turn += 1;
    next.phase = 'roll';
    next.lastRoll = undefined;
    next.rolledCategory = undefined;
    checkWin(next);
    return { ok: true, state: next };
  }

  return { ok: true, state: next };
}

export function applyDiceAction(state: DiceState, action: DiceAction): DiceActionResult {
  if (state.phase === 'gameOver') {
    return { ok: false, error: 'The game is over.' };
  }

  const next = cloneDice(state);
  next.actionCount = state.actionCount + 1;

  const current = state.players[state.currentPlayerIndex];
  // Only the core turn actions are bound to the active seat. `contest` and
  // `resolveDeclaration` may be raised by any other player during the peer
  // verification window.
  const turnLocked =
    action.type === 'roll' || action.type === 'declare' || action.type === 'endTurn';
  if (turnLocked && action.playerId !== current.id) {
    return { ok: false, error: "It is not that player's turn." };
  }

  if (action.type === 'roll') {
    if (state.phase !== 'roll') {
      return { ok: false, error: 'You have already rolled this turn.' };
    }
    const player = next.players[next.currentPlayerIndex];
    const { roll, skippedBecauseFull, category } = resolveRoll(next, player);
    next.lastRoll = roll;
    next.rolledCategory = category;
    if (skippedBecauseFull) {
      next.phase = 'exchange';
      next.exchange = createExchange(next, player.id);
    } else {
      next.phase = 'declare';
    }
    checkWin(next);
    return { ok: true, state: next };
  }

  if (action.type === 'offerExchange') {
    const exchange = state.exchange;
    if (!exchange) {
      return { ok: false, error: 'No exchange is open.' };
    }
    if (action.playerId !== exchange.offererId) {
      return { ok: false, error: 'Only the offerer can propose cards.' };
    }
    if (exchange.offeredCardIds.length > 0) {
      return { ok: false, error: 'You have already proposed cards.' };
    }
    const ids = [...new Set(action.cardIds)];
    if (ids.length < 1 || ids.length > 2) {
      return { ok: false, error: 'Propose one or two cards.' };
    }
    const handById = new Map(next.players[next.currentPlayerIndex].hand.map((card) => [card.id, card]));
    for (const id of ids) {
      if (!handById.has(id)) {
        return { ok: false, error: 'That card is not in your hand.' };
      }
    }
    next.exchange = { ...exchange, offeredCardIds: ids };
    // No responders (e.g. a solo game): the trade cannot proceed, so close it
    // at once and return to the normal declare phase.
    if (exchange.order.length === 0) {
      next.exchange = undefined;
      next.phase = 'declare';
    }
    return { ok: true, state: next };
  }

  if (action.type === 'respondExchange') {
    const exchange = state.exchange;
    if (!exchange) {
      return { ok: false, error: 'No exchange is open.' };
    }
    if (exchange.offeredCardIds.length === 0) {
      return { ok: false, error: 'The offerer must propose first.' };
    }
    const responderId = exchange.order[exchange.currentIndex];
    if (action.playerId !== responderId) {
      return { ok: false, error: 'It is not your turn to respond.' };
    }
    const responder = next.players.find((entry) => entry.id === responderId);
    if (!responder) return { ok: false, error: 'Unknown player.' };

    if (action.accept) {
      const available = exchange.offeredCardIds.filter(
        (id) => !exchange.takenCardIds.includes(id),
      );
      if (!action.takeCardId || !available.includes(action.takeCardId)) {
        return { ok: false, error: 'Choose one of the offered cards to take.' };
      }
      if (!action.giveCardId || !responder.hand.some((card) => card.id === action.giveCardId)) {
        return { ok: false, error: 'Choose a card from your hand to give.' };
      }
      const offerer = next.players.find((entry) => entry.id === exchange.offererId);
      const takeCard = offerer?.hand.find((card) => card.id === action.takeCardId);
      const giveCard = responder.hand.find((card) => card.id === action.giveCardId);
      if (!offerer || !takeCard || !giveCard) {
        return { ok: false, error: 'Exchange cards could not be resolved.' };
      }
      offerer.hand = offerer.hand.filter((card) => card.id !== takeCard.id);
      offerer.hand.push(giveCard);
      responder.hand = responder.hand.filter((card) => card.id !== giveCard.id);
      responder.hand.push(takeCard);
      next.exchange = { ...exchange, takenCardIds: [...exchange.takenCardIds, action.takeCardId] };
    }

    const advanced: DiceExchange = {
      ...(next.exchange ?? exchange),
      currentIndex: exchange.currentIndex + 1,
    };
    const allTaken = advanced.takenCardIds.length >= exchange.offeredCardIds.length;
    if (advanced.currentIndex >= exchange.order.length || allTaken) {
      next.exchange = undefined;
      next.phase = 'declare';
    } else {
      next.exchange = advanced;
    }
    checkWin(next);
    return { ok: true, state: next };
  }

  if (action.type === 'declare') {
    if (state.pendingDeclaration) {
      return { ok: false, error: 'Resolve the current declaration before declaring another.' };
    }
    if (state.phase !== 'declare') {
      return { ok: false, error: 'Roll the die before declaring.' };
    }
    const player = next.players[next.currentPlayerIndex];
    const handById = new Map(player.hand.map((card) => [card.id, card]));
    const cards: Card[] = [];
    const seen = new Set<string>();
    for (const id of action.cardIds) {
      if (seen.has(id)) return { ok: false, error: 'The same card was selected twice.' };
      seen.add(id);
      const card = handById.get(id);
      if (!card) return { ok: false, error: 'That card is not in your hand.' };
      cards.push(card);
    }
    if (cards.length < 2) {
      return { ok: false, error: 'A combo needs at least 2 cards.' };
    }

    const score = next.mode === 'find' ? scoreFindCombo(cards) : scoreCreateCombo(cards);
    if (!score.valid) {
      return { ok: false, error: score.reason ?? 'Invalid combo.' };
    }
    const basePoints = score.points;
    const bonus = realMovieBonus(next.mode, true);
    // A combo with no cast (no Actor and no Actress card) is docked a flat penalty.
    const castPenalty = lacksCast(cards) ? NO_CAST_PENALTY : 0;
    player.hand = player.hand.filter((card) => !seen.has(card.id));

    // --- Create-a-Movie: no scoring, no contest. 2–3 players log the pitch and
    // advance (freeform); 4–6 players open it for thumbs voting. ---
    if (next.mode === 'create') {
      const voting = next.players.length >= 4;
      if (!voting) {
        next.declared.push({
          id: `combo-${next.declared.length + 1}`,
          playerId: player.id,
          mode: 'create',
          cards,
          points: 0,
          claimedTitle: action.claimedTitle ?? '',
          claimedSynopsis: action.claimedSynopsis ?? '',
          verified: true,
          castPenalty: 0,
          turn: next.turn,
        });
        next.currentPlayerIndex = (next.currentPlayerIndex + 1) % next.players.length;
        if (next.currentPlayerIndex === 0) next.round += 1;
        next.turn += 1;
        next.phase = 'roll';
        next.lastRoll = undefined;
        next.rolledCategory = undefined;
        checkWin(next);
        return { ok: true, state: next };
      }
      next.pendingDeclaration = {
        id: `pending-${next.declared.length + 1}`,
        playerId: player.id,
        mode: 'create',
        cards,
        basePoints: 0,
        bonusPoints: 0,
        claimedTitle: action.claimedTitle ?? '',
        claimedSynopsis: action.claimedSynopsis ?? '',
        contests: [],
        castPenalty: 0,
        turn: next.turn,
        votes: {},
      };
      // Leave the phase on 'declare' and the declarer on turn: the table votes
      // (via the voting overlay) before the turn advances.
      return { ok: true, state: next };
    }

    // An AI seat is locked to the database: auto-verified, scored at once.
    if (player.kind === 'ai') {
      const total = basePoints + bonus - castPenalty;
      player.score += total;
      next.declared.push({
        id: `combo-${next.declared.length + 1}`,
        playerId: player.id,
        mode: next.mode,
        cards,
        points: total,
        movieId: score.movieId,
        realMatch: score.realMatch,
        verified: true,
        castPenalty,
        turn: next.turn,
      });
      checkWin(next);
      return { ok: true, state: next };
    }

    // A human declaration holds all points in a pending declaration until the
    // table verifies it through the contest window.
    const pending: PendingDeclaration = {
      id: `pending-${next.declared.length + 1}`,
      playerId: player.id,
      mode: next.mode,
      cards,
      basePoints,
      bonusPoints: bonus,
      claimedTitle: action.claimedTitle ?? '',
      contests: [],
      castPenalty,
      turn: next.turn,
    };
    next.pendingDeclaration = pending;
    return { ok: true, state: next };
  }

  if (action.type === 'contest') {
    const pending = state.pendingDeclaration;
    if (!pending || pending.id !== action.declarationId) {
      return { ok: false, error: 'No declaration is open to contest.' };
    }
    if (pending.mode === 'create') {
      return { ok: false, error: 'Create-a-Movie pitches are voted on, not contested.' };
    }
    const contestant = next.players.find((entry) => entry.id === action.playerId);
    if (!contestant) return { ok: false, error: 'Unknown player.' };
    if (contestant.id === pending.playerId) {
      return { ok: false, error: 'You cannot contest your own declaration.' };
    }
    if (contestant.contestsUsed >= CONTESTS_PER_PLAYER) {
      return { ok: false, error: 'You have no contests left this game.' };
    }
    if (pending.contests.some((entry) => entry.playerId === contestant.id)) {
      return { ok: false, error: 'You have already contested this declaration.' };
    }
    contestant.contestsUsed += 1;
    next.pendingDeclaration?.contests.push({ playerId: contestant.id, proof: action.proof ?? '' });
    return { ok: true, state: next };
  }

  if (action.type === 'vote') {
    return vote(state, action);
  }

  if (action.type === 'resolveDeclaration') {
    const pending = state.pendingDeclaration;
    if (!pending) {
      return { ok: false, error: 'No declaration is pending verification.' };
    }
    if (pending.mode === 'create') {
      return { ok: false, error: 'Create-a-Movie pitches are voted on, not resolved.' };
    }
    const declarer = next.players.find((entry) => entry.id === pending.playerId);
    if (!declarer) return { ok: false, error: 'Unknown declarer.' };

    let awarded = 0;
    if (action.outcome === 'real') {
      awarded = pending.basePoints + pending.bonusPoints - pending.castPenalty;
      declarer.score += awarded;
      for (const entry of pending.contests) {
        const challenger = next.players.find((player) => player.id === entry.playerId);
        if (challenger) challenger.score -= CONTEST_PENALTY;
      }
    } else {
      declarer.score -= CONTEST_PENALTY;
    }

    next.declared.push({
      id: `combo-${next.declared.length + 1}`,
      playerId: pending.playerId,
      mode: pending.mode,
      cards: pending.cards,
      points: awarded,
      claimedTitle: pending.claimedTitle,
      verified: action.outcome === 'real',
      castPenalty: pending.castPenalty,
      turn: pending.turn,
    });
    next.pendingDeclaration = undefined;
    checkWin(next);
    return { ok: true, state: next };
  }

  // endTurn
  if (state.pendingDeclaration) {
    return { ok: false, error: 'Resolve the pending declaration before ending your turn.' };
  }
  if (state.phase !== 'declare') {
    return { ok: false, error: 'Roll the die before ending your turn.' };
  }
  next.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.length;
  if (next.currentPlayerIndex === 0) next.round += 1;
  next.turn += 1;
  next.phase = 'roll';
  next.lastRoll = undefined;
  next.rolledCategory = undefined;
  checkWin(next);
  return { ok: true, state: next };
}

/** How many cards remain in the supply (for UI / end-of-game detection). */
export function diceCardsRemaining(state: DiceState): number {
  return (Object.values(state.piles) as Card[][]).reduce((sum, pile) => sum + pile.length, 0);
}

/** The `count` cards whose removal least reduces the best combo (cheapest to give away). */
function leastUsefulCards(mode: GameMode, hand: readonly Card[], count: number): string[] {
  const scored = hand.map((card) => {
    const remaining = hand.filter((other) => other.id !== card.id);
    const combo = bestCombo(mode, remaining);
    return { id: card.id, value: combo ? combo.points : 0 };
  });
  scored.sort((a, b) => a.value - b.value);
  return scored.slice(0, Math.min(count, scored.length)).map((entry) => entry.id);
}

/** Whether a responder should accept: swapping improves their best combo. */
function decideRespond(
  state: DiceState,
  exchange: DiceExchange,
  responder: PlayerState,
): { accept: boolean; giveCardId?: string; takeCardId?: string } {
  const available = exchange.offeredCardIds.filter(
    (id) => !exchange.takenCardIds.includes(id),
  );
  if (available.length === 0 || responder.hand.length === 0) {
    return { accept: false };
  }
  const offerer = state.players.find((player) => player.id === exchange.offererId);
  if (!offerer) return { accept: false };
  const before = bestCombo(state.mode, responder.hand);
  const beforePoints = before ? before.points : 0;
  const giveId = leastUsefulCards(state.mode, responder.hand, 1)[0];
  const giveCard = responder.hand.find((card) => card.id === giveId);
  if (!giveCard) return { accept: false };
  for (const takeId of available) {
    const takeCard = offerer.hand.find((card) => card.id === takeId);
    if (!takeCard) continue;
    const afterHand = responder.hand.filter((card) => card.id !== giveCard.id).concat(takeCard);
    const after = bestCombo(state.mode, afterHand);
    if ((after ? after.points : 0) > beforePoints) {
      return { accept: true, giveCardId: giveCard.id, takeCardId: takeId };
    }
  }
  return { accept: false };
}

/**
 * Heuristic dice AI: roll on your turn, cash in any worthwhile combo, then end.
 * During an exchange it proposes its two least useful cards (as offerer) or
 * accepts a swap that improves its best combo (as responder). Pure and
 * deterministic like the board bot; the caller applies actions in a loop until
 * this returns `null`.
 */
export function chooseDiceAiAction(state: DiceState): DiceAction | null {
  const current = state.players[state.currentPlayerIndex];
  if (state.phase === 'roll') {
    return { type: 'roll', playerId: current.id };
  }
  if (state.phase === 'exchange') {
    const exchange = state.exchange;
    if (!exchange) return null;
    if (exchange.offeredCardIds.length === 0) {
      // The offerer proposes; only an AI offerer acts automatically here.
      if (current.kind !== 'ai') return null;
      return {
        type: 'offerExchange',
        playerId: exchange.offererId,
        cardIds: leastUsefulCards(state.mode, current.hand, 2),
      };
    }
    const responderId = exchange.order[exchange.currentIndex];
    const responder = state.players.find((player) => player.id === responderId);
    if (!responder || responder.kind !== 'ai') return null;
    const decision = decideRespond(state, exchange, responder);
    return {
      type: 'respondExchange',
      playerId: responderId,
      accept: decision.accept,
      giveCardId: decision.giveCardId,
      takeCardId: decision.takeCardId,
    };
  }
  if (state.phase === 'declare') {
    const best = bestCombo(state.mode, current.hand);
    if (best && best.points >= DICE_DECLARE_THRESHOLD) {
      return {
        type: 'declare',
        playerId: current.id,
        cardIds: best.cards.map((card) => card.id),
      };
    }
    return { type: 'endTurn', playerId: current.id };
  }
  return null;
}
