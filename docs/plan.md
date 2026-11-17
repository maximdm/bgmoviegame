# Movie Game — Implementation Plan

A board/card game about movies, built with **React + PixiJS**, where movie data is sourced from **Wikidata**. Players combine category cards (Actor, Actress, Period, Setting, Release Year, Genre) in a cards-style loop to either **find a real movie** or **imagine a new one**.

## 1. Goals & Modes

- **Find a Movie** — open assembly + peer-verified title. Build a combo of cards from your hand (≥2 cards, ≥2 categories); it is **valid regardless of which films the cards came from** — the player then *names* a real film the combo forms. Score scales with card count and category coverage (more cards → more points). A **real-movie bonus** is held back until the table verifies the named title.
- **Create a Movie** — draw cards and pitch an imagined film. Score rewards size, variety (all 6 colors), and everything is a valid pitch. A real-movie bonus exists for a pitch that coincidentally matches a real Wikidata film, but it is awarded only through the **same peer-verification** flow, not automatically.

Both modes share one cards-style turn loop (draw → optionally declare → discard to the middle).

## 2. Core Architecture

A **shared, pure-TypeScript game engine** that is agnostic to React, Pixi, and the network. Three **player controllers** plug into it:

- `HumanController` — UI input (hotseat = several human seats on one screen).
- `AIController` — heuristic bot.
- `RemoteController` — online; actions over WebSocket, state from server.

This design delivers all three play styles (local hotseat, vs AI, online) from a single ruleset and keeps online play cheat-proof.

```
                 ┌────────────┐
   Human ───────►│            │
   AI ──────────►│  ENGINE   │──► state (hands, piles, scores, declared combos)
   Remote ─────►│ (pure TS)  │
                 └────────────┘
```

## 3. Monorepo Layout (npm/pnpm workspaces)

- `shared/` — engine, types, card/deck model, rules, scoring, AI, Wikidata mapping.
- `data/` — fetch script + generated `movies.json`.
- `client/` — Vite + React + PixiJS app.
- `server/` — Node WebSocket authoritative server (online mode).

## 4. Data Layer (pre-built dataset, your choice)

A Node script queries `https://query.wikidata.org/sparql` for instances of film (`P31 wd:Q11424`) with:

| Wikidata prop | Meaning | Game category |
|---|---|---|
| `P577` | publication date | Release Year |
| `P161` + `P21` | cast member + gender | Actor / Actress |
| `P136` | genre | Genre (canonicalised) |
| `P840` | narrative location | Setting (mapped) |
| `P495` | country of origin | Setting (fallback) |
| `P18` | image | poster art |
| label service (`en`) | title | title |

It pulls ~500 notable films across year windows and writes `movies.json`:
`{ id, title, year, posterUrl?, actors[], actresses[], genres[], settings[], period, countries[] }`.

### Mapping module (`wikidataMapping.ts`)
- **Setting**: label-matching tables map narrative-location labels (then country-of-origin labels as a fallback) → `{Urban, Small Town, Forest, Desert, Mountains, Island, Ocean, Africa, Europe, Asia, Americas, Moon, Space}`.
- **Period**: bucketed from the release year → `{BC/Ancient, Antiquity, Middle Ages, Early Modern, 19th Century, WWI, Interwar, WWII, 1950s … 2020s, Future}`.
- **Genre**: Wikidata's long tail of labels is collapsed onto 18 canonical genres (`drama film` → Drama, `romantic comedy` → Comedy + Romance, …) so genre cards stay reusable. Adult/explicit labels disqualify a film from the dataset.

> ⚠️ Setting/Period mapping is heuristic — the main data risk. It lives in one editable table so it can be tuned.

**WDQS quirks:** labels must come from `SERVICE wikibase:label` (direct `rdfs:label` returns nothing); labels cannot be combined with `GROUP_CONCAT` in the same aggregate query (they come back empty), and `MIN(?date)` triggers a server `StackOverflowError`. The pipeline therefore fetches a cheap aggregate film list, then resolves labels/details in separate batched queries.

## 5. Card & Deck Model

Six categories/colors: **Actor** (blue), **Actress** (pink), **Period** (green), **Setting** (orange), **Release Year** (yellow), **Genre** (purple).

The deck = **one physical card per (movie, attribute) pair**. Each card instance carries a hidden `movieId` back-reference, which the engine still *reports* (so the AI, which is locked to the database, can render its real title) but **no longer uses to invalidate a human declaration** — a human may name any plausible real film, verified by the table rather than by a hidden answer. Duplicate labels (an actor in many films) are distinct instances with different `movieId`s.

