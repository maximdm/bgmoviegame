/** Small hand-written movie set used by the engine tests. */
import type { Movie } from './types';

export function makeMovie(overrides: Partial<Movie> & Pick<Movie, 'id' | 'title'>): Movie {
  return {
    year: 2000,
    actors: [],
    actresses: [],
    genres: ['Drama'],
    settings: ['Urban'],
    period: '2000s',
    countries: ['United States of America'],
    ...overrides,
  };
}

export const FIXTURE_MOVIES: readonly Movie[] = [
  makeMovie({
    id: 'matrix',
    title: 'The Matrix',
    year: 1999,
    actors: ['Keanu Reeves', 'Laurence Fishburne'],
    actresses: ['Carrie-Anne Moss'],
    genres: ['Action', 'Science Fiction'],
    settings: ['Urban'],
    period: '1990s',
  }),
  makeMovie({
    id: 'fargo',
    title: 'Fargo',
    year: 1996,
    actors: ['Steve Buscemi', 'William H. Macy'],
    actresses: ['Frances McDormand'],
    genres: ['Crime', 'Drama'],
    settings: ['Small Town'],
    period: '1990s',
  }),
  makeMovie({
    id: 'moon',
    title: 'Moon',
    year: 2009,
    actors: ['Sam Rockwell'],
    actresses: [],
    genres: ['Science Fiction', 'Drama'],
    settings: ['Moon', 'Space'],
    period: '2000s',
  }),
  makeMovie({
    id: 'titanic',
    title: 'Titanic',
    year: 1997,
    actors: ['Leonardo DiCaprio'],
    actresses: ['Kate Winslet'],
    genres: ['Drama', 'Romance'],
    settings: ['Ocean'],
    period: '1990s',
  }),
  makeMovie({
    id: 'jaws',
    title: 'Jaws',
    year: 1975,
    actors: ['Roy Scheider'],
    actresses: [],
    genres: ['Thriller', 'Adventure'],
    settings: ['Ocean'],
    period: '1970s',
  }),
  makeMovie({
    id: 'alien',
    title: 'Alien',
    year: 1979,
    actors: ['Tom Skerritt'],
    actresses: ['Sigourney Weaver'],
    genres: ['Horror', 'Science Fiction'],
    settings: ['Space'],
    period: '1970s',
  }),
];
