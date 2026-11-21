// GET /api/divisions?club=BSF&names=Alice Parker|Ben Spinola
// Looks each paddler up in the public marathon results (entries.canoemarathon.org.uk),
// newest race first, and returns their current division.
import * as cheerio from 'cheerio'
import { sameRacer, resolveDivision, parseDate, norm, hostCode } from './lib/match.js'

const BASE = 'https://entries.canoemarathon.org.uk'
const UA = 'BSCC-Coaching-App/0.1 (club coaching tool)'
const TTL_MS = 60 * 60 * 1000
const BATCH = 6
// How many seasons to look back (this year + the ones before). Hasler divisions carry
// over between seasons, so someone who last raced two years ago still has a division.
const YEARS = () => Math.max(1, Math.min(6, parseInt(process.env.DIVISIONS_YEARS || '3', 10) || 3))
// Netlify stops a function after ~10s, so each call works for at most this long and
// then says { more: true }; the app calls again and carries on where the index left off.
const BUDGET_MS = () => parseInt(process.env.DIVISIONS_BUDGET_MS || '7000', 10)
// Results older than this (and not marked Provisional) are treated as final and indexed.
const SETTLED_DAYS = 14

// --- debug tracing -------------------------------------------------------------
// Add ?trace=1 (the app does) or set DIVISIONS_DEBUG=1 to log every step to the
// `netlify dev` terminal / Netlify function log. With ?trace=1 the response also
// contains "trace" and a per-paddler "report".
let traceOn = false
let traceLog = []
let traceStart = 0
function dbg(step, detail = {}) {
  if (!traceOn) return
  const entry = { ms: Date.now() - traceStart, step, ...detail }
  traceLog.push(entry)
  console.log('[divisions]', JSON.stringify(entry))
}

