/**
 * Tunable rules constants shared by the engine and the clients.
 *
 * These govern the peer-contest verification flow that replaced the trivia
 * quiz: the declarer names a film within `NAME_TIME_MS`, then other players get
 * `CONTEST_TIME_MS` to challenge it. Challenging is limited to
 * `CONTESTS_PER_PLAYER` per player per game, and a failed call costs both sides
 * `CONTEST_PENALTY` points (the declarer for a fake film, the challenger for
 * contesting a real one).
 */
export const NAME_TIME_MS = 30_000;
export const CONTEST_TIME_MS = 15_000;
export const CONTESTS_PER_PLAYER = 3;
export const CONTEST_PENALTY = 5;
/**
 * Create-a-Movie, 4-player baseline: a pitch used to win once this many distinct
 * players had thumbed it up. Retained as documentation of the historical floor;
 * the live threshold is {@link requiredThumbsUp}, which for 4 players equals this
 * value.
 */
export const THUMBS_UP_TO_WIN = 3;

/**
 * Create-a-Movie win threshold by player count.
 *
 * A pitch wins only when *every other player* thumbs it up (unanimous approval).
 * The declarer never votes on their own pitch, so "every other player" is exactly
 * `playerCount - 1`. This keeps the 4-player game at the historical 3-of-3 bar
 * while demanding real consensus at 5–6 players, where a bare 3-of-5 (60%) was
 * trivially easy and made large tables win *faster* than small ones — a
 * backwards difficulty curve. `Math.max` with {@link THUMBS_UP_TO_WIN} guards the
 * (otherwise unreachable) sub-4 case.
 */
export function requiredThumbsUp(playerCount: number): number {
  return Math.max(THUMBS_UP_TO_WIN, playerCount - 1);
}
