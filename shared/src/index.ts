/**
 * Shared, framework-agnostic game engine.
 *
 * Exposes the movie/card model, deck construction, scoring, the cards turn
 * loop, and the Wikidata -> game-category mapping. No React/Pixi/network
 * imports belong in this package.
 */
export const APP_NAME = 'Movie Game' as const;

export * from './types';
export * from './wikidataMapping';
export * from './deck';
export * from './scoring';
export * from './rules';
export * from './ai';
export * from './board';
export * from './dice';
export * from './constants';
