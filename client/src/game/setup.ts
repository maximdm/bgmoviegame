import type { GameMode, PlayerConfig } from '@movie-game/shared';

/** How the local seats are filled. */
export type PlayStyle = 'hotseat' | 'ai';

/** Which game variant to play. */
export type Variant = 'cards' | 'board' | 'dice';

/** Everything needed to start (or restart) a local game. */
export interface GameSetup {
  mode: GameMode;
  playStyle: PlayStyle;
  variant: Variant;
  players: PlayerConfig[];
  seed: number;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

export const PLAYER_COLORS = ['#f5c542', '#5eead4', '#f472b6', '#60a5fa', '#fb923c', '#c084fc'];

export const MIN_PLAYERS = 2;
export const MAX_LOCAL_PLAYERS = 6;

export function defaultPlayerNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Player ${index + 1}`);
}

export function botNames(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Bot ${index + 1}`);
}
