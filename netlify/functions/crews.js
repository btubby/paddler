// GET /api/crews?club=BSF  (coaches and the race coordinator: the board and the race planner)
// Speed ratings for a club's paddlers, fitted over every kayak result in the public Hasler
// results (entries.canoemarathon.org.uk) since FIRST_YEAR, all clubs, recent races counting
// most, plus the fields each division races against. The page decides who races K1 and who
// pairs up in a K2 (netlify/functions/lib/crewplan.js), so changing who's available needs
// no server call.
//
// That's about 1,000 race pages. Finished races never change, so each is read once and
// kept in Netlify Blobs (one blob per year, only the columns the model needs). Reading
// them all takes many calls: each works for a few seconds and answers { more: true }, and
// the page calls again. Races are left out until they have settled (two weeks, not
// provisional). The fitted ratings are kept too, and only worked out again when a new
// race has been added.
import * as cheerio from 'cheerio'
import { signedInAs } from './lib/access.js'
import { makeShareToken, readShareToken, fitToken } from './lib/share.js'
import { makeAttemptLimiter } from './lib/members.js'
import { parseDate, sameRacer, MISSPELLINGS, NAME_CHANGES } from './lib/match.js'
import { openAwardsStore } from './lib/awardstore.js'
import { recentAwardFor, starLevelFor } from './lib/awards.js'
import { createHash, randomBytes } from 'node:crypto'
import { fitRatings, personKey } from './lib/crewfit.js'
import { nameKeys } from './lib/sprint.js'
import { clubRace } from './lib/clubrace.js'
import { earlierNames, KEY as PERSON_KEY } from './lib/namelinks.js'

const BASE = 'https://entries.canoemarathon.org.uk'
const UA = 'BSCC-Coaching-App/0.1 (club coaching tool)'
const FIRST_YEAR = 2010 // the results site goes back to 2010
const SETTLED_DAYS = 14
// The paddler pages' copy of the results says which version of the sums made it: when the
// sums change (e.g. how a K2 result is shared), an older copy counts as not ready, so the
// page has it worked out again instead of showing the old figures. Bump with each change.
// The list of misspellings and name changes is part of it too, so adding a name there has
// everyone's results put together again by itself.
export const HIST_VERSION = '8:' + createHash('sha256').update(JSON.stringify([MISSPELLINGS, NAME_CHANGES])).digest('hex').slice(0, 8)
const RECENT_HOURS = 3 // recent races (not settled yet) are read again this often
const BUDGET_MS = () => parseInt(process.env.CREWS_BUDGET_MS || '6500', 10)
const BATCH = 6

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })

