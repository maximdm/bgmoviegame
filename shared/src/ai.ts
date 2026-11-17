/**
 * Heuristic AI controller.
 *
 * The bot is a pure function of `GameState`: given the current state it returns
 * exactly one `Action` (or `null` if it cannot act). The caller applies the
 * action through `applyAction` and asks again, so the same controller drives a
 * whole turn without the engine knowing anything about AI.
 *
 * Strategy, in short:
 *  - **Find** — target the movie that already covers the most categories in
 *    hand, keep every card of that movie, and declare it once it is worth
 *    enough (or immediately in the last round / when it wins).
 *  - **Create** — compare the best "variety" pitch against the best
 *    single-movie pitch (which carries the real-movie bonus) and take the
 *    higher score.
 *  - **Draw** — take the top discard only if it strictly improves the best
 *    combo; otherwise draw blind.
 *  - **Discard** — throw away the card furthest from the kept combo, breaking
 *    ties toward duplicate categories.
 *
 * No randomness: identical states always produce identical actions, which
 * keeps games reproducible and tests deterministic.
 */
import { realMovieBonus, scoreCreateCombo, scoreFindCombo } from './scoring';
import type { Action, Card, Category, GameMode, GameState, PlayerState } from './types';

/** Declare as soon as a combo is worth this much (before the final round). */
export const DEFAULT_DECLARE_THRESHOLD = 18;

export interface AiOptions {
  /**
   * Minimum combo value the bot will cash in. Defaults to
   * `DEFAULT_DECLARE_THRESHOLD`, or `1` in the final round (better to score
   * something before the game ends).
   */
  declareThreshold?: number;
}

/** A concrete declaration the bot is considering. */
export interface ComboCandidate {
  cards: Card[];
  points: number;
  movieId?: string;
}

/** One card per category, in hand order, for a deterministic pick. */
function distinctByCategory(cards: readonly Card[]): Card[] {
  const seen = new Set<Category>();
  const out: Card[] = [];
  for (const card of cards) {
    if (seen.has(card.category)) continue;
    seen.add(card.category);
    out.push(card);
  }
  return out;
}

/**
 * Drop exactly one card, preferring a category duplicate so the remaining
 * cards keep the widest possible coverage. Used when the whole hand belongs to
 * one movie (a declaration must leave a card to discard).
 */
function trimOne(cards: readonly Card[]): Card[] {
  const counts = new Map<Category, number>();
  for (const card of cards) counts.set(card.category, (counts.get(card.category) ?? 0) + 1);

  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if ((counts.get(cards[index].category) ?? 0) > 1) {
      return cards.filter((_, i) => i !== index);
    }
  }
  return cards.slice(0, -1);
}

function groupByMovie(hand: readonly Card[]): Map<string, Card[]> {
  const groups = new Map<string, Card[]>();
  for (const card of hand) {
    const group = groups.get(card.movieId);
    if (group) group.push(card);
    else groups.set(card.movieId, [card]);
  }
  return groups;
}

/** Every same-movie combo the hand can currently declare in Find mode. */
export function findComboCandidates(hand: readonly Card[]): ComboCandidate[] {
  const candidates: ComboCandidate[] = [];

  for (const group of groupByMovie(hand).values()) {
    if (new Set(group.map((card) => card.category)).size < 2) continue;

    let picks = [...group];
    // A declaration must leave at least one card behind to discard.
    if (picks.length >= hand.length) picks = trimOne(picks);
    if (picks.length < 2 || picks.length >= hand.length) continue;

    const score = scoreFindCombo(picks);
    if (score.valid) {
      candidates.push({
        cards: picks,
        points: score.points + realMovieBonus('find', score.realMatch),
        movieId: score.movieId,
      });
    }
  }

  return candidates;
}

/**
 * Every combo the hand can pitch in Create mode: the widest variety pitch plus
 * each single-movie pitch (the only ones eligible for the real-movie bonus).
 */
export function createComboCandidates(hand: readonly Card[]): ComboCandidate[] {
  const candidates: ComboCandidate[] = [];

  const pushIfValid = (cards: Card[]): void => {
    if (cards.length < 2 || cards.length >= hand.length) return;
    const score = scoreCreateCombo(cards);
    if (score.valid) {
      candidates.push({
        cards,
        points: score.points + realMovieBonus('create', score.realMatch),
        movieId: score.movieId,
      });
    }
  };

  // Variety: every card except one, with duplicate categories dropped first.
  // Each extra card is worth its own points, so this is the maximal pitch.
  if (hand.length > 1) pushIfValid(trimOne(hand));

  for (const group of groupByMovie(hand).values()) {
    if (new Set(group.map((card) => card.category)).size < 2) continue;
    const picks = group.length >= hand.length ? trimOne(group) : [...group];
    pushIfValid(picks);
  }

  return candidates;
}

