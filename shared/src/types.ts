/**
 * Engine types: movies, cards, players, game state and actions.
 *
 * Everything here is plain data — no React/Pixi/network imports — so the same
 * definitions are used by the client, the AI controllers and the server.
 */
import type { Genre, Period, Setting } from './wikidataMapping';

/** The six card categories / colors. */
export const CATEGORIES = [
  'Actor',
  'Actress',
  'Period',
  'Setting',
  'ReleaseYear',
  'Genre',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Human-readable names (ReleaseYear renders with a space). */
export const CATEGORY_LABELS: Record<Category, string> = {
  Actor: 'Actor',
  Actress: 'Actress',
  Period: 'Period',
  Setting: 'Setting',
  ReleaseYear: 'Release Year',
  Genre: 'Genre',
};

/** Card colors (numeric, ready for PixiJS). */
export const CATEGORY_COLORS: Record<Category, number> = {
  Actor: 0x3b82f6, // blue
  Actress: 0xec4899, // pink
  Period: 0x22c55e, // green
  Setting: 0xf97316, // orange
  ReleaseYear: 0xeab308, // yellow
  Genre: 0xa855f7, // purple
};

/** Card colors as CSS hex strings (for React chrome). */
export const CATEGORY_CSS_COLORS: Record<Category, string> = {
  Actor: '#3b82f6',
  Actress: '#ec4899',
  Period: '#22c55e',
  Setting: '#f97316',
  ReleaseYear: '#eab308',
  Genre: '#a855f7',
};

/** A movie record from the generated Wikidata dataset. */
export interface Movie {
  id: string;
  title: string;
  year: number;
  posterUrl?: string;
  actors: string[];
  actresses: string[];
  genres: Genre[];
  settings: Setting[];
  period: Period;
  countries: string[];
}

/**
 * One physical card. `movieId` is the hidden back-reference that drives
 * Find-a-Movie verification: a combo is valid iff every card shares it.
 */
export interface Card {
  id: string;
  category: Category;
  label: string;
  movieId: string;
}

export type GameMode = 'find' | 'create';
export type PlayerKind = 'human' | 'ai' | 'remote';

/**
 * `draw`   — the active player must take a card (deck or discard).
 * `discard`— the player may declare combos, then must discard one card.
 * `gameOver`— no further actions are accepted.
 */
export type Phase = 'draw' | 'discard' | 'gameOver';

export interface PlayerState {
  id: string;
  name: string;
  kind: PlayerKind;
  hand: Card[];
  score: number;
  /** Contests this player has raised against others this game. */
  contestsUsed: number;
}

export interface DeclaredCombo {
  id: string;
  playerId: string;
  mode: GameMode;
  cards: Card[];
  points: number;
  /** The freely-typed title the declarer claimed (human declarations). */
  claimedTitle?: string;
  /** Create mode only: the short synopsis the declarer pitched. */
  claimedSynopsis?: string;
  /** Engine-known real movie (AI declarations, or a coincidental human match). */
  movieId?: string;
  /** Create mode only: the pitch happened to match one real movie. */
  realMatch?: boolean;
  /** Whether the real-movie bonus was earned (verified real, or an AI seat). */
  verified: boolean;
  /** Points docked because the combo had no Actor or Actress card. */
  castPenalty: number;
  turn: number;
}

/**
 * A declaration awaiting peer verification. All points (base + bonus) are held
 * here until the contest window resolves. The declarer's cards are removed from
 * their hand the moment the claim is submitted, but no score changes until
 * `resolveDeclaration` runs.
 */
export interface PendingDeclaration {
  id: string;
  playerId: string;
  mode: GameMode;
  cards: Card[];
  basePoints: number;
  bonusPoints: number;
  /** The film title the declarer claims this combo forms. */
  claimedTitle: string;
  /** Create mode only: the short synopsis the declarer pitched. */
  claimedSynopsis?: string;
  /** Create mode only: thumbs votes keyed by voter id ('up' | 'down'). */
  votes?: Record<string, 'up' | 'down'>;
  /** Players who contested, each with the contradiction they cited. */
  contests: Array<{ playerId: string; proof: string }>;
  /** Points docked because the combo had no Actor or Actress card. */
  castPenalty: number;
  turn: number;
}

export interface GameState {
  mode: GameMode;
  players: PlayerState[];
  /** Cards each player holds; the hand is refilled to this after a declaration. */
  handSize: number;
  drawPile: Card[];
  discardPile: Card[];
  declared: DeclaredCombo[];
  /** A declaration awaiting peer verification, if any (see `PendingDeclaration`). */
  pendingDeclaration?: PendingDeclaration;
  phase: Phase;
  currentPlayerIndex: number;
  /** Turns completed + 1. */
  turn: number;
  /** Current round, starting at 1. */
  round: number;
  maxRounds: number;
  targetScore: number;
  /** Seed used to build/shuffle the deck (for reproducible games). */
  seed: number;
  winnerId?: string;
  /** Set when the game ends at the round limit with no outright leader. */
  draw?: boolean;
}

export interface DrawAction {
  type: 'draw';
  playerId: string;
  source: 'deck' | 'discard';
}

export interface DeclareAction {
  type: 'declare';
  playerId: string;
  cardIds: string[];
  /**
   * The movie title the player claims this combo forms. This drives the manual
   * peer verification — there is no hidden answer for a human declaration. AI
   * seats are locked to the database (auto-verified) and may omit it; their
   * real title is derived from `movieId` instead.
   */
  claimedTitle?: string;
  /** Create mode only: a short synopsis for the pitched film. */
  claimedSynopsis?: string;
}

export interface ContestAction {
  type: 'contest';
  playerId: string;
  declarationId: string;
  /** The contradiction the challenger cites (e.g. a wrong attribute). */
  proof?: string;
}

export interface ResolveAction {
  type: 'resolveDeclaration';
  playerId: string;
  /** Whether the group judged the claim to be a real film. */
  outcome: 'real' | 'fake';
}

export interface DiscardAction {
  type: 'discard';
  playerId: string;
  cardId: string;
}

/** A thumbs up/down verdict on a Create-a-Movie pitch. */
export interface VoteAction {
  type: 'vote';
  playerId: string;
  declarationId: string;
  vote: 'up' | 'down';
}

export type Action = DrawAction | DeclareAction | ContestAction | ResolveAction | DiscardAction | VoteAction;

export type ActionResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

export interface PlayerConfig {
  id?: string;
  name: string;
  kind?: PlayerKind;
}
