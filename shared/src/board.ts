/**
 * Board-game variant of the movie card game.
 *
 * A separate, self-contained engine that reuses the movie/card model and
 * scoring from the cards game. The board is a 16-space loop laid out as a
 * square (four tiles per side, corners shared):
 *
 *   - 2 spaces per category (12 colour spaces)
 *   - 3 "any" spaces (draw any category)
 *   - 1 "pass" space (draw nothing)
 *
 * The spaces are **shuffled per game so no two neighbouring tiles share a type**
 * (you never roll straight from one "Genre" tile onto another), seeded from the
 * game seed for reproducibility.
 *
 * Players roll a single die (1d6) to move around the loop; landing on a coloured
 * space draws a card of that colour into a hand capped at 12. Landing on an
 * "any" space lets the player **choose which category to draw from** (instead of
 * a random draw). There is no discard — cards are *collected*. When a
 * full-handed player lands on a draw space they cannot collect, so they open an
 * **exchange**: they offer up to two cards and each other player, in turn, may
 * swap one of their own cards for one offered card (or pass). When a player has
 * a combo, they declare it (spending those cards for points, held for peer
 * verification). First to the target score wins; otherwise the highest score
 * after the round limit.
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

export type BoardSpaceType = Category | 'any' | 'pass';

export interface BoardSpace {
  index: number;
  type: BoardSpaceType;
}

/**
 * An open trade opened when a full-handed player lands on a draw space. The
 * offerer puts 1–2 cards up; each other player, in seating order starting after
 * the offerer, may swap one of their own cards for one offered card or pass.
 */
export interface BoardExchange {
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

export const BOARD_SIZE = 16;

/** Fixed 16-space loop: two of each category, three "any", one "pass". */
export const BOARD_SPACES: readonly BoardSpace[] = ((): BoardSpace[] => {
  const spaces: BoardSpace[] = [];
  let index = 0;
  for (const category of CATEGORIES) {
    spaces.push({ index: index++, type: category });
    spaces.push({ index: index++, type: category });
  }
  for (let any = 0; any < 3; any += 1) spaces.push({ index: index++, type: 'any' });
  spaces.push({ index: index++, type: 'pass' });
  return spaces;
})();

/** The 16-space multiset for one lap of the board. */
function boardSpaceMultiset(): BoardSpaceType[] {
  const types: BoardSpaceType[] = [];
  for (const category of CATEGORIES) {
    types.push(category);
    types.push(category);
  }
  for (let any = 0; any < 3; any += 1) types.push('any');
  types.push('pass');
  return types;
}

function noAdjacentEqual(types: readonly BoardSpaceType[]): boolean {
  const n = types.length;
  for (let i = 0; i < n; i += 1) {
    if (types[i] === types[(i + 1) % n]) return false;
  }
  return true;
}

function shuffleInPlace<T>(items: T[], rng: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = items[i];
    items[i] = items[j];
    items[j] = swap;
  }
  return items;
}

/**
 * Guaranteed no-adjacent-equal layout: interleave the multiset into even then
 * odd positions, which separates every duplicate (and the three "any" tiles)
 * on a 16-cycle. Used only if random sampling somehow fails to find one.
 */
function interleavedSpaces(): BoardSpace[] {
  const sorted = [...boardSpaceMultiset()].sort((a, b) => {
    const freqA = boardSpaceMultiset().filter((t) => t === a).length;
    const freqB = boardSpaceMultiset().filter((t) => t === b).length;
    return freqB - freqA || (a < b ? -1 : 1);
  });
  const n = sorted.length;
  const slots: (BoardSpaceType | undefined)[] = new Array(n);
  let even = 0;
  let odd = 1;
  for (const type of sorted) {
    if (even < n) {
      slots[even] = type;
      even += 2;
    } else {
      slots[odd] = type;
      odd += 2;
    }
  }
  const laid: BoardSpaceType[] = slots.map((type, i) => type ?? sorted[i]);
  return laid.map((type, index) => ({ index, type }));
}

/**
 * Lay out the board so no two neighbouring spaces (around the loop, including the
 * wrap from last to first) share a type. Random per seed, but falls back to a
 * guaranteed interleaved layout if sampling does not find one.
 */
export function generateBoardSpaces(seed: number): BoardSpace[] {
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const multiset = boardSpaceMultiset();
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const candidate = shuffleInPlace([...multiset], rng);
    if (noAdjacentEqual(candidate)) {
      return candidate.map((type, index) => ({ index, type }));
    }
  }
  return interleavedSpaces();
}

