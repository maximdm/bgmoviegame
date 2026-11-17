# Movie Game

A movie-themed card game that runs entirely in the browser. Draw cards, spot the
real film hiding in your hand, or pitch an original one — solo against bots or
pass-the-device with friends.

## Game modes

| Mode | What you do | Winning |
| --- | --- | --- |
| **Find a Movie** | Every card hides the film it came from. Build a combo of 2+ cards from 2+ categories that all belong to the same real movie. | First to 100 points, or highest score after 50 rounds. |
| **Create a Movie** | Pitch an original film from any cards — a title plus a short synopsis. Human-only, social, no timer. | 4–6 players vote; first pitch to earn 3 👍 wins. 2–3 players pitch just for fun, no winner. |

### Variants

- **Cards** — draw, assemble a combo, discard one card. (The Find-a-Movie *Cards* variant renders the table with [PixiJS](https://pixijs.com/).)
- **Board** — roll a die around a 16-space loop, collect colour cards, then declare a movie.
- **Dice** — roll a die each turn; its face picks which category you draw from. No board.

Play **Hotseat** (everyone shares the device) or **vs AI** (you're seat 1, the rest are bots). Create a Movie is hotseat-only.

## Tech stack

- **React 19** + **TypeScript** (strict) for the UI.
- **Vite 8** for the static build (Rolldown-based).
- **PixiJS 8** for the Find-a-Movie *Cards* board (lazy-loaded — it is not part of the initial bundle).
- **npm workspaces** monorepo: `shared` (engine + rules + scoring), `data` (dataset pipeline), `client` (SPA), `server` (WebSocket, not deployed — see below).

## Project structure

```
shared/   Game engine: card/deck/rules/scoring, shared by client + (future) server
data/     Wikidata fetch pipeline → committed data/movies.json
client/   The static SPA (React + Vite). Deployed to Vercel.
server/   WebSocket multiplayer server. NOT part of the static deployment.
```

The engine lives in `shared/` and is imported from source by the client, so there
is no separate build step for game logic.

## Prerequisites

- **Node.js 22** (Vite 8 requires Node ≥ 20.19 / 22.12).
- npm 10+ (shipped with Node).

## Local development

```bash
# 1. Install all workspace dependencies (run from the repo root)
npm install

# 2. Start the client dev server (http://localhost:5173)
npm run dev

# 3. Run the engine unit tests
npm test

# 4. Run the end-to-end tests (drives the app in Chromium)
npm run test:e2e
```

> The e2e specs run against the Vite dev server and use a dev-only
> `window.__movieGame` hook. That hook is stripped from production builds, so the
> specs only run in development.

## Regenerating the movie dataset

The card pool ships as a committed `data/movies.json` (no network needed at
runtime). To refresh it from Wikidata:

```bash
npm run data:fetch          # live fetch
npm run data:fetch:offline  # rebuild from a cached response
```

The client loads this file as a separate chunk, so it never bloats the initial
bundle.

## Deploying to Vercel

The deployed app is the **static client only**; the `server/` (WebSocket)
workspace is intentionally excluded.

These settings are what make the build work (they live in `vercel.json`):

| Setting | Value | Why |
| --- | --- | --- |
| **Root Directory** | repository root (`.`) | Workspaces are resolved from the root `package.json`. |
| **Build Command** | `npm run build -w @movie-game/client` | `npm -w` is matched by the workspace **name**, not the folder path. |
| **Output Directory** | `dist` | Vercel resolves this relative to the auto-detected Vite framework root (`client/`), so `dist` → `client/dist`. |
| **Framework Preset** | *(none)* | Leaving the preset off stops Vercel from re-interpreting the output directory. |

A GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm ci`, the unit
tests, the client build, and the Playwright e2e suite on every PR and push to
`main` — so a broken dependency tree or a failing flow is caught before it ever
reaches Vercel.

## Scripts (repo root)

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the client dev server. |
| `npm test` | Run the `shared/` engine unit tests. |
| `npm run test:e2e` | Run the Playwright end-to-end suite. |
| `npm run build:client` | Production build of the client (what Vercel runs). |
| `npm run data:fetch` / `data:fetch:offline` | Regenerate `data/movies.json`. |

Each workspace also exposes its own `build`, `dev`, and `test` scripts via
`npm run <script> -w <workspace-name>`.

## License

Internal / personal project.
