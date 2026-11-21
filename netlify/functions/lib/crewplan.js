// Crew planner: who should race K1, and who should pair up in a K2, to get the best
// results. Pure functions; runs in the browser (the Paddler detail page) on ratings from
// /api/crews (see crewfit.js), so availability can be changed without asking the server.
//
// A paddler's "level" puts their speed on the division ladder: 5.6 is a strong div 6
// paddler, 6.4 a weak one. It is worked out against their own division's paddlers (on the
// same course), then one division = GAP (about 5.8% of the time), measured where
// neighbouring divisions race the same course.
//
// A K2 crew races in division floor((div A + div B) / 2) (a lower-division paddler can race
// up with a higher one; a crew with a div 1-3 paddler races div 3 at the lowest), at the average of the two levels. Each option is scored by the
// share of that division's field it would beat (K1s against K1s, K2s against K2s, from
// this season's results). A K2 is only suggested when it does at least as well for BOTH
// paddlers as racing K1 in their own division would; anyone better off in a K1 races K1.
// Among those, every paddler gets one option: the set that does best overall.

export const GAP = 0.058

export function level(p, fields) {
  const d = +p.div
  const med = fields.k1med[d]
  return med == null ? null : d + (p.a - med) / GAP
}

// share of a division's field (deciles of speed) that a level would beat
function beats(lvl, D, dec, fields) {
  const med = fields.k1med[D]
  if (!dec || med == null || lvl == null) return null
  const field = dec.map(x => D + (x - med) / GAP)
  if (lvl <= field[0]) return 1
  if (lvl >= field[field.length - 1]) return 0
  for (let i = 1; i < field.length; i++) {
    if (lvl <= field[i]) {
      const f = (i - 1 + (lvl - field[i - 1]) / Math.max(1e-9, field[i] - field[i - 1])) / (field.length - 1)
      return 1 - f
    }
  }
  return 0
}
export const beatsK1 = (lvl, D, fields) => beats(lvl, D, fields.k1[D], fields)
export const beatsK2 = (lvl, D, fields) => beats(lvl, D, fields.k2[D], fields)
// A K2 races in division (div A + div B) / 2, rounded down. But nobody can race down a
// distance: divisions 1-3 race the long course, 4-6 the medium and 7-9 the short one, and a
// paddler can't race a shorter course than their own division's. So the crew races on the
// quicker paddler's course at least (the other paddler races up): a div 2 with a div 6
// races div 3, not div 4; a div 5 with a div 9 races div 6, not div 7.
const lowestOnCourse = d => (d <= 3 ? 3 : d <= 6 ? 6 : 9)
export function crewDivision(a, b) {
  const da = +a.div
  const db = +b.div
  return Math.min(Math.floor((da + db) / 2), lowestOnCourse(Math.min(da, db)))
}

// trust thin data less: one or two results, or a K1 rating that only comes from K2 races
export const THIN = 3 // fewer results than this: a rough rating
const trust = p => (p.n < THIN ? 0.6 : 1)
const value = b => b * b // a podium place is worth more than a mid-field one
const SLACK = 0.02 // a K2 within 2% of someone's K1 result counts as just as good

// How used someone is to a K1 or a K2, from the share of their races in each (0.5 for a boat
// they've never raced, 1 for the one they always race): with "familiar" on, each option's
// score is scaled by it, so people mostly race the boats they know.
export function familiarity(p, kind) {
  const k1 = p.nK1 || 0
  const k2 = p.nK2 || 0
  if (!k1 && !k2) return 1
  return 0.5 + 0.5 * (kind === 'K1' ? k1 : k2) / (k1 + k2)
}

// Rules the coordinator adds: { kind: 'together' | 'apart', a: id, b: id } or
// { kind: 'K1' | 'K2', a: id } (people's ids). "together" always pairs them (even if a K1
// would suit one of them better); "apart" never; "K1" keeps someone in a K1; "K2" puts
// them in a K2 if anyone can be paired with them.
const NO = -1e6 // the score of something a rule rules out