export const BOARD_HAND_CAP = 12;
export const BOARD_DEFAULT_TARGET = 100;
export const BOARD_DEFAULT_MAX_ROUNDS = 50;

export interface BoardConfig {
  mode: GameMode;
  players: PlayerConfig[];
  targetScore?: number;
  maxRounds?: number;
  /** Card supply size; defaults to a generous pool so hands fill over a game. */
  deck?: { movieCount?: number };
  seed?: number;
  handCap?: number;
}

export interface BoardState {
  variant: 'board';
  mode: GameMode;
  players: PlayerState[];
  spaces: readonly BoardSpace[];
  positions: Record<string, number>;
  /** Per-category draw piles (shuffled). */
  piles: Record<Category, Card[]>;
  declared: DeclaredCombo[];
  /** A declaration awaiting peer verification, if any (see `PendingDeclaration`). */
  pendingDeclaration?: PendingDeclaration;
  phase: 'roll' | 'declare' | 'chooseAny' | 'exchange' | 'gameOver';
  currentPlayerIndex: number;
  turn: number;
  /** Monotonic counter; seeds the die and the "any" draw for determinism. */
  actionCount: number;
  round: number;
  maxRounds: number;
  targetScore: number;
  handCap: number;
  seed: number;
  lastRoll?: number;
  landedSpace?: number;
  /** Open trade, if a full-handed player landed on a draw space this turn. */
  exchange?: BoardExchange;
  winnerId?: string;
  /** Set when the game ends at the round limit with no outright leader. */
  draw?: boolean;
}

export type BoardAction =
  | { type: 'roll'; playerId: string }
  | { type: 'chooseAnyCategory'; playerId: string; category: Category }
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

export type BoardActionResult =
  | { ok: true; state: BoardState }
  | { ok: false; error: string };

function cloneBoard(state: BoardState): BoardState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: [...player.hand] })),
    positions: { ...state.positions },
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
    spaces: state.spaces,
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

export function createBoardGame(movies: readonly Movie[], config: BoardConfig): BoardState {
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

  const positions: Record<string, number> = {};
  for (const player of players) positions[player.id] = 0;

  return {
    variant: 'board',
    mode: config.mode,
    players,
    spaces: generateBoardSpaces(seed >>> 0),
    positions,
    piles,
    declared: [],
    phase: 'roll',
    currentPlayerIndex: 0,
    turn: 1,
    actionCount: 0,
    round: 1,
    maxRounds: config.maxRounds ?? BOARD_DEFAULT_MAX_ROUNDS,
    targetScore: config.targetScore ?? BOARD_DEFAULT_TARGET,
    handCap: config.handCap ?? BOARD_HAND_CAP,
    seed: seed >>> 0,
  };
}

/**
 * Resolve the die roll: move the token, then decide what the landed space does.
 * Returns the drawn card (if any) so callers can surface it. When the player's
 * hand is already full and there is a card to be had, `skippedBecauseFull` is
 * set so the caller can open an exchange instead of skipping the draw. When the
 * space is "any" and a draw is possible, `needsCategoryChoice` is set so the
 * caller can let the player pick a category before drawing.
 */
function resolveRoll(
  state: BoardState,
  player: PlayerState,
): {
  roll: number;
  drawn: Card | null;
  space: BoardSpace;
  skippedBecauseFull: boolean;
  needsCategoryChoice: boolean;
} {
  const rng = createRng((state.seed + state.actionCount * 2654435761) >>> 0);
  const roll = 1 + Math.floor(rng() * 6);
  const from = state.positions[player.id];
  const landed = (from + roll) % BOARD_SIZE;
  const space = state.spaces[landed];

  const categoryPilesNonEmpty = (Object.keys(state.piles) as Category[]).some(
    (category) => state.piles[category].length > 0,
  );

  if (space.type !== 'pass') {
    const cardAvailable =
      space.type === 'any' ? categoryPilesNonEmpty : state.piles[space.type].length > 0;
    if (player.hand.length >= state.handCap && cardAvailable) {
      return { roll, drawn: null, space, skippedBecauseFull: true, needsCategoryChoice: false };
    }
  }

  let drawn: Card | null = null;
  let needsCategoryChoice = false;
  if (space.type === 'any') {
    if (categoryPilesNonEmpty) needsCategoryChoice = true;
  } else if (space.type !== 'pass') {
    drawn = drawToHand(player.hand, state.piles[space.type].pop(), state.handCap);
  }

  return { roll, drawn, space, skippedBecauseFull: false, needsCategoryChoice };
}

