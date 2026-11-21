// From a paddler's results (each with a "rating": how quick it was against that course on
// the day, lower = quicker; see netlify/functions/lib/crewfit.js), work out:
//   - a "level" for each race on the division ladder (5.0 = a typical div 5 paddler,
//     4.6 a strong one), so races on different courses and in different years compare
//   - a smoothed trend of that level over time, and how it has changed
//   - what the results say about where time can be found, turned into coaching ideas
// Pure functions: used by the paddler page and the tests.

export const GAP = 0.058 // one division is about 5.8% of the time

// Hasler courses: divisions 7-9 race the short course, 4-6 the medium one, 1-3 the long one.
// From the result's table (div5, div5_5) or event name ("Div 5 K2"); other races (winter
// series, championships) aren't on one of these three courses.
export const COURSES = {
  short: { label: 'Short course', divs: 'div 7–9' },
  medium: { label: 'Medium course', divs: 'div 4–6' },
  long: { label: 'Long course', divs: 'div 1–3' }
}
export function courseOf(r) {
  const m = String(r.tab || '').match(/^div(\d)(_\d)?$/i) || String(r.event || '').match(/^Div (\d)\b/)
  if (!m) return null
  const d = +m[1]
  return d >= 7 ? 'short' : d >= 4 ? 'medium' : 'long'
}

// The ladder: a straight line through the typical (median) rating of each division, so
// one division is always GAP (the medians themselves wobble where courses change length)
export function ladder(k1med) {
  const ds = Object.keys(k1med || {}).map(Number).filter(d => d >= 1 && d <= 9 && k1med[d] != null)
  if (!ds.length) return { alpha: 0 }
  const alpha = ds.reduce((s, d) => s + (k1med[d] - GAP * d), 0) / ds.length
  return { alpha }
}
export const levelOf = (rating, lad) => (rating - lad.alpha) / GAP

const DAY = 864e5
const t = d => Date.parse(d)

// smoothed level at a date: results either side, nearer ones counting more (K2 results,
// and odd ones, count less)
export function trendAt(points, when, sigmaDays = 150) {
  let s = 0, w = 0
  for (const p of points) {
    const dt = (t(p.date) - when) / DAY / sigmaDays
    if (Math.abs(dt) > 3) continue
    const ww = Math.exp(-0.5 * dt * dt) * (p.k2 ? 0.5 : 1) * (p.odd ? 0.2 : 1)
    s += p.level * ww
    w += ww
  }
  return w > 0.05 ? s / w : null
}

// the trend as a line: a point a month, from the first result to the last
export function trendLine(points) {
  if (!points.length) return []
  const first = t(points[0].date), last = t(points[points.length - 1].date)
  const out = []
  for (let x = first; x <= last + 1; x += 30 * DAY) {
    const y = trendAt(points, x)
    if (y != null) out.push({ date: new Date(x).toISOString().slice(0, 10), level: y })
  }
  const y = trendAt(points, last)
  if (y != null) out.push({ date: points[points.length - 1].date, level: y })
  return out
}