// Answers that are the same for everyone (the leaderboards, a paddler's comments and sprint
// results) are kept by the visitor's browser and Netlify's CDN for a short while, so a busy
// day doesn't mean a function call for every look: the free plan has a monthly allowance.
// `browser` and `cdn` are seconds. Not used for anything that depends on who is asking.
const cachedJson = (body, { browser = 60, cdn = 300, vary = '' } = {}) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${browser}`, 'Netlify-CDN-Cache-Control': `public, s-maxage=${cdn}, stale-while-revalidate=${cdn * 6}`, ...(vary ? { 'Netlify-Vary': vary } : {}) } })
// the cookies that say a coach or the race coordinator is asking: the CDN keeps a separate copy
// for each (never cached: those answers are not public), so it only ever serves the public
// answer to visitors without them
const ROLE_VARY = 'cookie=bscc_session'

// who may ask: coaches (the board, paddler pages) and the race coordinator (race planner)
// race lists are read now and then; race pages once each (then kept in Blobs)
async function getHtml(path) {
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  return res.text()
}

// the races of one year, from its results list
async function racesOfYear(y, now) {
  const year = new Date(now).getUTCFullYear()
  const $ = cheerio.load(await getHtml(y === year ? '/results/races' : `/results/races?year=${y}`))
  const seen = new Map()
  $('tr').each((_, tr) => {
    const a = $(tr).find(`a[href*="/results/races/${y}/"]`).first()
    const href = a.attr('href')
    if (!href) return
    const path = new URL(href, BASE).pathname
    if (seen.has(path)) return
    const text = $(tr).text()
    seen.set(path, { key: path, name: a.text().trim(), date: parseDate(text)?.getTime() ?? null, provisional: /provisional/i.test(text) })
  })
  return [...seen.values()]
}

// one value per crew member, in crew order (see divisions.js)
function parts($, td) {
  if (!td) return []
  const $td = $(td)
  const blocks = $td.children('div')
  if (blocks.length) return blocks.map((_, d) => $(d).text().replace(/\s+/g, ' ').trim()).get()
  return ($td.html() || '').split(/<br\s*\/?>/i).map(h => $('<i>' + h + '</i>').text().replace(/\s+/g, ' ').trim())
}
const seconds = s => {
  const m = String(s || '').trim().match(/^(\d+):(\d\d):(\d\d)$/)
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null
}

// every finisher with a time: { tab, pos, names, clubs, cls, divs, pd, t }
export function parseResults(html) {
  const $ = cheerio.load(html)
  const rows = []
  $('table').each((_, table) => {
    const tab = $(table).closest('.tab-pane[id]').attr('id') || ''
    if (/^(points|promotions|races)$/.test(tab)) return
    const trs = $(table).find('tr')
    const h = trs.first().find('th,td').map((_, c) => $(c).text().trim().toLowerCase()).get()
    const col = { pos: h.indexOf('#'), name: h.indexOf('name'), club: h.indexOf('club'), cls: h.indexOf('class'), div: h.indexOf('div'), time: h.indexOf('time'), pd: h.indexOf('p/d') }
    if (col.name < 0 || col.time < 0) return
    trs.slice(1).each((_, tr) => {
      const td = $(tr).find('td')
      if (!td.length) return
      const t = seconds($(td[col.time]).text())
      if (!t) return
      let names = $(td[col.name]).find('[data-full-name]').map((_, s) => $(s).attr('data-full-name').trim()).get()
      if (!names.length) names = parts($, td[col.name]).filter(Boolean)
      let divs = col.div >= 0 ? parts($, td[col.div]) : []
      if (divs.length === 1 && names.length > 1) divs = /^\d\d$/.test(divs[0]) ? divs[0].split('') : divs[0].split(/\s+/)
      rows.push({
        tab,
        pos: parseInt($(td[col.pos]).text(), 10) || null,
        names,
        clubs: col.club >= 0 ? parts($, td[col.club]) : [],
        cls: col.cls >= 0 ? parts($, td[col.cls]) : [],
        divs,
        pd: col.pd >= 0 ? parts($, td[col.pd]) : [],
        t
      })
    })
  })
  return rows
}

export async function openStore() {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'crews', consistency: 'strong' })
}
// without Blobs (plain `vite`, tests): kept in memory for as long as the process lives
const memory = new Map()
const memStore = { get: async k => memory.get(k) ?? null, setJSON: async (k, v) => { memory.set(k, v) }, list: async ({ prefix = '' } = {}) => ({ blobs: [...memory.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }) }

// GET /api/paddler?club=BSF&name=Kerry%20Tubby[&in=CAM]: one paddler's results, all of them,
// each with how quick it was (for the paddler page): the club's own paddlers, or anyone else
// in the results. Kept when /api/crews works out the
// ratings; until it has, this answers { pending: true } and the page asks /api/crews first.
// a club code as a blob name ('' for results with no club)
const clubKey = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NONE'

function findPerson(hist, name) {
  const key = personKey(name)
  let found = Object.entries(hist.people).find(([k]) => k.split('|')[0] === key)
  if (!found) found = Object.entries(hist.people).find(([, p]) => p.names.some(n => sameRacer(name, n) || personKey(n) === key))
  return found || null // [key, person]
}
function answer(hist, key, found, extra = {}) {
  // kayak and canoe are separate ratings, each against its own fields
  const boat = b => (found[b] ? { K: hist[b].K, k1med: hist[b].k1med, ...found[b] } : null)
  return json({ found: true, key, club: key.split('|')[1], fetchedAt: hist.fetchedAt, name: found.name, names: found.names, kayak: boat('kayak'), canoe: boat('canoe'), ...extra })
}
// anyone in the results: the club's own paddlers first, then everyone else (all clubs). in:
// a club to look in (when the same name races for more than one)
// everyone with this name, in every club, from the index (saved with the same ratings):
// { ok: false } until it exists for these ratings
async function indexMatches(st, hist, name) {
  const index = await st.get('people-index', { type: 'json' })
  const ok = !!index && index.basis === hist.basis
  const key = personKey(name)
  const matches = ok
    ? Object.entries(index.people)
        .filter(([k, p]) => k.split('|')[0] === key || p.names.some(n => sameRacer(name, n) || personKey(n) === key))
        .sort(([, a], [, b]) => (b.last || '').localeCompare(a.last || '') || b.n - a.n) // most recent first
    : []
  return { ok, matches }
}
// the same name racing for another club (often someone who has moved clubs): listed, so the
// page can offer them, and a coach (or the paddler, from their own link) can say they are the
// same person
const othersOf = (matches, k) => matches.filter(([x]) => x !== k).slice(0, 8).map(([x, o]) => ({ key: x, name: o.name, club: o.club, n: o.n, first: o.first, last: o.last }))
export async function paddler(st, club, name, inClub = '') {
  const hist = await st.get(`hist5-${club}`, { type: 'json' })
  if (!hist || hist.v !== HIST_VERSION) return json({ pending: true })
  // results merged (or un-merged) since the ratings were last worked out: what's here is the old
  // version until they have been, which the page waits for
  const refitting = namesStale(hist, (await st.get('name-links', { type: 'json' })) || {}) || undefined
  // Not in the index yet (ratings worked out before anyone else's results were kept): the page
  // has them worked out again first
  const { ok: indexOk, matches } = await indexMatches(st, hist, name)
  if (!inClub || clubKey(inClub) === club) {
    const hit = findPerson(hist, name)
    if (hit) {
      const others = othersOf(matches, hit[0])
      return answer(hist, hit[0], hit[1], { ...(others.length ? { others } : {}), refitting })
    }
  }
  if (!indexOk) return json({ pending: true })
  const pick = (inClub && matches.find(([, p]) => p.club === clubKey(inClub))) || matches[0]
  if (!pick) return json({ found: false, fetchedAt: hist.fetchedAt })
  const [k, p] = pick
  const theirs = await st.get(`hist5-${p.club}`, { type: 'json' })
  const found = theirs?.people?.[k]
  if (!found) return json({ found: false, fetchedAt: hist.fetchedAt })
  const others = othersOf(matches, k)
  return answer(theirs, k, found, { ...(others.length ? { others } : {}), refitting })
}
// every comment, for a coach to keep a copy of (the results can be read again from the Hasler site;
// comments exist only here): rows of { paddler, date, race, event, comment, ticks, unfair, by, added }
export async function exportNotes(st) {
  const out = []
  const { blobs } = await st.list({ prefix: 'notes-' })
  for (const { key } of blobs) {
    if (key === 'notes-unfair') continue
    const cur = await st.get(key, { type: 'json' })
    for (const [rid, v] of Object.entries(cur?.items || {})) {
      for (const c of asList(v)) {
        out.push({ paddler: cur.display || cur.name, date: c.date || '', race: c.race || rid, event: c.event || '', comment: c.text || '', ticks: (c.flags || []).join(', '), unfair: c.unfair ? 'yes' : '', by: c.by || '', added: c.at ? new Date(c.at).toISOString() : '' })
      }
    }
  }
  return out.sort((a, b) => a.paddler.localeCompare(b.paddler) || (b.date || '').localeCompare(a.date || ''))
}
const csvCell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t }
export const notesCsv = rows => ['paddler,date,race,event,comment,ticks,not a fair result,written by,added'].concat(rows.map(r => [r.paddler, r.date, r.race, r.event, r.comment, r.ticks, r.unfair, r.by, r.added].map(csvCell).join(','))).join('\r\n') + '\r\n'
// ---- a paddler's own data: a copy of it, and deleting it --------------------------------------
// (the comments on their results, and the name links that put results together under them: the
// public marathon results themselves are not ours to remove, and are read again from the site)
const chase = (nl, from) => { let k = from; for (let i = 0; i < 6; i++) { const l = nl.links?.[k]; if (!l) break; k = l.to || personKey(l.name) + '|' + String(l.club).toUpperCase() } return k }
const nameKeysOf = me => new Set([personKey(me.name), ...(me.names || []).map(personKey)])
export async function myData(st, key) {
  const who = await notePerson(st, key)
  if (!who) return json({ pending: true })
  const comments = []
  for (const n of nameKeysOf(who.me)) {
    const cur = await st.get(noteBlob(n), { type: 'json' })
    for (const [rid, v] of Object.entries(cur?.items || {})) for (const { h, ...c } of asList(v)) comments.push({ rid, ...c, at: c.at ? new Date(c.at).toISOString() : undefined })
  }
  const nl = (await st.get('name-links', { type: 'json' })) || { links: {} }
  const links = Object.entries(nl.links || {}).filter(([from]) => chase(nl, from) === who.key).map(([from, l]) => ({ from, name: l.name, club: l.club, was: l.was, at: l.at ? new Date(l.at).toISOString() : undefined }))
  return json({
    about: 'Everything this app keeps about you apart from your public marathon race results, which it reads from entries.canoemarathon.org.uk and can read again.',
    paddler: { name: who.me.name, names: who.me.names, key: who.key },
    commentsOnYourResults: comments, namesPutTogether: links, takenAt: new Date().toISOString()
  })
}
export async function eraseMine(st, key, { kick = async () => {} } = {}) {
  const who = await notePerson(st, key)
  if (!who) return json({ error: 'Your results are not ready yet: try again in a few minutes' }, 409)
  let comments = 0
  for (const n of nameKeysOf(who.me)) {
    const blob = noteBlob(n)
    const cur = await st.get(blob, { type: 'json' })
    if (!cur) continue
    for (const [rid, v] of Object.entries(cur.items || {})) {
      comments += asList(v).length
      await setUnfair(st, n + '@' + rid, false, kick)
    }
    await st.setJSON(blob, { name: cur.name, items: {} })
  }
  const nl = (await st.get('name-links', { type: 'json' })) || { links: {} }
  const mine = Object.keys(nl.links || {}).filter(from => chase(nl, from) === who.key)
  if (mine.length) {
    nl.rejected ||= []
    for (const from of mine) { delete nl.links[from]; nl.rejected = [...new Set([...nl.rejected, `${from}>${who.key}`])].slice(-2000) }
    nl.at = Date.now()
    await st.setJSON('name-links', nl)
    await kick()
  }
  return json({ ok: true, comments, links: mine.length })
}
// A paddler's key after merges: a link made for "duncan jack|SOR" keeps working once a merge has
// put those results under "duncan jack|NOT" (name-links: each says where its results went)
async function resolveKey(st, key) {
  const nl = (await st.get('name-links', { type: 'json' })) || { links: {} }
  let k = key
  for (let i = 0; i < 6; i++) {
    const l = nl.links?.[k]
    if (!l) break
    k = l.to || personKey(l.name) + '|' + String(l.club).toUpperCase()
  }
  return { key: k, nl }
}
// results merged since the ratings were last worked out: what the page shows is still the old
const namesStale = (hist, nl) => !String(hist.basis || '').endsWith('|names ' + (nl.at || 0))
// a shared link: that one paddler, by the key in the signed token (never by a name asked for)
async function sharedPaddler(st, tokenKey) {
  const { key, nl } = await resolveKey(st, tokenKey)
  const club = key.split('|')[1]
  const hist = await st.get(`hist5-${club}`, { type: 'json' })
  if (!hist || hist.v !== HIST_VERSION) return json({ pending: true, shared: true })
  const found = hist.people[key]
  if (!found) return json({ found: false, fetchedAt: hist.fetchedAt })
  // guesses at earlier names are for coaches only; the paddler sees who else has their name
  // (to merge their own results) and what they have merged
  const { maybe, ...theirs } = found
  const { matches } = await indexMatches(st, hist, found.name)
  const others = othersOf(matches, key)
  const extra = { refitting: namesStale(hist, nl) || undefined }
  if (others.length) extra.others = others
  return answer(hist, key, theirs, extra)
}
// A shared link may also open one of that paddler's K2 (or C2) partners (/api/paddler?t=...&with=Name):
// only someone they have raced a crew with, and only the public results (nothing for coaches).
export async function sharedPartner(st, tokenKey, withName) {
  const { key } = await resolveKey(st, tokenKey)
  const club = key.split('|')[1]
  const hist = await st.get(`hist5-${club}`, { type: 'json' })
  if (!hist || hist.v !== HIST_VERSION) return json({ pending: true, shared: true })
  const me = hist.people[key]
  if (!me) return json({ found: false, fetchedAt: hist.fetchedAt })
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase()
  const want = norm(withName)
  const raced = [me.kayak, me.canoe].some(b => b?.history?.some(h => h.k2 && h.partner && norm(h.partner) === want))
  if (!want || !raced) return json({ error: 'That paddler is not one of your K2 partners' }, 403)
  const body = await (await paddler(st, club, withName)).json()
  if (body.pending) return json({ pending: true, shared: true })
  const { maybe, linked, others, ...theirs } = body // guesses, links and same names are for coaches
  return json({ ...theirs, partnerOf: me.name })
}
// Works out the ratings again, now that results have been merged: in the background on Netlify
// (crews-fit.js, as the ratings take longer than an ordinary call may run), in the call itself
// without Blobs (tests, plain `vite`)
const HOME_CLUB = () => String(process.env.HOME_CLUB || 'BSF').toUpperCase()
async function kickRefit(st, req) {
  const now = Date.now()
  const club = HOME_CLUB()
  const basis = await currentBasis(st, now)
  if (!basis) return
  if (st === memStore || process.env.CREWS_INLINE_FIT === '1') { await computeRatings(st, club, basis, now); return }
  await st.setJSON(`fitting-${club}`, { basis, at: now })
  const res = await fetch(new URL(`/api/crews-fit?club=${club}`, req.url), { method: 'POST', headers: { 'x-fit-token': fitToken() } }).catch(err => ({ status: String(err.message || err) }))
  console.log(`[crews] ${club}: working out the ratings in the background after a merge (${res.status})`)
}

// Anyone's lookup that finds the ratings not ready (just after a change to how they're made, or
// before they've ever been made) starts the recalculation, not only a coach opening the board:
// otherwise nothing happens until a coach visits. It starts once: a job already running for
// these races (started within the last 10 minutes) is left alone, and one that seems to have
// stopped is started again after that. Answers 'started', 'running', or 'no-races' (the races
// haven't been read yet: that is the coaches' board's job, as it takes many rounds).
export async function startFitIfIdle(st, req, now = Date.now()) {
  const club = HOME_CLUB()
  const basis = await currentBasis(st, now)
  if (!basis) return 'no-races'
  const job = await st.get(`fitting-${club}`, { type: 'json' })
  if (job && job.basis === basis && now - job.at < 10 * 60e3) return 'running'
  await kickRefit(st, req)
  return 'started'
}

// ---- comments on a result ---------------------------------------------------------------
// (A comment can be removed by a coach, by the paddler from their own link, or by whoever wrote it.)
// Anyone can comment on a paddler's result (the wind, stopping to help someone, a bad start),
// and anyone looking the paddler up reads them. The results are the public Hasler ones and stay
// as they are; comments are kept apart, under the paddler's name (so a move of club or a merge
// keeps them) and the race (the history row's rid), several per result. Only coaches remove
// them. "Not a fair result" (stopped to help, capsized...) makes the result count for almost
// nothing in ratings, so only the paddler (their own link) or a coach can tick it.
const NOTE_FLAGS = ['wind', 'rain', 'hot', 'cold', 'helped', 'capsized', 'unwell', 'course']
const MAX_COMMENTS = 20 // per result
const noteBlob = nameKey => 'notes-' + createHash('sha256').update(nameKey).digest('hex').slice(0, 24)
const notesLimiter = makeAttemptLimiter({ max: 10, windowMs: 15 * 60 * 1000 }) // comments per visitor
const asList = v => (Array.isArray(v) ? v : v ? [{ id: 'c0', ...v }] : []) // (the first version kept one per result)
async function notePerson(st, key) {
  const { key: k } = await resolveKey(st, key)
  const hist = await st.get(`hist5-${k.split('|')[1]}`, { type: 'json' })
  const me = hist?.v === HIST_VERSION ? hist.people[k] : null
  return me ? { key: k, me } : null
}
export async function readNotes(st, key) {
  const who = await notePerson(st, key)
  if (!who) return json({ pending: true })
  const names = new Set([personKey(who.me.name), ...(who.me.names || []).map(personKey)])
  const notes = {}
  for (const n of names) {
    for (const [rid, v] of Object.entries(((await st.get(noteBlob(n), { type: 'json' })) || { items: {} }).items)) notes[rid] = [...(notes[rid] || []), ...asList(v)]
  }
  // a K2 (or C2) is one result for both of them: their partner's comments on it show here too
  const mine = new Set(names)
  const partners = new Map() // partner's name key -> { name, rids }
  for (const r of [who.me.kayak, who.me.canoe].flatMap(b => b?.history || [])) {
    if (!r.rid || !r.partner) continue
    const pk = personKey(r.partner)
    if (mine.has(pk)) continue
    if (!partners.has(pk)) partners.set(pk, { name: r.partner, rids: new Set() })
    partners.get(pk).rids.add(r.rid)
  }
  for (const [pk, { name, rids }] of partners) {
    const items = ((await st.get(noteBlob(pk), { type: 'json' })) || { items: {} }).items
    for (const rid of rids) for (const c of asList(items[rid])) notes[rid] = [...(notes[rid] || []), { ...c, about: name }]
  }
  for (const [rid, l] of Object.entries(notes)) notes[rid] = l.sort((x, y) => x.at - y.at).map(({ h, ...c }) => c) // (h: the hash of the secret that lets the writer remove it)
  return json({ notes })
}
// keep the list of results marked unfair, and have the ratings worked out again when it changes
async function setUnfair(st, id, on, kick) {
  const u = (await st.get('notes-unfair', { type: 'json' })) || { list: [], at: 0 }
  if (u.list.includes(id) === on) return
  u.list = on ? [...u.list, id] : u.list.filter(x => x !== id)
  u.at = Date.now()
  await st.setJSON('notes-unfair', u)
  await kick()
}
// add a comment: { rid, text, flags, unfair }. Anyone may; own = the paddler's link, coach = signed in
export async function addNote(st, key, body, { own = false, coach = false, kick = async () => {} } = {}) {
  const who = await notePerson(st, key)
  if (!who) return json({ error: 'Their results are not ready yet: try again in a few minutes' }, 409)
  const rid = String(body.rid || '')
  const rows = [who.me.kayak, who.me.canoe].flatMap(b => b?.history || [])
  if (!rows.some(r => r.rid === rid)) return json({ error: 'That is not one of this paddler\'s results' }, 404)
  const nameKey = personKey(who.me.name)
  const blob = noteBlob(nameKey)
  const cur = (await st.get(blob, { type: 'json' })) || { name: nameKey, items: {} }
  cur.display = who.me.name
  const list = asList(cur.items[rid])
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const flags = [...new Set(Array.isArray(body.flags) ? body.flags : [])].filter(f => NOTE_FLAGS.includes(f))
  const unfair = !!body.unfair && (own || coach)
  if (!text && !flags.length && !unfair) return json({ error: 'Write a comment or tick something' }, 400)
  if (list.length >= MAX_COMMENTS) return json({ error: 'That result has as many comments as it can hold' }, 409)
  // the writer's browser keeps a secret, so they can take their own comment back
  const secret = randomBytes(12).toString('hex')
  const row = rows.find(r => r.rid === rid)
  const note = { race: row.race, date: row.date, event: row.event, id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, flags, unfair: unfair || undefined, at: Date.now(), by: own ? 'paddler' : coach ? 'coach' : 'visitor' }
  cur.items[rid] = [...list, { ...note, h: createHash('sha256').update(secret).digest('hex') }]
  await st.setJSON(blob, cur)
  if (unfair) await setUnfair(st, nameKey + '@' + rid, true, kick)
  return json({ ok: true, note, secret })
}
// remove a comment: a coach, the paddler it is about (their own link), or whoever wrote it
// (their browser sends the secret it was given). Which of those is the caller's to check
// (allow), except for the secret, which is checked here
export async function removeNote(st, key, body, { allow = false, kick = async () => {} } = {}) {
  const who = await notePerson(st, key)
  if (!who) return json({ error: 'Their results are not ready yet: try again in a few minutes' }, 409)
  const rid = String(body.rid || '')
  let found = false
  for (const n of new Set([personKey(who.me.name), ...(who.me.names || []).map(personKey)])) {
    const blob = noteBlob(n)
    const cur = await st.get(blob, { type: 'json' })
    const list = asList(cur?.items?.[rid])
    const c = list.find(x => x.id === body.id)
    if (!c) continue
    const mineBySecret = !!body.secret && !!c.h && createHash('sha256').update(String(body.secret)).digest('hex') === c.h
    if (!allow && !mineBySecret) return json({ error: 'Only a coach, the paddler or whoever wrote a comment can remove it' }, 403)
    found = true
    const rest = list.filter(c => c.id !== body.id)
    if (rest.length) cur.items[rid] = rest
    else delete cur.items[rid]
    await st.setJSON(blob, cur)
    if (!rest.some(c => c.unfair)) await setUnfair(st, n + '@' + rid, false, kick)
  }
  return found ? json({ ok: true }) : json({ error: 'No such comment' }, 404)
}
// POST /api/paddler-merge { t | key, action: 'merge', keys: [...] } or { t | key, action: 'unlink', from }
// (t: a shared link, key: the paddler's page): anyone can put the results of others with the same
// name together with this paddler's, or take one back out. Only paddlers the index lists with the same name as theirs can be merged, and an
// undo only for one merged into them. Everyone goes in under whoever raced most recently.
const mergeLimiter = makeAttemptLimiter({ max: 12, windowMs: 15 * 60 * 1000 }) // merges and undos per visitor
export async function mergeOwn(st, tokenKey, body, { kick = async () => {}, strict = false } = {}) {
  const { key, nl } = await resolveKey(st, tokenKey)
  const hist = await st.get(`hist5-${key.split('|')[1]}`, { type: 'json' })
  const me = hist?.v === HIST_VERSION ? hist.people[key] : null
  if (!me) return json({ error: 'Your results are not ready yet: try again in a few minutes' }, 409)
  const { matches } = await indexMatches(st, hist, me.name)
  if (namesStale(hist, nl)) return json({ error: 'Your results are still being put together: wait a few minutes first' }, 409)
  nl.links ||= {}
  nl.rejected ||= []
  const index = await st.get('people-index', { type: 'json' })
  if (body.action === 'unlink') {
    const from = String(body.from || '')
    const l = nl.links[from]
    if (!l || (l.to || personKey(l.name) + '|' + l.club) !== key) return json({ error: 'That is not merged into your results' }, 404)
    delete nl.links[from]
    nl.rejected = [...new Set([...nl.rejected, `${from}>${key}`])].slice(-2000)
    nl.at = Date.now()
    await st.setJSON('name-links', nl)
    await kick()
    return json({ ok: true, refitting: true })
  }
  if (body.action !== 'merge') return json({ error: 'action must be merge or unlink' }, 400)
  const allowed = new Map(matches.filter(([k]) => k !== key))
  const keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).map(String))]
  if (!keys.length || keys.length > 6 || keys.some(k => !allowed.has(k))) return json({ error: 'Those are not paddlers with your name' }, 403)
  const group = [key, ...keys].map(k => [k, index.people[k]])
  // Not a coach: only people whose results could be one person's. Two paddlers racing in the same
  // years, or with no dates to go by, are left to a coach.
  if (strict) {
    const spans = group.map(([, p]) => [p.first || '', p.last || '']).sort((a, b) => (a[0] < b[0] ? -1 : 1))
    if (spans.some(([f, l]) => !f || !l) || spans.some((s, i) => i && s[0] <= spans[i - 1][1])) {
      return json({ error: 'Their races overlap in time, so they may be different people. Ask a coach to merge them.' }, 403)
    }
  }
  const [targetKey, target] = group.reduce((a, b) => ((b[1].last || '') > (a[1].last || '') ? b : a))
  for (const [k, p] of group) {
    if (k === targetKey) continue
    nl.links[k] = { name: target.name, club: target.club, was: p.name || k.split('|')[0], to: targetKey, at: new Date().toISOString() }
    for (const l of Object.values(nl.links)) if (l.to === k) Object.assign(l, { name: target.name, club: target.club, to: targetKey })
  }
  nl.at = Date.now() // the ratings are worked out again (currentBasis)
  await st.setJSON('name-links', nl)
  await kick()
  return json({ ok: true, refitting: true, key: targetKey })
}
// GET /api/paddler-link?club=BSF&name=Kerry%20Tubby (coaches only): a link to send that
// paddler, opening only their own page. in=CAM: a paddler from another club (the club their
// page shows), so anyone in the results can be sent their page
async function shareLink(st, club, name, origin, inClub = '') {
  const hist = await st.get(`hist5-${inClub ? clubKey(inClub) : club}`, { type: 'json' })
  if (!hist) return json({ error: 'The results are still being read: open their page first' }, 409)
  const hit = findPerson(hist, name)
  if (!hit) return json({ error: `No results found for ${name}` }, 404)
  return json({ name: hit[1].name, url: `${origin}/my-racing/?t=${makeShareToken(hit[0])}` })
}

// Works out the ratings from every race kept, and saves them: the paddler pages' copy
// (hist4) first, then the board's and planner's (fit8). Takes a few seconds and a lot of
// reading, too long for an ordinary call on Netlify, so there it runs in a background
// function (crews-fit.js); in tests and without Blobs it runs in the call itself.
export async function computeRatings(st, club, basis, now = Date.now()) {
  const thisYear = new Date(now).getUTCFullYear()
  const races = []
  for (let y = FIRST_YEAR; y <= thisYear; y++) {
    const blob = await st.get(`year-${y}`, { type: 'json' })
    if (blob) for (const [key, r] of Object.entries(blob.races)) races.push({ key, ...r })
  }
  // and the recent ones (results not final yet)
  const kept = new Set(races.map(r => r.key))
  const recent = (await st.get('recent', { type: 'json' })) || { races: {} }
  for (const [key, r] of Object.entries(recent.races)) if (!kept.has(key)) races.push({ key, ...r })
  const t0 = Date.now()
  // names a coach has confirmed belong to someone who raced under another name before
  const nameLinks = (await st.get('name-links', { type: 'json' })) || { links: {}, rejected: [] }
  const unfair = new Set(((await st.get('notes-unfair', { type: 'json' })) || { list: [] }).list)
  const fit = fitRatings(races, { now, historyClub: '*', links: nameLinks.links, unfair }) // everyone's results, for looking anyone up
  // possible earlier names (married names, misspellings), for coaches to confirm or not
  const hints = earlierNames(fit.paddlers)
  const linkedFrom = new Map() // the new key -> the old names linked to it
  for (const [from, l] of Object.entries(nameLinks.links || {})) {
    const to = personKey(l.name) + '|' + l.club
    if (!linkedFrom.has(to)) linkedFrom.set(to, [])
    linkedFrom.get(to).push({ key: from, name: l.was || from.split('|')[0], club: from.split('|')[1] })
  }
  console.log(`[crews] ${club}: ${races.length} races read from storage in ${t0 - now} ms, ratings worked out in ${Date.now() - t0} ms`)
  const result = {
    fetchedAt: new Date(now).toISOString(),
    club,
    races: races.length,
    from: races.length ? new Date(Math.min(...races.map(r => r.date))).toISOString().slice(0, 10) : null,
    K: +fit.K.toFixed(4),
    fields: fit.fields,
    paddlers: fit.paddlers
      .filter(p => p.club === club)
      .map(({ name, names, a, n, nK1, nK2, div, cls, last, group, sd }) => ({ name, names, a: +a.toFixed(4), n, nK1, nK2, div, cls, last, group, sd })),
    // every K2 two of the club's paddlers have raced together, over all the results
    pairs: fit.pairs
      .filter(x => x.a.club === club && x.b.club === club)
      .map(x => ({
        a: x.a.names, // every name each one raced under, for matching to the board
        b: x.b.names,
        races: x.races,
        first: new Date(x.first).toISOString().slice(0, 10),
        last: new Date(x.last).toISOString().slice(0, 10),
        list: x.list // each race: { date, race, venue, event, pos, of }
      }))
  }
  // every result of the club's paddlers, for the paddler pages (/api/paddler): kayak
  // results, and canoe results rated separately (a paddler has a division in each)
  // Everyone's results, one blob per club (so the paddler page can look up anyone, from
  // any club), and an index of who's in which: { "gordon bullock|XYZ": { name, names, n, last } }
  const canoe = fit.canoe
  const byClub = new Map() // club -> people
  for (const [b, f] of [['kayak', fit], ['canoe', canoe]]) {
    for (const p of f.paddlers) {
      if (!f.history.has(p.key)) continue
      const c = clubKey(p.club)
      if (!byClub.has(c)) byClub.set(c, {})
      const people = byClub.get(c)
      const who = (people[p.key] ??= { name: p.name, names: [] })
      who.names = [...new Set([...who.names, ...p.names])]
      who[b] = { div: p.div, a: +p.a.toFixed(4), n: p.n, last: p.last, group: p.group, history: f.history.get(p.key) }
      if (b === 'kayak' && hints.has(p.key)) who.maybe = hints.get(p.key)
      if (linkedFrom.has(p.key)) who.linked = linkedFrom.get(p.key)
    }
  }
  const shared = {
    v: HIST_VERSION,
    basis,
    fetchedAt: result.fetchedAt,
    kayak: { K: result.K, k1med: fit.fields.k1med },
    canoe: { K: +canoe.K.toFixed(4), k1med: canoe.fields.k1med }
  }
  const index = {}
  // the home club last: its copy being there means all the others are too
  const clubs = [...byClub.keys()].filter(c => c !== club)
  for (const c of clubs) await st.setJSON(`hist5-${c}`, { ...shared, people: byClub.get(c) })
  for (const [c, people] of byClub) {
    for (const [k, p] of Object.entries(people)) {
      const n = (p.kayak?.n || 0) + (p.canoe?.n || 0)
      const last = [p.kayak?.last, p.canoe?.last].filter(Boolean).sort().pop() || ''
      const first = [p.kayak?.history?.[0]?.date, p.canoe?.history?.[0]?.date].filter(Boolean).sort()[0] || ''
      index[k] = { club: c, name: p.name, names: p.names, n, first, last }
    }
  }
  await st.setJSON('people-index', { basis, people: index })
  await st.setJSON(`hist5-${club}`, { ...shared, people: byClub.get(club) || {} })
  // saved last: if the call is stopped before this, the next one works it all out again
  await st.setJSON(`fit12-${club}`, { basis, result, histSaved: true, v: HIST_VERSION })
  console.log(`[crews] ${club}: saved after ${Date.now() - now} ms in all`)
  return result
}

// what the ratings are worked out from: how many races are kept, and the newest
export async function currentBasis(st, now = Date.now()) {
  const manifest = (await st.get('manifest', { type: 'json' })) || { years: {}, stored: {} }
  const stored = Object.values(manifest.years).flatMap(y => y.races).filter(r => manifest.stored[r.key])
  const recent = (await st.get('recent', { type: 'json' })) || { at: 0 }
  const links = (await st.get('name-links', { type: 'json' })) || { at: 0 }
  const unfair = (await st.get('notes-unfair', { type: 'json' })) || { at: 0 }
  return stored.length ? `${stored.length}|${Math.max(...stored.map(r => r.date))}|recent ${recent.at}|notes ${unfair.at || 0}|names ${links.at || 0}` : null
}

// ---- "Wreck the River" top fives (the homepage game): public leaderboards, name and numbers only:
// the highest scores, and the most things destroyed in a round. Anyone can add an entry (the
// browser can't be trusted, so it is only sanity-checked and rate limited); a coach can remove one.
const SCORES_KEY = 'wreck-scores' // { list: by score, wrecks: by things destroyed }
const SCORES_KEPT = 5
const SCORE_MAX = 200000 // far beyond what a 30 second round allows
const WRECKS_MAX = 300
const scoresLimiter = makeAttemptLimiter({ max: 20, windowMs: 15 * 60 * 1000 })
const cleanPlayer = v => String(v || '').replace(/[\u0000-\u001f\u007f<>&"`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14)
export async function wreckScores(st, req) {
  const stored = (await st.get(SCORES_KEY, { type: 'json' }).catch(() => null)) || {}
  let scores = stored.list || []
  let wrecks = stored.wrecks || []
  const out = list => list.map(({ id, name, score, wrecked, at }) => ({ id, name, score, wrecked, at }))
  const reply = extra => json({ scores: out(scores), wrecks: out(wrecks), ...extra })
  if (req.method === 'GET') return cachedJson({ scores: out(scores), wrecks: out(wrecks) }, { browser: 30, cdn: 60 })
  if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405)
  const body = await req.json().catch(() => ({}))
  if (body.action === 'remove') {
    if (!signedInAs(req, 'coach')) return json({ error: 'Coaches only' }, 401)
    scores = scores.filter(e => e.id !== body.id)
    wrecks = wrecks.filter(e => e.id !== body.id)
    await st.setJSON(SCORES_KEY, { list: scores, wrecks })
    return reply({ ok: true })
  }
  const name = cleanPlayer(body.name)
  const score = Math.floor(Number(body.score))
  const wrecked = Math.floor(Number(body.wrecked) || 0)
  if (!name) return json({ error: 'Type a name' }, 400)
  if (!Number.isFinite(score) || score < 1 || score > SCORE_MAX || wrecked < 0 || wrecked > WRECKS_MAX) return json({ error: 'That score is not valid' }, 400)
  const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
  const wait = scoresLimiter.blockedFor(ip)
  if (wait) return json({ error: `Too many scores from here: try again in ${Math.ceil(wait / 60000)} minutes` }, 429)
  scoresLimiter.fail(ip)
  const entry = { id: randomBytes(6).toString('hex'), name, score, wrecked, at: Date.now() }
  const place = (list, by) => {
    if (list.length >= SCORES_KEPT && by(entry) <= by(list[list.length - 1])) return [list, 0]
    const next = [...list, entry].sort((a, b) => by(b) - by(a) || b.score - a.score || a.at - b.at).slice(0, SCORES_KEPT)
    return [next, next.findIndex(e => e.id === entry.id) + 1]
  }
  let rank, wreckRank
  ;[scores, rank] = place(scores, e => e.score)
  ;[wrecks, wreckRank] = wrecked > 0 ? place(wrecks, e => e.wrecked) : [wrecks, 0]
  if (rank || wreckRank) await st.setJSON(SCORES_KEY, { list: scores, wrecks })
  return reply({ ok: true, rank, wreckRank, id: entry.id })
}

