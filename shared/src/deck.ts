/**
 * Deterministic deck construction and randomness helpers.
 *
 * A deck is built from a random subset of the movie dataset. Each selected
 * movie contributes one Release Year card, one Period card, and a sample of
 * its genres / actors / actresses / settings. Keeping the sample caps small
 * makes the deck a playable size and pushes players toward cross-category
 * combos rather than hoarding one movie's entire cast.
 */
import type { Card, Category, Movie } from './types';

/** Random number generator in [0, 1). */
export type Rng = () => number;

/** Small, fast, seedable PRNG (mulberry32) for reproducible games/tests. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface DeckOptions {
  /** How many movies contribute cards. */
  movieCount?: number;
  maxActors?: number;
  maxActresses?: number;
  maxGenres?: number;
  maxSettings?: number;
}

export const DEFAULT_DECK_OPTIONS: Required<DeckOptions> = {
  movieCount: 40,
  maxActors: 2,
  maxActresses: 2,
  maxGenres: 2,
  maxSettings: 1,
};

/** Take up to `limit` entries from an array in a seeded random order. */
function sample<T>(items: readonly T[], limit: number, rng: Rng): T[] {
  if (limit <= 0 || items.length === 0) return [];
  if (items.length <= limit) return [...items];
  return shuffle(items, rng).slice(0, limit);
}

/**
 * Build the physical card deck for a game.
 *
 * Deterministic for a given movie order, options and RNG. The caller decides
 * whether to shuffle the resulting deck (see `createGame`).
 */
export function buildDeck(
  movies: readonly Movie[],
  options: DeckOptions = {},
  rng: Rng = Math.random,
): Card[] {
  if (movies.length === 0) return [];

  const opts = { ...DEFAULT_DECK_OPTIONS, ...options };
  const chosen = shuffle(movies, rng).slice(0, Math.max(0, Math.min(opts.movieCount, movies.length)));

  const cards: Card[] = [];
  const counters = new Map<string, number>();

  const add = (movie: Movie, category: Category, label: string): void => {
    if (!label) return;
    const key = `${movie.id}:${category}`;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    cards.push({ id: `${key}:${index}`, category, label, movieId: movie.id });
  };

  for (const movie of chosen) {
    add(movie, 'ReleaseYear', String(movie.year));
    add(movie, 'Period', movie.period);

    for (const genre of sample(movie.genres, opts.maxGenres, rng)) {
      add(movie, 'Genre', genre);
    }
    for (const actor of sample(movie.actors, opts.maxActors, rng)) {
      add(movie, 'Actor', actor);
    }
    for (const actress of sample(movie.actresses, opts.maxActresses, rng)) {
      add(movie, 'Actress', actress);
    }
    for (const setting of sample(movie.settings, opts.maxSettings, rng)) {
      add(movie, 'Setting', setting);
    }
  }

  return cards;
}
