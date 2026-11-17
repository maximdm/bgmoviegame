# Milestones

Status legend: ⬜ Not started · 🔄 In progress · ✅ Done

## M1 — Project scaffold ✅
- [x] Initialize npm workspaces monorepo (`shared/`, `data/`, `client/`, `server/`).
- [x] Vite + React + TypeScript config in `client/`.
- [x] TypeScript config shared across packages.
- [x] PixiJS v8 + `@pixi/react` installed.
- [x] Basic `npm run dev` / `npm run build` wired for all packages.

## M2 — Wikidata data pipeline ✅
- [x] `data/src/fetch-wikidata.ts` script (run via `tsx`) querying `query.wikidata.org/sparql`.
- [x] Pull ~500 notable films with P577, P161, P21, P136, P840, P495, P18, labels.
- [x] `shared/src/wikidataMapping.ts`: Setting + Period + Genre mapping tables.
- [x] Generate `data/movies.json` (pre-built dataset, 532 films / 18 genres).
- [x] Validate dataset completeness (every film has year + ≥1 genre + cast).

## M3 — Game engine (pure TS) ✅
- [x] `shared/src/types.ts` — Card, Category, Player, GameState, Action.
- [x] `shared/src/cards` model folded into `types.ts` (category + color definitions).
- [x] `shared/src/deck.ts` — deterministic deck from the movie dataset (one card per movie×attribute, sampled caps).
- [x] `shared/src/rules.ts` — cards turn loop (draw/discard/declare), reshuffle, rounds and win logic.
- [x] `shared/src/scoring.ts` — points for combos (Find + Create modes).
- [x] Unit tests (Vitest) for deck, rules, scoring, mapping (72 passing).

## M4 — Local hotseat: Find a Movie (playable vertical slice) ✅
- [x] `client/` React shell: main menu, mode select, 2–6 player setup, seed.
- [x] PixiJS board: draw pile, discard pile (middle), fanned hands, hidden opponents.
- [x] `CardView` component (category color + label, poster deferred) + drag/drop + tweens.
- [x] State bridge (`GameStore` + `useSyncExternalStore`) + human controller wiring.
- [x] Declare/verify combo against `movieId`; score + win condition.
- [x] Results screen with standings, best combo, rematch.

## M5 — Create a Movie mode ✅
- [x] Mode switch + Create-mode scoring (size + all-6-colors + easter-egg bonus).
- [x] Pitch declaration UI on the shared board (same turn loop, different scoring).

## M6 — AI controllers ✅
- [x] `shared/src/ai.ts` pure heuristic bot: `chooseAiAction(state)` (draw → declare-at-threshold → discard), `bestCombo`, `chooseDiscard`, `isAiTurn`.
- [x] Vitest coverage (98 tests total): legal actions, threshold behaviour, final-round/win triggers, deterministic, full AI-vs-AI simulations.
- [x] Client: "vs AI" play style, bot seats (`kind: 'ai'`), auto-played turns with a short pause, and a `viewerId` so a bot's hand is never shown.
- [x] Hotseat privacy now driven by `viewerId` (the on-turn seat), reused for online later.

> **Balance fix (applied):** the original cards loop let hands only shrink — draw 1 /
> discard 1 and declaring removed cards permanently — so a player could declare at most
> ~`handSize − 1` cards all game, and with `maxRounds: 3` (a single lap ≈ 3 turns each)
> nobody reached the 100 target (games ended on round 3, scores in the teens–forties).
> Find-a-Movie was also starved by the 40-movie deck (~37% of 7-card hands had a valid
> combo). Resolution: `declare` now **refills the hand** from the draw pile back to
> `handSize` (reshuffling the discard pile if needed), `maxRounds` raised to **50** laps,
> and the client uses a denser deck (`players × 5` movies). After the fix, simulations
> show Find-a-Movie wins 37/60 games (avg winning score 91.5, competitive) and
> Create-a-Movie hits 100 every game. Both modes are now winnable and the AI is
> meaningful. Remaining M8 tuning: Create mode still ends very fast (~2–3 turns), so its
> bonuses may be lowered or the target raised.

## M6.5 — Trivia verification + partial-declare penalty ✅
Completed 2026-11-16. The real-movie bonus is now a *skill check* and players may declare
partial combos at a points cost.