const pct = levels => Math.abs(levels) * GAP * 100 // levels -> % of race time
const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
const sd = xs => { const m = mean(xs); return xs.length > 1 ? Math.sqrt(mean(xs.map(x => (x - m) ** 2))) : null }
export function fmtDuration(sec) {
  sec = Math.round(Math.abs(sec))
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}m`
  const m = Math.floor(sec / 60), s = sec % 60
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}
// a promotion on this result ("P3" or "P-GSB" in the P/D column): the division they went up
// to, or null
export function promotedTo(r) {
  const m = String(r?.pd || '').trim().toUpperCase().match(/^P-?(.+)$/)
  return m ? m[1] : null
}

// ---- divisions, including the children's ones below div 9 ----------------------------
// Children start in the Geoff Sanders (GS) divisions: GSC (under 12, mini K1), then GSB,
// then GSA (under 14), and from GSA are promoted into div 9. In the sums they rank below
// div 9: GSA 10, GSB 11, GSC 12 (so "promoted" is always to a lower number).
const GS_RANK = { GSA: 10, GSB: 11, GSC: 12 }
const GS_NAME = { 10: 'GSA', 11: 'GSB', 12: 'GSC' }
export const divRank = d => {
  const s = String(d ?? '').trim().toUpperCase().replace(/^GS[_ ]?DIV/, 'GS')
  return /^[1-9]$/.test(s) ? +s : GS_RANK[s] ?? null
}
// as written in the results: "5", "GSA"
export const rankName = r => (r >= 1 && r <= 9 ? String(r) : GS_NAME[r] || '')
// in a sentence: "div 5", "GSA"
export const divLabel = d => {
  const r = typeof d === 'number' ? d : divRank(d)
  return r == null ? String(d ?? '') : r <= 9 ? 'div ' + r : GS_NAME[r]
}

// The division they raced in on a result: the Div column, or, on older results pages that
// don't have one (before about 2023), the K1 division table they raced in (a K1 is always
// raced in your own division; a K2 table is the crew's, so it doesn't say). As a rank (above).
export function ownDivision(r) {
  const own = divRank(r.div)
  if (own != null) return own
  if (r.k2) return null
  const m = String(r.tab || '').match(/^div([1-9])$/i)
  if (m) return +m[1]
  const g = String(r.tab || '').match(/^gs_div([abc])$/i)
  return g ? 10 + 'abc'.indexOf(g[1].toLowerCase()) : null
}

// Each promotion, on the result where it happened: r.promo = { to, from, inferred }. Newer
// results pages say so (P3 in the P/D column); older ones don't, so a promotion is worked out
// from the divisions raced: when the next K1 is in a quicker division, they were promoted at
// (or after) the last race in the old one. results: oldest first; changed in place.
export function markPromotions(results) {
  let cur = null
  let run = [] // results raced in the current division, since they got there
  const best = rs => {
    // a promotion is earned by a top finish, so: the last win in that division, else the
    // last podium, else simply the last race there (a later race can still list the old
    // division, before the promotion has been put through)
    for (const ok of [r => r.pos === 1, r => r.pos != null && r.pos <= 3, () => true]) {
      for (let i = rs.length - 1; i >= 0; i--) if (ok(rs[i])) return rs[i]
    }
    return null
  }
  for (const r of results) {
    const told = promotedTo(r)
    const own = ownDivision(r)
    if (own != null) {
      if (cur != null && own < cur && !run.some(x => x.promo)) {
        const at = best(run)
        if (at) at.promo = { to: rankName(own), from: rankName(cur), inferred: true }
      }
      if (own !== cur) run = []
      cur = own
      run.push(r)
    }
    if (told) {
      r.promo = { to: told, from: own != null ? rankName(own) : cur != null ? rankName(cur) : null }
      if (!run.includes(r)) run.push(r)
      const tr = divRank(told)
      if (tr != null) { cur = tr; run = [] }
    }
  }
  return results
}

// how a race compared with their usual form (vsForm: % of the time, - = quicker)
export function describeForm(vsForm) {
  if (vsForm == null) return ''
  const p = Math.abs(vsForm).toFixed(1) + '%'
  if (vsForm <= -4) return `A great race: about ${p} quicker than their form at the time`
  if (vsForm <= -1) return `A good race: about ${p} quicker than their form at the time`
  if (vsForm < 1) return 'About their usual form at the time'
  if (vsForm < 4) return `Below their usual: about ${p} slower than their form at the time`
  return `An off day: about ${p} slower than their form at the time`
}
export const formShort = v => (v == null ? '' : Math.abs(v) < 1 ? 'usual form' : Math.abs(v).toFixed(1) + (v < 0 ? '% quicker' : '% slower'))

// The ladder with the children's divisions on it: where GSA, GSB and GSC sit (how quick their
// K1 tables typically are; a division apart each where there's nothing to go on), and words
// for a level: "a strong div 5", "a typical GSA"
export function scaleFor(k1med) {
  const lad = ladder(k1med)
  const pos = {}
  let last = 9
  for (const r of [10, 11, 12]) {
    const v = k1med?.[r] != null ? levelOf(k1med[r], lad) : null
    pos[r] = v != null && v > last + 0.2 ? v : last + 1
    last = pos[r]
  }
  const rankLevel = r => (r >= 10 ? pos[r] : r)
  const describe = level => {
    if (level == null) return ''
    if (level <= (9 + pos[10]) / 2) return describeLevel(level)
    // the nearest children's division, and where in it
    let r = 10
    for (const k of [11, 12]) if (Math.abs(level - pos[k]) < Math.abs(level - pos[r])) r = k
    const span = (pos[Math.min(12, r + 1)] - pos[Math.max(10, r - 1)]) / 2 || 1
    const off = (level - pos[r]) / span
    const word = off < -0.25 ? 'a strong' : off > 0.25 ? 'a newer' : 'a typical'
    return `${word} ${GS_NAME[r]}`
  }
  return { lad, rankLevel, describe, label: divLabel }
}

// "a strong div 5", "a typical div 6", "a steady div 7"
export function describeLevel(level) {
  if (level == null) return ''
  const d = Math.min(9, Math.max(1, Math.round(level)))
  const off = level - d
  const word = off < -0.25 ? 'a strong' : off > 0.25 ? 'a newer' : 'a typical'
  return `${word} div ${d}`
}

// Who a paddler has raced a K2 (or C2) with, and how many races together: one row per
// partner, most races first (then the most recent). results: the paddler's results, in any
// order ({ date, race, k2, partner, pos, of }). Same partner under a different spelling of
// their case or spacing counts as one.
export function partnersOf(results) {
  const by = new Map()
  for (const r of results || []) {
    const name = String(r.partner || '').replace(/\s+/g, ' ').trim()
    if (!r.k2 || !name) continue
    const key = name.toLowerCase()
    if (!by.has(key)) by.set(key, { name, races: 0, first: '', last: '', lastName: '', wins: 0, podiums: 0 })
    const p = by.get(key)
    p.races++
    if (r.date && (!p.first || r.date < p.first)) p.first = r.date
    if (r.date && r.date >= p.last) { p.last = r.date; p.name = name } // show the spelling used most recently
    if (r.pos === 1 && r.of > 1) p.wins++
    if (r.pos && r.pos <= 3 && r.of > 1) p.podiums++
    // how the race went against their own form at the time (- = quicker), oldest first
    if (typeof r.vsForm === 'number' && r.date) (p.forms ||= []).push({ date: r.date, v: r.vsForm, race: r.race || '', row: r })
  }
  for (const p of by.values()) Object.assign(p, crewForm(p.forms))
  return [...by.values()]
    .map(({ lastName, ...p }) => p)
    .sort((a, b) => b.races - a.races || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || a.name.localeCompare(b.name))
}

// A regular crew has raced together at least this many times
export const REGULAR_CREW = 4

// How a crew's races went against the paddler's usual form: the average (%, - = quicker),
// the best and worst, and whether it is getting better: the second half of the races against
// the first. Needs 3 or more races with a figure; otherwise it says nothing.
export function crewForm(forms) {
  const f = (forms || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  if (f.length < 3) return { forms: f, avg: null, best: null, worst: null, change: null }
  const mean = xs => xs.reduce((n, x) => n + x.v, 0) / xs.length
  const half = Math.floor(f.length / 2)
  const first = f.slice(0, half), second = f.slice(f.length - half)
  return {
    forms: f,
    avg: +mean(f).toFixed(1),
    best: f.reduce((b, x) => (x.v < b.v ? x : b), f[0]),
    worst: f.reduce((b, x) => (x.v > b.v ? x : b), f[0]),
    change: +(mean(second) - mean(first)).toFixed(1)
  }
}
// in words: "quicker together", "getting quicker" (a lower % is quicker)
export const crewAvgWords = v => (v == null ? '' : v <= -1 ? 'Quicker together' : v >= 1 ? 'Slower together' : 'About their usual')
export const crewChangeWords = v => (v == null ? '' : v <= -1 ? 'Getting quicker' : v >= 1 ? 'Getting slower' : 'Steady')

// history: [{ date, race, k2, partner, div, t, rating, odd, pos, of, ... }] (oldest first)
// boat: 'kayak' (K1/K2 results) or 'canoe' (C1/C2: "k2" then means a C2), for the wording
// and the coaching ideas
export const boatWords = boat => (boat === 'canoe' ? { one: 'C1', two: 'C2', boat: 'canoe' } : { one: 'K1', two: 'K2', boat: 'kayak' })
// group: 'junior' | 'senior' | 'veteran' | '' (from the Class column in the results: see
// crewfit.js ageGroup): juniors improve fast and unevenly, veterans do well to hold their speed
// the club gym has kayak ergos, for paddlers who've had the induction
const GYM = 'after the gym induction'

export function analyse(history, k1med, { now = Date.now(), currentDiv = null, boat = 'kayak', group = '', gym = true } = {}) {
  const junior = group === 'junior'
  const veteran = group === 'veteran'
  const W = boatWords(boat)
  const canoe = boat === 'canoe'
  const ergo = !canoe && gym // the club gym's ergos are kayak ergos (gym: false for other clubs' paddlers)
  const scale = scaleFor(k1med)
  const lad = scale.lad
  // every result, for the table; only those with someone else on the course say how quick
  // it was (a canoe alone in its class, say), so only those are on the ladder
  const all = history
    .filter(h => h.date)
    .map(h => ({ ...h, level: typeof h.rating === 'number' && !h.alone ? levelOf(h.rating, lad) : null, course: courseOf(h) }))
  markPromotions(all)
  const points = all.filter(p => p.level != null)
  // how each race went against their own form at the time: the trend from their other
  // results around then (not counting this one), in % of the race time, - = quicker
  for (const p of points) {
    const form = trendAt(points.filter(q => q !== p), t(p.date))
    if (form != null) p.vsForm = +((p.level - form) * GAP * 100).toFixed(1)
  }
  const trend = trendLine(points)
  if (!points.length) return { all, points, trend, stats: null, ideas: [], scale }

  const lastDate = t(points[points.length - 1].date)
  const level = trendAt(points, lastDate)
  // only when they were racing back then (not the trend stretched back from a few recent races)
  const yearAgo = t(points[0].date) <= lastDate - 300 * DAY ? trendAt(points, lastDate - 365 * DAY) : null
  const bestRow = trend.reduce((b, p) => (!b || p.level < b.level ? p : b), null)
  const firstLevel = trend.length ? trend[0].level : null
  const recent = points.filter(p => lastDate - t(p.date) <= 730 * DAY && !p.odd)
  const resid = p => p.level - (trendAt(points, t(p.date)) ?? p.level)
  // their division (a rank: GSA 10, GSB 11...), and the one they'd be promoted to next
  const div = divRank(currentDiv) ?? ownDivision(points[points.length - 1]) ?? Math.min(9, Math.round(level))
  const next = div > 1 ? div - 1 : null
  const typicalSecs = (() => {
    const ts = recent.map(p => p.t).filter(Boolean).sort((a, b) => a - b)
    return ts.length ? ts[Math.floor(ts.length / 2)] : 3600
  })()

  const racesLastYear = points.filter(p => now - t(p.date) <= 365 * DAY).length
  const k1 = recent.filter(p => !p.k2), k2 = recent.filter(p => p.k2)
  const k1Gap = k1.length >= 2 && k2.length >= 2 ? mean(k1.map(resid)) - mean(k2.map(resid)) : null // + : K1s slower than K2s
  const long = recent.filter(p => p.t >= 70 * 60), short = recent.filter(p => p.t && p.t < 50 * 60)
  const fade = long.length >= 2 && short.length >= 2 ? mean(long.map(resid)) - mean(short.map(resid)) : null // + : slower in long races
  const spread = sd(recent.map(resid))
  const placed = recent.filter(p => p.pos && p.of > 1)
  const podiums = placed.filter(p => p.pos <= 3).length

  const stats = {
    level, yearAgo, change: yearAgo != null ? level - yearAgo : null, // - : quicker
    best: bestRow, first: firstLevel, since: points[0].date,
    races: points.length, k1Races: points.filter(p => !p.k2).length, k2Races: points.filter(p => p.k2).length,
    racesLastYear, lastRace: all[all.length - 1].date, div, divLabel: divLabel(div), next, nextLabel: next ? divLabel(next) : '',
    // how much quicker (% of the time) to race like a typical paddler one division up,
    // against that division's own typical speed
    // (to a children's division, or from GSA up to div 9, the same way: against how quick
    // that division typically is)
    toNextPct: next && k1med?.[next] != null ? (lad.alpha + level * GAP - k1med[next]) * 100 : null,
    typicalSecs, spreadPct: spread != null ? spread * GAP * 100 : null,
    k1GapPct: k1Gap != null ? k1Gap * GAP * 100 : null, fadePct: fade != null ? fade * GAP * 100 : null,
    podiums, placedRaces: placed.length
  }

  // ---- coaching ideas, most useful first ---------------------------------------------
  const ideas = []
  const add = (kind, title, why, how, weight, gain) => ideas.push({ kind, title, why, how, weight, gain })

  const toNext = stats.toNextPct
  if (toNext != null && toNext > 0) {
    add('speed', 'Speed and threshold sessions',
      `Racing like a typical ${divLabel(next)} paddler needs about ${toNext.toFixed(1)}% more speed: roughly ${fmtDuration(toNext / 100 * typicalSecs)} over a ${fmtDuration(typicalSecs)} race.`,
      veteran
        ? ['One hard session a week at race pace and just above (e.g. 5 × 4 min, 2 min easy), with easy days either side', 'Short sprints (10–15 s) to keep the top-end speed', 'Time trials over a fixed course every few weeks to see the gains']
        : junior
          ? ['Race-pace pieces and relays in club sessions: short, sharp and fun', 'Short sprints (10–20 s) for a quicker stroke rate', 'Time trials every few weeks to see the gains']
          : ['Intervals at race pace and just above (e.g. 6 × 4 min, 2 min easy) once or twice a week', 'Short sprints (10–20 s) for top-end speed and a quicker stroke rate', 'Time trials over a fixed course every few weeks to see the gains'],
      2 + Math.min(2, toNext / 5), toNext / 100 / GAP)
    if (ergo) ideas[ideas.length - 1].how.push(`The same intervals on an ergo in the club gym (${GYM}): split and power on screen show every gain, whatever the river's doing`)
  } else if (toNext != null) {
    add('speed', 'Ready for promotion: race-pace work', `Already racing quicker than a typical ${divLabel(next)} paddler: the speed is there for promotion.`,
      ['Keep the race-pace intervals going', 'Enter races where a win or high place earns the promotion points'], 3, 0)
  }

  if (fade != null && fade > 0.3) {
    add('endurance', 'Endurance: hold the pace for the whole race',
      `In longer races (over 70 min) the results are about ${pct(fade).toFixed(1)}% slower than in shorter ones, compared with their usual level: pace is fading late on.`,
      ['A weekly long steady paddle (60–90 min, conversational pace)', 'Build up race distance with portages included', 'Practise eating and drinking on the move in long sessions'],
      1 + fade * 2, fade)
    if (ergo) ideas[ideas.length - 1].how.push(`When the river's high or it's dark: a long steady ergo session in the club gym (${GYM})`)
  } else if (fade != null && fade < -0.3) {
    add('endurance', 'Strength over distance: use it', `Longer races go about ${pct(-fade).toFixed(1)}% better than shorter ones: endurance is a strength.`,
      ['Pick longer races where this counts most', 'Add short, sharp starts to stop losing time early on'], 0.8, 0)
  }

  if (k1Gap != null && k1Gap > 0.3) {
    add('k1', canoe ? 'C1 skills: steering on the paddle, switching and balance' : 'K1 skills: balance, steering and confidence',
      `${W.one} results are about ${pct(k1Gap).toFixed(1)}% slower than ${W.two} ones: the engine is there, the ${W.one} handling is costing time.`,
      canoe
        ? ['Steering with as little correction as possible: a short J or pry at the exit, not a stern rudder', 'Sit-and-switch drills: change sides every 6–10 strokes without losing the run of the boat', 'Balance work kneeling and sitting, and paddling a straight line on your weaker side']
        : ['Balance drills (paddling with eyes closed, feet together, one-handed bracing)', 'Steering with the rudder on tight bends at speed', 'Time in a slightly less stable boat once comfortable'],
      1.2 + k1Gap * 2, k1Gap)
  } else if (k1Gap != null && k1Gap < -0.3) {
    add('k2', canoe ? 'C2 crew work: switching together and steering' : 'K2 crew work: timing and wash',
      `${W.two} results are about ${pct(-k1Gap).toFixed(1)}% behind ${W.one} ones: a ${W.two} should be worth more than that.`,
      canoe
        ? ['"Hut" calls: both switch sides on the same stroke, with no lost stroke', 'Stern paddler steering with small corrections so the bow can just drive', 'Matching the catch and stroke length; settle on a regular partner and seat']
        : ['Crew timing drills: matching catch and exit, calling changes', 'Settle on a regular partner and seat', 'Practise wash hanging and changing position together'],
      1.2 + -k1Gap * 2, -k1Gap)
  } else if (!stats.k1Races && stats.k2Races) {
    add('k1', `Try some ${W.one} racing`, `All the results are in ${W.two}s: a few ${W.one} races give a ${W.one} division and show what to work on alone.`,
      [`Enter a ${W.one} at a local Hasler`, canoe ? 'C1 steering and sit-and-switch sessions on club nights' : 'K1 balance and steering sessions on club nights'], 0.9, 0)
  }

  if (spread != null && spread > 0.45) {
    add('consistency', 'Pacing and consistency',
      `Results vary a lot from race to race (about ±${(spread * GAP * 100).toFixed(1)}% around the trend): a steadier race is worth time on the bad days.`,
      ['Even-pace practice: hold a target split for every km', 'A race-day routine: warm-up, start plan, feeding plan', 'Note conditions and how each race felt, to spot what goes wrong'],
      1 + spread, spread / 2)
    if (ergo) ideas[ideas.length - 1].how.push(`Ergo pieces in the club gym (${GYM}) holding a set split: the screen shows straight away when the pace drifts`)
  }

  const months = stats.change != null ? stats.change : null
  if (veteran && months != null && Math.abs(months) < 0.15 && points.length >= 8) {
    // for a veteran, the same speed as a year ago is a good result
    add('technique', 'Holding speed: keep it that way',
      `About the same speed as a year ago (${pct(months).toFixed(1)}% ${months <= 0 ? 'quicker' : 'slower'}): for a veteran paddler, holding speed is a good result. Technique is where more can come from.`,
      canoe
        ? ['Single-blade technique: top-hand height, rotation, a vertical shaft', 'A 1-to-1 session with a canoe coach']
        : ['Ivan Lawler technique series on the Resources page: one body part at a time', 'Catch, rotation and leg drive drills'],
      1.1, 0.2)
  } else if (months != null && Math.abs(months) < 0.15 && points.length >= 8) {
    add('technique', 'Technique: a fresh look at the stroke',
      `Level over the last year is flat (${months <= 0 ? 'about ' + pct(months).toFixed(1) + '% quicker' : 'about ' + pct(months).toFixed(1) + '% slower'}): more of the same training is unlikely to move it; better technique often does.`,
      canoe
        ? ['Video the stroke: top hand over the water, a vertical shaft, the catch out in front', 'Rotation and drive drills, and a cleaner exit so less steering is needed', 'A 1-to-1 session with a canoe coach']
        : ['Video the stroke and compare with the Ivan Lawler technique series (Resources page)', 'Catch, rotation and leg drive drills, one at a time', 'A 1-to-1 technique session with a coach'],
      1.5, 0.3)
  } else if (months != null && months > 0.15) {
    add('technique', 'Get back to best form',
      junior
        ? `About ${pct(months).toFixed(1)}% slower than a year ago. Juniors often have a slower patch while they grow (a new body to steer), and it usually comes back; worth a chat about time on the water and anything else going on.`
        : `About ${pct(months).toFixed(1)}% slower than a year ago: worth finding out why (${veteran ? 'time off, injury, recovery between sessions, boat, fitness' : 'time off, injury, boat, fitness'}).`,
      junior
        ? ['A chat about time on the water, school and anything getting in the way', 'Back to basics on technique after a growth spurt: balance and the catch', 'Keep it fun: games, K2s with friends, racing with no pressure']
        : ['A chat about training time and anything getting in the way', 'Rebuild with steady paddling before hard intervals', 'Technique check, in case habits have crept in'],
      (junior ? 1.5 : 2) + months, months)
  } else {
    add('technique', 'Technique: keep refining the stroke',
      months != null && months < 0 ? `Quicker by about ${pct(months).toFixed(1)}% over the last year: technique work keeps that going.` : 'Good technique is the cheapest speed there is.',
      canoe
        ? ['Single-blade technique: top-hand height, rotation and a vertical shaft', 'Steering strokes kept short so they cost little speed', 'Video now and then to check']
        : ['Ivan Lawler technique series on the Resources page: one body part at a time', 'Catch, rotation and leg drive drills', 'Video now and then to check'],
      1, 0.2)
  }

  if (racesLastYear < 4) {
    add('racing', 'Race more often', `${racesLastYear || 'No'} race${racesLastYear === 1 ? '' : 's'} in the last 12 months: racing is where race skills and fitness come together.`,
      ['The local Hasler series and winter series', `A ${W.two} with a club mate to share the travel`], 1.1, 0)
  }

  add('racecraft', 'Race craft: starts, wash hanging, turns and portages',
    placed.length ? `${podiums} podium${podiums === 1 ? '' : 's'} in ${placed.length} placed race${placed.length === 1 ? '' : 's'} over the last two years: race skills turn the same speed into better places.` : 'Race skills turn the same speed into better places.',
    canoe
      ? ['Fast starts and getting onto a wash early, switching to the side that holds it', 'Buoy turns: a cross-bow draw or a planned switch before the turn', 'Quick, tidy portages: getting in and out of a canoe without losing time']
      : ['Practise fast starts and getting onto a wash early', 'Wash hanging on both sides, and changing washes', 'Turns around buoys and quick, tidy portages'],
    0.9, 0.15)

  if (junior) {
    add('junior', 'Junior: skills and range first',
      'Juniors improve fast, and not always smoothly: lots of paddling in different boats builds the skills that later speed comes from.',
      ['Plenty of varied paddling: K1, K2, different boats, games and skills sessions', 'Race often: local Haslers and the winter series', 'Strength from bodyweight and core work; heavy weights can wait until they’ve finished growing'],
      1.3, 0.2)
  } else if (veteran) {
    add('recovery', 'Recovery and staying injury-free',
      'For a veteran paddler, recovery between hard sessions and staying injury-free are where the gains come from.',
      ['Fewer, better hard sessions: one or two a week, with easy days between', 'Mobility and strength twice a week (hips, back, shoulders)', 'A longer warm-up before racing and hard sessions'],
      1.25, 0.15)
  } else {
    add('strength', 'Strength and conditioning', 'Off-water strength and mobility protect against injury and add power through the stroke.',
      canoe
        ? ['Twice-weekly core and pulling strength, both sides evenly (single-blade work is one-sided)', 'Hip, knee and shoulder mobility for kneeling and rotation', 'Winter circuits with the club']
        : ['Twice-weekly core and pulling strength', 'Hip and shoulder mobility', 'Winter circuits with the club'], 0.6, 0.15)
  }

  if (ergo) {
    add('ergo', 'Ergo training in the club gym',
      `The club gym's kayak ergos give measured, weatherproof training: once they’ve had the gym induction${junior ? ' (and with a coach there for juniors)' : ''}, sessions can fit round the river, the dark and the weather.`,
      [
        'Book the gym induction with a coach first: setting up and using the ergos safely',
        'Set the ergo up like the boat: seat height, footrest and paddle length',
        veteran
          ? 'Steady 30–45 min sessions, plus one interval session a week at most: easy on the joints between hard days'
          : junior
            ? 'Short, varied pieces and technique work rather than long grinds'
            : 'Steady 30–60 min sessions for fitness, and race-pace intervals with a split or power target',
        'An ergo test (e.g. 1000 m or 2 km) every 6–8 weeks to see fitness change between races'
      ],
      0.95, 0.15)
  }

  ideas.sort((a, b) => b.weight - a.weight)
  return { all, points, trend, stats, ideas, scale }
}
