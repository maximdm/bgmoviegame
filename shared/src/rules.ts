/**
 * Cards-style turn loop and game lifecycle.
 *
 * A turn is: draw one card (deck or top of discard) → optionally declare one
 * or more combos → discard one card to the middle. All functions are pure:
 * `applyAction` clones the state and returns a new one.
 */
import { buildDeck, createRng, shuffle } from './deck';
import type { DeckOptions } from './deck';
import { CONTEST_PENALTY, CONTESTS_PER_PLAYER, requiredThumbsUp } from './constants';
import {
  lacksCast,
  NO_CAST_PENALTY,
  realMovieBonus,
  scoreCreateCombo,
  scoreFindCombo,
} from './scoring';
import type {
  Action,
  ActionResult,
  Card,
  ContestAction,
  GameMode,
  GameState,
  Movie,
  PendingDeclaration,
  PlayerConfig,
  PlayerState,
  ResolveAction,
  VoteAction,
} from './types';

export const DEFAULT_HAND_SIZE = 7;
export const DEFAULT_TARGET_SCORE = 100;
export const DEFAULT_MAX_ROUNDS = 50;
export const MAX_PLAYERS = 6;

export interface GameConfig {
  mode: GameMode;
  players: PlayerConfig[];
  handSize?: number;
  targetScore?: number;
  maxRounds?: number;
  deck?: DeckOptions;
  /** Omit for a random seed; pass one for reproducible games/tests. */
  seed?: number;
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: [...player.hand] })),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    declared: [...state.declared],
    pendingDeclaration: state.pendingDeclaration
      ? {
          ...state.pendingDeclaration,
          contests: [...state.pendingDeclaration.contests],
          votes: { ...state.pendingDeclaration.votes },
        }
      : undefined,
  };
}

/** Total number of cards a player has locked into declared combos (tie-break). */
function declaredCardCount(state: GameState, playerId: string): number {
  return state.declared
    .filter((combo) => combo.playerId === playerId)
    .reduce((total, combo) => total + combo.cards.length, 0);
}

/**
 * Deal cards from the draw pile (reshuffling the discard pile if needed) until
 * the player holds a full hand. Declaring removes cards permanently, so a
 * declaration is followed by a refill — otherwise hands would shrink every
 * turn and the game could never reach the target score.
 */
function refillHand(state: GameState, player: PlayerState): void {
  while (player.hand.length < state.handSize) {
    if (state.drawPile.length === 0) {
      if (state.discardPile.length <= 1) break;
      const top = state.discardPile[state.discardPile.length - 1];
      const rest = state.discardPile.slice(0, -1);
      const rng = createRng(state.seed + state.turn * 7919 + rest.length);
      state.drawPile = shuffle(rest, rng);
      state.discardPile = [top];
    }
    const card = state.drawPile.pop();
    if (!card) break;
    player.hand.push(card);
  }
}

/**
 * End the game at the round limit and pick a winner: a player only wins if they
 * scored *and* are the sole leader. All-zero scores and any tie are a draw
 * (never an arbitrary "Player 1 wins"). The previous score → declared-cards →
 * seat-order ordering is kept purely for standings display.
 */
function finishGame(state: GameState): GameState {
  state.phase = 'gameOver';
  const ranked = [...state.players].sort(
    (a, b) =>
      b.score - a.score ||
      declaredCardCount(state, b.id) - declaredCardCount(state, a.id) ||
      state.players.indexOf(a) - state.players.indexOf(b),
  );
  const top = Math.max(...state.players.map((player) => player.score));
  const leaders = state.players.filter((player) => player.score === top);
  if (top > 0 && leaders.length === 1) {
    state.winnerId = leaders[0].id;
    state.draw = false;
  } else {
    state.winnerId = undefined;
    state.draw = true;
  }
  return state;
}

function advanceTurn(state: GameState): GameState {
  state.turn += 1;
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;

  if (nextIndex === 0) {
    if (state.round >= state.maxRounds) {
      return finishGame(state);
    }
    state.round += 1;
  }

  state.currentPlayerIndex = nextIndex;
  state.phase = 'draw';
  return state;
}

