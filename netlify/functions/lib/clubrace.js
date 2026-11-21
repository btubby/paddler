// How the club did at a race: every result of the club's paddlers in one race, worked out
// from the club's saved history (hist5-<CLUB>, the same copy the paddler page uses), so asking
// costs one read and no new sums on Netlify. Pure logic: tested directly (test/clubrace.test.js).
//
// "How they did against their form": this result's rating against the middle of the same
// paddler's earlier ratings in the two years before, in % of the race time (- = quicker).
// It is the same idea as the "vs their form" column on the paddler page, worked out simply.
const DAY = 864e5
const FORM_DAYS = 730
const MIN_PRIOR = 3 // earlier results needed to say what their form was
export const raceOf = h => String(h.rid || '').split('|')[0]
const median = xs => {
  const s = xs.slice().sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// the races the club's paddlers have been in, newest first: [{ key, name, date, url, n }]
export function clubRaces(people) {
  const by = new Map()
  for (const [key, p] of Object.entries(people || {})) {
    for (const b of ['kayak', 'canoe']) {
      for (const h of p[b]?.history || []) {
        const k = raceOf(h)
        if (!k || !h.date) continue
        if (!by.has(k)) by.set(k, { key: k, name: h.race, date: h.date, url: h.url, paddlers: new Set() })
        by.get(k).paddlers.add(key)
      }
    }
  }
  return [...by.values()]
    .map(({ paddlers, ...r }) => ({ ...r, n: paddlers.size }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)))
}

// % quicker (-) or slower (+) than their form going in; null when there is too little to go on
export function formAgainst(history, row) {
  if (typeof row.rating !== 'number' || row.alone || !row.date) return null
  const t = Date.parse(row.date)
  const prior = history
    .filter(h => h !== row && h.date && !h.odd && !h.alone && typeof h.rating === 'number' && Date.parse(h.date) < t && t - Date.parse(h.date) <= FORM_DAYS * DAY)
    .map(h => h.rating)
  if (prior.length < MIN_PRIOR) return null
  return +((row.rating - median(prior)) * 100).toFixed(1)
}

// the club's results at one race (the newest, or `raceKey`)
export function clubRace(people, raceKey = '') {
  const races = clubRaces(people)
  const race = (raceKey && races.find(r => r.key === raceKey)) || races[0]
  if (!race) return { race: null, races: [], totals: null, crews: [] }
  const crews = new Map() // one per crew: two club paddlers in a K2 are one crew
  for (const [key, p] of Object.entries(people)) {
    for (const b of ['kayak', 'canoe']) {
      const hist = p[b]?.history || []
      for (const h of hist) {
        if (raceOf(h) !== race.key) continue
        const mine = { key, name: p.name, div: h.div || '', pd: h.pd || '', vs: formAgainst(hist, h) }
        const id = h.tab + '|' + [p.name, h.partner || ''].sort().join('/')
        if (!crews.has(id)) {
          crews.set(id, { tab: h.tab, event: h.event, boat: h.boat || b, k2: !!h.k2, pos: h.pos ?? null, of: h.of ?? null, t: h.t ?? null, alone: !!h.alone, members: [], partner: h.partner && h.partner !== p.name ? h.partner : '' })
        }
        const c = crews.get(id)
        c.members.push(mine)
        // a partner who is also in the club is a member, not an outsider
        if (c.partner && c.members.some(m => m.name === c.partner)) c.partner = ''
      }
    }
  }
  const list = [...crews.values()].sort((a, b) => (a.pos ?? 1e9) / (a.of || 1) - (b.pos ?? 1e9) / (b.of || 1) || String(a.event).localeCompare(String(b.event)))
  const contested = c => c.of > 1 && c.pos
  const members = list.flatMap(c => c.members)
  const withForm = list.flatMap(c => c.members.filter(m => m.vs != null).map(m => ({ ...m, event: c.event })))
  const totals = {
    paddlers: new Set(members.map(m => m.key)).size,
    crews: list.length,
    wins: list.filter(c => contested(c) && c.pos === 1).length,
    podiums: list.filter(c => contested(c) && c.pos <= 3).length,
    promotions: members.filter(m => /^P/i.test(m.pd)).length,
    quicker: withForm.filter(m => m.vs <= -1).length,
    rated: withForm.length,
    // the best days against form (a clear 1% or more quicker), up to three
    best: withForm.filter(m => m.vs <= -1).sort((a, b) => a.vs - b.vs).slice(0, 3).map(m => ({ name: m.name, event: m.event, vs: m.vs }))
  }
  return { race, races: races.slice(0, 10), totals, crews: list }
}
