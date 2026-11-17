/**
 * Wikidata SPARQL data pipeline.
 *
 * Builds `data/movies.json` — the curated dataset bundled with the game.
 *
 * Strategy:
 *  1. Aggregate film queries over a few year windows (year + poster),
 *     restricted to notable films (sitelinks >= 25).
 *  2. Batched detail queries resolve titles, genres, narrative locations and
 *     countries via the label service.
 *  3. Batched cast queries (P161) joined with gender (P21) classify
 *     Actor vs Actress.
 *  4. Derive Setting + Period + canonical Genre via the shared mapping module.
 *  5. Filter to films with a year, >=1 genre and >=1 cast member, then write.
 *
 * Labels cannot be aggregated together with `GROUP_CONCAT` on WDQS (they come
 * back empty), and `MIN(?date)` crashes the server, so the pipeline keeps
 * queries simple and folds rows together in JS.
 *
 * If the live endpoint is unreachable (or returns too little), a curated
 * fallback seed guarantees an always-valid dataset. Force offline with
 * `npm run fetch:offline -w data`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveSettings,
  isExcludedGenreLabel,
  mapGenreLabelToGenres,
  yearToPeriod,
} from '@movie-game/shared';
import type { Period, Setting } from '@movie-game/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../movies.json');

const ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'MovieGameDataPipeline/0.1 (movie card game dataset; local development)';

const FILM_LIMIT = Number(process.env.FILM_LIMIT ?? 800);
const CAST_BATCH = Number(process.env.CAST_BATCH ?? 100);
const MIN_INTERVAL_MS = 1200;
let lastRequestAt = 0;
const FORCE_OFFLINE = process.argv.includes('--offline');
const REQUIRED_YEAR = 1914; // keep the dataset modern enough for the game

interface BindingValue {
  type: string;
  value: string;
}
type Binding = Record<string, BindingValue>;
interface SparqlResponse {
  results: { bindings: Binding[] };
}

interface MovieRecord {
  id: string;
  title: string;
  year: number;
  posterUrl?: string;
  actors: string[];
  actresses: string[];
  genres: string[];
  settings: Setting[];
  period: Period;
  countries: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keep requests spaced out — WDQS rate-limits bursty clients (HTTP 429). */
async function pace(): Promise<void> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function qidFromUri(uri: string): string {
  return uri.slice(uri.lastIndexOf('/') + 1);
}

function parseYear(dateStr?: string): number | null {
  if (!dateStr) return null;
  const match = /^(-?\d+)-/.exec(dateStr);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(value);
    }
  }
  return out;
}

async function runQuery(query: string, label: string): Promise<Binding[]> {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await pace();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70_000);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/sparql-results+json',
          'User-Agent': USER_AGENT,
        },
        body: new URLSearchParams({ query, format: 'json' }).toString(),
        signal: controller.signal,
      });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 3000 * attempt;
        console.warn(`  ${label}: rate-limited, waiting ${waitMs}ms...`);
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        if (res.status >= 500 && attempt < maxAttempts) {
          await sleep(2000 * attempt);
          continue;
        }
        throw new Error(`${label}: HTTP ${res.status} ${body}`);
      }

      const json = (await res.json()) as SparqlResponse;
      return json.results.bindings;
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

/**
 * Select up to `limit` films with their earliest release date + a poster.
 *
 * NOTE: WDQS returns empty labels when `SERVICE wikibase:label` is combined
 * with GROUP_CONCAT/aggregation, so labels are resolved in `detailsQuery`
 * instead. Aggregate-by-?film is also much cheaper than a DISTINCT subquery
 * joined back to films (which times out upstream).
 */
function filmsQuery(limit: number, fromYear: number, toYear: number): string {
  return `
SELECT ?film (SAMPLE(?date) AS ?date) (SAMPLE(?poster) AS ?poster)
WHERE {
  ?film wdt:P31 wd:Q11424 ;
        wdt:P577 ?date ;
        wdt:P136 ?genre .
  ?film wikibase:sitelinks ?sitelinks .
  FILTER(?sitelinks >= 25)
  FILTER(YEAR(?date) >= ${fromYear} && YEAR(?date) < ${toYear})
  OPTIONAL { ?film wdt:P18 ?poster . }
}
GROUP BY ?film
LIMIT ${limit}
`;
}

