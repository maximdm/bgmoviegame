# Agent Guide (AGENTS.md)

Context and conventions for AI coding agents working in this repository.

## What this project is
A movies-themed board/card game (React + PixiJS) whose data comes from Wikidata.
Two modes:
- **Find a Movie** — assemble ≥2 cards across ≥2 categories from your hand, then *name* a real film the combo forms (verified by the table, not a hidden `movieId`).
- **Create a Movie** — pitch an imagined film; score by size + category variety; same peer-verified bonus flow.

Shared cards-style loop: draw → optionally declare → discard to the middle.

## Tech stack
- **Vite + React + TypeScript** (client app shell & UI).
- **PixiJS v8** via `@pixi/react` (animated board, cards, drag/drop, tweens).
- **Node + `ws`** (online authoritative server, built last).
- **Vitest** for engine unit tests.
- **Playwright** for browser end-to-end tests (`client/e2e`, run against the dev server).
- **npm/pnpm workspaces** monorepo.

## Repository structure
```
shared/src/  pure-TS engine (types, deck, scoring, rules, ai, board, constants, wikidataMapping, testFixtures)
data/        fetch-wikidata.ts (tsx) + generated movies.json
client/src/  game/ (store + setup), screens/ (menu, game, results),
             pixi/ (Board, CardView, register), components/, data/movies.ts
client/e2e/  Playwright browser tests (honor check)
server/      Node WebSocket authoritative server (room.ts, index.ts)
docs/        plan.md, milestones.md, agent.md
```
The **engine in `shared/` is the single source of truth for rules**. Client and server both consume it; never re-implement rules elsewhere.

## Client architecture
- `client/src/data/movies.ts` imports the bundled `data/movies.json` (no network at runtime) and exposes `MOVIES` / `MOVIES_BY_ID`.
- `client/src/game/store.ts` wraps the engine: `GameStore.dispatch(action)` returns the engine `ActionResult` and notifies subscribers; `useGameState(store)` binds it via `useSyncExternalStore`.
- `client/src/pixi/register.ts` must be imported for its `extend({ Container, Graphics, Text })` side effect before any `<pixi*>` element renders.
- Pixi is only a renderer: `Board` draws piles/opponents/hand and reports gestures; all validation is engine-side. The HUD (`screens/GameScreen.tsx`) computes previews with `scoreFindCombo`/`scoreCreateCombo` from the same module the engine uses.
- Viewers & privacy: `Board` is drawn for a `viewerId`. The viewer's own hand is face-up; every other seat (including the active bot) is a card back. `GameScreen` passes `viewerId` = the on-turn seat in hotseat, or the seated human in vs AI. This same concept will drive online (you only ever see your own hand).
- AI seats: when it is an `ai` player's turn, `GameScreen` schedules `chooseAiAction` every ~650 ms so the turn animates step by step. The same `chooseAiAction` also powers server-side bots later.
- Card gestures: `pointerdown` starts a drag and a native `window` `pointerup` listener finishes it. Do **not** swap this back to canvas-only handlers — a rapid click can land before a Pixi drag overlay mounts, and the mapped card unmounts on pointer-down.
- `client/src/game/setup.ts` defines `GameSetup` (`mode`, `playStyle` of `hotseat | 'ai'`, `players`, `seed`) and player/color limits.