// ---- National sprint regatta results for a paddler (read from the PDFs by sprint-index.js) ----
// Matched on first initial + surname + club, as that is all the results print ("C Redeker", BSF).
// GET /api/club-race?club=BSF[&race=/results/races/2026/...] (public: the same results are on the
// marathon results site): how the club's paddlers did at the club's latest race (or the one
// asked for). One read of the club's saved history; the answer is kept by the browser and
// Netlify's CDN for a few minutes, so a busy page costs few function calls.
export async function clubRaceFor(st, club, raceKey = '') {
  const hist = await st.get(`hist5-${club}`, { type: 'json' })
  if (!hist || hist.v !== HIST_VERSION) return { pending: true }
  return { club, ratingsAt: hist.fetchedAt, ...clubRace(hist.people, raceKey) }
}
export async function sprintFor(st, key) {
  const [name, club] = String(key).split('|')
  const manifest = await st.get('sprint-index', { type: 'json' }).catch(() => null)
  if (!manifest) return { indexed: false, entries: [] }
  const shard = await st.get(`sprint-club-${clubKey(club)}`, { type: 'json' }).catch(() => null)
  const index = await st.get('people-index', { type: 'json' }).catch(() => null)
  const me = index?.people?.[key]
  const mine = new Set([name, ...(me?.names || []), me?.name].filter(Boolean).flatMap(n => nameKeys(n)))
  const overlap = o => nameKeys(o).some(k => mine.has(k))
  const entries = (shard?.entries || []).filter(e => e.keys.some(k => mine.has(k)))
  // someone else at the club who is "the same" by initial and surname: the page says so
  const ambiguous = entries.length ? Object.entries(index?.people || {}).filter(([k, p]) => k !== key && clubKey(p.club) === clubKey(club) && [p.name, ...(p.names || [])].filter(Boolean).some(overlap)).length : 0
  const titles = Object.fromEntries((manifest.regattas || []).map(r => [r.id, { title: r.title, url: r.url, year: r.year }]))
  entries.sort((a, b) => b.regatta.localeCompare(a.regatta) || a.race - b.race)
  return { indexed: true, at: manifest.at, problems: (manifest.failed || []).slice(0, 6), read: (manifest.regattas || []).length, ambiguous, regattas: titles, entries: entries.map(({ keys, name: n, club: c, ...e }) => e) }
}