- [x] `shared/src/trivia.ts` (new, pure + deterministic) — `buildTrivia(movie, movies, seed)`
      returns 5 multiple-choice questions where the **movie title is the answer** (multiple
      correct answers allowed when a clue matches several real films — "select all that apply").
      Clues drawn from the movie's own attributes (year, genre, cast pair, setting, period);
      distractors are other dataset titles sharing a genre/cast/nearby year (plausible confusers).
- [x] `shared/src/scoring.ts` — `MISSING_CATEGORY_PENALTY` = 2: subtract
      `penalty × (6 − categoryCount)`, clamped so a combo still earns ≥ its raw card points.
      Remove the auto real-movie bonus from scoring; keep returning `realMatch` / `movieId`.
- [x] `shared/src/types.ts` — `DeclareAction.triviaVerified?`; `DeclaredCombo.verified?`.
- [x] `shared/src/rules.ts` — gate the real-movie bonus on verification: add
      `FIND_REAL_MOVIE_BONUS` (new, 15) and keep `CREATE_REAL_MOVIE_BONUS` (20), both granted
      only when `realMatch && (action.triviaVerified || player.kind === 'ai')`. Store `verified`.
- [x] Client `Trivia.tsx` (new React overlay) — 15-second countdown, 5 questions, multi-select
      where multiple are correct, **Submit** + **Skip (forfeit bonus)** buttons.
- [x] `GameScreen.tsx` — intercept a *human* real-movie declare (Find: always; Create: only when
      `realMatch`) → open trivia → dispatch `declare` with `triviaVerified`. AI turns and
      non-real Create pitches dispatch immediately.
- [x] Tests: penalty (partial combos lose points but stay ≥ size points), verification gate
      (human fail → no bonus; AI → bonus), trivia generation (deterministic, correct answer
      present, multi-correct when applicable).
- [x] Docs.

> **Tunables:** `MISSING_CATEGORY_PENALTY` = 2 · `FIND_REAL_MOVIE_BONUS` = 10 ·
> `CREATE_REAL_MOVIE_BONUS` = 20 · `TRIVIA_QUESTIONS` = 5 · `TRIVIA_TIME_MS` = 15000 ·
> `TRIVIA_PASS_THRESHOLD` = 3/5. Find-mode trivia fires on **every** real declare; the Skip
> button avoids forcing it. AI auto-verifies (trivia is a human skill check). Online (M7) reuses
> `triviaVerified` over the wire so the server gates the bonus identically.

> ⚠️ **Superseded by M6.6.** The trivia quiz and the hidden-`movieId` gate were removed in
> favour of free-text naming + peer contest (see M6.6). `shared/src/trivia.ts` and the
> `Trivia.tsx` overlay are deleted; `DeclareAction.triviaVerified` no longer exists.

## M6.6 — Peer-contest verification (replaces M6.5 trivia) ✅
Completed 2026-11-16. The trivia quiz is gone. A human declaration now holds all points
(base + bonus) in a `pendingDeclaration` and opens a 15 s contest window; any other player may
contest (citing a contradiction), and any non-declarer rules the claim Real/Fake. Both sides
lose `CONTEST_PENALTY` (−5) on a bad call. Find-a-Movie also drops its hidden-`movieId`
requirement — a combo is valid with ≥2 cards / ≥2 categories, and the real-movie bonus comes
only from manual verification. AI seats stay locked to the database (auto-verified, scored
immediately, no contest window).

- [x] `shared/src/constants.ts` (new) — `NAME_TIME_MS` (30 000), `CONTEST_TIME_MS` (15 000),
      `CONTESTS_PER_PLAYER` (3), `CONTEST_PENALTY` (5).
- [x] `shared/src/types.ts` — `PlayerState.contestsUsed`; `DeclaredCombo.claimedTitle` / `verified`
      (required); new `PendingDeclaration`, `ContestAction`, `ResolveAction`.
- [x] `shared/src/scoring.ts` — `scoreFindCombo` no longer requires `allSameMovie`; `realMovieBonus`
      only pays when the claim was manually verified (AI auto-verifies, so bots still earn it).
