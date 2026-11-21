// POST /api/sprint-index[?years=5][&force=1]: reads the National Sprint Regatta results from
// canoeingresults.com (PDFs, one per regatta, linked from a page for each year) and keeps them so
// the paddler page can show a paddler's results. Coaches only. A background function: it answers
// 202 at once and may run for up to 15 minutes (about a minute per ten PDFs).
//
// Kept in the same blob store as everything else:
//   sprint-regatta-<UKSPyyyy-mm>   every paddler's entry in that regatta (regattas never change, so
//                                  one already kept is not read again unless ?force=1)
//   sprint-club-<CLUB>             every entry for a club, from all the regattas kept (what the paddler page reads)
//   sprint-index                   { at, regattas: [{ id, year, title, url, races, rows, entries, skipped }], failed }
import * as cheerio from 'cheerio'
import { signedInAs } from './lib/access.js'
import { openStore } from './crews.js'
import { pdfPages } from './lib/sprintpdf.js'
import { resultPages, linesFromPages, parseResults, entriesOf } from './lib/sprint.js'

const ROOT = 'https://canoeingresults.com/sprint/sprint-results-1960-2012/'
const yearPage = y => (y >= 2020 ? `${ROOT}sprint-racing-2020s/sprint-racing-results-${y}/` : `${ROOT}sprint-racing-2010s/sprint-racing-results-${y}/`)
const get = async (url, what) => {
  const res = await fetch(url, { headers: { 'user-agent': 'BSCC-coaching-app (sprint results index)' } })
  if (!res.ok) throw new Error(`${what}: ${res.status}`)
  return res
}
// the regatta PDFs a year's page links to
export function pdfLinks(html, base) {
  const $ = cheerio.load(html)
  const out = new Map()
  $('a[href]').each((_, a) => {
    const href = String($(a).attr('href') || '')
    const m = href.match(/(UKSP(\d{4})-(\d{2}))\.pdf$/i)
    if (!m) return
    const id = m[1].toUpperCase()
    if (!out.has(id)) out.set(id, { id, year: Number(m[2]), url: new URL(href, base).href, title: $(a).text().replace(/\s+/g, ' ').trim() })
  })
  return [...out.values()]
}
const clubKey = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NONE'

export default async (req) => {
  if (!signedInAs(req, 'coach')) return console.log('[sprint-index] not signed in as a coach: nothing done')
  const url = new URL(req.url)
  const thisYear = new Date().getFullYear()
  const count = Math.min(10, Math.max(1, Number(url.searchParams.get('years')) || 5))
  const force = url.searchParams.get('force') === '1'
  const st = await openStore()
  const regattas = []
  const failed = []
  try {
    for (let y = thisYear - count + 1; y <= thisYear; y++) {
      let links = []
      try { links = pdfLinks(await (await get(yearPage(y), `year page ${y}`)).text(), yearPage(y)) } catch (err) { failed.push({ year: y, error: String(err.message || err) }); continue }
      if (!links.length) failed.push({ year: y, error: 'no PDF links found on the year page' })
      for (const l of links) {
        try {
          let kept = force ? null : await st.get(`sprint-regatta-${l.id}`, { type: 'json' })
          if (!kept) {
            const pages = resultPages(await pdfPages(await (await get(l.url, l.id)).arrayBuffer()))
            const { races, skipped } = parseResults(linesFromPages(pages))
            const entries = entriesOf(races, l.id)
            kept = { id: l.id, year: l.year, title: l.title, url: l.url, races: races.length, rows: races.reduce((n, r) => n + r.rows.length, 0), skipped: skipped.length, at: Date.now(), entries }
            await st.setJSON(`sprint-regatta-${l.id}`, kept)
          }
          regattas.push({ id: kept.id, year: kept.year, title: kept.title, url: kept.url, races: kept.races, rows: kept.rows, entries: kept.entries.length, skipped: kept.skipped })
        } catch (err) { failed.push({ id: l.id, error: String(err.message || err) }) }
      }
    }
    // a blob for each club, from every regatta kept (not only this run's)
    const byClub = new Map()
    const ids = (await st.list({ prefix: 'sprint-regatta-' })).blobs.map(b => b.key)
    for (const key of ids) {
      const r = await st.get(key, { type: 'json' })
      for (const e of r?.entries || []) {
        const c = clubKey(e.club)
        if (!byClub.has(c)) byClub.set(c, [])
        byClub.get(c).push({ keys: e.keys, name: e.name, regatta: e.regatta, race: e.race, class: e.class, event: e.event, metres: e.metres, stage: e.stage, pos: e.pos, time: e.time, seconds: e.seconds, status: e.status, with: e.with })
      }
    }
    for (const [c, entries] of byClub) await st.setJSON(`sprint-club-${c}`, { club: c, at: Date.now(), entries })
    await st.setJSON('sprint-index', { at: Date.now(), years: [thisYear - count + 1, thisYear], regattas, failed })
    console.log(`[sprint-index] ${regattas.length} regattas, ${failed.length} problems`)
  } catch (err) {
    console.log('[sprint-index] failed:', err?.stack || err)
    await st.setJSON('sprint-index', { at: Date.now(), regattas, failed: [...failed, { error: String(err.message || err) }] }).catch(() => {})
  }
}

export const config = { path: '/api/sprint-index', background: true }