/** All declaration candidates for a mode, best first. */
export function comboCandidates(mode: GameMode, hand: readonly Card[]): ComboCandidate[] {
  const candidates = mode === 'find' ? findComboCandidates(hand) : createComboCandidates(hand);
  return candidates.sort((a, b) => b.points - a.points || b.cards.length - a.cards.length);
}

/** The highest-scoring declaration available, or `null`. */
export function bestCombo(mode: GameMode, hand: readonly Card[]): ComboCandidate | null {
  return comboCandidates(mode, hand)[0] ?? null;
}

/**
 * How much a card is worth keeping. Higher is better; the bot discards the
 * minimum. Combines same-movie depth (Find), category coverage of that movie,
 * and a penalty for duplicating a category already present.
 */
function keepScore(mode: GameMode, hand: readonly Card[], card: Card): number {
  const sameMovie = hand.filter((other) => other.movieId === card.movieId);
  const movieCategories = new Set(sameMovie.map((other) => other.category)).size;
  const sameCategory = hand.filter((other) => other.category === card.category).length;

  let score = movieCategories * 3;
  if (mode === 'find') score += sameMovie.length * 2;
  else score += 6;
  score -= (sameCategory - 1) * 5;
  return score;
}

/** Pick the card to throw away: outside the kept combo, then lowest value. */
export function chooseDiscard(mode: GameMode, hand: readonly Card[]): Card | null {
  if (hand.length === 0) return null;

  const keep = new Set((bestCombo(mode, hand)?.cards ?? []).map((card) => card.id));
  const pool = hand.filter((card) => !keep.has(card.id));
  const candidates = pool.length > 0 ? pool : hand;

  let worst = candidates[0];
  let worstScore = keepScore(mode, hand, worst);
  for (const card of candidates.slice(1)) {
    const score = keepScore(mode, hand, card);
    if (score < worstScore) {
      worst = card;
      worstScore = score;
    }
  }
  return worst;
}

/** Take the top discard only when it strictly improves the best combo. */
export function chooseDrawSource(state: GameState, player: PlayerState): 'deck' | 'discard' {
  const top = state.discardPile[state.discardPile.length - 1];
  if (!top) return 'deck';

  const before = bestCombo(state.mode, player.hand)?.points ?? 0;
  const after = bestCombo(state.mode, [...player.hand, top])?.points ?? 0;
  return after > before ? 'discard' : 'deck';
}

/** Effective declaration threshold for the current state. */
function thresholdFor(state: GameState, options: AiOptions): number {
  if (options.declareThreshold !== undefined) return options.declareThreshold;
  return state.round >= state.maxRounds ? 1 : DEFAULT_DECLARE_THRESHOLD;
}

/**
 * Decide the bot's next action. Returns `null` when the game is over or when
 * `playerId` is not the active seat (so callers can safely ask every seat).
 */
export function chooseAiAction(
  state: GameState,
  playerId?: string,
  options: AiOptions = {},
): Action | null {
  if (state.phase === 'gameOver') return null;
  // Wait for any open declaration to be verified before acting.
  if (state.pendingDeclaration) return null;

  const current = state.players[state.currentPlayerIndex];
  if (!current) return null;
  if (playerId !== undefined && playerId !== current.id) return null;

  if (state.phase === 'draw') {
    return {
      type: 'draw',
      playerId: current.id,
      source: chooseDrawSource(state, current),
    };
  }

  const candidate = bestCombo(state.mode, current.hand);
  if (candidate) {
    const threshold = thresholdFor(state, options);
    const wins = current.score + candidate.points >= state.targetScore;
    if (wins || candidate.points >= threshold) {
      return {
        type: 'declare',
        playerId: current.id,
        cardIds: candidate.cards.map((card) => card.id),
      };
    }
  }

  const card = chooseDiscard(state.mode, current.hand);
  if (!card) return null;
  return { type: 'discard', playerId: current.id, cardId: card.id };
}

/** True when the active seat is a bot. */
export function isAiTurn(state: GameState): boolean {
  return state.phase !== 'gameOver' && state.players[state.currentPlayerIndex]?.kind === 'ai';
}