- [x] `shared/src/rules.ts` / `shared/src/board.ts` — human declare → `pendingDeclaration`
      (points held); AI declare → auto-award; `contest` + `resolveDeclaration`; turn-ownership
      check exempts `contest`/`resolveDeclaration`; discard/endTurn blocked while pending.
- [x] `client/src/components/ClaimMovie.tsx` (new) — naming + contest/resolution overlay,
      hotseat seat switcher, vs-AI honor-check panel (declarer self-confirms a solo claim;
      withdraw costs `CONTEST_PENALTY`). `Trivia.tsx` deleted.
- [x] `GameScreen.tsx` / `BoardScreen.tsx` — naming state, pending contest wiring, combo cards
      show `claimedTitle`.
- [x] Tests: 121 engine tests green (hold-then-verify, contest limits, both-side penalties,
      auto-verify for AI, Find relaxed), client typecheck + production build clean.
- [x] Playwright e2e (`client/e2e/honor-check.spec.ts`, `npm run test:e2e`): vs-AI honor check
      confirms a real claim (+14) with no auto-award after 16s, and withdrawal costs −5.
- [x] Docs (`plan.md`, `agent.md`, this file) supersede the M6.5 trivia model.

> **Tunables:** `MISSING_CATEGORY_PENALTY` = 2 · `FIND_REAL_MOVIE_BONUS` = 10 ·
> `CREATE_REAL_MOVIE_BONUS` = 20 · `NAME_TIME_MS` = 30 000 · `CONTEST_TIME_MS` = 15 000 ·
> `CONTESTS_PER_PLAYER` = 3 · `CONTEST_PENALTY` = 5. The engine **never** checks a hidden answer
> for humans; verification is purely social. AI auto-verifies (locked to the Wikidata database).

## M7 — Online multiplayer (server)
- [ ] `server/` Node + `ws` authoritative server.
- [ ] `GameRoom` holds engine instance; validate actions; broadcast state.
- [ ] `RemoteController` in client; lobby + room join.
- [ ] Reconnection handling (best-effort).

## M8 — Polish & tuning
- [x] README + run instructions (see repo-root `README.md`).
- [x] Poster-image loading with colour-card fallback — `Card` now carries `posterUrl`
      (populated in `buildDeck`); `CardChip` shows the Wikimedia poster with a
      legibility scrim and falls back to the label card on error/absence. ~35% of
      the dataset has a poster. (Pixi `CardView` on the Find-a-Movie board still
      renders the label card — a possible follow-up.)
- [x] Animation/micro-interaction pass — DOM hand cards and declared combos fade in
      on mount (a "deal" effect), hand cards lift on hover, and the whole thing
      respects `prefers-reduced-motion`. (Sound deferred — autoplay/UX risk.)
- [x] **Create-a-Movie balance tuning (win threshold).** Investigation found the
      mode does *not* currently use the `CREATE_*` scoring bonuses or `targetScore`
      for winning at all: 4–6 players end on a **vote win** (`THUMBS_UP_TO_WIN = 3`),
      and 2–3 players are freeform with no winner. The real imbalance was the vote
      bar being a fixed 3, which made a 6-player game win on 3-of-5 (60%) — *easier*
      than a 4-player game (3-of-3, 100%): a backwards difficulty curve and the
      source of the "~2–3 turns" complaint. Fix: a pitch now needs **unanimous
      approval** — every other player thumbs up (`requiredThumbsUp(n) = n − 1`) —
      applied consistently across `rules.ts`, `dice.ts` and `board.ts`, plus the
      `ClaimMovie` UI and `MainMenu` copy. 4-player behaviour is unchanged (still
      3-of-3), so all prior engine + e2e tests stay green. A Monte-Carlo sim
      (`create-balance-sim.mjs`) shows the new rule leaves 4p untouched and makes
      5p/6p games **2.7–16× longer** (6p: ~1–2 pitches → ~2–32). Two engine tests
      lock in the 5p/6p unanimity.
- [ ] Mapping table tuning (Setting/Period) — the heuristic mapping tables in
      `shared/src/wikidataMapping.ts` are the main data risk; tune after playtest.
      **Deferred.**
- [ ] *(Open question, raised by this tuning)* Create-a-Movie scoring (`CREATE_*`
      constants) and `targetScore` are currently dead for winning — if we later
      want Create to *race to a score* (instead of/in addition to a vote win), that
      is a larger design change touching the vote-win engine + e2e tests. Not done
      here to stay safe and test-preserving.

