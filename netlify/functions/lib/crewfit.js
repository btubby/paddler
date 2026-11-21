// Speed ratings from Hasler race results, for the crew planner (see crewplan.js).
// Pure functions, no dependencies: used by netlify/functions/crews.js and the tests.
//
// The model: every finishing time is
//     log(time) = course + paddler            (K1)
//     log(time) = course + mean(two paddlers) + K2   (K2: K2 crews are quicker by about 7%)
// "course" is one race's course on the day (conditions included), "paddler" is how quick
// that paddler is (lower = quicker). Fitted over everyone in every race (all clubs), so a
// BSF paddler is compared with the whole field, not just their own club. All results
// count, recent ones more (half-weight after HALF_LIFE days), so someone who hasn't raced
// for a while is still rated from their older races; odd results (a capsize, a wrong
// turn) count less (robust fit).

import { hostCode, fixSpelling, nameChange, MISSPELLINGS } from './match.js'

// "div5_5" -> "Div 5 K2", "k2-16-mix" -> "K2 16 Mix"
export function eventName(tab, boat = 'kayak') {
  const m = String(tab).match(/^div(\d)_\d$/i)
  if (m) return `Div ${m[1]} ${boat === 'canoe' ? 'C2' : 'K2'}`
  const one = String(tab).match(/^div(\d)$/i)
  if (one && boat === 'canoe') return `Div ${one[1]} C1`
  return String(tab).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\b([KC])(\d)/gi, (_, b, n) => b.toUpperCase() + n)
}

export const HALF_LIFE = 365 // days: results from a year ago count half as much
export const FIELD_DAYS = 730 // the fields each division races against: the last two years
const ROBUST = 0.06 // residuals bigger than this (6% of the time) are down-weighted
const ITERATIONS = 120
// tables that aren't kayaks (canoes, SUP, para, general-purpose boats): left out
const NOT_KAYAK = /(^|[-_])m?c\d|^sc\d|_sc\d|jc\d|sup|para|^gp-|mc\d/
// Hasler division tables mix kayaks and canoes (a C2 can race in div9_9), and a paddler has
// a separate division in each: the Class column says which (SMK, VFK: kayak; VMC, JMC:
// canoe). Only kayak results count here, for both the ratings and the divisions.
export const isCanoe = x => (x.cls || []).some(c => /C$/i.test(String(c).trim()))
// Canoe results (C1s and C2s), for a paddler's separate canoe rating: the Class column says
// canoe, or, where a table has no classes, it's a canoe table (c1, mc2, jc1...). SUP and
// para tables are left out of both.
const CANOE_TABLE = /(^|[-_])[mjs]?c\d/
export function isCanoeRow(x) {
  if ((x.cls || []).some(c => String(c).trim())) return isCanoe(x)
  return CANOE_TABLE.test(x.tab) && !/sup|para/.test(x.tab)
}
function counts(x, boat) {
  if (boat === 'canoe') return isCanoeRow(x) && !/para/.test(x.tab) && !(/sup/.test(x.tab) && !isCanoe(x))
  return !NOT_KAYAK.test(x.tab) && !isCanoe(x)
}

// A name as the results misspelt it, put right for showing ("Petr Luksah" -> "Petr Luksan":
// lib/match.js MISSPELLINGS); any other name as it is
export function spelt(name) {
  const right = MISSPELLINGS[normName(name)]
  return right ? right.replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : name
}

export function normName(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim()
}

// The results don't always spell a name the same way ("Dave"/"David", "Eddie"/"Edward",
// "Rich"/"Richard"): first names are put in one form, so it's one paddler, one rating.
const NICKNAMES = {
  dave: 'david', davey: 'david', eddie: 'edward', ed: 'edward', ted: 'edward', rich: 'richard', richie: 'richard',
  rick: 'richard', dick: 'richard', mike: 'michael', mick: 'michael', bob: 'robert', rob: 'robert', robbie: 'robert',
  bert: 'robert', will: 'william', bill: 'william', billy: 'william', tom: 'thomas', tommy: 'thomas', jim: 'james',
  jimmy: 'james', ben: 'benjamin', benji: 'benjamin', kate: 'katherine', katie: 'katherine', kathy: 'katherine',
  dan: 'daniel', danny: 'daniel', joe: 'joseph', pete: 'peter', steve: 'stephen', tony: 'anthony', andy: 'andrew',
  nick: 'nicholas', nicky: 'nicholas', liz: 'elizabeth', beth: 'elizabeth', jenny: 'jennifer', jen: 'jennifer',
  matt: 'matthew', sam: 'samuel', charlie: 'charles', fred: 'frederick', freddie: 'frederick', harry: 'henry',
  greg: 'gregory', phil: 'philip', ollie: 'oliver', olly: 'oliver', josh: 'joshua', zak: 'zachary', zach: 'zachary'
}
// Known misspellings of a name (see match.js) are put right too.
export function personKey(name) {
  const [first = '', ...rest] = fixSpelling(normName(name)).split(' ')
  return fixSpelling([NICKNAMES[first] || first, ...rest].join(' '))
}