/** Fetch titles, genres, narrative locations and countries for a batch of films. */
function detailsQuery(filmQids: string[]): string {
  const values = filmQids.map((q) => `wd:${q}`).join(' ');
  return `
SELECT ?film ?filmLabel ?genreLabel ?locLabel ?countryLabel WHERE {
  VALUES ?film { ${values} }
  OPTIONAL { ?film wdt:P136 ?genre . }
  OPTIONAL { ?film wdt:P840 ?loc . }
  OPTIONAL { ?film wdt:P495 ?country . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${filmQids.length * 150}
`;
}

function castQuery(filmQids: string[]): string {
  const values = filmQids.map((q) => `wd:${q}`).join(' ');
  return `
SELECT ?film ?actor ?actorLabel ?gender WHERE {
  VALUES ?film { ${values} }
  ?film wdt:P161 ?actor .
  OPTIONAL { ?actor wdt:P21 ?gender . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
`;
}

function toPosterUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const url = raw.replace(/^http:/, 'https:');
  return url.includes('?') ? `${url}&width=400` : `${url}?width=400`;
}

async function fetchLive(): Promise<MovieRecord[]> {
  console.log(`Querying Wikidata for up to ${FILM_LIMIT} films...`);

  // Query a few year windows so the dataset spans eras instead of whatever
  // order WDQS happens to return.
  const windows = [
    { from: REQUIRED_YEAR, to: 1980, share: 0.25 },
    { from: 1980, to: 2000, share: 0.25 },
    { from: 2000, to: 2015, share: 0.25 },
    { from: 2015, to: 2020, share: 0.1 },
    { from: 2020, to: 2100, share: 0.15 },
  ];

  interface FilmBase {
    title: string;
    year: number;
    posterUrl?: string;
  }

  const base = new Map<string, FilmBase>();
  for (const window of windows) {
    const limit = Math.max(25, Math.round(FILM_LIMIT * window.share));
    const rows = await runQuery(
      filmsQuery(limit, window.from, window.to),
      `films ${window.from}-${window.to === 2100 ? 'now' : window.to}`,
    );

    for (const row of rows) {
      const filmUri = row.film?.value;
      if (!filmUri) continue;

      const year = parseYear(row.date?.value);
      if (year === null) continue;

      const id = qidFromUri(filmUri);
      if (base.has(id)) continue;
      base.set(id, {
        title: '', // filled in from the details query (labels not available here)
        year,
        posterUrl: toPosterUrl(row.poster?.value),
      });
    }
    console.log(
      `  window ${window.from}-${window.to === 2100 ? 'now' : window.to}: ${rows.length} rows, ${base.size} films so far`,
    );
  }

  console.log(`  ${base.size} distinct films with a release year`);
  const filmQids = [...base.keys()];

  // Titles + genres + narrative locations + countries (labels resolved by the service).
  type Details = {
    genres: Set<string>;
    locations: Set<string>;
    countries: Set<string>;
    excluded: boolean;
  };
  const detailsByFilm = new Map<string, Details>();
  const detailBatches = Math.ceil(filmQids.length / CAST_BATCH);
  for (let i = 0; i < filmQids.length; i += CAST_BATCH) {
    const batch = filmQids.slice(i, i + CAST_BATCH);
    const label = `details ${i / CAST_BATCH + 1}/${detailBatches}`;
    const rows = await runQuery(detailsQuery(batch), label);

    for (const row of rows) {
      const filmUri = row.film?.value;
      if (!filmUri) continue;

      const id = qidFromUri(filmUri);
      let entry = detailsByFilm.get(id);
      if (!entry) {
        entry = { genres: new Set(), locations: new Set(), countries: new Set(), excluded: false };
        detailsByFilm.set(id, entry);
      }

      const baseEntry = base.get(id);
      const title = row.filmLabel?.value;
      if (baseEntry && !baseEntry.title && title && title !== id) baseEntry.title = title;

      const rawGenre = row.genreLabel?.value;
      if (rawGenre && !/^Q\d+$/.test(rawGenre)) {
        if (isExcludedGenreLabel(rawGenre)) {
          entry.excluded = true;
        } else {
          for (const genre of mapGenreLabelToGenres(rawGenre)) entry.genres.add(genre);
        }
      }
      if (row.locLabel?.value) entry.locations.add(row.locLabel.value);
      if (row.countryLabel?.value) entry.countries.add(row.countryLabel.value);
    }
    console.log(`  ${label}: ${rows.length} rows`);
  }

  // Cast, split into Actor / Actress via gender (P21 = Q6581072 is female).
  const castByFilm = new Map<string, { actors: Set<string>; actresses: Set<string> }>();
  const castBatches = Math.ceil(filmQids.length / CAST_BATCH);
  for (let i = 0; i < filmQids.length; i += CAST_BATCH) {
    const batch = filmQids.slice(i, i + CAST_BATCH);
    const label = `cast ${i / CAST_BATCH + 1}/${castBatches}`;
    const rows = await runQuery(castQuery(batch), label);

    for (const row of rows) {
      const filmUri = row.film?.value;
      const actor = row.actorLabel?.value;
      if (!filmUri || !actor || /^Q\d+$/.test(actor)) continue;

      const id = qidFromUri(filmUri);
      const gender = row.gender?.value ? qidFromUri(row.gender.value) : '';
      let entry = castByFilm.get(id);
      if (!entry) {
        entry = { actors: new Set(), actresses: new Set() };
        castByFilm.set(id, entry);
      }
      if (gender === 'Q6581072') entry.actresses.add(actor);
      else entry.actors.add(actor);
    }
    console.log(`  ${label}: ${rows.length} rows`);
  }

  const movies: MovieRecord[] = [];
  for (const [id, info] of base) {
    if (!info.title) continue;

    const details = detailsByFilm.get(id);
    if (details?.excluded) continue;

    const genres = details ? [...details.genres] : [];
    if (genres.length === 0) continue;

    const cast = castByFilm.get(id);
    const actors = cast ? [...cast.actors] : [];
    const actresses = cast ? [...cast.actresses] : [];
    if (actors.length + actresses.length === 0) continue;

    const locations = details ? [...details.locations] : [];
    const countries = details ? [...details.countries] : [];

    movies.push({
      id,
      title: info.title,
      year: info.year,
      posterUrl: info.posterUrl,
      actors: uniqueStrings(actors),
      actresses: uniqueStrings(actresses),
      genres: uniqueStrings(genres),
      settings: deriveSettings(locations, countries),
      period: yearToPeriod(info.year),
      countries: uniqueStrings(countries),
    });
  }

  return movies;
}

