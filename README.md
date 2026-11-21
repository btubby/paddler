# Paddler

The website and tools for **Bishops Stortford Canoe Club (BSCC)**, live at **https://bscc-coach.netlify.app**.
Coaches get a board of coaching groups, anyone can look up a paddler's racing history, the race
coordinator gets a K1 / K2 line-up planner, and paddlers get their own page from a link. Almost
everything is built from the **public Hasler marathon results** (entries.canoemarathon.org.uk), which
the server reads and works speed ratings out of; MemberMojo (the club's membership system) is only
used for the coaches' board.

> New to this project (or picking it back up)? Read this file, then `.github/copilot-instructions.md`
> (the short version for AI assistants: conventions, gotchas, how to test).

## Contents

1. [Pages](#pages) and [who can open what](#who-can-open-what)
2. [The paddler page](#the-paddler-page-paddlerspaddler-and-my-racing) in detail
3. [The coaching board](#the-coaching-board-paddlers), [race planner](#the-race-planner-race-planner), [My training](#my-training-my-training)
4. [Server: functions, API and stored data](#server)
5. [Settings (`.env` and Netlify)](#settings-env-and-netlify)
6. [Run locally](#run-locally), [build and deploy](#build-and-deploy), [member sync](#updating-member-details-and-photos-from-membermojo)
7. [Privacy and data protection](#privacy-and-data-protection)
8. [Project layout](#project-layout) and [tests](#tests)
9. [Putting it on GitHub](#putting-it-on-github)

## Pages

Nine pages, built together by Vite (one HTML entry each, each with its own Vue 3 app and styles; see
`vite.config.js`). Every page has the same menu along the top (`src/shared/SiteNav.vue`), which only
shows each visitor the pages they can open (`/api/whoami`).

| Address | What it is | Code |
| --- | --- | --- |
| `/` | **Homepage**: animated river with kayaks, narrowboats, weather and time of day (Bishop's Stortford's real sunrise/sunset). Links to everything else. **Zoom**: scroll wheel, pinch, the +/− buttons or the + − 0 keys zoom the river up to 5× (drag to pan); the title box and menu stay put. In scenic mode, now and then as two paddlers pass one another (heading opposite ways) one says hello in a speech bubble ("Morning!", "Wet one today!"…) and sometimes the other answers (`greetings` in `src/home/App.vue`). Every so often (both modes) a car drives down Stylemans Lane and parks in a free space in the yard (`sendCar`/`driveCars`). Cars and trees wrecked in gaming mode come back when a new game starts. **Scenic / Gaming switch** (top centre; every visit starts in scenic mode). Scenic is just the river. Gaming mode gives it a neon arcade look with scanlines and turns it into *Wreck the River*: 30 seconds, click a boat three times to wreck it (random: blows up 60%, flies off at the camera 20%, sinks 20%; 100/150/75 points), quick wrecks build a combo up to x5, high score kept in the browser. It isn't only kayaks: narrowboats (200 points) and the cars in the yard (120) go up in a much bigger blast (a narrowboat is replaced by another after a while; a car stays as a burnt-out shell), and trees (60, big overhanging ones 90) topple and lie where they fall. Every so often a stick of dynamite floats down the river: one click sets it off, taking out everything within range for a 300-point bonus plus all the wrecks (`eggDynamite`; `spawnDebris('dynamite')` in `swarm.js`). Code: `eggTap` and the game block in `src/home/App.vue`, scoreboard in `src/home/ArcadePanel.vue`. Gaming is off for reduced motion. **Race mode** (third button): the usual traffic leaves and five kayaks line up on the water below the club; paddle by alternating Z and X (left, right, left…; the same key twice barely moves you; a steady beat of about 3 a second is best, too fast splashes, too slowly loses ground), steer with ←/→, brake with ↓ (on-screen buttons on touch devices). Mistakes (the same key twice, splashing, hitting a bank or boat) use up a BALANCE bar, which steady strokes refill: run it out and you fall in and lose the race. Get behind the start line before the starter calls ("On your marks… Set… GO!"); going over it early adds 3 seconds. The camera follows your boat (yellow ring), results show times and gaps, and the best time is kept in the browser. Rules and boat physics are in `src/home/race.js` (plain JS, tested in `test/race.test.js`), the wiring in the race block of `src/home/App.vue`, the display in `src/home/RacePanel.vue`; difficulty is `TUNE` in `race.js`. Off for reduced motion. | `index.html`, `src/home/` |
| `/paddlers/paddler/` | **Paddler lookup** (public): look up anyone in the marathon results, from any club. See [the paddler page](#the-paddler-page-paddlerspaddler-and-my-racing). Not indexed by search engines. | `paddlers/paddler/index.html`, `src/paddler/` |
| `/my-racing/?t=…` | **A paddler's own page** from a signed link a coach makes with "Share with paddler": their results, chart, K2 partners, comments, and their own data controls. | `my-racing/index.html`, `src/paddler/` |
| `/paddlers/` | **Paddler detail board** (coach role): drag members into coaching groups; K2 pair lines and family tree. (Old address `/coaching-groups/` redirects here: `netlify.toml`.) | `paddlers/index.html`, `src/coaching/` |
| `/race-planner/` | **K1 / K2 race planner** (race coordinator role): suggested K1/K2 line-up from the ratings, edited by dragging; the coordinator can also add C1 and C2 canoes by hand (not rated, so never suggested). | `race-planner/index.html`, `src/raceplan/` |
| `/my-training/` | **My training** (coach role): charts of a paddler's own Strava training, from their Strava download or connected account. | `my-training/index.html`, `src/training/` |
| `/bscc-stars/` | **BSCC Star Awards** (coach role): the **assessment record** (the club's assessment book: date, paddler, assessor, award; add, edit, remove, a 'by paddler' view of the highest award, spreadsheet download) and printable 1, 2 and 3 Star certificates (A5). PDFs in `public/certificates/` are behind the same role. | `bscc-stars/index.html`, `src/stars/` |
| `/resources/` | **Training inspiration and resources** (public; no club branding on the page itself, though the site menu is shared): coaching videos: this week's featured video (`FEATURED` in `src/resources/App.vue`: change that one entry each week; currently the Lisa Carrington technique video), an earlier Facebook technique video, and the Ivan Lawler series folded into a small section. | `resources/index.html`, `src/resources/` |
| `/on-the-water/` | **On the water** (public): a soft-focus looping video from a kayak seat. | `on-the-water/index.html`, `src/water/`, `public/on-the-water/` |
| `/club-race/` | **Club at the last race** (public): how the club's paddlers did at the latest race the club went to (or one of the last ten): wins, podiums, every crew's place and time, and each result against that paddler's own form. | `club-race/index.html`, `src/clubrace/`, `netlify/functions/lib/clubrace.js` |

Every page shows a strip of kayaks dashing about until its app starts (`src/shared/kayakDash.js`; add
`?kayaks` to preview), and the data-heavy pages show a river animation while ratings are worked out
(`src/shared/LoadingRiver.vue`; add `?loading` to preview). The paddler pages, race planner and board
share a sky-blue background (`src/shared/SkyBackground.vue`; hidden in the night and high-contrast themes).

## Who can open what

| Role | How | Can open |
| --- | --- | --- |
| **Public** | nothing | `/`, `/paddlers/paddler/` (public results only, plus comments), `/club-race/`, `/resources/`, `/on-the-water/` |
| **A paddler with a link** | signed link from a coach | `/my-racing/?t=…`: only their own page (and their K2 partners' pages, public results only) |
| **Coach** | signing in with Google with the *coach* role | the above, plus `/paddlers/` (board, member data, MemberMojo links, share links, name-link tools), `/my-training/`, `/bscc-stars/` and `/certificates/*` |
| **Admin** | signing in with Google (an `ADMIN_EMAILS` address, or the *admin* role) | everything a coach and the race coordinator can open, plus `/roles/` (who has which role) |
| **Race coordinator** | signing in with Google with the *coordinator* role | the public pages plus `/race-planner/`, and the paddler pages (without MemberMojo or share links) |

- **Sign in with Google** (the "Sign in" button at the right of the menu bar, on every page): an admin lists Google
  accounts (email addresses) and their roles at `/roles/`; `ADMIN_EMAILS` are always admins, so the first admin needs no list.
  Anyone with a Google account may sign in (the bar then says "Welcome <first name>" and "Logged in as <email>") but only listed
  accounts get roles. There are **no passwords**. `POST /api/auth/google` (`netlify/functions/auth.js`) checks Google's ID token
  itself (`lib/google.js`: signature against Google's keys, our client ID, issuer, expiry, verified email) and sets a signed
  `bscc_session` cookie (HttpOnly, 3 days) holding the email, first name and the roles at that moment
  (`netlify/edge-functions/lib/session.js`, with a Node twin in `netlify/functions/lib/session.js`; `test/auth.test.js` checks they
  agree). A role added or removed takes effect at the person's next sign-in; changing `SESSION_SECRET` signs everyone out at once.
- The pages for coaches and the race coordinator are gated by **edge functions** (`netlify/edge-functions/coaching-gate.js`,
  `race-planner-gate.js`, shared code `lib/role-gate.js`). Someone without the role is sent to `/?signin=signin|norole&need=…&next=…`:
  the menu bar then opens the sign-in box (or says the account lacks the role) and, after signing in, goes on to `next`.
  `<page>/?leave` signs out (clearing the old password cookies too) and goes to `/?signedout=1`. One coach role opens all of the
  coach pages; a coach doesn't open the race planner unless they also have the coordinator role (admins have every role).
- Functions check the session with `netlify/functions/lib/access.js` (`signedInAs(req, 'coach' | 'coordinator')`).
- `GET /api/whoami` says what this browser is signed in as, so the menu can hide pages (`src/shared/SiteNav.vue`).
- `/api/paddler` is open to everyone and returns `viewer: 'coach' | 'coordinator' | 'public'`; coach-only
  extras (guesses at earlier names, who is linked, MemberMojo link) are left out for everyone else.
- Share links are signed with `SHARE_LINK_SECRET` (or a secret derived from `SESSION_SECRET`): `netlify/functions/lib/share.js`.

## The paddler page (`/paddlers/paddler/` and `/my-racing/`)

One Vue app (`src/paddler/App.vue`) serves both addresses. `?name=Ann+Able` looks someone up; `&in=CLM` picks the
club when the same name races for several.

**What it shows** (all from the public marathon results; kayak K1/K2 and canoe C1/C2 are rated separately, each
with its own division ladder, with a toggle for anyone who races both):
- Header: name, club (multi-club paddlers: "Has raced for 3 clubs x, y and z", abbreviations highlighted),
  age group, division, promotions history.
- Stat tiles (racing like…, over the last year, best form, what it would take to race like the next division up).
  Tiles say "Over the last year" only if they raced in the last year; otherwise the month and year of the last race.
- **Progress chart** (`ProgressChart.vue`): every race on the division ladder, a trend line, promotions, K2 vs K1,
  course length by dot size, and a marker on races with comments.
- Coaching ideas worked out from the results (`insights.js`).
- **K2 / C2 partners**: who they have raced with and how many times. For coaches (and on a shared link) a partner's name opens their page.
- **All results** table with comments under each race.
- Coaches also see: MemberMojo link and photo (club members only), "Share with paddler", guesses at earlier names.

**How speed is rated** (`netlify/functions/lib/crewfit.js`, `insights.js`): every finishing time is modelled as
`log(time) = course + paddler` (K1; K2 uses the mean of the two paddlers plus a K2 effect), fitted over everyone in
every race since 2010 (all clubs, recent races counting most; a result a year old counts half). That gives each paddler
a rating on the same scale as the fields they raced against, turned into a "level" on the division ladder
(5.0 = typical div 5). Results far off someone's usual (capsize, wrong turn) count for less (`odd`).

**Same name, several clubs / changed name** (people are keyed `name|CLUB`, e.g. `duncan jack|NOT`):
- The page lists others with the same name ("Same name in the results") so the right person can be chosen.
- **Merging**: anyone (no sign-in) can tick same-name paddlers and merge them (`POST /api/paddler-merge`, `mergeOwn` in `crews.js`).
  Results go under the club raced for most recently; the ratings are recalculated in the background and the page waits
  (`refitting`). It can be undone from the page. For non-coaches the server only accepts same-name paddlers whose
  years don't overlap, allows 12 tries per visitor per 15 minutes and does one merge at a time. A one-click
  "Looks like the same person" appears when there is one other with the same name whose results start after this
  one's end (or end before its start). Coaches can merge anything. A share link keeps working after a merge (`resolveKey`).
- **Earlier names** (married names, misspellings): for coaches only, a paddler whose first result is already in a middling
  division must have raced before under another name; `lib/namelinks.js` suggests candidates (same first name, sex and age group, old name stopping
  before the new one starts, matching divisions and K2 partners). A coach confirms with **Same person** (stored as a name
  link) or **Not them**. Nothing is ever linked without a person saying so. Fixed corrections can also go in
  `lib/match.js` (`NAME_CHANGES`, `MISSPELLINGS`; changing them changes `HIST_VERSION`, which recalculates the ratings).
- Stored in the `crews` blob store as `name-links`: `{ links: { fromKey: { name, club, was, to, at } }, rejected, at }`.

**Comments on results** (`/api/paddler-notes`):
- Anyone can comment on any result (ticks: windy, rain, hot, cold, stopped to help, capsized, ill/injured, course/start
  problem; plus up to 280 characters; up to 20 per result; visitors 10 per 15 minutes). Comments are **public**.
- Stored apart from the Hasler results, under the paddler's *name* (so club moves and merges keep them) and the race (`rid` = race key + `|` + tab).
- **Removing**: a coach (any), the paddler it is about (from their own link), or whoever wrote it (the browser keeps a secret given at posting; only its hash is stored).
- **K2/C2 partners see each other's comments** on their shared race, labelled with the author's name.
- **"Not a fair result"** (stopped to help, capsized…) is only offered on a paddler's own link and to coaches; it makes that result count for almost nothing in the ratings (and shows it as odd); the ratings are recalculated in the background (`notes-unfair` blob).
- Coaches can download every comment as CSV/JSON (`/api/paddler-notes?export=csv`): the comments are the only data that exists only in this app.

**Paddlers' own data**: on their own link (or for a coach on any page) a "Your data" panel downloads everything kept about them
(`?mydata=1`) and deletes all comments on their results and the name links under their name (`action: 'erase'`).

## The coaching board (`/paddlers/`)

For coaches: drag coaches and paddlers into coaching groups. Members come from MemberMojo; each card shows the member's
photo (with consent), their current division from the marathon results, when they last raced, and an orange tint for
under-18s. Coaches are members with a "Coach" membership in MemberMojo.

- **Front end:** `src/coaching/` (`App.vue`, components `PaddlerChip`, `GroupColumn`, `PairLines`; data `board.js`, `crews.js`, `k2tree.js`, `photos.js`, `paddlers.js`).
- **Shared groups:** stored once on the site (Netlify Blobs, `/api/board`) and the same for every coach; each change is sent as a small operation ("move 123 to g1") applied one at a time so coaches editing at once don't overwrite each other; other coaches' changes arrive within 15 seconds. Display settings (filters, photos, K2 lines) stay per browser.
- **Show K2 pairs**: lines join everyone on the board who has raced a K2 together (number = races together; dashed if none in the last year), laid out like a family tree (`k2tree.js`).
- Member photos need a MemberMojo session, so the server fetches them in batches (`photos.js`, `/api/members/photos`).

## The race planner (`/race-planner/`)

For the race coordinator: suggests who should race K1 and who should pair up in a K2.
- Ratings from `crews.js`; the planning rules are in `lib/crewplan.js`: a K2 races in division (A + B) ÷ 2 rounded down, nobody races down a distance (divs 1-3 long, 4-6 medium, 7-9 short), and a K2 is only suggested when it does at least as well for both paddlers as their own K1 race.
- The coordinator can add rules (two paddlers must / must not share a K2; someone must race a K1 / K2), keep people in the boats they usually race, and "Re-plan with these rules". Then drag a paddler (or click, then click where they go) onto a seat to swap, onto a K1 to make a K2, onto New K1 / New K2, or into Not in a boat / Not racing. Boats show their division, the share of the field they'd beat, and warnings.
- The line-up is saved as you go (`/api/race-plan`, store `race-plans`, one plan per club, versioned: a save from an out-of-date copy is refused with 409 and the coordinator picks which to keep). Pure line-up logic: `src/raceplan/lineup.js`.
- Shows members' photos only with photo consent, matched by name on the server (`/api/members/photos-by-name`); the member list itself is not sent.

## My training (`/my-training/`)

`/my-training/` shows a paddler charts of their own Strava training. Two ways in:

- **Their Strava download** (works with any account, free or paid): they ask Strava for their
  archive (Settings → My Account → Download or Delete Your Account → Request Your Archive),
  then drop the zip (or the activities.csv inside it) on the page. It's read in their browser
  (`src/training/stravaExport.js`): nothing is uploaded, and it's remembered in that browser
  only until they press "Forget it". The page has step-by-step instructions.
- **Connecting their Strava account** (setting up, below): stays up to date by itself, but needs the club's
  Strava app, which Strava limits to a few athletes.

Either way the charts are: hours a week by kind (paddling, ergo, gym, running…), paddling speed over time,
km paddled a month and their latest activities. `/my-training/?demo` shows made-up example data.

- **Only the paddler sees it.** Strava's API terms only allow someone's Strava data to be shown
  to them, so it is sent only to the browser that connected (a signed, http-only cookie): not
  to coaches, not on the paddler pages.
- **Only summaries are kept** (Netlify Blobs, store `strava`): date, type, name, distance, time,
  speed, heart rate, power. No GPS tracks, maps or photos. Disconnecting deletes it all and
  withdraws the app's access on Strava.
- **The club's Strava page** (https://www.strava.com/clubs/stortcanoe, club id 498340, or set `STRAVA_CLUB_ID`):
  publicly it shows only its name, member count and description; its activities are behind a Strava
  login, so there is nothing public to read. The site therefore (1) links to it: a "Join the club
  on Strava" card on `/resources/` and on `/my-training/`; and (2) for a paddler who has connected
  their Strava on My training, a button "Show the club's latest activities" asks Strava's own club API
  (`/api/strava/club`: first name and last initial, the activity, distance, time: no dates, routes or
  maps; the connected athlete has to be a member of the club or Strava refuses). It is only asked when
  the button is pressed, kept 15 minutes under that athlete only (`club-<id>` in the `strava` store),
  never shown on a public page, and deleted when they disconnect. Check Strava's API Agreement
  before widening who can see it.
- **Setting up:** create an API application at https://www.strava.com/settings/api (the club's
  account, or yours to start with), set its Authorization Callback Domain to the site's domain,
  and add `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` on Netlify. A new Strava app can
  connect only its owner's account at first; Strava allows up to 10 athletes on request in
  the app settings, and more after Strava reviews it.



## Source data: what the marathon results leave out

The source (entries.canoemarathon.org.uk) covers far more than Hasler races: Hasler divisions, other marathons and, in the last couple of years, the Winter Series. Its older pages
(and some newer races) have no **Class** column, so they don't say kayak or canoe (checked: no Class column in 2012, 2016, 2020, 2021; some 2022 races have it and some, such as the Hasler Final, don't;
2023 and 2024 do). A division table with no class is counted as a **kayak** result (the likelier), which can muddle someone who races both. Those history rows carry `nc: true`;
the paddler page marks them with a † and says so above "All results". SUP results aren't read at all. Changing how history rows are made means bumping `HIST_VERSION` (now `8:`), so the first lookup after a deploy (a coach's or anyone's) starts a one-off recalculation (see `startFitIfIdle`).

## Keeping within Netlify's free allowance

The free plan has a monthly Functions allowance; going over pauses every site on the account (this
happened in November 2026). So the site is built to make few function calls:

- **The menu bar** asks `/api/whoami` at most every 30 minutes per browser (answer kept in
  `localStorage` as `bscc-nav-roles`), and always on the pages only a coach or the coordinator can open.
- **The homepage** makes no calls when it opens; the game asks for the leaderboards only when gaming mode starts.
- **Cached for everyone** (`cachedJson` in `crews.js`: browser and Netlify CDN): the leaderboards
  (`/api/wreck-scores` GET, 30 s / 60 s), a paddler's comments (`/api/paddler-notes?key=` GET, 60 s / 2 min),
  their sprint results (`/api/paddler-sprint?key=` GET, 5 / 15 min) and `/api/club-race` (5 / 15 min).
  Never cached: anything on a share link (`?t=`) and every POST.
- **The public paddler lookup** (`/api/paddler?club=&name=`) is cached too (2 min in the browser, 10 min in the CDN) but only
  for visitors without the coach or coordinator cookies: the answer is sent with `Netlify-Vary: cookie=…` so the CDN keeps
  those apart, and coach/coordinator answers are never cached. Not cached while the results are being worked out, or when
  nobody was found. After a merge or name link the page adds `&fresh=<time>` so it sees the new numbers at once.
- **`public/robots.txt`** keeps polite crawlers off `/api/` and the paddler pages (each page view is a function call).
- **The paddler page** only asks for the club's members (`/api/members`, coaches only) when a coach or the coordinator is signed in.
- **The heavy work** (reading races, `crews-fit`, `sprint-index`) only starts when a coach opens the board or presses a button;
  the sums are only redone when the results changed (`basis`). Recent races are read again at most every `RECENT_HOURS` (3).
- Check usage in Netlify: Usage & billing → Functions (it lists each function).

## Server

Netlify **Functions** (`netlify/functions/`, Node ES modules), **Edge Functions** (`netlify/edge-functions/`, Deno, the role gates) and **Netlify Blobs** for storage (no database).

### API reference

| Endpoint | File | Who | What |
| --- | --- | --- | --- |
| `GET /api/paddler?club=BSF&name=…[&in=CLM]` | `crews.js` | anyone | One paddler's results with ratings (`viewer` says what extras the caller gets). Answers `{ pending: true }` until the ratings have been worked out. |
| `GET /api/paddler?t=<token>[&with=Name]` | `crews.js` | link holder | The token's own paddler; `with` opens one of their K2/C2 partners (403 for anyone else). |
| `GET /api/crews?club=BSF` | `crews.js` | coach, coordinator | The club's ratings, fields and K2 pairs for the board and race planner. First ever call reads ~1,000 race pages (answers `{ more: true }`, called repeatedly), then starts the background fit. |
| `POST /api/crews-fit?club=BSF` | `crews-fit.js` | coach, coordinator, server (`x-fit-token`) | **Background function** (up to 15 min): works the ratings out and saves them; `/api/crews` and merges start it. |
| `GET/POST/PUT/DELETE /api/awards` | `awards.js` (`lib/awards.js`) | coaches | The assessment record: `GET` lists `{id, date, paddler, assessor, award (1–3), memberId, addedBy, at}` newest first; `POST {date, paddler, assessor, award, memberId?}` adds one (a repeat of the same paddler, date and award is refused), `PUT {id, …}` edits, `DELETE ?id=` removes. Stored as one list in the `bscc-awards` store. |
| `GET/POST /api/wreck-scores` | `crews.js` (`wreckScores`) | public (removal: coach) | The homepage game's two top fives, most points (`scores`) and most things destroyed in a round (`wrecks`): `GET` lists both as `{id, name, score, wrecked, at}`; `POST {name, score, wrecked}` adds the entry to whichever it qualifies for (name cleaned and cut to 14 characters, score 1–200000, 20 per visitor per 15 minutes, only the best five of each are kept, blob `wreck-scores`); `POST {action:'remove', id}` is coach-only, for a name that shouldn't be there. Scores come from the browser so they can't be trusted: it is for fun. |
| `POST /api/sprint-index[?years=5][&force=1]` | `sprint-index.js` (background) | coach | Reads the National Sprint Regatta results PDFs from canoeingresults.com for the last five years (the year pages link to `UKSPyyyy-mm.pdf`, one per regatta), parses them (`lib/sprint.js`, `lib/sprintpdf.js` with pdf.js) and keeps them in blobs `sprint-regatta-<id>`, `sprint-club-<CLUB>` and `sprint-index`. Regattas already kept are not read again unless `force=1`. |
| `GET /api/club-race?club=BSF[&race=<race path>]` | `crews.js` (`clubRaceFor`), `lib/clubrace.js` | public | The club's results at its latest race (or the one asked for) with totals and a list of the last ten races. One read of the saved `hist5-<CLUB>`; kept 5 minutes by the browser and 15 by Netlify's CDN so it adds few function calls. `{ pending: true }` until the ratings exist. Same public results as the Hasler site; nothing is stored. |
| `GET /api/paddler-sprint?key=name\|CLUB` or `?t=` | `crews.js` (`sprintFor`) | public | A paddler's sprint regatta entries (matched on first initial + surname + club), with how many other paddlers at the club share that initial and surname. |
| `GET /api/paddler-link?club=&name=[&in=]` | `crews.js` | coach | Makes a signed share link (`/my-racing/?t=…`). |
| `POST /api/paddler-names` | `crews.js` | coach | `{ action: link \| reject \| unlink, from, to }`: confirm or set aside an earlier name. Recalculates the ratings. |
| `POST /api/paddler-merge` | `crews.js` | anyone | `{ t \| key, action: merge \| unlink, keys \| from }`: put same-name results together / undo (rules above). |
| `GET/POST /api/paddler-notes` | `crews.js` | anyone / link / coach | Comments: `GET ?key=` (or `?t=`) reads; `POST` adds; `action: 'remove'` removes (coach, the paddler's link, or the writer's secret); `action: 'erase'` deletes everything about a paddler (link or coach); `GET ?mydata=1` downloads a paddler's data (link or coach); `GET ?export=csv\|json` all comments (coach). |
| `GET /api/whoami` | `whoami.js` | anyone | `{ coach, coordinator, admin, email, name, googleClientId }`: what this browser is signed in as with Google. |
| `POST /api/auth/google` | `auth.js` | anyone with a Google account | `{ credential }` (Google's ID token) → `{ email, roles }` and the `bscc_session` cookie. |
| `POST /api/auth/logout` | `auth.js` | anyone | Forgets the session cookie. |
| `GET` / `PUT /api/auth/roles` | `auth.js` | admins (Google) | The roles list; `PUT { email, roles }` sets one person's roles (`[]` removes them). |
| `GET /api/divisions?club=BSF&names=A\|B` | `divisions.js` | board | Each name's current division from the marathon results (three seasons, indexed in the `divisions` store). |
| `GET /api/members` … | `members.js` | coach or `SYNC_TOKEN` | Member list; `/members/photos`, `/members/photo/:id`, `/members/photos-by-name`, `POST /members/upload`, `/members/upload-photos` (sync). |
| `GET/POST /api/board` | `members.js` | coach | The shared coaching groups (store `board`), applied as operations. |
| `GET/PUT /api/race-plan?club=BSF` | `race-plan.js` | coordinator | The saved race line-up (store `race-plans`). |
| `/api/strava/connect \| callback \| activities \| club \| disconnect` | `strava.js` | the paddler's own browser | Strava connection for My training (store `strava`); `club` is the Strava club's latest activities, for a connected member of the club. |

### Stored data (Netlify Blobs)

| Store | Keys | Holds |
| --- | --- | --- |
| `crews` | `manifest`, `year-YYYY`, `recent` | The Hasler race pages read so far (only the columns the model needs); finished races never change so each is read once; races are left out until settled (two weeks, not provisional); `recent` holds newer ones. |
| `crews` | `fit12-<club>`, `fitting-<club>`, `hist5-<CLUB>`, `people-index` | The fitted ratings; the background job's progress; everyone's results, one blob per club; an index of who is in which club. They carry a `basis` string (`races\|last date\|recent N\|notes N\|names N`) and `HIST_VERSION`: when the data or the sums change they are worked out again. |
| `crews` | `name-links` | Merges and confirmed earlier names (see above). |
| `crews` | `notes-<hash of name key>`, `notes-unfair` | Comments (each with a hash of its author's secret) and the list of results marked not fair. |
| `membermojo` | `members` | The synced member list (only under-18 / coach / photo-consent flags and names are kept). |
| `board` | `board` | Coaching groups and roles. |
| `race-plans` | one per club | The race line-up. |
| `bscc-awards` | `records` | The star awards assessment record: `{ rev, records: [...] }`. |
| `bscc-roles` | `roles` | Who has which role (email → roles), for Google sign-in. |
| `divisions` | `index-<club>` | Index of the club's paddlers' divisions. |
| `strava` | `athlete-<id>`, `acts-<id>`, `club-<id>` | Strava tokens and activity summaries only; `club-<id>` is a 15-minute copy of the club's latest activities for that one athlete. |

Without Blobs (plain `vite`, tests) the functions fall back to in-memory stores.

### How the ratings get worked out

Reading ~1,000 race pages and fitting everyone's speed takes longer than an ordinary function may run (about 10 s), so: `/api/crews` reads races in rounds (each works a few seconds and answers `{ more: true }`, the page asks again), then starts `crews-fit.js` (a background function, up to 15 min) which saves the ratings, the per-club results and the index. Pages show "being put together" until the saved `basis` matches the current one. Anything that changes the sums (a new race, a name link or merge, a "not a fair result" mark, a change to `MISSPELLINGS`/`NAME_CHANGES`) changes the basis or `HIST_VERSION` and triggers a recalculation. **After a deploy that changes the sums, the first lookup of anyone on the paddler page starts it** (`startFitIfIdle` in `crews.js`: only once, and not again for 10 minutes while a run is going; the page says "being prepared, try again in about five minutes"). Only the first-ever reading of the races (many rounds) still needs a coach to open `/paddlers/`.

### Library code (`netlify/functions/lib/`)

| File | What |
| --- | --- |
| `crewfit.js` | The rating model (pure): fits paddler and course effects; builds each paddler's history rows (`rid`, `club`, `rating`, `odd`, `partner`…). |
| `crewplan.js` | The K1/K2 planner (pure), also runs in the browser. |
| `match.js` | Name matching, `MISSPELLINGS`, `NAME_CHANGES`, date parsing. |
| `namelinks.js` | Suggests earlier names for coaches (pure). |
| `access.js` | Who is signed in, from the gate cookies. |
| `share.js` | Signs and reads share-link tokens; `fitToken()` for the server's own background-fit calls. |
| `members.js` | MemberMojo helpers, constant-time compare, sign-in attempt limiter (`makeAttemptLimiter`). |
| `strava.js` | Strava OAuth, trimming activities, the signed session cookie. |

### Edge functions

`coaching-gate.js` (coaches: `/paddlers/*` except `/paddlers/paddler/`, `/bscc-stars/*`, `/certificates/*`, `/my-training/*`) and `race-planner-gate.js` (`/race-planner/*`), both built on `lib/role-gate.js`.

## Settings (`.env` and Netlify)

| Variable | Where | Purpose |
| --- | --- | --- |
| `MEMBERMOJO_EMAIL`, `MEMBERMOJO_PASSWORD` | `.env` only | MemberMojo login used locally and by the sync. |
| `SYNC_TOKEN` | `.env` and Netlify | Secret the sync uses to read and upload the member list. At least 20 characters. |
| `SYNC_SITE_URL` | `.env` only | The live site, e.g. `https://bscc-coach.netlify.app`. |
| `GOOGLE_CLIENT_ID` | `.env` and Netlify | The OAuth client ID for Sign in with Google (not secret). Needs the site's address (and `http://localhost:8888`) as authorised JavaScript origins; see `.env.example`. |
| `SESSION_SECRET` | `.env` and Netlify | Long random string (16+ characters) that signs the Google sign-in cookie. Changing it signs everyone out. |
| `ADMIN_EMAILS` | `.env` and Netlify | Comma-separated Google accounts that are always admins and can edit `/roles/`. |
| `SHARE_LINK_SECRET` | Netlify (optional) | Signs the links coaches share with paddlers. Without it one is made from `SESSION_SECRET` (so changing that also stops every shared link). Changing this stops every shared link. Links made while the coaches still had a password were signed with a key made from it: to keep them, set this to `node -e "console.log(require('crypto').createHash('sha256').update('bscc-share-links:' + process.argv[1]).digest('hex'))" '<the old coaches password>'`. |
| `MEMBERS_SOURCE` | Netlify: `upload` | `upload`: serve the synced copy. `live`: ask MemberMojo. Unset: synced copy if any. |
| `MEMBERS_PROFILES` | optional | `off` skips reading profiles: no under-18 tint, coach flag or photos. |
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Netlify | The club's Strava API application, for My training. |
| `HOME_CLUB` | optional | The club code the ratings are worked out for (default `BSF`). |
| `MEMBERS_DEBUG`, `DIVISIONS_DEBUG` | local only | `1` logs every step. Don't set on the live site (logs contain names). |

To make a new `SYNC_TOKEN`: `openssl rand -base64 24`, then set it in `.env` and on
Netlify. `COACH_TOKEN` is no longer used; it can be removed from `.env` and from Netlify
(`npx netlify env:unset COACH_TOKEN`).


**You need:** Node.js 20.6 or newer (`node -v`), a Netlify account, and a MemberMojo login with a password set (Your Membership → Change Password).

## Run locally

```
cd "/Users/bentubby/joe/BSCCCoachingApp 6"
npm install
cp .env.example .env        # first time only, then fill it in (see Settings below)
npx netlify dev
```

Open the address `netlify dev` prints, **http://localhost:8888** (the homepage), or go
straight to **http://localhost:8888/paddlers/** and sign in with Google (the account must be in `ADMIN_EMAILS` or have a role on `/roles/`; `http://localhost:8888` must be an authorised origin on the Google client). (`npm run dev` alone runs only the page on
port 5190, without the functions, so no members or divisions.)

Locally, the functions sign in to MemberMojo themselves, which works from a home
connection. Things to know:

- **Sign-in limits.** MemberMojo refuses sign-ins for a while after too many (HTTP 429).
  Every restart or code change signs in again, so avoid rapid restarts. If you see
  "limiting sign-ins", wait 15–30 minutes. Untick **Show photos** to save sign-ins.
- **First load is slower.** It reads each member's profile (under-18, coach, photo
  consent); the results are cached for 12 hours.
- **Step-by-step logs.** Under `netlify dev` these print in the terminal
  (`[members]`, `[divisions]`) and the browser console. To see the full member trace:
  ```
  curl -H "x-sync-token: YOUR_SYNC_TOKEN" "http://localhost:8888/api/members?trace=1&fresh=1"
  ```
- **Tests:** `npm test` runs the unit tests (name matching, divisions, access codes).


## Build and deploy

The live site is **https://bscc-coach.netlify.app**.

### First time only

```
npx netlify login
npx netlify link                         # choose the site
npx netlify env:set SYNC_TOKEN   "$(grep '^SYNC_TOKEN='  .env | cut -d= -f2-)"
npx netlify env:set MEMBERS_SOURCE upload
npx netlify env:set GOOGLE_CLIENT_ID "$(grep '^GOOGLE_CLIENT_ID=' .env | cut -d= -f2-)"
npx netlify env:set SESSION_SECRET "$(grep '^SESSION_SECRET=' .env | cut -d= -f2-)"
npx netlify env:set ADMIN_EMAILS "$(grep '^ADMIN_EMAILS=' .env | cut -d= -f2-)"
```

The live site doesn't need the MemberMojo email and password (it can't use them,
see section 3), so don't store them on Netlify. If they were imported earlier:
`npx netlify env:unset MEMBERMOJO_EMAIL` and `npx netlify env:unset MEMBERMOJO_PASSWORD`.

### Every deploy

```
npm run deploy
```

This runs the tests, then (only if they pass) `npx netlify deploy --prod --build`, which
runs `npm run build` (output in `dist/`) and publishes the pages and the functions.

**Settings changes need a redeploy.** Functions only pick up changed Netlify
settings when they are deployed again.

After deploying, open `/paddlers/` on the site, sign in with Google as a coach, and check the status line
says "MemberMojo list (… members, uploaded …)". If it says nothing has been uploaded
yet, run the sync (see “Updating member details…” below).



## Updating member details and photos from MemberMojo

MemberMojo is behind Cloudflare, which blocks sign-ins from cloud servers like
Netlify's (HTTP 403 "Just a moment…"). So the live site never contacts MemberMojo.
Instead you run a sync on your own computer, which signs in from your home
connection and uploads the result to the site.

```
npm run sync-members                  # member list only
npm run sync-members -- --photos      # member list and photos
npm run sync-members -- --dry-run     # read MemberMojo, upload nothing (for checking)
npm run sync-members -- --check       # is everyone in MemberMojo on the live site? (changes nothing)
```

### What it does

1. Signs in to MemberMojo once and reads the Member Directory.
2. Opens each member's profile and keeps three yes/no answers, nothing else:
   - under 18 (from "Age")
   - coach (membership type "Coach" or "Coach (3 months)")
   - photo consent (from "Photo consent")
3. With `--photos`, fetches photos, but only for members whose photo consent is "Yes".
4. Uploads the list (and photos) to the live site, which keeps them in Netlify Blobs.
   Photos of members who have left, or withdrawn consent, are deleted.

A successful run looks like:

```
✓ 82 members read from MemberMojo (7 coaches, 18 under 18, 60 with photo consent)
✓ Uploaded 82 members
✓ Photos uploaded
```

### When to run it

- When members join or leave, or change membership type or photo consent.
- Add `--photos` when photos have changed.

Coaches see the new list the next time they open or refresh the app. Divisions
don't need a sync: the site looks them up from the Hasler results itself.

### Troubleshooting

| Message | Fix |
| --- | --- |
| `SYNC_SITE_URL is the Netlify dashboard` | Use the site address (`https://….netlify.app`), not `app.netlify.com`. |
| `HTTP 404` on `/api/members/upload` | The live site runs older code: `npx netlify deploy --prod --build`. |
| `SYNC_TOKEN is not configured` / `too short` | Set `SYNC_TOKEN` on Netlify (section 2) and redeploy. |
| `HTTP 401 Unauthorized` | `SYNC_TOKEN` in `.env` and on Netlify differ; set it again from `.env`. |
| `limiting sign-ins` / `HTTP 429` | MemberMojo's sign-in limit: wait 30 minutes to a few hours, then retry once. |
| `did not accept the sign-in` | Check `MEMBERMOJO_EMAIL` / `MEMBERMOJO_PASSWORD` in `.env`, and that the account has a password. |



## National sprint regatta results

The paddler page also shows a paddler's results at the National Sprint Regattas (the last five years), from canoeingresults.com, which only publishes them as PDFs.

- **Getting them in:** a coach clicks "read the latest sprint results" under the section on a paddler page (or `POST /api/sprint-index`). The background function finds each year's page, downloads each regatta PDF, reads it and saves the entries. Run it again after each new regatta; ones already read are skipped (`?force=1` re-reads them all, e.g. after improving the reader).
- **Reading the PDFs:** they are scanned and run through OCR, so the text has slips (`Kl`, `lO00m`, `21 :51.45`, `I` between crew members). `netlify/functions/lib/sprint.js` is forgiving about these: it splits the page into columns (using the "Class:" headings), reads the race headings and each result line, and joins crews that run over two lines. `lib/sprintpdf.js` gets the text and its positions out of the PDF with pdf.js (`pdfjs-dist`, kept out of the bundle in `netlify.toml`). Check a PDF by hand with `node scripts/sprint-check.mjs UKSP2025-05.pdf BSF`: it prints what was read and any lines it could not. Tests use the saved text positions in `test/fixtures/`.
- **Matching:** results print only "C Redeker" and a club code, so a result is matched to a paddler on first initial + surname + club. If another paddler at the same club shares the initial and surname, the page warns that some may be someone else's.
- **Limits:** not used in the ratings (sprint times are not comparable with marathon times). Years before 2010 and the older results format are not read. The venue is not shown (the PDFs don't give it).

## Privacy and data protection

The homepage game's top five shows whatever name the player types (the box says it is shown to everyone and that a nickname is fine); nothing else about them is kept. A coach can remove an entry with `POST /api/wreck-scores {action:'remove', id}` while signed in.

**What is kept about people**, and where:
- **MemberMojo (coaches' board only):** only three yes/no answers per member (under 18, coach, photo consent) plus names; ages, membership types, medical or contact details are never stored. Photos only with consent "Yes"; the sync deletes the rest.
- **Public marathon results and ratings:** read from the public site and worked out here; can be re-read any time.
- **Comments, name links, "not a fair result" marks:** exist only in this app's Netlify Blobs. Comments are **public**.
- **Strava (My training):** summaries only, shown only to that paddler.
- **Assessment record (`/bscc-stars/`):** for each assessment the paddler's name (and MemberMojo id when picked from the member list), date, assessor and award (1–3 star), and the email of the coach who added or edited the row, in the `bscc-awards` Netlify Blobs store. Coaches only, except that an award gained in the last 7 days shows its level and date (never the assessor) on that paddler's own lookup page as a congratulations banner (`recentAward` in `/api/paddler`, so public and cached up to ~10 minutes). A paddler's highest award level (`starLevel`, level only) also shows beside their name on the lookup page, and coaches see it as a badge on the board cards. A coach can edit or remove any row and download everything as a spreadsheet; a paddler's request to see or delete their rows goes to the privacy contact, and a coach does it from this page.
- **Roles (`/roles/`):** the email addresses of club volunteers an admin has given a role (coach, race coordinator, admin) and who added them, in the `bscc-roles` Netlify Blobs store; used only to decide who may open what. Admins can download the list and remove anyone from `/roles/`. Signing in with Google keeps nothing about people with no role beyond a cookie in their own browser (their email, for the "Logged in as" line).

**Controls:**
- Every member-data endpoint needs a Google sign-in with the coach role (or `SYNC_TOKEN` for the sync; 10 wrong tokens in 15 minutes blocks a client for a while).
- A paddler (own link) or a coach can **download** everything kept about a paddler and **delete** all comments on their results and name links under their name. Comments can be removed by a coach, the paddler they are about, or their writer. Coaches can export all comments.
- A privacy note sits at the foot of every paddler page: the contact (the site owner) is `PRIVACY_NAME` / `PRIVACY_EMAIL` in `src/paddler/App.vue`. The note no longer mentions personal "My racing" links (being phased out): requests go to that contact, and a coach does the download/delete from the paddler page.
- Step-by-step server logs (which contain names) are off on the live site. The division lookup sends names in the request body, not the URL.
- **Sign out** signs you out and forgets the member details stored in that browser. The shared groups are not affected.
- The club is the data controller. The committee or welfare officer should agree to this use and the club's privacy notice should cover it (including public comments and merging results under a name).
- Keep `.env` out of Git (it is in `.gitignore`). Keep the repository private if possible: `src/coaching/data/paddlers.js` names some members in comments.

## Project layout

```
index.html, paddlers/, paddlers/paddler/, my-racing/, my-training/, race-planner/,
bscc-stars/, resources/, on-the-water/     one HTML entry per page (Vite)
vite.config.js                              the pages; local redirect /paddlers -> /paddlers/; the loading kayaks
netlify.toml                                build, redirects (/coaching-groups -> /paddlers), dev settings
.github/copilot-instructions.md             notes for AI assistants working on the code

src/home/                                   homepage: App.vue, swarm.js (motion, collisions), weather.js, narrowboatLook.js, components/
src/paddler/                                paddler page: App.vue, ProgressChart.vue, insights.js (levels, trend, coaching ideas)
src/coaching/                               the board: App.vue, components/, data/ (board, crews, k2tree, photos, paddlers)
src/raceplan/                               race planner: App.vue, BoatIcon.vue, RaceChip.vue, lineup.js
src/training/                               My training: App.vue, charts, stats.js, stravaExport.js, DownloadHelp.vue
src/stars/ src/resources/ src/water/        the star awards, resources and on-the-water pages
src/shared/                                 SiteNav, SkyBackground, LoadingRiver, KayakDash, loadingPreview.js, kayakDash.js

netlify/functions/                          members, divisions, crews, crews-fit (background), race-plan, strava, whoami
netlify/functions/lib/                      crewfit, crewplan, match, namelinks, access, share, members, strava
netlify/edge-functions/                     coaching-gate, race-planner-gate, lib/role-gate, lib/session

scripts/sync-members.mjs                    the member sync (run on your own computer)
public/                                     logo, favicon, certificate PDFs, the on-the-water video
test/                                       unit tests (npm test)
```

## Tests

`npm test` (Node's built-in runner, `node --test`) runs everything in `test/` — name matching, divisions, ratings and crew planning,
the paddler functions (merge, notes, export, privacy), the race planner, Strava and weather. `npm run deploy` runs them first and
only deploys if they pass. There are no browser tests: check page changes by running `npx netlify dev`. (In a sandbox without the
Mac-native build modules, `vite build` can't run; compile a changed `.vue` file with `@vue/compiler-sfc` to catch template errors.)

## Putting it on GitHub

- The repo has not been under Git yet. `.gitignore` already excludes `node_modules`, `dist`, `.env` and `.netlify`. Check `git status` shows no `.env` before the first commit, and rotate any secrets that were ever in a committed file.
- Keep it **private** if possible (member names appear in a comment in `src/coaching/data/paddlers.js`).
- Netlify can deploy from GitHub (Site configuration → Build & deploy → link repository; build command `npm run build`, publish `dist`) in place of `npm run deploy`. Environment variables stay in Netlify, not in the repo. Note `npm run deploy` also runs the tests; if Netlify builds from GitHub, run the tests in a GitHub Action (`npm ci && npm test`).