// Warm-instance cache so several lookups don't re-download the same race pages.
const cache = new Map()
async function getHtml(path) {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.html
  const t0 = Date.now()
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA } })
  dbg('fetch', { path, status: res.status, took: Date.now() - t0 })
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`)
  const html = await res.text()
  cache.set(path, { at: Date.now(), html })
  return html
}

// Races from this season and the previous ones, newest first.
let raceListCache = null // { at, years, list }
async function listRaces() {
  const years = YEARS()
  if (raceListCache && raceListCache.years === years && Date.now() - raceListCache.at < TTL_MS) {
    dbg('races:list-cached', { count: raceListCache.list.length })
    return raceListCache.list
  }
  const thisYear = new Date().getUTCFullYear()
  const seen = new Map()
  for (let y = thisYear; y > thisYear - years; y--) {
    const path = y === thisYear ? '/results/races' : `/results/races?year=${y}`
    let html
    try { html = await getHtml(path) } catch (err) { dbg('races:list-failed', { year: y, error: err.message }); continue }
    const $ = cheerio.load(html)
    let found = 0
    $('tr').each((_, tr) => {
      const a = $(tr).find('a[href*="/results/races/"]').first()
      const href = a.attr('href')
      if (!href) return
      const p = new URL(href, BASE).pathname
      if (!/^\/results\/races\/\d{4}\//.test(p) || seen.has(p)) return
      const text = $(tr).text()
      seen.set(p, { name: a.text().trim(), path: p, date: parseDate(text), provisional: /provisional/i.test(text) })
      found++
    })
    dbg('races:list', { year: y, racesFound: found })
  }
  const list = [...seen.values()].sort((x, y) => (y.date?.getTime() ?? 0) - (x.date?.getTime() ?? 0))
  if (!list.length) dbg('races:none-found', { note: 'no race links found; the results site layout may have changed' })
  else {
    const day = r => (r.date ? r.date.toISOString().slice(0, 10) : '?')
    dbg('races:checking', { seasons: years, count: list.length, newest: `${list[0].name} (${day(list[0])})`, oldest: `${list.at(-1).name} (${day(list.at(-1))})` })
  }
  raceListCache = { at: Date.now(), years, list }
  return list
}

// --- index of this club's results from settled races ---------------------------------
// Final results don't change, so from each settled race only this club's rows
// (name, div, P/D, tab) are kept in Netlify Blobs. Later lookups read the index
// instead of re-downloading ~200 race pages. Falls back to memory without Blobs.
const indexMem = new Map()
async function indexStore() {
  if (globalThis.__divisionsTestStore) return globalThis.__divisionsTestStore // tests only
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'divisions', consistency: 'strong' })
}
async function loadIndex(club) {
  try {
    const v = await (await indexStore()).get(`index-${club}`, { type: 'json' })
    return v?.version === 5 ? v : { version: 5, races: {} } // v5: a K2 crew's single division isn't a paddler's own; older indexes are rebuilt
  } catch (err) {
    dbg('index:memory-only', { message: err.message })
    return indexMem.get(club) || { version: 5, races: {}, memoryOnly: true }
  }
}
async function saveIndex(club, idx) {
  if (idx.memoryOnly) { indexMem.set(club, idx); return }
  try { await (await indexStore()).setJSON(`index-${club}`, idx) } catch (err) {
    dbg('index:save-failed', { message: err.message })
    indexMem.set(club, { ...idx, memoryOnly: true })
  }
}
const settled = r => !r.provisional && !!r.date && Date.now() - r.date.getTime() > SETTLED_DAYS * 864e5

// A cell holds one value per crew member. The results site marks them up two ways:
//   names/clubs/classes: <td><div>Zoe Norford</div><div>Kerry Tubby</div></td>
//   div/points/P/D:      <td>6<br>6</td>, <td><br>P4</td>
// Values stay in crew order, blanks included, so P/D lines up with the right paddler.
function parts($, td) {
  const $td = $(td)
  const blocks = $td.children('div')
  if (blocks.length) return blocks.map((_, d) => $(d).text().replace(/\s+/g, ' ').trim()).get()
  const segs = ($td.html() || '').split(/<br\s*\/?>/i).map(h => $('<i>' + h + '</i>').text().replace(/\s+/g, ' ').trim())
  if (segs.length === 1 && /\S\s{3,}\S/.test($td.text())) return $td.text().trim().split(/\s{3,}/)
  return segs
}

function parseRace(html) {
  const $ = cheerio.load(html)
  const entries = []
  $('table').each((_, table) => {
    const rows = $(table).find('tr')
    const headers = rows.first().find('th,td').map((_, c) => $(c).text().trim().toLowerCase()).get()
    const col = { pos: headers.indexOf('#'), name: headers.indexOf('name'), club: headers.indexOf('club'), cls: headers.indexOf('class'), div: headers.indexOf('div'), pd: headers.indexOf('p/d') }
    if (col.name < 0 || col.club < 0 || col.div < 0) return
    // each division's table sits in a tab pane, e.g. <div id="div6_6" class="tab-pane">;
    // the page opens that tab for the URL fragment #race-div6_6
    const tab = $(table).closest('.tab-pane[id]').attr('id') || ''
    rows.slice(1).each((_, tr) => {
      const tds = $(tr).find('td')
      if (!tds.length) return
      const names = parts($, tds[col.name]).filter(Boolean)
      const clubs = parts($, tds[col.club])
      let divs = parts($, tds[col.div])
      if (divs.length === 1 && names.length > 1) divs = divs[0].split(/\s+/)
      const pds = col.pd >= 0 ? parts($, tds[col.pd]) : []
      // the Class column (SMK, VFK: kayak; VMC, JMC: canoe). Canoeists have their own
      // divisions, and a C2 can be in the same table as the K2s
      const classes = col.cls >= 0 ? parts($, tds[col.cls]) : []
      if (classes.some(c => /C$/i.test(c))) return
      // finishing place in that race (shared by a K2 crew); blank for DNF etc.
      const pos = col.pos >= 0 ? parseInt($(tds[col.pos]).text().trim(), 10) || null : null
      names.forEach((name, i) => {
        entries.push({
          name,
          crew: names, // everyone in the boat (K1: just them; K2: the pair)
          club: clubs[i] ?? clubs[0] ?? '',
          // a K2 row may give one division for the crew: only use it as theirs if it's per paddler
          div: divs.length === names.length ? divs[i] : names.length === 1 ? divs[0] ?? '' : '',
          pd: pds[i] ?? '',
          pos,
          tab
        })
      })
    })
  })
  // a paddler can appear in several tables (e.g. an extra class table); prefer the
  // division tab so the link opens the right tab. Stable sort keeps page order otherwise.
  return entries.sort((a, b) => /^div/i.test(b.tab) - /^div/i.test(a.tab))
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra }
  })

const surname = n => norm(n).split(' ').slice(1).join(' ')
const firstName = n => norm(n).split(' ')[0]

export default async (req) => {
  const url = new URL(req.url)
  // The app POSTs { club, names: [...] } so member names aren't in the URL (URLs end up
  // in logs and caches). GET ?club=&names=a|b still works for quick manual checks.
  let body = {}
  if (req.method === 'POST') {
    try { body = await req.json() } catch { return json({ error: 'Body must be JSON: { club, names: [...] }' }, 400) }
  }
  const wantTrace = !!(body.trace || url.searchParams.get('trace'))
  traceOn = wantTrace || /^(1|true|yes)$/i.test(process.env.DIVISIONS_DEBUG || '')
  traceLog = []
  traceStart = Date.now()
  const club = String(body.club || url.searchParams.get('club') || '').trim().toUpperCase()
  const allNames = (Array.isArray(body.names) ? body.names.map(String) : (url.searchParams.get('names') || '').split('|'))
    .map(s => s.trim()).filter(Boolean)
  const names = allNames.slice(0, 200)
  dbg('start', { club, paddlers: names.length, droppedOver200: allNames.length - names.length, cachedPages: cache.size })
  if (!club || !names.length) return json({ error: 'club and names are required' }, 400)

  try {
    const results = Object.fromEntries(names.map(n => [n, null]))
    let pending = names.length
    const races = await listRaces()
    const idx = await loadIndex(club)
    const deadline = Date.now() + BUDGET_MS()
    // every entry seen on pages fetched in this call, kept only while tracing, to explain why a paddler wasn't found
    const seenEntries = []
    let dirty = false, fetched = 0, fromIndex = 0
    const day = r => (r.date ? r.date.toISOString().slice(0, 10) : null)

    // races are handled newest first, so each paddler gets their most recent result. Their
    // division comes from their most recent Hasler division table (div4, div4_4): other races
    // (winter series...) can show an out-of-date division, so after one of those the search
    // goes on back to their last Hasler result for the division.
    const HASLER = /^div\d(_\d)?$/i
    const settledDiv = new Set()
    const match = (race, entries) => {
      for (const e of entries) {
        for (const n of names) {
          if (settledDiv.has(n) || !sameRacer(n, e.name)) continue
          const hasler = HASLER.test(e.tab || '') && !!String(e.div || '').trim()
          if (results[n]) {
            if (!hasler) continue // an older non-Hasler result: nothing new
            Object.assign(results[n], resolveDivision(e.div, e.pd), { divisionRace: race.name, divisionDate: day(race) })
            settledDiv.add(n)
            pending--
            dbg('paddler:division', { paddler: n, div: e.div, pd: e.pd || '', division: results[n].division, race: race.name })
            continue
          }
          results[n] = {
            ...resolveDivision(e.div, e.pd),
            race: race.name,
            date: day(race),
            venue: hostCode(race.name), // host club's code, e.g. LBZ
            place: e.pos ?? null, // finishing place in their race (1, 2, 3...)
            raceUrl: BASE + race.path + (e.tab ? `#race-${e.tab}` : ''),
            matchedName: e.name,
            // who they paddled with in that race (K2 partner; empty for K1)
            partners: (e.crew || []).filter(x => x !== e.name)
          }
          dbg('paddler:found', { paddler: n, matchedAs: e.name, div: e.div, pd: e.pd || '', division: results[n].division, race: race.name, date: results[n].date, link: results[n].raceUrl })
          if (hasler) {
            results[n].divisionRace = race.name
            results[n].divisionDate = day(race)
            settledDiv.add(n)
            pending--
          }
        }
      }
    }

    let i = 0
    while (i < races.length && pending > 0) {
      const known = idx.races[races[i].path]
      if (known) { match(races[i], known.entries); fromIndex++; i++; continue }
      if (Date.now() > deadline) break // out of time: the app calls again
      const batch = []
      for (let j = i; j < races.length && batch.length < BATCH && !idx.races[races[j].path]; j++) batch.push(races[j])
      const pages = await Promise.allSettled(batch.map(r => getHtml(r.path)))
      pages.forEach((page, k) => {
        const race = batch[k]
        if (page.status !== 'fulfilled') {
          dbg('race:failed', { race: race.name, path: race.path, error: String(page.reason?.message || page.reason) })
          return
        }
        const entries = parseRace(page.value)
        const clubEntries = entries
          .filter(e => e.club.toUpperCase() === club)
          .map(({ name, div, pd, tab, crew, pos }) => ({ name, div, pd, tab, crew, pos }))
        if (traceOn) entries.forEach(e => seenEntries.push({ ...e, race: race.name, date: race.date }))
        dbg('race:parsed', { race: race.name, date: day(race), entries: entries.length, clubEntries: clubEntries.length, indexed: settled(race) })
        fetched++
        if (settled(race)) { idx.races[race.path] = { name: race.name, date: day(race), entries: clubEntries }; dirty = true }
        match(race, clubEntries)
      })
      i += batch.length
    }
    const more = pending > 0 && i < races.length
    if (dirty) await saveIndex(club, idx)
    dbg('progress', { racesChecked: i, racesTotal: races.length, fromIndex, fetched, indexedRaces: Object.keys(idx.races).length, more })

    // per-paddler report: what was found, or the closest entries when nothing was
    const report = names.map(n => {
      const r = results[n]
      if (r) return { paddler: n, found: true, division: r.division, matchedAs: r.matchedName, race: r.race, date: r.date }
      const sn = surname(n), fn = firstName(n)
      const near = []
      const seenKey = new Set()
      for (const e of seenEntries) {
        const sameSurname = sn && surname(e.name) === sn
        const sameFirstInClub = e.club.toUpperCase() === club && firstName(e.name) === fn
        if (!sameSurname && !sameFirstInClub) continue
        const key = `${e.name}|${e.club}`
        if (seenKey.has(key)) continue
        seenKey.add(key)
        near.push(`${e.name} (${e.club || 'no club'}, div ${e.div || '?'}, ${e.race})`)
        if (near.length >= 5) break
      }
      const why = !sn ? 'only one name, so the surname match cannot work'
        : near.length ? 'similar names seen but none matched (club must be ' + club + ', same surname, first names equal or one a 3+ letter prefix of the other)'
        : `no ${club} entry with this surname in the last ${i} races (${YEARS()} seasons)`
      return { paddler: n, found: false, why, nearMisses: near }
    })
    if (traceOn) report.filter(r => !r.found).forEach(r => dbg('paddler:not-found', r))
    dbg('done', { found: report.filter(r => r.found).length, notFound: report.filter(r => !r.found).length, racesChecked: i, more })

    return json(
      { fetchedAt: new Date().toISOString(), club, seasons: YEARS(), racesChecked: i, racesTotal: races.length, more, results, ...(wantTrace ? { report, trace: traceLog } : {}) },
      200,
      wantTrace || req.method === 'POST' ? { 'Cache-Control': 'no-store' } : {
        // Browsers always revalidate; Netlify's CDN serves the cached copy for an hour,
        // so refreshing the page does not hit the results site every time.
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'Netlify-CDN-Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
      }
    )
  } catch (err) {
    dbg('error', { message: String(err.message || err) })
    return json({ error: 'Lookup failed', detail: String(err.message || err), ...(wantTrace ? { trace: traceLog } : {}) }, 502)
  }
}

export const config = { path: '/api/divisions' }