export default async (req) => {
  const url = new URL(req.url)
  const store = async () => { try { const st = await openStore(); await st.get('manifest'); return st } catch { return memStore } }
  // a paddler's own page from a shared link: only the paddler the signed token names
  if (url.pathname === '/api/paddler' && url.searchParams.has('t')) {
    const key = readShareToken(url.searchParams.get('t'))
    if (!key) return json({ error: 'This link is not valid (or has been withdrawn). Ask your coach for a new one.' }, 403)
    const withName = String(url.searchParams.get('with') || '').trim()
    try { return withName ? await sharedPartner(await store(), key, withName) : await sharedPaddler(await store(), key) } catch (err) { return json({ error: 'Lookup failed', detail: String(err.message || err) }, 502) }
  }
  if (url.pathname === '/api/paddler-sprint') {
    try {
      const t = url.searchParams.get('t') || ''
      const tk = t ? readShareToken(t) : null
      if (t && !tk) return json({ error: 'This link is not valid (or has been withdrawn). Ask your coach for a new one.' }, 403)
      const key = tk || String(url.searchParams.get('key') || '')
      if (!PERSON_KEY.test(key)) return json({ error: 'key is needed' }, 400)
      const out = await sprintFor(await store(), key)
      // the same for everyone, and changes only when a coach reads the PDFs again
      return out.indexed && !tk ? cachedJson(out, { browser: 300, cdn: 900 }) : json(out)
    } catch (err) { return json({ error: 'Sprint results failed', detail: String(err.message || err) }, 502) }
  }
  if (url.pathname === '/api/club-race') {
    try {
      const club = clubKey(url.searchParams.get('club') || 'BSF')
      const race = String(url.searchParams.get('race') || '').slice(0, 200)
      const body = await clubRaceFor(await store(), club, race)
      // public and the same for everyone: kept a few minutes by the browser and the CDN, so
      // repeat visits don't call this function (which keeps within Netlify's free allowance)
      return new Response(JSON.stringify(body), { headers: body.pending ? { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } : { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300', 'Netlify-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } })
    } catch (err) { return json({ error: 'Club results failed', detail: String(err.message || err) }, 502) }
  }
  if (url.pathname === '/api/wreck-scores') {
    try { return await wreckScores(await store(), req) } catch (err) { return json({ error: 'Scores failed', detail: String(err.message || err) }, 502) }
  }
  // comments on results: anyone reads and adds; coaches remove
  if (url.pathname === '/api/paddler-notes') {
    try {
      const st = await store()
      const t = url.searchParams.get('t') || ''
      const tk = t ? readShareToken(t) : null
      if (t && !tk) return json({ error: 'This link is not valid (or has been withdrawn). Ask your coach for a new one.' }, 403)
      if (req.method === 'GET' && url.searchParams.has('export')) {
        if (!signedInAs(req, 'coach')) return json({ error: 'Coaches only' }, 401)
        const rows = await exportNotes(st)
        const stamp = new Date().toISOString().slice(0, 10)
        if (url.searchParams.get('export') === 'json') return new Response(JSON.stringify(rows, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="bscc-comments-${stamp}.json"`, 'cache-control': 'no-store' } })
        return new Response('\ufeff' + notesCsv(rows), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="bscc-comments-${stamp}.csv"`, 'cache-control': 'no-store' } })
      }
      if (req.method === 'GET' && url.searchParams.has('mydata')) {
        const key = tk || (signedInAs(req, 'coach') && PERSON_KEY.test(String(url.searchParams.get('key'))) ? String(url.searchParams.get('key')) : '')
        if (!key) return json({ error: 'Use your own link, or ask a coach' }, 403)
        const res = await myData(st, key)
        if (!res.ok) return res
        return new Response(await res.text(), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="my-bscc-data.json"', 'cache-control': 'no-store' } })
      }
      if (req.method === 'GET') {
        const key = tk || String(url.searchParams.get('key') || '')
        if (!PERSON_KEY.test(key)) return json({ error: 'key is needed' }, 400)
        const r = await readNotes(st, key)
        // comments are public and the page adds a new one to its own list at once, so a few minutes' wait is fine
        if (!tk && r.ok) { const b = await r.clone().json(); if (!b.pending) return cachedJson(b, { browser: 60, cdn: 120 }) }
        return r
      }
      if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405)
      const body = await req.json().catch(() => ({}))
      const coach = !!signedInAs(req, 'coach')
      const bt = body.t ? readShareToken(body.t) : null
      if (body.t && !bt) return json({ error: 'This link is not valid (or has been withdrawn). Ask your coach for a new one.' }, 403)
      const key = bt || String(body.key || '')
      if (!PERSON_KEY.test(key)) return json({ error: 'key is needed' }, 400)
      if (body.action === 'erase') {
        if (!coach && !bt) return json({ error: 'Use your own link, or ask a coach' }, 403)
        if (!body.confirm) return json({ error: 'confirm is needed' }, 400)
        return await eraseMine(st, key, { kick: () => kickRefit(st, req) })
      }
      if (body.action === 'remove') {
        return await removeNote(st, key, body, { allow: coach || !!bt, kick: () => kickRefit(st, req) })
      }
      const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
      if (!coach) {
        const wait = notesLimiter.blockedFor(ip)
        if (wait) return json({ error: `Too many comments from here: try again in ${Math.ceil(wait / 60000)} minutes` }, 429)
        notesLimiter.fail(ip) // each comment counts
      }
      return await addNote(st, key, body, { own: !!bt, coach, kick: () => kickRefit(st, req) })
    } catch (err) { return json({ error: 'Comments failed', detail: String(err.message || err) }, 502) }
  }
  // putting results with the same name together (or taking them apart): anyone, for any paddler
  // (a shared link names its paddler; otherwise the page says which, and it must be one that exists)
  if (url.pathname === '/api/paddler-merge') {
    if (req.method !== 'POST') return json({ error: 'POST' }, 405)
    const body = await req.json().catch(() => ({}))
    let personKey_ = null
    if (body.t) {
      personKey_ = readShareToken(body.t)
      if (!personKey_) return json({ error: 'This link is not valid (or has been withdrawn). Ask your coach for a new one.' }, 403)
    } else if (PERSON_KEY.test(String(body.key))) personKey_ = String(body.key)
    if (!personKey_) return json({ error: 'key is needed' }, 400)
    const ip = req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
    const wait = mergeLimiter.blockedFor(ip)
    if (wait) return json({ error: `Too many merges from here: try again in ${Math.ceil(wait / 60000)} minutes` }, 429)
    mergeLimiter.fail(ip) // each try counts
    try {
      const st = await store()
      return await mergeOwn(st, personKey_, body, { kick: () => kickRefit(st, req), strict: !signedInAs(req, 'coach') })
    } catch (err) { return json({ error: 'Merge failed', detail: String(err.message || err) }, 502) }
  }
  // /api/paddler (the paddler lookup pages, which have no password): anyone. It's the public
  // Hasler results; what only coaches may see (guesses at earlier names, who is linked) is left
  // out for everyone else. /api/paddler-link (share links) and /api/paddler-names: coaches only.
  // /api/crews (it starts the reading of the results, which is heavy): coaches and the race
  // coordinator.
  const coach = signedInAs(req, 'coach')
  const coordinator = signedInAs(req, 'coordinator')
  const publicLookup = url.pathname === '/api/paddler'
  const ok = coach || publicLookup || (url.pathname !== '/api/paddler-link' && coordinator)
  if (!ok) return json({ error: 'Not signed in: sign in with Google as a coach or the race coordinator' }, 401)
  const club = String(url.searchParams.get('club') || '').trim().toUpperCase()
  if (!/^[A-Z]{2,5}$/.test(club)) return json({ error: 'club is required, e.g. ?club=BSF' }, 400)
  // POST /api/paddler-names { action: 'link' | 'reject' | 'unlink', from, to } (coaches only):
  // from (an earlier name's key) is, or isn't, the same paddler as to
  if (url.pathname === '/api/paddler-names') {
    if (!coach) return json({ error: 'Coaches only' }, 401)
    if (req.method !== 'POST') return json({ error: 'POST' }, 405)
    const body = await req.json().catch(() => ({}))
    const { action, from, to } = body
    if (!['link', 'reject', 'unlink'].includes(action) || !PERSON_KEY.test(String(from)) || !PERSON_KEY.test(String(to)) || from === to) return json({ error: 'action, from and to are needed' }, 400)
    const st = await store()
    const nl = (await st.get('name-links', { type: 'json' })) || { links: {}, rejected: [] }
    nl.links ||= {}
    nl.rejected ||= []
    if (action === 'link') {
      const index = await st.get('people-index', { type: 'json' })
      const target = index?.people?.[to]
      const old = index?.people?.[from]
      if (!target) return json({ error: 'Not found: ' + to }, 404)
      nl.links[from] = { name: target.name, club: target.club, was: old?.name || from.split('|')[0], to, at: new Date().toISOString() }
      // anything linked to the old name now goes to the new one
      for (const l of Object.values(nl.links)) if (l.to === from) Object.assign(l, { name: target.name, club: target.club, to })
      nl.at = Date.now() // the ratings are worked out again (currentBasis)
    } else if (action === 'unlink') {
      if (!nl.links[from]) return json({ error: 'Not linked' }, 404)
      delete nl.links[from]
      nl.rejected = [...new Set([...nl.rejected, `${from}>${to}`])]
      nl.at = Date.now()
    } else {
      nl.rejected = [...new Set([...nl.rejected, `${from}>${to}`])].slice(-2000)
    }
    await st.setJSON('name-links', nl)
    return json({ ok: true, action, refitting: action !== 'reject' })
  }
  if (url.pathname === '/api/paddler-link') {
    const name = String(url.searchParams.get('name') || '').trim()
    if (!name) return json({ error: 'name is required' }, 400)
    try { return await shareLink(await store(), club, name, url.origin, String(url.searchParams.get('in') || '').trim()) } catch (err) { return json({ error: 'Could not make a link', detail: String(err.message || err) }, 500) }
  }
  if (url.pathname.startsWith('/api/paddler')) {
    const name = String(url.searchParams.get('name') || '').trim()
    if (!name) return json({ error: 'name is required' }, 400)
    let st = memStore
    try { st = await openStore(); await st.get('manifest') } catch { st = memStore }
    try {
      const res = await paddler(st, club, name, String(url.searchParams.get('in') || '').trim())
      // who's looking: the page offers share links (and the board) to coaches only
      const body = await res.json()
      // guesses at earlier names: coaches only, less any a coach has said aren't them
      if (!coach) delete body.maybe // (what has been merged is shown to everyone, with an undo)
      else if (body.maybe) {
        const nl = (await st.get('name-links', { type: 'json' })) || { rejected: [] }
        body.maybe = body.maybe.filter(m => !nl.rejected?.includes(`${m.key}>${body.key}`))
        if (!body.maybe.length) delete body.maybe
      }
      // not ready: the first person to ask (coach or not) gets the recalculation going
      if (body.pending && !coach && !coordinator) body.starting = await startFitIfIdle(st, req).catch(() => undefined)
      // a star award gained in the last week (level and date only) for the congratulations banner
      if (!body.pending) { // (also for a member with no race results yet: their award is all there is)
        try {
          const aw = await (await openAwardsStore()).get('records', { type: 'json' })
          const recent = recentAwardFor(aw?.records, body.name || name, (a, b) => personKey(a) === personKey(b))
          if (recent) body.recentAward = recent
          const level = starLevelFor(aw?.records, body.name || name, (a, b) => personKey(a) === personKey(b))
          if (level) body.starLevel = level // (level only: not when, or who assessed)
        } catch { /* no awards store (or none yet): no banner */ }
      }
      const viewer = coach ? 'coach' : coordinator ? 'coordinator' : 'public'
      const out = { ...body, viewer }
      // the public answer is the same for everyone and changes only after a race or a merge: kept a
      // few minutes by the browser and the CDN (the page asks afresh after a merge). Not while it is
      // being worked out, or when nobody was found.
      if (viewer === 'public' && body.found !== false && !body.pending && !body.refitting && !body.starting && !url.searchParams.has('fresh')) return cachedJson(out, { browser: 120, cdn: 600, vary: ROLE_VARY })
      const res2 = json(out)
      res2.headers.set('Netlify-Vary', ROLE_VARY)
      return res2
    } catch (err) { return json({ error: 'Lookup failed', detail: String(err.message || err) }, 502) }
  }
  const now = Date.now()
  const deadline = now + BUDGET_MS()
  try {
    let st = memStore
    try { st = await openStore(); await st.get('manifest') } catch { st = memStore }
    // manifest: { years: { 2019: { done: true, races: [{ key, name, date, provisional }] } }, stored: { key: true } }
    const manifest = (await st.get('manifest', { type: 'json' })) || { years: {}, stored: {} }
    const thisYear = new Date(now).getUTCFullYear()
    let manifestDirty = false
    // race lists: past years are fixed once the following year is well under way
    for (let y = thisYear; y >= FIRST_YEAR; y--) {
      const known = manifest.years[y]
      if (known?.done) continue
      if (known && known.at && now - known.at < RECENT_HOURS * 3600e3) continue // re-read open years now and then
      if (Date.now() > deadline) break
      const races = await racesOfYear(y, now)
      manifest.years[y] = { races, at: now, done: y < thisYear - 1 || (y === thisYear - 1 && new Date(now).getUTCMonth() >= 2) }
      manifestDirty = true
    }
    const all = Object.values(manifest.years).flatMap(y => y.races)
    const settled = r => r.date && !r.provisional && now - r.date > SETTLED_DAYS * 864e5
    const todo = all.filter(r => settled(r) && !manifest.stored[r.key]).sort((a, b) => b.date - a.date) // newest first
    const listsDone = Object.keys(manifest.years).length === thisYear - FIRST_YEAR + 1
    // read the races not yet kept, a few at a time, adding each to its year's blob
    const touched = new Map() // year -> blob
    let i = 0
    while (i < todo.length && Date.now() < deadline) {
      const batch = todo.slice(i, i + BATCH)
      const pages = await Promise.allSettled(batch.map(r => getHtml(r.key)))
      for (const [k, p] of pages.entries()) {
        const r = batch[k]
        const y = new Date(r.date).getUTCFullYear()
        if (!touched.has(y)) touched.set(y, (await st.get(`year-${y}`, { type: 'json' })) || { races: {} })
        // a page that won't load is kept as empty, so it doesn't hold everything up
        touched.get(y).races[r.key] = { name: r.name, date: r.date, rows: p.status === 'fulfilled' ? parseResults(p.value) : [] }
        manifest.stored[r.key] = true
      }
      manifestDirty = true
      i += batch.length
    }
    for (const [y, blob] of touched) await st.setJSON(`year-${y}`, blob)
    if (manifestDirty) await st.setJSON('manifest', manifest)
    const stored = all.filter(r => manifest.stored[r.key])
    // Recent races (the last two weeks, or still provisional): their results can still change,
    // so they aren't kept for good like the others, but they count straight away. They're
    // read into their own blob, read again every few hours until they settle.
    let recentDirty = false
    if (listsDone && i >= todo.length) {
      const due = all.filter(r => r.date && r.date <= now && !settled(r)).sort((a, b) => b.date - a.date)
      const recent = (await st.get('recent', { type: 'json' })) || { at: 0, races: {} }
      const stale = now - recent.at > RECENT_HOURS * 3600e3 || due.some(r => !recent.races[r.key]) || Object.keys(recent.races).some(k => !due.some(r => r.key === k))
      if (stale && Date.now() < deadline) {
        const pages = await Promise.allSettled(due.map(r => getHtml(r.key)))
        const races = {}
        pages.forEach((p, k) => {
          const r = due[k]
          // a page that won't load this time: keep what we had
          races[r.key] = p.status === 'fulfilled' ? { name: r.name, date: r.date, provisional: true, rows: parseResults(p.value) } : recent.races[r.key] || { name: r.name, date: r.date, provisional: true, rows: [] }
        })
        await st.setJSON('recent', { at: now, races })
        recentDirty = true
      }
    }
    // more to read, or this call has already spent its time reading: the ratings get a call
    // of their own (working them out takes a few seconds, and a call that runs too long is
    // stopped before it can save anything)
    if (!listsDone || i < todo.length || i > 0 || manifestDirty || recentDirty) {
      return json({ more: true, racesChecked: stored.length, racesTotal: all.filter(settled).length })
    }

    // the ratings: kept, and worked out again only when races have been added
    const basis = await currentBasis(st, now)
    const cached = await st.get(`fit12-${club}`, { type: 'json' })
    const ready = !!cached?.histSaved && cached.v === HIST_VERSION // saved after the paddler pages' copy, so both are there
    if (ready && cached.basis === basis && now - Date.parse(cached.result.fetchedAt) < 24 * 3600e3) return json(cached.result)
    if (st === memStore || process.env.CREWS_INLINE_FIT === '1') return json(await computeRatings(st, club, basis, now))
    // on Netlify: worked out again in the background (crews-fit.js), as it takes longer than
    // an ordinary call may run. Meanwhile the last ratings are used, if there are any; if
    // not, the page asks again until they're ready. Started again if a run seems to have
    // stopped without saving (after 5 minutes).
    const job = await st.get(`fitting-${club}`, { type: 'json' })
    if (!job || job.basis !== basis || now - job.at > 5 * 60e3) {
      await st.setJSON(`fitting-${club}`, { basis, at: now })
      const res = await fetch(new URL(`/api/crews-fit?club=${club}`, req.url), { method: 'POST', headers: { cookie: req.headers.get('cookie') || '' } }).catch(err => ({ status: String(err.message || err) }))
      console.log(`[crews] ${club}: working out the ratings in the background (${res.status})`)
    }
    if (ready) return json({ ...cached.result, refreshing: true })
    return json({ more: true, working: true, racesChecked: stored.length, racesTotal: all.filter(settled).length })
  } catch (err) {
    return json({ error: 'Crew ratings failed', detail: String(err.message || err) }, 502)
  }
}

export const config = { path: ['/api/crews', '/api/paddler', '/api/paddler-link', '/api/paddler-names', '/api/paddler-merge', '/api/paddler-notes', '/api/wreck-scores', '/api/paddler-sprint', '/api/club-race'] }