function draw(state: GameState, player: PlayerState, source: 'deck' | 'discard'): ActionResult {
  if (state.phase !== 'draw') {
    return { ok: false, error: 'You must draw a card first.' };
  }
  if (state.pendingDeclaration) {
    return { ok: false, error: 'Resolve the pending declaration before drawing.' };
  }

  const next = cloneState(state);
  const current = next.players[next.currentPlayerIndex];

  if (source === 'discard') {
    if (next.discardPile.length === 0) {
      return { ok: false, error: 'The discard pile is empty.' };
    }
    const card = next.discardPile.pop() as Card;
    current.hand.push(card);
    next.phase = 'discard';
    return { ok: true, state: next };
  }

  // Deck: reshuffle the discard pile (keeping its top card) when exhausted.
  if (next.drawPile.length === 0 && next.discardPile.length > 1) {
    const top = next.discardPile[next.discardPile.length - 1];
    const rest = next.discardPile.slice(0, -1);
    const rng = createRng(next.seed + next.turn * 7919 + rest.length);
    next.drawPile = shuffle(rest, rng);
    next.discardPile = [top];
  }

  if (next.drawPile.length === 0) {
    // Nothing left to draw anywhere: the game ends on scores.
    return { ok: true, state: finishGame(next) };
  }

  const card = next.drawPile.pop() as Card;
  current.hand.push(card);
  next.phase = 'discard';
  return { ok: true, state: next };
}

function declare(
  state: GameState,
  player: PlayerState,
  cardIds: string[],
  claimedTitle?: string,
  claimedSynopsis?: string,
): ActionResult {
  if (state.phase !== 'discard') {
    return { ok: false, error: 'Draw a card before declaring a combo.' };
  }
  if (state.pendingDeclaration) {
    return { ok: false, error: 'Resolve the pending declaration before declaring another.' };
  }
  if (new Set(cardIds).size !== cardIds.length) {
    return { ok: false, error: 'The same card was selected twice.' };
  }

  const handById = new Map(player.hand.map((card) => [card.id, card]));
  const cards: Card[] = [];
  for (const id of cardIds) {
    const card = handById.get(id);
    if (!card) return { ok: false, error: 'That card is not in your hand.' };
    cards.push(card);
  }

  if (cards.length >= player.hand.length) {
    return { ok: false, error: 'Keep at least one card to discard.' };
  }

  const score = state.mode === 'find' ? scoreFindCombo(cards) : scoreCreateCombo(cards);
  if (!score.valid) {
    return { ok: false, error: score.reason ?? 'Invalid combo.' };
  }

  const basePoints = score.points;
  const bonus = realMovieBonus(state.mode, true);
  // A combo with no cast (no Actor and no Actress card) is docked a flat penalty.
  const castPenalty = lacksCast(cards) ? NO_CAST_PENALTY : 0;
  const next = cloneState(state);
  const current = next.players[next.currentPlayerIndex];
  const selected = new Set(cardIds);
  current.hand = current.hand.filter((card) => !selected.has(card.id));
  refillHand(next, current);

  // --- Create-a-Movie: no scoring, no contest. The pitch is either logged
  // immediately (2–3 players, freeform) or opened for thumbs voting (4–6). ---
  if (state.mode === 'create') {
    const voting = next.players.length >= 4;
    if (!voting) {
      next.declared.push({
        id: `combo-${next.declared.length + 1}`,
        playerId: current.id,
        mode: 'create',
        cards,
        points: 0,
        claimedTitle: claimedTitle ?? '',
        claimedSynopsis: claimedSynopsis ?? '',
        verified: true,
        castPenalty: 0,
        turn: next.turn,
      });
      return { ok: true, state: advanceTurn(next) };
    }
    next.pendingDeclaration = {
      id: `pending-${next.declared.length + 1}`,
      playerId: current.id,
      mode: 'create',
      cards,
      basePoints: 0,
      bonusPoints: 0,
      claimedTitle: claimedTitle ?? '',
      claimedSynopsis: claimedSynopsis ?? '',
      contests: [],
      castPenalty: 0,
      turn: next.turn,
      votes: {},
    };
    return { ok: true, state: advanceTurn(next) };
  }

  // An AI seat is locked to the database: its claim is always a real film, so it
  // is auto-verified and scored immediately with no contest window.
  if (player.kind === 'ai') {
    const total = basePoints + bonus - castPenalty;
    current.score += total;
    next.declared.push({
      id: `combo-${next.declared.length + 1}`,
      playerId: current.id,
      mode: next.mode,
      cards,
      points: total,
      movieId: score.movieId,
      realMatch: score.realMatch,
      verified: true,
      castPenalty,
      turn: next.turn,
    });
    if (current.score >= next.targetScore) {
      next.phase = 'gameOver';
      next.winnerId = current.id;
      return { ok: true, state: next };
    }
    return { ok: true, state: advanceTurn(next) };
  }

  // A human declaration holds all points in a pending declaration until the
  // table verifies it through the contest window. The turn passes to the next
  // seat for that verification, and the declarer no longer discards — the hand
  // was already refilled above.
  const pending: PendingDeclaration = {
    id: `pending-${next.declared.length + 1}`,
    playerId: current.id,
    mode: next.mode,
    cards,
    basePoints,
    bonusPoints: bonus,
    claimedTitle: claimedTitle ?? '',
    contests: [],
    castPenalty,
    turn: next.turn,
  };
  next.pendingDeclaration = pending;
  return { ok: true, state: advanceTurn(next) };
}

