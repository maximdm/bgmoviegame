import { describe, expect, it } from 'vitest';
import { DEFAULT_DECK_OPTIONS, buildDeck, createRng, shuffle } from './deck';
import { FIXTURE_MOVIES, makeMovie } from './testFixtures';
import type { Card, Category } from './types';

const FIXTURE_IDS = new Set(FIXTURE_MOVIES.map((movie) => movie.id));

function ofCategory(deck: readonly Card[], movieId: string, category: Category): Card[] {
  return deck.filter((card) => card.movieId === movieId && card.category === category);
}

/** A single movie that exceeds every sampling cap. */
const RICH_MOVIE = makeMovie({
  id: 'rich',
  title: 'Rich Movie',
  year: 1984,
  period: '1980s',
  actors: ['Actor A', 'Actor B', 'Actor C', 'Actor D'],
  actresses: ['Actress A', 'Actress B', 'Actress C'],
  genres: ['Action', 'Comedy', 'Drama', 'Horror'],
  settings: ['Urban', 'Forest', 'Ocean'],
});

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(123);
    const b = createRng(123);
    const sequenceA = Array.from({ length: 5 }, () => a());
    const sequenceB = Array.from({ length: 5 }, () => b());
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces values in [0, 1)', () => {
    const rng = createRng(42);
    for (let i = 0; i < 200; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('produces different sequences for different seeds', () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });
});

describe('shuffle', () => {
  it('is deterministic for a given seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffle(input, createRng(9))).toEqual(shuffle(input, createRng(9)));
  });

  it('does not mutate the input and keeps every element', () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const shuffled = shuffle(input, createRng(5));
    expect(input).toEqual(copy);
    expect([...shuffled].sort()).toEqual([...input].sort());
  });
});

describe('buildDeck', () => {
  it('returns an empty deck when there are no movies', () => {
    expect(buildDeck([])).toEqual([]);
  });

  it('is deterministic for the same movies, options and seed', () => {
    const options = { movieCount: 4, maxActors: 2, maxActresses: 2, maxGenres: 2, maxSettings: 1 };
    const a = buildDeck(FIXTURE_MOVIES, options, createRng(2024));
    const b = buildDeck(FIXTURE_MOVIES, options, createRng(2024));
    expect(a).toEqual(b);
  });

  it('only uses the requested number of movies', () => {
    const deck = buildDeck(FIXTURE_MOVIES, { movieCount: 2 }, createRng(11));
    expect(new Set(deck.map((card) => card.movieId)).size).toBe(2);
    expect(deck.every((card) => FIXTURE_IDS.has(card.movieId))).toBe(true);
  });

  it('uses every movie when movieCount exceeds the dataset', () => {
    const deck = buildDeck(FIXTURE_MOVIES, { movieCount: 99 }, createRng(3));
    expect(new Set(deck.map((card) => card.movieId))).toEqual(FIXTURE_IDS);
  });

  it('produces a deck for movieCount 0', () => {
    expect(buildDeck(FIXTURE_MOVIES, { movieCount: 0 }, createRng(3))).toEqual([]);
  });

  it('gives every card a unique id', () => {
    const deck = buildDeck(FIXTURE_MOVIES, { movieCount: 6 }, createRng(17));
    expect(new Set(deck.map((card) => card.id)).size).toBe(deck.length);
  });

  it('gives every selected movie exactly one Release Year and one Period card', () => {
    const deck = buildDeck(FIXTURE_MOVIES, { movieCount: 6 }, createRng(23));
    for (const movie of FIXTURE_MOVIES) {
      const years = ofCategory(deck, movie.id, 'ReleaseYear');
      const periods = ofCategory(deck, movie.id, 'Period');
      expect(years).toHaveLength(1);
      expect(periods).toHaveLength(1);
      expect(years[0].label).toBe(String(movie.year));
      expect(periods[0].label).toBe(movie.period);
    }
  });

  it('only draws labels from the movie the card belongs to', () => {
    const deck = buildDeck(FIXTURE_MOVIES, { movieCount: 6 }, createRng(29));
    const byId = new Map(FIXTURE_MOVIES.map((movie) => [movie.id, movie]));
    for (const card of deck) {
      const movie = byId.get(card.movieId);
      expect(movie).toBeDefined();
      if (!movie) continue;
      switch (card.category) {
        case 'Actor':
          expect(movie.actors).toContain(card.label);
          break;
        case 'Actress':
          expect(movie.actresses).toContain(card.label);
          break;
        case 'Genre':
          expect(movie.genres).toContain(card.label);
          break;
        case 'Setting':
          expect(movie.settings).toContain(card.label);
          break;
        default:
          break;
      }
    }
  });

  it('respects the sampling caps and keeps the hidden movie reference', () => {
    const deck = buildDeck(
      [RICH_MOVIE],
      { maxActors: 2, maxActresses: 2, maxGenres: 2, maxSettings: 1 },
      createRng(31),
    );

    expect(ofCategory(deck, 'rich', 'Actor')).toHaveLength(2);
    expect(ofCategory(deck, 'rich', 'Actress')).toHaveLength(2);
    expect(ofCategory(deck, 'rich', 'Genre')).toHaveLength(2);
    expect(ofCategory(deck, 'rich', 'Setting')).toHaveLength(1);
    expect(deck.every((card) => card.movieId === 'rich')).toBe(true);
    expect(new Set(deck.map((card) => card.id)).size).toBe(deck.length);
  });

  it('applies the default caps when no options are given', () => {
    const deck = buildDeck([RICH_MOVIE], {}, createRng(37));
    expect(ofCategory(deck, 'rich', 'Actor')).toHaveLength(DEFAULT_DECK_OPTIONS.maxActors);
    expect(ofCategory(deck, 'rich', 'Actress')).toHaveLength(DEFAULT_DECK_OPTIONS.maxActresses);
    expect(ofCategory(deck, 'rich', 'Genre')).toHaveLength(DEFAULT_DECK_OPTIONS.maxGenres);
    expect(ofCategory(deck, 'rich', 'Setting')).toHaveLength(DEFAULT_DECK_OPTIONS.maxSettings);
  });

  it('omits a category entirely when its cap is zero', () => {
    const deck = buildDeck(
      [RICH_MOVIE],
      { maxActors: 0, maxActresses: 0, maxGenres: 0, maxSettings: 0 },
      createRng(41),
    );
    expect(deck.map((card) => card.category).sort()).toEqual(['Period', 'ReleaseYear']);
  });
});
