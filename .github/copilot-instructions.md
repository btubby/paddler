# Copilot / AI assistant instructions: Paddler

Read `README.md` first: it describes every page, API endpoint, stored data and setting. This file is
the short version: what the project is, how it's built, and the things that catch people out.

## What this is

The website and tools for **Bishops Stortford Canoe Club (BSCC)**, live at https://bscc-coach.netlify.app
(club code in the Hasler results: `BSF`). Built by Ben, a club coach and developer (Vue, React, .NET).
Almost everything is derived from the **public Hasler marathon results** (entries.canoemarathon.org.uk):
the server reads every race since 2010, fits a speed rating per paddler, and the pages show a paddler's
racing history, a coaching board, a K1/K2 race planner, and public comments on results.
MemberMojo (membership system) is only used for the coaches' board and is synced from Ben's own computer
(Cloudflare blocks it from Netlify).

## Stack

- **Vue 3** single-file components with `<script setup>` (JavaScript, no TypeScript), scoped styles, no UI library, no router, no store library.
- **Vite multi-page app** (`appType: 'mpa'`): one HTML entry per page, listed in `vite.config.js` (`PAGES` and `rollupOptions.input`). Adding a page = new folder with `index.html`, `src/<page>/main.js` + `App.vue`, add to both lists, to `SiteNav.vue`, and to the edge-function `config.path` if it needs a role.
- **Netlify Functions** in `netlify/functions/` (ES modules; each exports a default handler taking a Web `Request` and returning a `Response`, plus `export const config = { path: [...] }`), **Edge Functions** in `netlify/edge-functions/` (Deno; the role gates), **Netlify Blobs** for storage (no database).
- Tests: Node's built-in runner (`npm test` = `node --test`), files in `test/`. Only dependencies: `vue`, `cheerio`, `@netlify/blobs` (and `vite`, `@vitejs/plugin-vue` for dev).
- Deploy: `npm run deploy` (runs the tests, then `netlify deploy --prod --build`). Locally: `npx netlify dev` (http://localhost:8888).

## Conventions

- **UK English** in all user-facing text and comments ("colour", "organise", "licence"). Friendly plain wording for paddlers; the club is not technical.
- **Comment the *why***, in plain English, at the top of a function or section (the codebase does this throughout; keep the style).
- **Pure logic goes in plain `.js` modules** with no Vue/Netlify imports (`netlify/functions/lib/*`, `src/paddler/insights.js`, `src/raceplan/lineup.js`, `src/training/stats.js`, `src/coaching/data/k2tree.js`) so it is unit-tested directly and can run in both server and browser. Keep it that way; add tests for any change in behaviour.
- **Test the function logic, not the framework**: export the inner functions from `crews.js` (e.g. `mergeOwn`, `addNote`, `readNotes`, `paddler`) and test them with a tiny in-memory store `{ get, setJSON, list }`; for routing/auth tests call the default handler with a `Request` and a cookie. Follow the existing tests in `test/crews.test.js`.
- Every new API route must be added to the function's `config.path`. Responses use the local `json()` helper. Errors return `{ error: '...' }` with a sensible status (the pages show `error` to the user).
- Don't add dependencies without a good reason. No inline `alert` except for a failed action; use the page's status lines.
- Keep the front end working on a phone (the paddler page has a `narrow` mode).

## Things that catch people out

1. **Who can see what.** Roles: public, paddler-with-signed-link, coach, race coordinator and admin: no passwords, everyone signs in with Google and an admin gives accounts roles at `/roles/` (`ADMIN_EMAILS` are always admins). Gates are edge functions (`lib/role-gate.js`); functions re-check with `lib/access.js` (`signedInAs`). `/api/paddler` is **public** and must never leak coach-only data (MemberMojo, guesses at earlier names, `linked`, `others` for shared partner pages, share links). The `bscc_session` cookie is signed with `SESSION_SECRET` and holds the email, first name and roles.
2. **Paddlers are keyed `name|CLUB`** (e.g. `duncan jack|NOT`), via `personKey(name)` in `lib/crewfit.js`. The same person can be several keys (clubs, name changes). Merges (`name-links` blob) make results appear under one key; `resolveKey()` follows links so old share tokens keep working. Comments are keyed by the *name* part so they survive club moves and merges.
3. **Ratings are cached and recalculated in the background.** `hist5-<CLUB>`, `people-index` and `fit12-<club>` carry a `basis` string (`races|last date|recent N|notes N|names N`) and `HIST_VERSION` (`'7:' + hash of MISSPELLINGS/NAME_CHANGES`). **If you change how ratings or history rows are computed, bump the number in `HIST_VERSION`**; the old copy then counts as "pending" until recalculated. `namesStale()` relies on the basis ending in `|names <at>`, so keep `names` last. A recalculation is long (about 10 s limit per normal function), so it runs in `crews-fit.js` (a background function). Starting it: a coach/coordinator opening the board (`/api/crews`) reads any new races and starts it; and **any `/api/paddler` lookup that finds the ratings not ready starts it** (`startFitIfIdle` in `crews.js`: once, via the server's own `x-fit-token`, not again for 10 minutes), so after a deploy that changes the sums the first person to look someone up starts the recalculation. Reading races for the first time still needs a coach on the board.
4. **Netlify Function time limit** (~10 s) and Blobs eventual consistency: stores are opened with `consistency: 'strong'`; reading all the races is done in rounds that answer `{ more: true }`.
5. **History rows have `rid`** (`race.key + '|' + tab`): the stable id of one result, used for comments and the "not a fair result" list. K2 partners share a `rid`.
6. **Hasler page parsing** is in `crews.js` `parseResults` (cheerio) and is fragile: check against a real results page if the site's HTML changes.
7. **Can't run `vite build` in some sandboxes** (Mac-native rollup modules). Compile a changed `.vue` file with `@vue/compiler-sfc` (`parse` → `compileScript` → `compileTemplate`) to catch template errors, and run `npm test`.
8. Redirects with `force = true` in `netlify.toml` keep query strings. `/coaching-groups/*` → `/paddlers/*` is permanent, keep it.
9. **Test data in tests uses made-up names.** Never put real members' names or results in tests, comments or fixtures. (`src/coaching/data/paddlers.js` already names some members in comments: don't add more.)

## Privacy rules (UK GDPR: the club is the controller)

- Comments, name links and "not a fair result" marks exist **only in this app** (Netlify Blobs). Comments are **public by design**. Anything new that stores personal data needs: a way for the paddler to download it, a way to delete it, a line in the privacy note at the foot of `src/paddler/App.vue` and in the README's Privacy section.
- Keep the author-secret design for comments: only a hash is stored; the writer's browser keeps the secret.
- Never log names on the live site (logs are off by default; `MEMBERS_DEBUG`/`DIVISIONS_DEBUG` are local only).
- Strava data is shown only to the athlete who connected it (Strava's API terms): never to coaches.
- Never commit `.env` or real secrets. `.env.example` lists every variable.

## Where to look

| Task | Start here |
| --- | --- |
| Paddler page behaviour | `src/paddler/App.vue`, `ProgressChart.vue`, `insights.js` |
| Ratings model | `netlify/functions/lib/crewfit.js` |
| Merge, name links, comments, export, privacy endpoints | `netlify/functions/crews.js` |
| K1/K2 planning rules | `netlify/functions/lib/crewplan.js`, `src/raceplan/` |
| Sign-in and roles | `netlify/edge-functions/`, `netlify/functions/lib/access.js`, `lib/share.js` |
| Menu and page list | `src/shared/SiteNav.vue`, `vite.config.js` |
| Member sync | `scripts/sync-members.mjs`, `netlify/functions/members.js` |

## Before you finish a change

1. `npm test` passes.
2. A changed `.vue` file compiles (see item 7 above) or you ran `npx netlify dev` and looked at it.
3. If you changed the ratings or the history rows: `HIST_VERSION` bumped.
4. README updated if pages, endpoints, stored data or settings changed.
