import { describe, expect, it } from 'vitest';
import {
  deriveSettings,
  isExcludedGenreLabel,
  mapGenreLabelToGenres,
  mapLocationLabelToSetting,
  yearToPeriod,
} from './wikidataMapping';

describe('mapLocationLabelToSetting', () => {
  it('recognises named settings and locations', () => {
    expect(mapLocationLabelToSetting('Paris')).toBe('Urban');
    expect(mapLocationLabelToSetting('France')).toBe('Europe');
    expect(mapLocationLabelToSetting('Moon')).toBe('Moon');
    expect(mapLocationLabelToSetting('Mars')).toBe('Space');
    expect(mapLocationLabelToSetting('Amazon rainforest')).toBe('Forest');
    expect(mapLocationLabelToSetting('Sahara Desert')).toBe('Desert');
  });

  it('returns null for unmapped labels', () => {
    expect(mapLocationLabelToSetting('')).toBeNull();
    expect(mapLocationLabelToSetting('Somewhere Unmapped')).toBeNull();
  });
});

describe('deriveSettings', () => {
  it('prefers narrative locations over country of origin', () => {
    expect(deriveSettings(['Paris'], ['United States of America'])).toEqual(['Urban']);
  });

  it('falls back to countries when no location maps', () => {
    expect(deriveSettings(['Somewhere Unmapped'], ['France'])).toEqual(['Europe']);
  });

  it('de-duplicates and sorts deterministically', () => {
    expect(deriveSettings(['London', 'Paris', 'Tokyo'], [])).toEqual(['Urban']);
    expect(deriveSettings(['Japan', 'France'], [])).toEqual(['Europe', 'Asia']);
  });
});

describe('yearToPeriod', () => {
  it('buckets release years chronologically', () => {
    expect(yearToPeriod(-500)).toBe('BC / Ancient');
    expect(yearToPeriod(1942)).toBe('World War II');
    expect(yearToPeriod(1916)).toBe('World War I');
    expect(yearToPeriod(1999)).toBe('1990s');
    expect(yearToPeriod(2024)).toBe('2020s');
    expect(yearToPeriod(2300)).toBe('Future');
  });
});

describe('mapGenreLabelToGenres', () => {
  it('maps raw Wikidata labels to canonical genres', () => {
    expect(mapGenreLabelToGenres('drama film')).toEqual(['Drama']);
    expect(mapGenreLabelToGenres('romantic comedy film')).toEqual(['Comedy', 'Romance']);
    expect(mapGenreLabelToGenres('science fiction horror film')).toEqual([
      'Horror',
      'Science Fiction',
    ]);
    expect(mapGenreLabelToGenres('neo-noir crime thriller')).toEqual(['Crime', 'Thriller']);
  });

  it('returns an empty list for unrecognised genres', () => {
    expect(mapGenreLabelToGenres('lgbtq-related')).toEqual([]);
  });
});

describe('isExcludedGenreLabel', () => {
  it('flags adult genres only', () => {
    expect(isExcludedGenreLabel('pornographic film')).toBe(true);
    expect(isExcludedGenreLabel('erotic thriller')).toBe(true);
    expect(isExcludedGenreLabel('drama film')).toBe(false);
  });
});