## 6. Engine & Rules (cards-style)

State: `players[]`, `hands[]`, `drawPile`, `discardPile` (the "middle"), `declaredCombos[]`, `scores[]`, `turnPointer`.

**Turn (both modes):** draw one (from draw pile *or* top of discard) → optionally declare → discard one to the middle.

- **Find a Movie (open assembly + peer-verify):** declare a combo; valid with **≥2 cards across ≥2 categories** (no hidden `movieId` requirement). Score = `cardCount×2 + categoryCount² + allSixBonus`, minus a `MISSING_CATEGORY_PENALTY` per category not covered (clamped so a combo still earns at least its raw card points). The **entire award (base + bonus) is held** in a `pendingDeclaration` until the table verifies the named title. First to target score (or after deck exhausts) wins.
- **Create a Movie:** declare any multi-card, multi-category "pitch"; score rewards size + variety (`categoryCount×3`) + all-6-colors, minus the same missing-category penalty. Same hold-then-verify flow as Find.

**Partial declares are legal** (≥2 cards, ≥2 categories) and simply score less — players may pitch a 4-card/4-colour movie and accept the penalty rather than hunting the full set.

**Peer-contest verification (both modes):** the declarer *names* a film within `NAME_TIME_MS` (30 s); a timeout silently cancels the declare with no penalty. A `pendingDeclaration` then opens a `CONTEST_TIME_MS` (15 s) window in which **any other player** may contest, citing a contradiction (`proof`); each player gets `CONTESTS_PER_PLAYER` (3) contests per game. When the window closes:
- **No contest** → the claim is auto-accepted and the held points are awarded.
- **Contested** → any *non-declaring* viewer marks it **Real** or **Fake**.
  - Real → declarer is awarded base + bonus; every challenger who contested pays `CONTEST_PENALTY` (−5).
  - Fake → declarer pays `CONTEST_PENALTY` (−5); correct challengers lose nothing.

The engine **never** checks a hidden answer for humans; verification is purely social. AI seats are **locked to the database**: their declarations are always a real film, so they are auto-verified and scored immediately with no naming step or contest window.

In **vs AI** there is no peer to challenge the lone human, so a human claim skips the contest window and becomes an **honor check**: the player is asked to confirm the title is a real film, awarding themselves the held points only if it is (withdrawing a fake claim costs `CONTEST_PENALTY`, same as a failed peer ruling).

Proposed defaults (tunable, in `shared/src/constants.ts`): hand size 7, win at ~100 pts / 50 rounds, discard reshuffles into draw pile when empty, `MISSING_CATEGORY_PENALTY` 2, `FIND_REAL_MOVIE_BONUS` 10, `CREATE_REAL_MOVIE_BONUS` 20, `NAME_TIME_MS` 30 000, `CONTEST_TIME_MS` 15 000, `CONTESTS_PER_PLAYER` 3, `CONTEST_PENALTY` 5.

**Create-a-Movie vote win:** a 4–6 player pitch wins on **unanimous** approval — every other player thumbs it up (`requiredThumbsUp(n) = n − 1`; the `THUMBS_UP_TO_WIN = 3` constant is the historical 4-player baseline, now derived). This ends a backwards difficulty curve where 6-player games won on a 3-of-5 (60%) bar — faster than 4-player (3-of-3, 100%). 2–3 players stay freeform with no winner. (Create scoring/`targetScore` are not used for winning yet — see milestones M8.)

### Board-game variant
A second way to play over the same Find/Create objective, built as an independent engine in
`shared/src/board.ts` (so the cards loop is untouched). Instead of draw-and-discard:

- A **16-space loop**: two spaces per category (12 colour spaces), three "any" spaces, one "pass".
  The spaces are **shuffled per game** (seeded by the game seed) so that **no two neighbouring
  tiles share a type** — you never roll straight from one colour tile onto an identical one. The
  layout is reproducible from the seed.
- Each turn, **roll a single die (1d6)** to move; landing on a colour space draws a card of that
  colour into a **hand capped at 12**. There is **no discard** — cards are *collected* and *spent*
  when you declare a combo.
- Landing on an **"any" space** lets the **player choose which category to draw from** (instead of
  a random auto-draw); the available categories show their remaining card counts, and empty
  categories are disabled. The die is seeded from `state.seed` + `state.actionCount` (deterministic).
- When a player's hand is **full (12)** and they land on a draw space they cannot collect, they
  open an **exchange**: they offer **1–2 cards**, and each other player in turn (starting with the
  next seat) may **swap** one of their own cards for one offered card or **pass**. The round closes
  when everyone has had a turn or all offered cards are taken, then the offerer can declare/end as
  normal.
