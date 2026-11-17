import { describe, expect, it } from 'vitest';
import { scoreCreateCombo, scoreFindCombo } from './scoring';
import type { Card, Category } from './types';

const ALL_CATEGORIES: readonly Category[] = [
  'Actor',
  'Actress',
  'Period',
  'Setting',
  'ReleaseYear',
  'Genre',
];

function card(movieId: string, category: Category, index = 0): Card {
  return {
    id: `${movieId}:${category}:${index}`,
    category,
    label: `${movieId} ${category} ${index}`,
    movieId,
  };
}

/** One card per category, all from the same movie. */
function fullCombo(movieId: string): Card[] {
  return ALL_CATEGORIES.map((category) => card(movieId, category));
}

/** One card per category, each from a different movie. */
function mixedFullCombo(): Card[] {
  return ALL_CATEGORIES.map((category, index) => card(`movie-${index}`, category));
}

describe('scoreFindCombo', () => {
  it('rejects combos with fewer than 2 cards', () => {
    const result = scoreFindCombo([card('m1', 'Actor')]);
    expect(result).toMatchObject({ valid: false, points: 0, size: 1, categoryCount: 1 });
    expect(result.reason).toMatch(/at least 2 cards/);
  });

  it('accepts cards from different movies (no hidden answer required)', () => {
    const result = scoreFindCombo([card('m1', 'Actor'), card('m2', 'Actress')]);
    expect(result).toMatchObject({ valid: true, points: 4, realMatch: false });
    expect(result.movieId).toBeUndefined();
  });

  it('rejects a combo that only covers one category', () => {
    const result = scoreFindCombo([card('m1', 'Actor', 0), card('m1', 'Actor', 1)]);
    expect(result).toMatchObject({ valid: false, points: 0, categoryCount: 1 });
    expect(result.reason).toMatch(/2 different categories/);
  });

  it('scores 2 cards across 2 categories: 2*2 + 2^2, penalty leaves only card points', () => {
    expect(scoreFindCombo([card('m1', 'Actor'), card('m1', 'Actress')])).toEqual({
      valid: true,
      points: 4,
      size: 2,
      categoryCount: 2,
      movieId: 'm1',
      realMatch: true,
    });
  });

  it('scores 3 cards across 3 categories: 3*2 + 3^2 minus penalty = 9', () => {
    const result = scoreFindCombo([
      card('m1', 'Actor'),
      card('m1', 'Genre'),
      card('m1', 'Setting'),
    ]);
    expect(result).toMatchObject({ valid: true, points: 9, size: 3, categoryCount: 3, realMatch: true });
  });

  it('adds the all-six bonus: 6*2 + 6^2 + 10 = 58', () => {
    const result = scoreFindCombo(fullCombo('m1'));
    expect(result).toMatchObject({
      valid: true,
      points: 58,
      size: 6,
      categoryCount: 6,
      movieId: 'm1',
    });
  });

  it('reports the hidden movie for a valid combo', () => {
    expect(scoreFindCombo(fullCombo('matrix')).movieId).toBe('matrix');
  });
});

describe('scoreCreateCombo', () => {
  it('rejects combos with fewer than 2 cards', () => {
    const result = scoreCreateCombo([]);
    expect(result).toMatchObject({ valid: false, points: 0, size: 0, categoryCount: 0 });
    expect(result.reason).toMatch(/at least 2 cards/);
  });

  it('rejects a pitch that only covers one category', () => {
    const result = scoreCreateCombo([card('m1', 'Genre', 0), card('m2', 'Genre', 1)]);
    expect(result).toMatchObject({ valid: false, points: 0, categoryCount: 1 });
    expect(result.reason).toMatch(/2 different categories/);
  });

  it('accepts cards from different movies without the real-movie bonus', () => {
    const result = scoreCreateCombo([card('m1', 'Actor'), card('m2', 'Actress')]);
    expect(result).toEqual({
      valid: true,
      points: 4,
      size: 2,
      categoryCount: 2,
      realMatch: false,
      movieId: undefined,
    });
  });

  it('scores 3 cards across 2 categories: 3*2 + 2*3 minus penalty = 6', () => {
    const result = scoreCreateCombo([
      card('m1', 'Actor'),
      card('m2', 'Actor', 1),
      card('m3', 'Genre'),
    ]);
    expect(result).toMatchObject({ valid: true, points: 6, categoryCount: 2 });
  });

  it('scores a mixed six-color pitch: 6*2 + 6*3 + 15 = 45', () => {
    const result = scoreCreateCombo(mixedFullCombo());
    expect(result).toMatchObject({
      valid: true,
      points: 45,
      size: 6,
      categoryCount: 6,
      realMatch: false,
    });
    expect(result.movieId).toBeUndefined();
  });

  it('flags the real-movie match but leaves the bonus to verification', () => {
    const result = scoreCreateCombo([card('m1', 'Actor'), card('m1', 'Actress')]);
    expect(result).toMatchObject({
      valid: true,
      points: 4,
      realMatch: true,
      movieId: 'm1',
    });
  });

  it('scores a full six-colour real-movie pitch: 6*2 + 6*3 + 15 = 45 (bonus gated)', () => {
    const result = scoreCreateCombo(fullCombo('m1'));
    expect(result).toMatchObject({
      valid: true,
      points: 45,
      size: 6,
      categoryCount: 6,
      realMatch: true,
      movieId: 'm1',
    });
  });
});