// "P5" or "P-GSB": promoted to that division; anything else leaves the division raced
export function currentDivision(div, pd) {
  let d = String(div || '').trim().toUpperCase()
  const m = String(pd || '').trim().toUpperCase().match(/^P-?(.+)$/)
  if (m) d = m[1]
  return d
}

// A paddler's division now, from their results (oldest first: [{ tab, div, pd }], div being
// their own division on that result, '' when the result doesn't say). Divisions change at
// Hasler races (promotion P3, or a demotion taken up), so the Hasler division tables (div4,
// div4_4) decide; other races (winter series, championships) only count for someone with
// no Hasler results: their Div column can be out of date (Oleh Kuzmenko was promoted to div
// 3 in June, and a winter series race in October still listed him as div 4). A promotion
// also isn't undone by a later result that still shows the division they were promoted out of.
export function divisionFromResults(rows) {
  // (the Geoff Sanders divisions for children, gs_diva/b/c, are Hasler divisions too)
  const hasler = rows.filter(r => /^(div\d(_\d)?|gs_div[abc])$/i.test(r.tab || ''))
  let div = ''
  let promotedFrom = null
  for (const r of hasler.length ? hasler : rows) {
    const own = String(r.div || '').trim().toUpperCase()
    if (own && !(promotedFrom && own === promotedFrom)) {
      div = own
      promotedFrom = null
    }
    const m = String(r.pd || '').trim().toUpperCase().match(/^P-?(.+)$/)
    if (m) {
      promotedFrom = own || div
      div = m[1]
    }
  }
  return div
}
// someone's own division on a result: a K2 row may give one division for the crew
// (not either paddler's own), so that counts only when there's one per paddler
export const ownDivision = (x, i) => (x.divs?.length === x.names.length ? x.divs[i] : x.names.length === 1 ? x.divs?.[0] : '') || ''

// The age group from the Class column (JMK: junior man, kayak; SFK: senior woman; VMC:
// veteran man, canoe). Public in the results, and only a rough band: "junior" is under 18,
// and the class is as entered, so it can lag a birthday.
export function ageGroup(cls) {
  const c = String(cls || '').trim().toUpperCase()
  if (/^J/.test(c) || /^U\d/.test(c)) return 'junior'
  if (/^V/.test(c)) return 'veteran'
  if (/^S/.test(c)) return 'senior'
  return ''
}

// Which course each result was on. Hasler races have one table per division (div6 for
// K1s, div6_6 for K2s); divisions on the same course are compared directly, so they are
// grouped: a new group starts where the typical time drops sharply (a shorter course,
// usually between div 3/4 and div 6/7). Other races: each table is its own course.
function courseKeys(race) {
  const keys = new Map()
  const hz = race.rows.filter(x => /^div\d(_\d)?$/.test(x.tab))
  if (hz.length) {
    const med = {}
    for (let d = 1; d <= 9; d++) {
      const ts = hz.filter(x => +x.tab[3] === d).map(x => (x.tab.includes('_') ? x.t * 1.04 : x.t)).sort((a, b) => a - b)
      if (ts.length) med[d] = ts[Math.floor(ts.length / 2)]
    }
    let g = 0
    let prev = null
    const group = {}
    for (const d of Object.keys(med).map(Number).sort((a, b) => a - b)) {
      if (prev && med[d] < med[prev] * 0.85) g++
      group[d] = g
      prev = d
    }
    for (const x of hz) keys.set(x, `${race.key}|hz${group[+x.tab[3]]}`)
  }
  for (const x of race.rows) if (!keys.has(x)) keys.set(x, `${race.key}|${x.tab}`)
  return keys
}