## Key design invariants (do not break)
- Each physical card carries a hidden `movieId`, but **humans are not bound to it**: a Find-a-Movie combo is valid with ≥2 cards / ≥2 categories regardless of which films the cards came from. The engine still reports `realMatch`/`movieId` only so an AI (locked to the database) can display its real title.
- The engine is framework-agnostic: no React/Pixi/network imports inside `shared/`.
- Engine API: `createGame(movies, config)` returns a `GameState`; `applyAction(state, action)` is pure and returns `{ ok, state }` or `{ ok: false, error }`.
- Games are deterministic for a given `seed` (mulberry32), which is stored on `GameState` and reused for discard-pile reshuffles.
- Three player controllers (`Human`, `AI`, `Remote`) are the only way to mutate engine state; all changes go through `Action` dispatch.
- The **board variant** reuses the same scoring and peer-contest verification but has a different turn loop: `createBoardGame` / `applyBoardAction` / `chooseBoardAiAction` in `shared/src/board.ts`. Collection is capped at `BOARD_HAND_CAP` (12); declaring *spends* those cards. The 16-space loop is **shuffled per game** (seeded by the game seed) so that **no two neighbouring tiles share a type**, and the client renders it as a **square board** (`BoardScreen.tsx`) with pawn peons that slide between 16 perimeter tiles to show positions, a 3D dice (`components/Dice.tsx`) that tumbles on roll, a choose-category panel (landing on "any" lets the player pick the category to draw), and an exchange panel for the full-hand trade. When a full-handed player lands on a draw space, an **exchange** opens (`offerExchange` / `respondExchange` actions, `BoardExchange` state): the offerer proposes 1–2 cards and each other player in turn may swap one card or pass. The die is seeded from `state.seed` + `state.actionCount` for determinism.
- The **dice variant** is the board variant's "die-rolled counterpart" with no board geometry: `createDiceGame` / `applyDiceAction` / `chooseDiceAiAction` in `shared/src/dice.ts`. Each turn rolls a die (1d6) and the face **maps directly to a category** (1 = Actor … 6 = Genre), drawing from that per-category pile. An empty rolled pile skips the draw but keeps the turn; a full-handed player rolling a drawable category opens the **same full-hand exchange** (`DiceExchange` state). It reuses the board's scoring, exchange, peer-contest verification, and the seeded die. The client renders it as `DiceScreen.tsx`: a six-category supply grid (rolled category highlighted) plus the shared 3D dice.
- Online: server runs the engine; clients only render received state.
- Card faces show category color + label only — never render a `movieId` or poster in the hand (the AI's real title stays out of human hands).
- **Verification is peer contest, not a quiz.** A human declaration creates a `pendingDeclaration` (base + bonus held) and a 15 s contest window. Any non-declarer may contest (with a `proof`); each player has `CONTESTS_PER_PLAYER` (3) contests/game. On close, an uncontested claim auto-awards; a contested claim is ruled Real/Fake by any non-declarer — Real pays `CONTEST_PENALTY` (−5) to each wrong challenger, Fake pays `CONTEST_PENALTY` to the declarer. **The engine never checks a hidden answer for humans.** In vs-AI there is no peer, so the declarer's claim skips the countdown and shows an honor-check panel (self-confirm real → award, withdraw fake → `CONTEST_PENALTY`). AI seats are auto-verified and scored immediately (no naming step, no contest window). `DeclaredCombo.verified` records the outcome for the UI badge; `DeclaredCombo.claimedTitle` is the human's freely typed title.
- **Partial declares are legal and penalised.** Both modes accept ≥2 cards / ≥2 categories. A combo loses `MISSING_CATEGORY_PENALTY` (2) per category not covered, clamped so it still earns at least its raw card points (`cards.length × 2`). Full 6-colour coverage avoids the penalty and earns the all-six bonus.

## Conventions
- TypeScript strict mode.
- Card categories are a fixed enum: `Actor | Actress | Period | Setting | ReleaseYear | Genre`, each with a color.
- Settings/Period/Genre derivation lives only in `shared/src/wikidataMapping.ts` (editable tables).
- Engine changes require Vitest coverage for deck/rules/scoring.
- Prefer dedicated tools over shell; keep changes consistent with surrounding code.

## How to run
- Install: `npm install`
- Dev client: `npm run dev` · server: `npm run dev:server` · build all: `npm run build` · tests: `npm test` · e2e: `npm run test:e2e`

Playwright specs live in `client/e2e` and start/reuse the Vite dev server automatically (`playwright.config.ts`). They depend on the dev-only `window.__movieGame` hook (hand is Pixi canvas), so they run against dev, not a production build. First-time setup on a new machine: `npm install && npx playwright install chromium`.
- Regenerate data: `npm run fetch -w data` (live Wikidata; ~3–5 min) or `npm run fetch:offline -w data` (curated seed). Then rebuild the client, which bundles `movies.json`. Optional env: `FILM_LIMIT` (default 800), `CAST_BATCH` (default 100).

## Common tasks
- **Add a category/color**: extend the category enum + `CATEGORY_COLORS`/`CATEGORY_CSS_COLORS` in `shared/src/types.ts`, the deck builder, and possibly `CardView` band text contrast.
- **Tune scoring/balance**: edit `shared/src/scoring.ts` (combo points, `MISSING_CATEGORY_PENALTY`, real-movie bonuses) and engine defaults in `shared/src/rules.ts` (hand size, target score, rounds).
- **Tune verification**: edit `shared/src/constants.ts` (`NAME_TIME_MS`, `CONTEST_TIME_MS`, `CONTESTS_PER_PLAYER`, `CONTEST_PENALTY`) for the peer-contest flow.
- **Improve Setting/Period accuracy**: edit tables in `shared/src/wikidataMapping.ts`, then re-run data fetch.
- **New mode**: add an action + scoring branch; keep the same turn loop.

## Risks to watch
- Wikidata Setting/Period mapping is heuristic — expect tuning.
- Online multiplayer is the largest scope; build it after the local slice works.
- Poster images are Wikimedia URLs; ensure CORS-friendly loading with a color-card fallback. None are rendered yet — hand cards stay label-only to avoid leaking the hidden movie.

## Relevant agent skills (acquired)
Leverage these installed skills when working in this repo (`skills/` dir: `.agents/skills`):
- **vercel-react-best-practices** — React/Next perf patterns (renders, bundles, data fetching) for the `client/` app.
- **vercel-composition-patterns** — scalable React component composition for `client/` UI.
- **node** — Node.js + TypeScript best practices (type stripping, async, errors) for `shared/` and `server/`.
- **fastify-best-practices** — Fastify/TS server, routes, validation, WebSockets for `server/`.
- **typescript-magician** — complex generic types, type guards, strict typing across the codebase.
- **linting-neostandard-eslint9** — ESLint v9 flat config / neostandard setup.
- Built-in (no install needed): **vitest** (engine unit tests), **web-design-guidelines** (UI review).
- Note: no dedicated PixiJS/game-dev skill exists in the ecosystem; rely on general knowledge for `client/pixi/`.