function contest(state: GameState, player: PlayerState, action: ContestAction): ActionResult {
  const pending = state.pendingDeclaration;
  if (!pending || pending.id !== action.declarationId) {
    return { ok: false, error: 'No declaration is open to contest.' };
  }
  if (pending.mode === 'create') {
    return { ok: false, error: 'Create-a-Movie pitches are voted on, not contested.' };
  }
  if (player.id === pending.playerId) {
    return { ok: false, error: 'You cannot contest your own declaration.' };
  }
  if (player.contestsUsed >= CONTESTS_PER_PLAYER) {
    return { ok: false, error: 'You have no contests left this game.' };
  }
  if (pending.contests.some((entry) => entry.playerId === player.id)) {
    return { ok: false, error: 'You have already contested this declaration.' };
  }

  const next = cloneState(state);
  const contestant = next.players.find((entry) => entry.id === player.id);
  if (!contestant) return { ok: false, error: 'Unknown player.' };
  contestant.contestsUsed += 1;
  next.pendingDeclaration?.contests.push({ playerId: player.id, proof: action.proof ?? '' });
  return { ok: true, state: next };
}

function resolveDeclaration(state: GameState, outcome: ResolveAction['outcome']): ActionResult {
  const pending = state.pendingDeclaration;
  if (!pending) {
    return { ok: false, error: 'No declaration is pending verification.' };
  }
  if (pending.mode === 'create') {
    return { ok: false, error: 'Create-a-Movie pitches are voted on, not resolved.' };
  }

  const next = cloneState(state);
  const declarer = next.players.find((entry) => entry.id === pending.playerId);
  if (!declarer) return { ok: false, error: 'Unknown declarer.' };

  let awarded = 0;
  if (outcome === 'real') {
    awarded = pending.basePoints + pending.bonusPoints - pending.castPenalty;
    declarer.score += awarded;
    // Every challenger who contested a real film pays the penalty.
    for (const entry of pending.contests) {
      const challenger = next.players.find((player) => player.id === entry.playerId);
      if (challenger) challenger.score -= CONTEST_PENALTY;
    }
  } else {
    // A fake claim costs the declarer; challengers were right and lose nothing.
    declarer.score -= CONTEST_PENALTY;
  }

  next.declared.push({
    id: `combo-${next.declared.length + 1}`,
    playerId: pending.playerId,
    mode: pending.mode,
    cards: pending.cards,
    points: awarded,
    claimedTitle: pending.claimedTitle,
    verified: outcome === 'real',
    castPenalty: pending.castPenalty,
    turn: pending.turn,
  });
  next.pendingDeclaration = undefined;

  const leader = next.players.find((entry) => entry.score >= next.targetScore);
  if (leader) {
    next.phase = 'gameOver';
    next.winnerId = leader.id;
  }

  return { ok: true, state: next };
}

/**
 * A thumbs verdict on a Create-a-Movie pitch. The declarer cannot vote on their
 * own pitch. A pitch wins only with unanimous approval — {@link requiredThumbsUp}
 * = every other player thumbs it up — so a single great pitch can still win, but
 * large tables must actually agree rather than clearing a low 3-of-N bar. If
 * every other player has voted and the pitch is still short of unanimous, it
 * fails — it is logged (un-verified) and the turn, which already advanced when
 * the pitch was declared, simply continues. A thumbs-down has no penalty and no
 * other effect.
 */
function vote(state: GameState, player: PlayerState, action: VoteAction): ActionResult {
  const pending = state.pendingDeclaration;
  if (!pending || pending.id !== action.declarationId) {
    return { ok: false, error: 'No pitch is open to vote on.' };
  }
  if (pending.mode !== 'create') {
    return { ok: false, error: 'Only Create-a-Movie pitches are voted on.' };
  }
  if (player.id === pending.playerId) {
    return { ok: false, error: 'You cannot vote on your own pitch.' };
  }
  if (pending.votes && pending.votes[player.id]) {
    return { ok: false, error: 'You have already voted on this pitch.' };
  }

  const next = cloneState(state);
  const pendingNext = next.pendingDeclaration;
  if (!pendingNext) return { ok: false, error: 'No pitch is open to vote on.' };
  const votes: Record<string, 'up' | 'down'> = { ...(pendingNext.votes ?? {}) };
  votes[player.id] = action.vote;
  pendingNext.votes = votes;

  const ups = Object.values(votes).filter((value) => value === 'up').length;
  const voters = next.players.filter((entry) => entry.id !== pending.playerId);
  // Unanimous approval: a pitch wins only when every other player thumbs it up.
  if (ups >= requiredThumbsUp(next.players.length)) {
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
    // The turn already advanced when the pitch was declared; nothing else to do.
    return { ok: true, state: next };
  }

  return { ok: true, state: next };
}

