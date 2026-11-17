/**
 * Wikidata -> game category mapping.
 *
 * Wikidata cleanly provides release year, cast (+gender), and genre, but NOT
 * "Setting" (Forest/Moon/Space/...) or "Period" (WWII/BC/...) as structured
 * fields. This module bridges that gap with editable heuristic tables:
 *
 *  - Setting: derived from a film's narrative-location labels (P840), falling
 *    back to country-of-origin labels (P495) when no location is mapped.
 *  - Period: bucketed from the release year (P577). This is a deliberate proxy
 *    until we can source depicted-era data; it coexists with the exact
 *    "Release Year" card category.
 *
 * Tables are intentionally plain string sets so they are easy to tune.
 */

/** Category: Setting — where a film's story takes place. */
export type Setting =
  | 'Urban'
  | 'Small Town'
  | 'Forest'
  | 'Desert'
  | 'Mountains'
  | 'Island'
  | 'Ocean'
  | 'Africa'
  | 'Europe'
  | 'Asia'
  | 'Americas'
  | 'Moon'
  | 'Space';

/** Category: Period — era associated with a film (release-year proxy for now). */
export type Period =
  | 'BC / Ancient'
  | 'Antiquity'
  | 'Middle Ages'
  | 'Early Modern'
  | '19th Century'
  | 'World War I'
  | 'Interwar'
  | 'World War II'
  | '1950s'
  | '1960s'
  | '1970s'
  | '1980s'
  | '1990s'
  | '2000s'
  | '2010s'
  | '2020s'
  | 'Future';

/** Canonical ordering used for deterministic card generation. */
export const SETTINGS: readonly Setting[] = [
  'Urban',
  'Small Town',
  'Forest',
  'Desert',
  'Mountains',
  'Island',
  'Ocean',
  'Africa',
  'Europe',
  'Asia',
  'Americas',
  'Moon',
  'Space',
];

/** Canonical ordering of periods (chronological). */
export const PERIODS: readonly Period[] = [
  'BC / Ancient',
  'Antiquity',
  'Middle Ages',
  'Early Modern',
  '19th Century',
  'World War I',
  'Interwar',
  'World War II',
  '1950s',
  '1960s',
  '1970s',
  '1980s',
  '1990s',
  '2000s',
  '2010s',
  '2020s',
  'Future',
];

/**
 * Category: Genre — a deliberately small, card-friendly vocabulary.
 *
 * Wikidata's raw genre labels are a long tail ("neo-noir",
 * "psychological thriller", "romantic comedy", ...). Mapping them onto a
 * canonical set keeps genre cards reusable across movies, which the cards
 * loop depends on.
 */
export type Genre =
  | 'Action'
  | 'Adventure'
  | 'Animation'
  | 'Comedy'
  | 'Crime'
  | 'Documentary'
  | 'Drama'
  | 'Family'
  | 'Fantasy'
  | 'History'
  | 'Horror'
  | 'Musical'
  | 'Mystery'
  | 'Romance'
  | 'Science Fiction'
  | 'Thriller'
  | 'War'
  | 'Western';

/** Canonical genre ordering used for deterministic card generation. */
export const GENRES: readonly Genre[] = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Musical',
  'Mystery',
  'Romance',
  'Science Fiction',
  'Thriller',
  'War',
  'Western',
];

/**
 * Keyword rules mapping raw Wikidata labels to canonical genres. Several rules
 * can match at once ("romantic comedy" -> Comedy + Romance), and the result is
 * de-duplicated and put in `GENRES` order.
 */
const GENRE_RULES: readonly { genre: Genre; test: RegExp }[] = [
  {
    genre: 'Science Fiction',
    test: /science[ -]fiction|sci[ -]fi|cyberpunk|space opera|dystopian|post-apocalyptic|apocalyptic|speculative|biopunk|retrofuturism|tech noir|alien invasion/,
  },
  { genre: 'Fantasy', test: /fantasy|fairy tale/ },
  { genre: 'Animation', test: /animat/ },
  { genre: 'Action', test: /action|superhero|martial arts|ninja|samurai|spy|vigilante|swashbuckler/ },
  { genre: 'Adventure', test: /adventure|treasure hunt|\broad\b|\bepic\b/ },
  { genre: 'Comedy', test: /comedy|satire|satirical|parody|slapstick|mockumentary|tragicomedy/ },
  { genre: 'Crime', test: /crime|heist|gangster|noir|detective|police|prison|trial/ },
  { genre: 'Documentary', test: /documentary/ },
  {
    genre: 'Drama',
    test: /drama|melodrama|tragedy|teen|coming[ -]of[ -]age|political|survival/,
  },
  { genre: 'Family', test: /family|children|christmas/ },
  { genre: 'History', test: /histor|period|biograph|biopic|medieval|sword-and-sandal/ },
  {
    genre: 'Horror',
    test: /horror|slasher|zombie|vampire|werewolf|ghost|monster|gothic|splatter|supernatural|natural horror|religious horror/,
  },
  { genre: 'Musical', test: /musical|music-themed|music documentary/ },
  { genre: 'Mystery', test: /mystery/ },
  { genre: 'Romance', test: /romance|romantic/ },
  { genre: 'Thriller', test: /thriller|suspense|spy/ },
  { genre: 'War', test: /war|military/ },
  { genre: 'Western', test: /western/ },
];

