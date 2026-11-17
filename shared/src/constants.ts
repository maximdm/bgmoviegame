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
 * Create-a-Movie: a pitch wins once this many distinct players have thumbed it
 * up. Only reachable with 4+ players (3 other voters); 2–3 players stay freeform.
 */
export const THUMBS_UP_TO_WIN = 3;
