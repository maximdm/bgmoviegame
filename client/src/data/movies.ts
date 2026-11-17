/**
 * The bundled Wikidata dataset.
 *
 * The JSON is produced by `npm run data:fetch` and committed with the repo, so
 * the client ships a ready-to-play movie list with no network dependency.
 *
 * It is loaded with a dynamic `import()` (via `loadMovies`) so Vite/Rolldown
 * splits the ~450 KB dataset into its own chunk instead of bloating the initial
 * bundle. The synchronous accessors below read from a module-level cache that is
 * populated once the JSON chunk has loaded; `App` gates the UI on `loadMovies()`
 * so every consumer is guaranteed to run after the data is ready.
 */
import type { Movie } from '@movie-game/shared';

interface MovieFile {
  generatedAt: string;
  source: string;
  count: number;
  movies: Movie[];
}

let cache: MovieFile | null = null;
let byId: ReadonlyMap<string, Movie> | null = null;

/** Loads (and caches) the dataset. Idempotent — safe to call repeatedly. */
export async function loadMovies(): Promise<MovieFile> {
  if (cache) return cache;
  const mod = await import('../../../data/movies.json');
  cache = mod.default as MovieFile;
  byId = new Map(cache.movies.map((movie) => [movie.id, movie]));
  return cache;
}

function ensureLoaded(): MovieFile {
  if (!cache) throw new Error('Movie dataset not loaded — call loadMovies() first');
  return cache;
}

export function getMovies(): readonly Movie[] {
  return ensureLoaded().movies;
}

export function getMovieById(id: string | undefined): Movie | undefined {
  if (!id) return undefined;
  if (!byId) ensureLoaded();
  return byId?.get(id);
}

export function getDatasetCount(): number {
  return cache?.movies.length ?? 0;
}
