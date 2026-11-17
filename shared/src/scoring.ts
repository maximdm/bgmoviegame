/**
 * Combo scoring for both game modes.
 *
 * Find a Movie — a combo is valid if it spans at least 2 cards across 2+
 * categories. The movie a player claims is no longer a hidden truth the engine
 * enforces: any plausible real film can be proposed and is later verified by
 * the table. A combo that happens to share a `movieId` is still reported so the
 * AI (which is locked to the database) can be displayed normally.
 *
 * Create a Movie — any multi-category pitch is valid. Points reward size and
 * variety; covering all six colors earns a bonus.
 *
 * The real-movie bonus for a human declaration is awarded only after the group
 * verifies the claimed title (see `rules.ts` / `board.ts`). Because the engine
 * no longer gates it on a hidden answer, the bonus is a flat amount per mode.
 */
import type { Card, GameMode } from './types';

export const FIND_POINTS_PER_CARD = 2;
export const FIND_ALL_SIX_BONUS = 10;
/** Bonus for a verified real film (Find mode), held until peer verification. */
export const FIND_REAL_MOVIE_BONUS = 10;

export const CREATE_POINTS_PER_CARD = 2;
export const CREATE_POINTS_PER_CATEGORY = 3;
export const CREATE_ALL_SIX_BONUS = 15;
export const CREATE_REAL_MOVIE_BONUS = 20;

/**
 * Points lost per category a combo does not cover. A 2-card/2-colour combo
 * therefore scores only its raw card points; full six-colour coverage avoids it.
 * The penalty is clamped so a combo never drops below its size×per-card value.
 */
export const MISSING_CATEGORY_PENALTY = 2;

/**
 * Points lost when a declared combo features neither an Actor nor an Actress
 * card. A "movie" without any cast feels incomplete, so the engine docks a flat
 * penalty from the awarded points once the claim is verified (or auto-scored for
 * an AI seat).
 */
export const NO_CAST_PENALTY = 10;

/**
 * True when the combo contains no Actor card and no Actress card — i.e. it has
 * no cast at all. Such a combo incurs the {@link NO_CAST_PENALTY}.
 */
export function lacksCast(cards: readonly Card[]): boolean {
  return !cards.some((card) => card.category === 'Actor' || card.category === 'Actress');
}

/**
 * The real-movie bonus for a combo. `realMatch` is true only when the cards
 * actually share a real movie (used by the AI, which is locked to the database,
 * to rank its candidates). For human declarations there is no hidden answer, so
 * the engine passes `realMatch: true` explicitly when it holds points for peer
 * verification, and the bonus is ultimately awarded only if the table verifies
 * the claimed title.
 */
export function realMovieBonus(mode: GameMode, realMatch?: boolean): number {
  if (!realMatch) return 0;
  return mode === 'find' ? FIND_REAL_MOVIE_BONUS : CREATE_REAL_MOVIE_BONUS;
}

export interface ComboScore {
  valid: boolean;
  points: number;
  size: number;
  categoryCount: number;
  /** Present when the combo maps to one real movie (always for Find). */
  movieId?: string;
  /** Create mode only: all cards belong to one real movie. */
  realMatch?: boolean;
  /** Why a combo was rejected. */
  reason?: string;
}

interface Base {
  size: number;
  categoryCount: number;
}

function countCategories(cards: readonly Card[]): number {
  return new Set(cards.map((card) => card.category)).size;
}

function rejected(base: Base, reason: string): ComboScore {
  return { valid: false, points: 0, ...base, reason };
}

function allSameMovie(cards: readonly Card[]): boolean {
  const movieId = cards[0]?.movieId;
  return movieId !== undefined && cards.every((card) => card.movieId === movieId);
}

/** Score a Find-a-Movie declaration (base value; the real-movie bonus is gated elsewhere). */
export function scoreFindCombo(cards: readonly Card[]): ComboScore {
  const base: Base = { size: cards.length, categoryCount: countCategories(cards) };

  if (cards.length < 2) {
    return rejected(base, 'A combo needs at least 2 cards.');
  }
  if (base.categoryCount < 2) {
    return rejected(base, 'A Find-a-Movie combo needs at least 2 different categories.');
  }

  const sizePoints = cards.length * FIND_POINTS_PER_CARD;
  const coveragePoints = base.categoryCount ** 2;
  const allSixBonus = base.categoryCount === 6 ? FIND_ALL_SIX_BONUS : 0;
  const penalty = MISSING_CATEGORY_PENALTY * (6 - base.categoryCount);
  const points = Math.max(sizePoints, sizePoints + coveragePoints + allSixBonus - penalty);

  // The engine no longer requires cards to share a hidden movie, but it still
  // reports the coincidence so AI declarations (locked to the database) render
  // with their real title.
  const sameMovie = allSameMovie(cards);
  return {
    valid: true,
    points,
    ...base,
    movieId: sameMovie ? cards[0].movieId : undefined,
    realMatch: sameMovie,
  };
}

/** Score a Create-a-Movie pitch (base value; the real-movie bonus is gated elsewhere). */
export function scoreCreateCombo(cards: readonly Card[]): ComboScore {
  const base: Base = { size: cards.length, categoryCount: countCategories(cards) };

  if (cards.length < 2) {
    return rejected(base, 'A pitch needs at least 2 cards.');
  }
  if (base.categoryCount < 2) {
    return rejected(base, 'A pitch needs at least 2 different categories.');
  }

  const sizePoints = cards.length * CREATE_POINTS_PER_CARD;
  const varietyPoints = base.categoryCount * CREATE_POINTS_PER_CATEGORY;
  const allSixBonus = base.categoryCount === 6 ? CREATE_ALL_SIX_BONUS : 0;
  const penalty = MISSING_CATEGORY_PENALTY * (6 - base.categoryCount);
  const points = Math.max(sizePoints, sizePoints + varietyPoints + allSixBonus - penalty);
  const realMatch = allSameMovie(cards);

  return {
    valid: true,
    points,
    ...base,
    realMatch,
    movieId: realMatch ? cards[0].movieId : undefined,
  };
}