/** Curated fallback so the pipeline always yields a usable dataset. */
const FALLBACK_MOVIES: MovieRecord[] = [
  {
    id: 'fallback-fargo-1996',
    title: 'Fargo',
    year: 1996,
    actors: ['Steve Buscemi', 'William H. Macy', 'Peter Stormare'],
    actresses: ['Frances McDormand'],
    genres: ['Crime', 'Drama', 'Thriller'],
    settings: ['Urban', 'Small Town'],
    period: '1990s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-matrix-1999',
    title: 'The Matrix',
    year: 1999,
    actors: ['Keanu Reeves', 'Laurence Fishburne', 'Hugo Weaving'],
    actresses: ['Carrie-Anne Moss'],
    genres: ['Action', 'Science Fiction'],
    settings: ['Urban'],
    period: '1990s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-inception-2010',
    title: 'Inception',
    year: 2010,
    actors: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt', 'Tom Hardy'],
    actresses: ['Elliot Page', 'Marion Cotillard'],
    genres: ['Action', 'Science Fiction', 'Thriller'],
    settings: ['Urban'],
    period: '2010s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-godfather-1972',
    title: 'The Godfather',
    year: 1972,
    actors: ['Marlon Brando', 'Al Pacino', 'James Caan'],
    actresses: ['Diane Keaton'],
    genres: ['Crime', 'Drama'],
    settings: ['Urban'],
    period: '1970s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-starwars-1977',
    title: 'Star Wars',
    year: 1977,
    actors: ['Mark Hamill', 'Harrison Ford', 'Alec Guinness'],
    actresses: ['Carrie Fisher'],
    genres: ['Action', 'Adventure', 'Science Fiction', 'Fantasy'],
    settings: ['Space'],
    period: '1970s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-jurassic-1993',
    title: 'Jurassic Park',
    year: 1993,
    actors: ['Sam Neill', 'Jeff Goldblum'],
    actresses: ['Laura Dern'],
    genres: ['Adventure', 'Science Fiction'],
    settings: ['Forest', 'Island'],
    period: '1990s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-lotr-2001',
    title: 'The Lord of the Rings: The Fellowship of the Ring',
    year: 2001,
    actors: ['Elijah Wood', 'Ian McKellen', 'Viggo Mortensen'],
    actresses: ['Liv Tyler', 'Cate Blanchett'],
    genres: ['Adventure', 'Fantasy'],
    settings: ['Forest', 'Mountains'],
    period: '2000s',
    countries: ['New Zealand'],
  },
  {
    id: 'fallback-casablanca-1942',
    title: 'Casablanca',
    year: 1942,
    actors: ['Humphrey Bogart', 'Paul Henreid'],
    actresses: ['Ingrid Bergman'],
    genres: ['Drama', 'Romance', 'War'],
    settings: ['Africa', 'Urban'],
    period: 'World War II',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-lawrence-1962',
    title: 'Lawrence of Arabia',
    year: 1962,
    actors: ['Peter O\u2019Toole', 'Omar Sharif', 'Alec Guinness'],
    actresses: [],
    genres: ['Adventure', 'Drama', 'War'],
    settings: ['Desert', 'Africa'],
    period: '1960s',
    countries: ['United Kingdom'],
  },
  {
    id: 'fallback-2001-1968',
    title: '2001: A Space Odyssey',
    year: 1968,
    actors: ['Keir Dullea', 'Gary Lockwood'],
    actresses: [],
    genres: ['Science Fiction', 'Adventure'],
    settings: ['Space', 'Moon'],
    period: '1960s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-madmax-2015',
    title: 'Mad Max: Fury Road',
    year: 2015,
    actors: ['Tom Hardy', 'Nicholas Hoult'],
    actresses: ['Charlize Theron'],
    genres: ['Action', 'Adventure', 'Science Fiction'],
    settings: ['Desert'],
    period: '2010s',
    countries: ['Australia'],
  },
  {
    id: 'fallback-alien-1979',
    title: 'Alien',
    year: 1979,
    actors: ['Tom Skerritt', 'John Hurt', 'Ian Holm'],
    actresses: ['Sigourney Weaver'],
    genres: ['Horror', 'Science Fiction'],
    settings: ['Space'],
    period: '1970s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-bladerunner-1982',
    title: 'Blade Runner',
    year: 1982,
    actors: ['Harrison Ford', 'Rutger Hauer'],
    actresses: ['Sean Young'],
    genres: ['Science Fiction', 'Thriller'],
    settings: ['Urban'],
    period: '1980s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-titanic-1997',
    title: 'Titanic',
    year: 1997,
    actors: ['Leonardo DiCaprio', 'Billy Zane'],
    actresses: ['Kate Winslet'],
    genres: ['Drama', 'Romance'],
    settings: ['Ocean'],
    period: '1990s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-avatar-2009',
    title: 'Avatar',
    year: 2009,
    actors: ['Sam Worthington', 'Stephen Lang'],
    actresses: ['Zoe Saldana', 'Sigourney Weaver'],
    genres: ['Action', 'Adventure', 'Science Fiction'],
    settings: ['Forest', 'Space'],
    period: '2000s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-gladiator-2000',
    title: 'Gladiator',
    year: 2000,
    actors: ['Russell Crowe', 'Joaquin Phoenix'],
    actresses: ['Connie Nielsen'],
    genres: ['Action', 'Drama'],
    settings: ['Urban'],
    period: '2000s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-shawshank-1994',
    title: 'The Shawshank Redemption',
    year: 1994,
    actors: ['Tim Robbins', 'Morgan Freeman'],
    actresses: [],
    genres: ['Drama'],
    settings: ['Urban'],
    period: '1990s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-pulpfiction-1994',
    title: 'Pulp Fiction',
    year: 1994,
    actors: ['John Travolta', 'Samuel L. Jackson', 'Bruce Willis'],
    actresses: ['Uma Thurman'],
    genres: ['Crime', 'Drama'],
    settings: ['Urban'],
    period: '1990s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-interstellar-2014',
    title: 'Interstellar',
    year: 2014,
    actors: ['Matthew McConaughey', 'Michael Caine'],
    actresses: ['Anne Hathaway', 'Jessica Chastain'],
    genres: ['Adventure', 'Drama', 'Science Fiction'],
    settings: ['Space'],
    period: '2010s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-grandbudapest-2014',
    title: 'The Grand Budapest Hotel',
    year: 2014,
    actors: ['Ralph Fiennes', 'Tony Revolori'],
    actresses: ['Saoirse Ronan'],
    genres: ['Comedy', 'Adventure'],
    settings: ['Europe', 'Urban'],
    period: '2010s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-jaws-1975',
    title: 'Jaws',
    year: 1975,
    actors: ['Roy Scheider', 'Robert Shaw', 'Richard Dreyfuss'],
    actresses: [],
    genres: ['Thriller', 'Adventure'],
    settings: ['Ocean'],
    period: '1970s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-revenant-2015',
    title: 'The Revenant',
    year: 2015,
    actors: ['Leonardo DiCaprio', 'Tom Hardy'],
    actresses: [],
    genres: ['Adventure', 'Drama'],
    settings: ['Forest', 'Mountains'],
    period: '2010s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-slumdog-2008',
    title: 'Slumdog Millionaire',
    year: 2008,
    actors: ['Dev Patel'],
    actresses: ['Freida Pinto'],
    genres: ['Drama', 'Romance'],
    settings: ['Asia', 'Urban'],
    period: '2000s',
    countries: ['United Kingdom'],
  },
  {
    id: 'fallback-blackpanther-2018',
    title: 'Black Panther',
    year: 2018,
    actors: ['Chadwick Boseman', 'Michael B. Jordan'],
    actresses: ['Lupita Nyong\u2019o'],
    genres: ['Action', 'Adventure', 'Science Fiction'],
    settings: ['Africa'],
    period: '2010s',
    countries: ['United States of America'],
  },
  {
    id: 'fallback-moon-2009',
    title: 'Moon',
    year: 2009,
    actors: ['Sam Rockwell'],
    actresses: [],
    genres: ['Science Fiction', 'Drama'],
    settings: ['Moon', 'Space'],
    period: '2000s',
    countries: ['United Kingdom'],
  },
];

