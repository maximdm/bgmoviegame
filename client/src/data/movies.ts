/**
 * The bundled Wikidata dataset.
 *
 * The JSON is produced by `npm run data:fetch` and committed with the repo, so
 * the client ships a ready-to-play movie list with no network dependency.
 */
import raw from '../../../data/movies.json';
import type { Movie } from '@movie-game/shared';

interface MovieFile {
  generatedAt: string;
  source: string;
  count: number;
  movies: Movie[];
}

const file = raw as unknown as MovieFile;

export const MOVIES: readonly Movie[] = file.movies;
export const MOVIES_BY_ID: ReadonlyMap<string, Movie> = new Map(
  MOVIES.map((movie) => [movie.id, movie]),
);
export const DATASET_COUNT = MOVIES.length;