/** Adult / explicit genres that disqualify a film from the game dataset. */
const EXCLUDED_GENRE_RE = /pornograph|erotic|fetish|\brape\b/;

/** True when a raw Wikidata genre should exclude the film from the dataset. */
export function isExcludedGenreLabel(label: string): boolean {
  return EXCLUDED_GENRE_RE.test(label.toLowerCase());
}

/** Map a raw Wikidata genre label to zero or more canonical genres. */
export function mapGenreLabelToGenres(label: string): Genre[] {
  const l = label.toLowerCase();
  const found = new Set<Genre>();
  for (const rule of GENRE_RULES) {
    if (rule.test.test(l)) found.add(rule.genre);
  }
  const order = new Map<Genre, number>(GENRES.map((g, i) => [g, i] as const));
  return [...found].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

const AFRICA_COUNTRIES = new Set([
  'africa',
  'nigeria',
  'kenya',
  'south africa',
  'egypt',
  'morocco',
  'algeria',
  'tunisia',
  'libya',
  'ethiopia',
  'ghana',
  'senegal',
  'uganda',
  'tanzania',
  'zimbabwe',
  'democratic republic of the congo',
  'republic of the congo',
  'congo',
  'sudan',
  'south sudan',
  'somalia',
  'mali',
  'cameroon',
  'ivory coast',
  "côte d'ivoire",
  'angola',
  'mozambique',
  'namibia',
  'botswana',
  'rwanda',
  'burundi',
  'madagascar',
  'mauritania',
  'niger',
  'chad',
  'burkina faso',
  'guinea',
  'benin',
  'togo',
  'sierra leone',
  'liberia',
  'gabon',
  'zambia',
  'malawi',
  'lesotho',
  'eswatini',
  'swaziland',
  'eritrea',
  'djibouti',
  'gambia',
  'cape verde',
  'comoros',
  'mauritius',
  'seychelles',
]);

const EUROPE_COUNTRIES = new Set([
  'europe',
  'united kingdom',
  'england',
  'scotland',
  'wales',
  'northern ireland',
  'ireland',
  'republic of ireland',
  'france',
  'germany',
  'italy',
  'spain',
  'portugal',
  'netherlands',
  'the netherlands',
  'belgium',
  'switzerland',
  'austria',
  'sweden',
  'norway',
  'denmark',
  'finland',
  'iceland',
  'poland',
  'czech republic',
  'czechia',
  'slovakia',
  'hungary',
  'romania',
  'bulgaria',
  'greece',
  'turkey',
  'russia',
  'ukraine',
  'belarus',
  'croatia',
  'serbia',
  'bosnia and herzegovina',
  'slovenia',
  'albania',
  'north macedonia',
  'montenegro',
  'kosovo',
  'estonia',
  'latvia',
  'lithuania',
  'luxembourg',
  'malta',
  'cyprus',
  'monaco',
  'andorra',
  'san marino',
  'liechtenstein',
  'moldova',
  'georgia',
  'armenia',
  'azerbaijan',
]);

const ASIA_COUNTRIES = new Set([
  'asia',
  'china',
  'japan',
  'india',
  'south korea',
  'north korea',
  'korea',
  'vietnam',
  'thailand',
  'indonesia',
  'malaysia',
  'philippines',
  'singapore',
  'pakistan',
  'bangladesh',
  'sri lanka',
  'nepal',
  'bhutan',
  'afghanistan',
  'iran',
  'iraq',
  'israel',
  'saudi arabia',
  'united arab emirates',
  'qatar',
  'kuwait',
  'jordan',
  'lebanon',
  'syria',
  'kazakhstan',
  'uzbekistan',
  'turkmenistan',
  'kyrgyzstan',
  'tajikistan',
  'mongolia',
  'myanmar',
  'burma',
  'cambodia',
  'laos',
  'taiwan',
  'hong kong',
  'macau',
]);

const AMERICAS_COUNTRIES = new Set([
  'americas',
  'united states of america',
  'united states',
  'usa',
  'canada',
  'mexico',
  'brazil',
  'argentina',
  'chile',
  'colombia',
  'peru',
  'venezuela',
  'ecuador',
  'bolivia',
  'uruguay',
  'paraguay',
  'cuba',
  'jamaica',
  'dominican republic',
  'haiti',
  'guatemala',
  'honduras',
  'el salvador',
  'nicaragua',
  'costa rica',
  'panama',
  'puerto rico',
  'trinidad and tobago',
  'bahamas',
  'barbados',
]);

const MAJOR_CITIES = new Set([
  'new york city',
  'new york',
  'los angeles',
  'chicago',
  'san francisco',
  'boston',
  'philadelphia',
  'washington, d.c.',
  'washington dc',
  'houston',
  'miami',
  'seattle',
  'detroit',
  'las vegas',
  'london',
  'manchester',
  'birmingham',
  'paris',
  'marseille',
  'lyon',
  'tokyo',
  'osaka',
  'kyoto',
  'berlin',
  'munich',
  'hamburg',
  'rome',
  'milan',
  'naples',
  'madrid',
  'barcelona',
  'moscow',
  'saint petersburg',
  'beijing',
  'shanghai',
  'hong kong',
  'mumbai',
  'delhi',
  'new delhi',
  'bangalore',
  'kolkata',
  'chennai',
  'cairo',
  'istanbul',
  'sao paulo',
  'são paulo',
  'rio de janeiro',
  'mexico city',
  'buenos aires',
  'toronto',
  'vancouver',
  'montreal',
  'sydney',
  'melbourne',
  'dublin',
  'amsterdam',
  'brussels',
  'vienna',
  'zurich',
  'stockholm',
  'copenhagen',
  'oslo',
  'helsinki',
  'warsaw',
  'prague',
  'budapest',
  'athens',
  'lisbon',
  'dubai',
  'seoul',
  'bangkok',
  'jakarta',
  'manila',
  'karachi',
  'lahore',
  'casablanca',
  'lagos',
  'nairobi',
  'johannesburg',
  'cape town',
]);

function normalize(label: string): string {
  return label.trim().toLowerCase();
}

/** Map a single narrative-location / country label to a Setting, if possible. */
export function mapLocationLabelToSetting(label: string): Setting | null {
  const l = normalize(label);
  if (!l) return null;

  if (l.includes('moon')) return 'Moon';
  if (/(outer space|space station|spacecraft|mars|galaxy|planet|orbit)/.test(l)) return 'Space';
  if (/(forest|jungle|woods|woodland)/.test(l)) return 'Forest';
  if (l.includes('desert')) return 'Desert';
  if (/(mountain|alps|himalaya|andes)/.test(l)) return 'Mountains';
  if (/(island|islands|isle)/.test(l)) return 'Island';
  if (/(ocean|sea|underwater|submarine)/.test(l)) return 'Ocean';
  if (MAJOR_CITIES.has(l)) return 'Urban';
  if (AFRICA_COUNTRIES.has(l)) return 'Africa';
  if (EUROPE_COUNTRIES.has(l)) return 'Europe';
  if (ASIA_COUNTRIES.has(l)) return 'Asia';
  if (AMERICAS_COUNTRIES.has(l)) return 'Americas';
  return null;
}

/**
 * Derive a deterministic, de-duplicated list of Settings for a film.
 * Narrative locations take priority; countries are only used when no location
 * could be mapped (so a US film set in Paris is tagged Europe, not Americas).
 */
export function deriveSettings(locations: string[], countries: string[]): Setting[] {
  const found = new Set<Setting>();

  for (const label of locations) {
    const setting = mapLocationLabelToSetting(label);
    if (setting) found.add(setting);
  }

  if (found.size === 0) {
    for (const label of countries) {
      const setting = mapLocationLabelToSetting(label);
      if (setting) found.add(setting);
    }
  }

  const order = new Map<Setting, number>(SETTINGS.map((s, i) => [s, i] as const));
  return [...found].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/** Bucket a release year into a Period. */
export function yearToPeriod(year: number): Period {
  if (year < 0) return 'BC / Ancient';
  if (year < 500) return 'Antiquity';
  if (year < 1500) return 'Middle Ages';
  if (year < 1800) return 'Early Modern';
  if (year < 1914) return '19th Century';
  if (year < 1919) return 'World War I';
  if (year < 1939) return 'Interwar';
  if (year < 1946) return 'World War II';
  if (year < 1960) return '1950s';
  if (year < 1970) return '1960s';
  if (year < 1980) return '1970s';
  if (year < 1990) return '1980s';
  if (year < 2000) return '1990s';
  if (year < 2010) return '2000s';
  if (year < 2020) return '2010s';
  if (year <= new Date().getFullYear()) return '2020s';
  return 'Future';
}