const deciles = arr => {
  const s = [...arr].sort((a, b) => a - b)
  return s.length ? [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map(f => +s[Math.round(f * (s.length - 1))].toFixed(4)) : null
}

// races: [{ key, name, date (ms), rows: [{ tab, pos, names[], clubs[], cls[], divs[], pd[], t (seconds) }] }]
// historyClub: also keep every result of that club's paddlers ('*': everyone's), each with how quick it
// was (see "history" below), for the paddler pages
//
// Canoes (C1, C2) are fitted in the same model, as separate paddlers: someone who races
// both has a kayak rating and a canoe rating, and a canoe division. They share the course
// on the day with the kayaks (a Hasler division table rarely has more than one or two
// canoes, too few to say how quick the course was on their own), so canoe ratings are on
// the same scale as kayak ones, just slower. C2s get their own crew bonus. The result's
// top level is the kayaks, as before; result.canoe has the same for canoes.
// links: { 'catherine ayling|MAI': { name: 'Catherine Shirley', club: 'EAL' } }: paddlers a coach
// confirmed raced under another name before (namelinks.js), put together under the new one
export function fitRatings(races, { now = Date.now(), halfLife = HALF_LIFE, fieldDays = FIELD_DAYS, historyClub = null, links = {}, unfair = new Set() } = {}) {
  const P = { kayak: new Map(), canoe: new Map() }
  const person = (name, club, boat) => {
    // a paddler who changed their name: under the name and club they race with now
    let changed = nameChange(normName(name))
    if (changed) club = changed.club
    let k = personKey(name) + '|' + String(club || '').toUpperCase()
    const linked = links[k]
    if (linked) { changed = linked; club = linked.club; k = personKey(linked.name) + '|' + String(club).toUpperCase() }
    const map = P[boat]
    if (!map.has(k)) map.set(k, { key: k, boat, name: changed ? changed.name : spelt(name), names: new Set(), club: String(club || '').toUpperCase(), a: 0, ent: [] })
    const p = map.get(k)
    p.names.add(spelt(name)) // (a misspelling isn't another name they raced under)
    return p
  }
  const E = []
  for (const race of races) {
    const keys = courseKeys(race)
    const w = Math.pow(0.5, Math.max(0, now - (race.date || now)) / 864e5 / halfLife)
    for (const x of race.rows) {
      if (!x.t || !x.names?.length || x.names.length > 2) continue
      const boat = counts(x, 'kayak') ? 'kayak' : counts(x, 'canoe') ? 'canoe' : null
      if (!boat) continue
      const ms = x.names.map((n, i) => person(n, x.clubs[i] ?? x.clubs[0], boat))
      if (ms.length === 2 && ms[0] === ms[1]) continue
      const e = { c: keys.get(x), ms, boat, k2: ms.length === 2, lt: Math.log(x.t), w, rw: 1, x, race }
      // a paddler (or a coach) said this was not a fair result (stopped to help, capsized...): it
      // hardly counts towards anyone's rating, and is shown as an odd result
      if (unfair.size && ms.some(m => unfair.has(m.key.split('|')[0] + '@' + race.key + '|' + x.tab))) { e.w = w * 0.02; e.unfair = true }
      E.push(e)
      for (const m of ms) { m.ent.push(e); m.maxW = Math.max(m.maxW || 0, w) }
    }
  }
  const everyone = () => [...P.kayak.values(), ...P.canoe.values()]
  const C = new Map()
  const KB = { kayak: 0, canoe: 0 } // crew bonus: K2s, C2s
  const bonus = e => (e.k2 ? KB[e.boat] : 0)
  const crew = e => (e.k2 ? (e.ms[0].a + e.ms[1].a) / 2 : e.ms[0].a)
  const resid = e => e.lt - C.get(e.c) - crew(e) - bonus(e)
  for (let it = 0; it < ITERATIONS; it++) {
    const cs = new Map()
    for (const e of E) {
      const s = cs.get(e.c) || [0, 0]
      s[0] += (e.lt - crew(e) - bonus(e)) * e.w * e.rw
      s[1] += e.w * e.rw
      cs.set(e.c, s)
    }
    for (const [c, s] of cs) C.set(c, s[0] / s[1])
    for (const boat of ['kayak', 'canoe']) {
      let ks = 0
      let kw = 0
      for (const e of E) if (e.k2 && e.boat === boat) { ks += (e.lt - C.get(e.c) - crew(e)) * e.w * e.rw; kw += e.w * e.rw }
      KB[boat] = kw ? ks / kw : 0
    }
    for (const p of everyone()) {
      let s = 0
      let w = 0
      for (const e of p.ent) {
        const base = e.lt - C.get(e.c) - bonus(e)
        const target = e.k2 ? 2 * base - (e.ms[0] === p ? e.ms[1].a : e.ms[0].a) : base
        const ww = e.w * e.rw * (e.k2 ? 0.5 : 1)
        s += target * ww
        w += ww
      }
      // a little pull towards average keeps someone with a single result from running off
      // (scaled to their own results' weight, so old results aren't pulled more than new ones)
      p.a = s / (w + 0.02 * p.maxW)
    }
    // 0 is the average kayak paddler (canoes are measured on the same scale)
    let m = 0
    for (const p of P.kayak.values()) m += p.a
    m /= P.kayak.size || 1
    for (const p of everyone()) p.a -= m
    if (it >= 30 && it % 10 === 0) for (const e of E) e.rw = Math.min(1, ROBUST / Math.max(1e-9, Math.abs(resid(e))))
  }

  // a result only says something if someone else was on that course too
  const onCourse = new Map()
  for (const e of E) onCourse.set(e.c, (onCourse.get(e.c) || 0) + 1)
  for (const p of everyone()) {
    p.n = p.ent.filter(e => onCourse.get(e.c) > 1).length
    const latest = [...p.ent].sort((a, b) => (b.race.date || 0) - (a.race.date || 0))[0]
    const i = latest.ms.indexOf(p)
    p.name = latest.x.names[i] != null ? spelt(latest.x.names[i]) : p.name // the name as they last raced under (spelt right)
    p.names = [...p.names]
    p.div = divisionFromResults([...p.ent]
      .sort((a, b) => (a.race.date || 0) - (b.race.date || 0))
      .map(e => { const k = e.ms.indexOf(p); return { tab: e.x.tab, div: ownDivision(e.x, k), pd: e.x.pd?.[k] } }))
    p.cls = latest.x.cls?.[i] ?? latest.x.cls?.[0] ?? ''
    p.last = latest.race.date ? new Date(latest.race.date).toISOString().slice(0, 10) : ''
    p.nK1 = p.ent.filter(e => !e.k2).length
    p.nK2 = p.ent.filter(e => e.k2).length
    p.group = ageGroup(p.cls)
    // how steady their results are: the typical gap between a result and their rating (% of
    // the time, odd ones capped), for telling experienced, steady paddlers from developing ones
    const gaps = p.ent.filter(e => onCourse.get(e.c) > 1).map(e => Math.min(0.15, Math.abs(resid(e))))
    p.sd = gaps.length >= 3 ? +Math.sqrt(gaps.reduce((s, g) => s + g * g, 0) / gaps.length).toFixed(4) : null
  }

  const finishers = new Map() // race|table -> how many finished (kayaks and canoes)
  for (const e of E) finishers.set(e.race.key + '|' + e.x.tab, (finishers.get(e.race.key + '|' + e.x.tab) || 0) + 1)
  const out = boat => {
    const EB = E.filter(e => e.boat === boat)
    // The fields each division races against: how quick the K1s (C1s) in div N tables were,
    // and the K2 (C2) crews in divN_N tables (paddlers with at least 2 results only). For
    // canoes, a short window has too few, so it's all of them. Below div 9, the children's
    // Geoff Sanders divisions: GSA as 10, GSB 11, GSC 12 (gs_diva/b/c tables, K1s).
    const k1 = {}
    const k2 = {}
    const days = boat === 'canoe' ? Infinity : fieldDays
    for (const e of EB) {
      const m = e.x.tab.match(/^div(\d)(_\d)?$/)
      const gs = !m && !e.k2 && e.x.tab.match(/^gs_div([abc])$/i)
      if ((!m && !gs) || e.ms.some(p => p.n < 2) || now - (e.race.date || now) > days * 864e5) continue
      const d = m ? m[1] : String(10 + 'abc'.indexOf(gs[1].toLowerCase()))
      ;((e.k2 ? k2 : k1)[d] ??= []).push(crew(e))
    }
    const fields = { k1: {}, k2: {}, k1med: {} }
    for (const [d, xs] of Object.entries(k1)) { fields.k1[d] = deciles(xs); fields.k1med[d] = fields.k1[d][5] }
    for (const [d, xs] of Object.entries(k2)) fields.k2[d] = deciles(xs)
    // Who has paddled a K2 (C2) with whom, over all the results: how often, and when last
    // (and each race: when, where, the event and how they did)
    const pairs = new Map()
    for (const e of EB) {
      if (!e.k2) continue
      const [p, q] = [...e.ms].sort((a, b) => (a.key < b.key ? -1 : 1))
      const k = p.key + '~' + q.key
      if (!pairs.has(k)) pairs.set(k, { a: p, b: q, races: 0, first: e.race.date, last: e.race.date, list: [] })
      const x = pairs.get(k)
      x.races++
      x.first = Math.min(x.first, e.race.date)
      x.last = Math.max(x.last, e.race.date)
      x.list.push({
        date: e.race.date ? new Date(e.race.date).toISOString().slice(0, 10) : '',
        race: e.race.name,
        venue: hostCode(e.race.name),
        event: eventName(e.x.tab, boat),
        pos: e.x.pos ?? null,
        of: finishers.get(e.race.key + '|' + e.x.tab) || null
      })
    }
    for (const x of pairs.values()) x.list.sort((a, b) => (a.date < b.date ? 1 : -1))
    // Each result of the club's paddlers, with how quick it was on the same scale as the
    // ratings (lower = quicker): the time against that course on the day. In a K2: their own
    // rating plus half of how much quicker or slower the crew was than the two ratings
    // predict. (Taking the partner's rating off the crew's would put the crew's whole day on
    // one paddler, doubled: an ordinary K2 with a quick partner looked like an off day.)
    // "alone": nobody else on that course, so it says nothing about speed.
    const history = new Map()
    if (historyClub) {
      for (const e of EB) {
        const base = e.lt - C.get(e.c) - bonus(e)
        e.ms.forEach((p, i) => {
          if (historyClub !== '*' && p.club !== historyClub) return
          const mate = e.k2 ? e.ms[1 - i] : null
          // the club the results page gives for them that day (they may have raced for several)
          const club = String(e.x.clubs?.[i] ?? e.x.clubs?.[0] ?? '').toUpperCase().trim()
          if (!history.has(p.key)) history.set(p.key, [])
          history.get(p.key).push({
            date: e.race.date ? new Date(e.race.date).toISOString().slice(0, 10) : '',
            race: e.race.name,
            url: e.race.key && e.race.key.startsWith('/') ? e.race.key : undefined,
            rid: e.race.key + '|' + e.x.tab, // what a note on this result is kept under
            venue: hostCode(e.race.name),
            event: eventName(e.x.tab, boat),
            tab: e.x.tab, // the results page opens this table with #race-<tab>
            k2: e.k2, // for canoes: a C2
            boat,
            partner: mate ? mate.name : undefined,
            club: club || undefined,
            div: String(e.x.divs?.[i] ?? e.x.divs?.[0] ?? '').toUpperCase(),
            pd: String(e.x.pd?.[i] ?? '').toUpperCase() || undefined,
            pos: e.x.pos ?? null,
            of: finishers.get(e.race.key + '|' + e.x.tab) || null,
            t: e.x.t,
            // K2: their own rating, plus half of how far the crew was off its expected time
            // that day (base - (p.a + mate.a) / 2), shared equally between the two of them
            rating: +(e.k2 ? base + (p.a - mate.a) / 2 : base).toFixed(4),
            odd: e.rw < 0.5 || e.unfair || undefined, // a result well off their usual (capsize, wrong turn...)
            alone: onCourse.get(e.c) > 1 ? undefined : true,
            // a division table with no Class column (the older results, and some newer races, don't say
            // kayak or canoe): counted as a kayak result, but it may be a canoe one
            nc: boat === 'kayak' && /^div/i.test(String(e.x.tab)) && !(e.x.cls || []).some(c => String(c).trim()) ? true : undefined,
            provisional: e.race.provisional || undefined // a recent race: results may still change
          })
        })
      }
      for (const list of history.values()) list.sort((a, b) => (a.date < b.date ? -1 : 1))
    }
    return { K: KB[boat], paddlers: [...P[boat].values()], fields, entries: EB.length, pairs: [...pairs.values()], history }
  }
  return { ...out('kayak'), canoe: out('canoe') }
}