function buildFromSeed(): MovieRecord[] {
  return FALLBACK_MOVIES.map((movie) => ({
    id: movie.id,
    title: movie.title,
    year: movie.year,
    posterUrl: movie.posterUrl,
    actors: [...movie.actors],
    actresses: [...movie.actresses],
    genres: [...movie.genres],
    settings: [...movie.settings],
    period: movie.period,
    countries: [...movie.countries],
  }));
}

function validate(movies: MovieRecord[]): string[] {
  const problems: string[] = [];
  if (movies.length === 0) problems.push('dataset is empty');
  for (const movie of movies) {
    if (!Number.isInteger(movie.year)) problems.push(`${movie.id}: missing year`);
    if (movie.genres.length === 0) problems.push(`${movie.id}: no genre`);
    if (movie.actors.length + movie.actresses.length === 0) {
      problems.push(`${movie.id}: no cast`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  let movies: MovieRecord[] = [];
  let source = 'wikidata';

  if (!FORCE_OFFLINE) {
    try {
      movies = await fetchLive();
    } catch (err) {
      console.warn(`Live Wikidata fetch failed: ${(err as Error).message}`);
    }
  } else {
    console.log('Offline mode requested — skipping live fetch.');
  }

  if (movies.length < 50) {
    console.warn(
      `Only ${movies.length} live movies — using curated fallback seed (${FALLBACK_MOVIES.length}).`,
    );
    movies = buildFromSeed();
    source = 'fallback-seed';
  }

  movies.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const dataset = {
    generatedAt: new Date().toISOString(),
    source,
    count: movies.length,
    movies,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  const problems = validate(movies);
  const withSetting = movies.filter((m) => m.settings.length > 0).length;
  const withActress = movies.filter((m) => m.actresses.length > 0).length;
  const genres = new Set(movies.flatMap((m) => m.genres));

  console.log(`\nWrote ${movies.length} movies to ${OUT_PATH}`);
  console.log(`  source:            ${source}`);
  console.log(`  distinct genres:   ${genres.size}`);
  console.log(`  with >=1 setting:  ${withSetting}/${movies.length}`);
  console.log(`  with >=1 actress:  ${withActress}/${movies.length}`);

  if (problems.length > 0) {
    console.warn(`\nValidation issues (${problems.length}):`);
    for (const problem of problems.slice(0, 20)) console.warn(`  - ${problem}`);
    process.exitCode = 1;
  } else {
    console.log('  validation:        OK (year + genre + cast for every movie)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