## M9 — Board-game variant ✅
Completed 2026-11-16. A second way to play over the same Find/Create objective: a
16-space loop, a die, and colour-card collection instead of draw-and-discard.

- [x] `shared/src/board.ts` (new, self-contained) — `createBoardGame`, `applyBoardAction`,
       `chooseBoardAiAction`. Board = 16 spaces (2 per category + 3 "any" + 1 "pass"),
       **shuffled per game** (seeded by the game seed) so **no two neighbouring tiles share
       a type**. Roll 1d6 → move → draw a card of that colour (or, on an "any" space, the
       player **chooses which category** to draw from) into a hand capped at 12. No discard:
       cards are *collected* and *spent* when you declare a combo. The die is seeded from
       `state.seed` + `state.actionCount`, so a given seed replays identically.
- [x] Reuses `scoreFindCombo` / `scoreCreateCombo` and the **same peer-contest verification**
       as the cards game (points held in `pendingDeclaration`; AI auto-verifies). `BOARD_HAND_CAP`
       = 12, `BOARD_DEFAULT_TARGET` = 100, `BOARD_DEFAULT_MAX_ROUNDS` = 50.
- [x] Client: `BoardScreen.tsx` (HTML/CSS ring + tokens + hand), `boardStore.ts`, a Variant
       switch in `MainMenu`, and `App` routing to the board engine. AI seats auto-play one
       action at a time; the `ClaimMovie` overlay is shared with the cards game.
- [x] Tests: board engine tests (spaces + non-adjacent shuffle, roll/draw, hand cap, the
       choose-category "any" flow, declare gating, turn/round flow, win conditions, exchange,
       AI). Playability sim confirms games terminate (40/40 reach the round limit) and Create
       mode frequently hits the target.

> **Tunables:** `BOARD_HAND_CAP`, `BOARD_DEFAULT_TARGET`, `BOARD_DEFAULT_MAX_ROUNDS`, and the
> `BOARD_DECLARE_THRESHOLD` (6) that the board bot uses. Find-a-Movie on the board is
> collect-and-hope — combos are scarcer, so most Find board games end on the round limit
> rather than the target; lower the target or raise rounds to taste.

## M10 — Dice variant ✅
Completed 2026-11-17. A third way to play — the board variant's "die-rolled counterpart" with
no board geometry. Each turn rolls a die (1d6) and the face **maps straight to a category**
(1 = Actor … 6 = Genre), drawing a card from that per-category pile.

- [x] `shared/src/dice.ts` (new, self-contained) — `createDiceGame`, `applyDiceAction`,
       `chooseDiceAiAction`. Roll 1d6 → the face picks the category → draw a card of that
       colour into a hand capped at 12. No board, no discard: cards are *collected* and *spent*
       when you declare a combo. The die is seeded from `state.seed` + `state.actionCount`,
       so a given seed replays identically.
- [x] If the rolled category's pile is **empty**, the draw is skipped but the turn is kept (no
       re-roll). A **full-handed** player rolling a drawable category opens the **same
       full-hand exchange** (`DiceExchange`, `offerExchange` / `respondExchange`) as the board.
- [x] Reuses `scoreFindCombo` / `scoreCreateCombo` and the **same peer-contest verification**
       as the cards/board games. `DICE_HAND_CAP` = 12, `DICE_DEFAULT_TARGET` = 100,
       `DICE_DEFAULT_MAX_ROUNDS` = 50, `DICE_DECLARE_THRESHOLD` = 6.
- [x] Client: `DiceScreen.tsx` (six-category supply grid + shared 3D dice + hand), `diceStore.ts`,
       a Variant switch in `MainMenu` (Cards / Board / Dice), and `App` routing to the dice
       engine. Reuses the shared `ClaimMovie` overlay and the same AI auto-play loop.
- [x] Tests: dice engine tests (draw-by-category, empty-pile skip, full-hand exchange,
       declare/contest, round-limit draw, AI run-to-completion). Mobile-verified at 390/320px
       with zero horizontal overflow.

## Suggested order of delivery
M1 → M2 → M3 → M4 (first playable) → M5 → M6 → M6.5 → M9 → M10 → M7 (largest) → M8.