function discard(state: GameState, player: PlayerState, cardId: string): ActionResult {
  if (state.pendingDeclaration) {
    return { ok: false, error: 'Resolve the pending declaration before discarding.' };
  }
  if (state.phase !== 'discard') {
    return { ok: false, error: 'Draw a card before discarding.' };
  }

  const index = player.hand.findIndex((card) => card.id === cardId);
  if (index === -1) {
    return { ok: false, error: 'That card is not in your hand.' };
  }
  // Discards are only allowed at a full hand (7+ by default): declaring already
  // regenerated the hand, and you should never shed below a complete hand.
  if (player.hand.length < state.handSize) {
    return { ok: false, error: `You can only discard when holding ${state.handSize} or more cards.` };
  }

  const next = cloneState(state);
  const current = next.players[next.currentPlayerIndex];
  const [card] = current.hand.splice(index, 1);
  next.discardPile.push(card);

  return { ok: true, state: advanceTurn(next) };
}

/** Apply one player action. Invalid actions return `{ ok: false }` unchanged. */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.phase === 'gameOver') {
    return { ok: false, error: 'The game is over.' };
  }

  const current = state.players[state.currentPlayerIndex];
  // Only the core turn actions are bound to the active seat. `contest` and
  // `resolveDeclaration` may be raised by any other player during the peer
  // verification window.
  const turnLocked = action.type === 'draw' || action.type === 'declare' || action.type === 'discard';
  if (turnLocked && action.playerId !== current.id) {
    return { ok: false, error: `It is ${current.name}'s turn.` };
  }

  switch (action.type) {
    case 'draw':
      return draw(state, current, action.source);
    case 'declare':
      return declare(state, current, action.cardIds, action.claimedTitle, action.claimedSynopsis);
    case 'contest': {
      const contestant = state.players.find((player) => player.id === action.playerId);
      if (!contestant) return { ok: false, error: 'Unknown player.' };
      return contest(state, contestant, action);
    }
    case 'resolveDeclaration': {
      const resolver = state.players.find((player) => player.id === action.playerId);
      if (!resolver) return { ok: false, error: 'Unknown player.' };
      return resolveDeclaration(state, action.outcome);
    }
    case 'vote': {
      const voter = state.players.find((player) => player.id === action.playerId);
      if (!voter) return { ok: false, error: 'Unknown player.' };
      return vote(state, voter, action);
    }
    case 'discard':
      return discard(state, current, action.cardId);
    default:
      return { ok: false, error: 'Unknown action.' };
  }
}

/** Create a fresh game, build and shuffle the deck, and deal opening hands. */
export function createGame(movies: readonly Movie[], config: GameConfig): GameState {
  const { players: playerConfigs } = config;
  if (playerConfigs.length === 0) {
    throw new Error('At least one player is required.');
  }
  if (playerConfigs.length > MAX_PLAYERS) {
    throw new Error(`At most ${MAX_PLAYERS} players are supported.`);
  }

  const handSize = config.handSize ?? DEFAULT_HAND_SIZE;
  const targetScore = config.targetScore ?? DEFAULT_TARGET_SCORE;
  const maxRounds = config.maxRounds ?? DEFAULT_MAX_ROUNDS;
  if (handSize < 1) throw new Error('Hand size must be at least 1.');
  if (targetScore < 1) throw new Error('Target score must be at least 1.');
  if (maxRounds < 1) throw new Error('Max rounds must be at least 1.');

  const seed = config.seed ?? Math.floor(Math.random() * 0xffffffff);
  const rng = createRng(seed);
  const deck = shuffle(buildDeck(movies, config.deck, rng), rng);

  const required = playerConfigs.length * handSize + 1;
  if (deck.length < required) {
    throw new Error(
      `Not enough cards: deck has ${deck.length}, need at least ${required}. Increase deck.movieCount.`,
    );
  }

  const players: PlayerState[] = playerConfigs.map((player, index) => ({
    id: player.id ?? `p${index + 1}`,
    name: player.name,
    kind: player.kind ?? 'human',
    hand: [],
    score: 0,
    contestsUsed: 0,
  }));

  // Deal round-robin.
  for (let round = 0; round < handSize; round += 1) {
    for (const player of players) {
      player.hand.push(deck.pop() as Card);
    }
  }

  return {
    mode: config.mode,
    players,
    handSize,
    drawPile: deck,
    discardPile: [],
    declared: [],
    phase: 'draw',
    currentPlayerIndex: 0,
    turn: 1,
    round: 1,
    maxRounds,
    targetScore,
    seed,
  };
}