- The die is seeded from `state.seed` + `state.actionCount` (deterministic); the board layout is
  seeded separately so repeats are reproducible.
- Scoring, partial-declare penalty, and the **same peer-contest verification** (hold-then-verify
  with the contest window) are identical to the cards game. Defaults: hand cap 12, target 100,
  round limit 50, bot threshold 6.
- Client: `BoardScreen.tsx` renders a **square board** in HTML/CSS — 16 tiles around a square
  perimeter, pawn **peons** that slide between spaces to show each player's position, and a real
  3D **dice** that tumbles on roll — and reuses the shared `ClaimMovie` overlay; the menu offers
  a **Variant** switch (Cards / Board).

### Dice variant
A third way to play, also over the same Find/Create objective, built as an independent engine in
`shared/src/dice.ts` (the "die-rolled counterpart" of the Board variant). It keeps the Board's
"any space" idea — the die picks the category — but drops all board geometry:

- Each turn, **roll a single die (1d6)**; the face **maps straight to a category** (1 = Actor, 2 =
  Actress, 3 = Period, 4 = Setting, 5 = Release Year, 6 = Genre) and a card is drawn from that
  per-category pile into a **hand capped at 12**. There is **no board** and **no discard** — cards
  are *collected* and *spent* when you declare a combo.
- If the rolled category's pile is **already empty**, the draw is skipped but the turn is kept
  (you may still declare a combo or end) — no re-roll. If a **full-handed** player rolls a category
  that still has cards, they open the **same full-hand exchange** as the Board variant.
- The die is seeded from `state.seed` + `state.actionCount` (deterministic), matching the Board.
- Scoring, partial-declare penalty, the full-hand exchange, and the **same peer-contest
  verification** are identical to the Board and cards games. Defaults: hand cap 12, target 100,
  round limit 50, bot threshold 6.
- Client: `DiceScreen.tsx` renders the six category piles as a supply grid (the rolled category is
  highlighted), a real 3D **dice** that tumbles on roll, and reuses the shared `ClaimMovie`
  overlay; the menu offers a **Variant** switch (Cards / Board / Dice).

## 7. Player Controllers
- `HumanController` — UI input; hotseat = multiple human seats.
- `AIController` — heuristic: target a `movieId` from hand, keep cards toward it, discard least useful, declare at threshold.
- `RemoteController` — online; sends actions over WS, renders received state.

## 8. Online Multiplayer (`server/`)
Node + `ws` authoritative server. One `GameRoom` per match holds an engine instance. Clients send actions → server validates via engine → broadcasts state. Clients never compute rules. Largest piece (rooms, lobby, reconnection); built last but reuses the exact engine.

## 9. Client (React + PixiJS v8)
- **React**: main menu (mode + player setup), lobby, HUD (scores/turn), results, settings.
- **PixiJS** (`@pixi/react`): board with draw pile, central discard pile, fanned hands, declared-combo area. `Card` = rounded rect tinted by category + label + optional poster; drag-drop + tween animations.
- **State bridge**: engine state mirrored into a store (Zustand / `useSyncExternalStore`); React HUD and Pixi both read it; actions dispatch to the active controller.

## 10. Build Sequence
1. Scaffold monorepo + Vite/React/TS + Pixi deps.
2. Data script → `movies.json` + mapping module.
3. Engine: types, cards, deck, rules, scoring (pure, unit-tested).
4. Client shell + Pixi board/cards → local hotseat Find-a-Movie playable.
5. Create-a-Movie mode.
6. AI controllers.
7. Online server + RemoteController + netcode.
8. Polish: animations, poster art, scoring tuning, optional sound.

## 11. Risks / Open Decisions
- **Setting/Period mapping quality** — heuristic; mitigated by editable table, expect tuning.
- **Online scope** — biggest effort; steps 1–6 first, online last.
- **Balance** — hand size / win threshold tunable after playtest.
- **Poster images** — Wikimedia URLs; may need CORS-friendly loading with color-card fallback.
- **Defaults chosen**: hand size 7, win ~100 pts / 50 rounds, categories & color scheme as listed; `MISSING_CATEGORY_PENALTY` 2; real-movie bonuses 10 (Find) / 20 (Create), both held for peer verification (`NAME_TIME_MS` 30 s, `CONTEST_TIME_MS` 15 s, `CONTESTS_PER_PLAYER` 3, `CONTEST_PENALTY` 5).