// Learning crews: a developing paddler (fewer than 15 results, or a junior with fewer than
// 25) in the back of a K2 behind an experienced, steady one (25+ results, steady from race to
// race), one to three divisions quicker: they follow the stroke in front, a good way to learn.
// With "learning" on, these crews are preferred to both racing K1s, even if the experienced
// paddler would do better alone; the planner then picks the best of them.
// "Steady" is relative: no more up and down from race to race than the typical experienced
// paddler in the squad (or 5% of the time, if that's more)
export const developing = p => p.n < 15 || (p.group === 'junior' && p.n < 25)
export function steadyCut(people) {
  const sds = people.filter(p => p.n >= 25 && p.sd != null).map(p => p.sd).sort((a, b) => a - b)
  return Math.max(0.05, sds.length ? sds[Math.floor(sds.length / 2)] : 0)
}
export const experienced = (p, cut = 0.05) => !developing(p) && p.n >= 25 && (p.sd == null || p.sd <= cut)
export function learningPair(p, q, fields, cut = 0.05) {
  const lp = level(p, fields)
  const lq = level(q, fields)
  if (lp == null || lq == null) return null
  // one to three divisions quicker: close enough to race together (a div 9 isn't put in a div 3 race)
  const ahead = (m, l) => l - m >= 1 && l - m <= 3
  if (experienced(p, cut) && developing(q) && ahead(lp, lq)) return { mentor: p, learner: q }
  if (experienced(q, cut) && developing(p) && ahead(lq, lp)) return { mentor: q, learner: p }
  return null
}