/** Build the responder order for a freshly opened exchange (next player first). */
function createExchange(state: BoardState, offererId: string): BoardExchange {
  const offererIndex = state.players.findIndex((player) => player.id === offererId);
  const order: string[] = [];
  for (let step = 1; step < state.players.length; step += 1) {
    const index = (offererIndex + step) % state.players.length;
    order.push(state.players[index].id);
  }
  return { offererId, offeredCardIds: [], order, currentIndex: 0, takenCardIds: [] };
}

function checkWin(state: BoardState): void {
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
function vote(state: BoardState, action: VoteAction): BoardActionResult {
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

  const next = cloneBoard(state);
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
    next.landedSpace = undefined;
    checkWin(next);
    return { ok: true, state: next };
  }

  return { ok: true, state: next };
}

export function applyBoardAction(state: BoardState, action: BoardAction): BoardActionResult {
  if (state.phase === 'gameOver') {
    return { ok: false, error: 'The game is over.' };
  }

  const next = cloneBoard(state);
  next.actionCount = state.actionCount + 1;

  const current = state.players[state.currentPlayerIndex];
  // Only the core turn actions are bound to the active seat. `contest` and
  // `resolveDeclaration` may be raised by any other player during the peer
  // verification window.
  const turnLocked =
    action.type === 'roll' ||
    action.type === 'declare' ||
    action.type === 'endTurn' ||
    action.type === 'chooseAnyCategory';
  if (turnLocked && action.playerId !== current.id) {
    return { ok: false, error: "It is not that player's turn." };
  }

  if (action.type === 'roll') {
    if (state.phase !== 'roll') {
      return { ok: false, error: 'You have already rolled this turn.' };
    }
    const player = next.players[next.currentPlayerIndex];
    const { roll, skippedBecauseFull, needsCategoryChoice } = resolveRoll(next, player);
    next.lastRoll = roll;
    next.landedSpace = (next.positions[player.id] + roll) % BOARD_SIZE;
    next.positions[player.id] = next.landedSpace;
    if (skippedBecauseFull) {
      next.phase = 'exchange';
      next.exchange = createExchange(next, player.id);
    } else if (needsCategoryChoice) {
      next.phase = 'chooseAny';
    } else {
      next.phase = 'declare';
    }
    checkWin(next);
    return { ok: true, state: next };
  }

  if (action.type === 'chooseAnyCategory') {
    if (state.phase !== 'chooseAny') {
      return { ok: false, error: 'No category to choose right now.' };
    }
    if (turnLocked && action.playerId !== current.id) {
      return { ok: false, error: "It is not that player's turn." };
    }
    const pile = next.piles[action.category];
    if (!pile || pile.length === 0) {
      return { ok: false, error: 'That category is empty.' };
    }
    const player = next.players[next.currentPlayerIndex];
    drawToHand(player.hand, pile.pop(), state.handCap);
    next.phase = 'declare';
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

    const advanced: BoardExchange = { ...(next.exchange ?? exchange), currentIndex: exchange.currentIndex + 1 };
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
        next.landedSpace = undefined;
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
  next.landedSpace = undefined;
  checkWin(next);
  return { ok: true, state: next };
}

/** How many cards remain in the supply (for UI / end-of-game detection). */
export function boardCardsRemaining(state: BoardState): number {
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
  state: BoardState,
  exchange: BoardExchange,
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

/** Minimum combo value the board bot will cash in (avoids trivial 2-card scores). */
export const BOARD_DECLARE_THRESHOLD = 6;

/**
 * Heuristic board AI: roll on your turn, cash in any worthwhile combo, then end.
 * During an exchange it proposes its two least useful cards (as offerer) or
 * accepts a swap that improves its best combo (as responder). Pure and
 * deterministic like the cards-game bot; the caller applies actions in a loop
 * until this returns `null`.
 */
export function chooseBoardAiAction(state: BoardState): BoardAction | null {
  const current = state.players[state.currentPlayerIndex];
  if (state.phase === 'roll') {
    return { type: 'roll', playerId: current.id };
  }
  if (state.phase === 'chooseAny') {
    const options = CATEGORIES.filter((category) => state.piles[category].length > 0);
    if (options.length === 0) return { type: 'endTurn', playerId: current.id };
    // Diversify: prefer the category the hand currently has the fewest of, then
    // the deepest pile, so the bot collects coverage rather than duplicates.
    const choice = options
      .map((category) => ({
        category,
        have: current.hand.filter((card) => card.category === category).length,
        depth: state.piles[category].length,
      }))
      .sort((a, b) => a.have - b.have || b.depth - a.depth)[0].category;
    return { type: 'chooseAnyCategory', playerId: current.id, category: choice };
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
    if (best && best.points >= BOARD_DECLARE_THRESHOLD) {
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