// people: [{ id, name, a, div, n, nK1, nK2, group, sd }]; options: { rules, familiar, learning }
// returns { entries: [{ kind: 'K1'|'K2', D, members, beats }], options, total, unmet: [rule] }
export function planCrews(people, fields, { rules = [], familiar = false, learning = false } = {}) {
  const ps = people
    .filter(p => /^[1-9]$/.test(String(p.div)) && fields.k1med[+p.div] != null)
    .map(p => ({ ...p, lvl: level(p, fields) }))
  const n = ps.length
  const at = id => ps.findIndex(p => p.id != null && p.id === id)
  const rule = (kind, i, j) => rules.some(r => r.kind === kind && ((at(r.a) === i && (j == null || at(r.b) === j)) || (j != null && at(r.a) === j && at(r.b) === i)))
  const fam = (p, kind) => (familiar ? familiarity(p, kind) : 1)
  const cut = steadyCut(ps)
  const solo = ps.map((p, i) => {
    const b = beatsK1(p.lvl, +p.div, fields)
    const score = b == null ? 0 : value(b) * trust(p) * (p.nK1 ? 1 : 0.85) * fam(p, 'K1')
    return { kind: 'K1', D: +p.div, members: [p], beats: b, score: rule('K2', i) ? NO : score }
  })
  const pair = []
  for (let i = 0; i < n; i++) {
    pair.push([])
    for (let j = 0; j < n; j++) {
      if (j <= i) { pair[i].push(pair[j]?.[i] ?? null); continue }
      const D = crewDivision(ps[i], ps[j])
      const lvl = (ps[i].lvl + ps[j].lvl) / 2
      const b = beatsK2(lvl, D, fields)
      const together = rule('together', i, j)
      const lp = learning ? learningPair(ps[i], ps[j], fields, cut) : null
      // no K2 that leaves either paddler worse off than their own K1 race (unless a rule says
      // they pair up, or that one of them races a K2). With "familiar" on, each side is
      // weighed by how used they are to it: someone who never races K1s isn't held to theirs.
      const worse = !together && !lp && b != null && [i, j].some(k => !rule('K2', k) && solo[k].beats != null && b * fam(ps[k], 'K2') < solo[k].beats * fam(ps[k], 'K1') - SLACK)
      const banned = rule('apart', i, j) || rule('K1', i) || rule('K1', j)
      let score = b == null ? 0 : 2 * value(b) * Math.min(trust(ps[i]), trust(ps[j])) * Math.min(fam(ps[i], 'K2'), fam(ps[j], 'K2'))
      // a learning crew is worth more than the two of them racing K1s; the better the crew, the more
      if (lp) score = Math.max(score, (Math.max(0, solo[i].score) + Math.max(0, solo[j].score)) * 1.1 + score * 0.5)
      const members = lp ? [lp.mentor, lp.learner] : [ps[i], ps[j]] // learning crews: the experienced paddler in front
      pair[i].push(banned || (!together && (b == null || worse)) ? null : { kind: 'K2', D, members, beats: b, score, ...(lp ? { learning: true } : {}) })
    }
  }
  // fix the lower triangle (filled before the upper one existed)
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) pair[i][j] = pair[j][i]

  // local search: partner[i] = j (K2 together) or -1 (K1). Start everyone in K1, then keep
  // making the best single change until nothing helps: pair two, split a pair, swap
  // partners between two crews, or take someone's partner.
  const partner = new Array(n).fill(-1)
  // "together" rules first, and they stay: nobody else can take those partners
  const fixed = new Set()
  const unmet = []
  for (const r of rules.filter(r => r.kind === 'together')) {
    const i = at(r.a)
    const j = at(r.b)
    if (i < 0 || j < 0) continue // not racing / no results: nothing to do
    if (i === j || partner[i] >= 0 || partner[j] >= 0 || !pair[i][j]) { unmet.push(r); continue }
    partner[i] = j
    partner[j] = i
    fixed.add(i).add(j)
  }
  const sc = i => (partner[i] < 0 ? solo[i].score : pair[i][partner[i]].score / 2)
  const total = () => ps.reduce((s, _, i) => s + sc(i), 0)
  let best = total()
  for (let round = 0; round < 200; round++) {
    let improved = false
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || partner[i] === j || !pair[i][j] || fixed.has(i) || fixed.has(j) || fixed.has(partner[i]) || fixed.has(partner[j])) continue
        // move: i and j race together; their old partners (if any) go K1 or pair up
        const oi = partner[i]
        const oj = partner[j]
        const saved = [...partner]
        if (oi >= 0) partner[oi] = -1
        if (oj >= 0) partner[oj] = -1
        partner[i] = j
        partner[j] = i
        if (oi >= 0 && oj >= 0 && oi !== oj && pair[oi][oj]) {
          // the two left over might do better together
          const t1 = total()
          partner[oi] = oj
          partner[oj] = oi
          if (total() < t1) { partner[oi] = -1; partner[oj] = -1 }
        }
        const t = total()
        if (t > best + 1e-12) { best = t; improved = true } else partner.splice(0, n, ...saved)
      }
      // move: i leaves its crew to race K1
      if (partner[i] >= 0 && !fixed.has(i)) {
        const o = partner[i]
        partner[i] = -1
        partner[o] = -1
        const t = total()
        if (t > best + 1e-12) { best = t; improved = true } else { partner[i] = o; partner[o] = i }
      }
    }
    if (!improved) break
  }

  const entries = []
  for (let i = 0; i < n; i++) {
    if (partner[i] < 0) entries.push(solo[i])
    else if (partner[i] > i) entries.push(pair[i][partner[i]])
  }
  entries.sort((a, b) => a.D - b.D || (a.kind === b.kind ? b.beats - a.beats : a.kind === 'K2' ? -1 : 1))

  // other good options in each division: the best K2 crews and K1s, whoever they are
  const options = {}
  for (let i = 0; i < n; i++) {
    ;(options[solo[i].D] ??= []).push(solo[i])
    for (let j = i + 1; j < n; j++) if (pair[i][j]) (options[pair[i][j].D] ??= []).push(pair[i][j])
  }
  for (const D of Object.keys(options)) {
    const reliable = o => o.members.every(m => m.n >= THIN)
    options[D] = {
      k2: options[D].filter(o => o.kind === 'K2' && reliable(o)).sort((a, b) => b.beats - a.beats).slice(0, 5),
      k1: options[D].filter(o => o.kind === 'K1' && reliable(o)).sort((a, b) => b.beats - a.beats).slice(0, 5)
    }
  }
  // rules that couldn't be kept (e.g. someone who must race a K2 with nobody to pair with)
  for (const r of rules) {
    const i = at(r.a)
    if (i < 0) continue
    if (r.kind === 'K2' && partner[i] < 0) unmet.push(r)
    if (r.kind === 'apart' && partner[i] >= 0 && partner[i] === at(r.b)) unmet.push(r)
  }
  return { entries, options, total: best, unmet }
}
