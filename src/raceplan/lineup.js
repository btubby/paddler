// The race line-up the coordinator edits on the race planner page: which paddlers are in
// which boat. Pure functions (used by the page and the tests).
//
// A line-up: { boats: [{ id, kind: 'K1' | 'K2', seats: [id] | [id|null, id|null] }], out: [id],
//   (kind: K1 and K2 kayaks, C1 and C2 canoes; canoes aren't rated)
//   suggested: [crewKey] (the crews the planner suggested when the line-up was started from it) }
// Everyone else is "not yet in a boat" (the squad). Seats hold member ids.
import { level, beatsK1, beatsK2, crewDivision, familiarity, learningPair, steadyCut, THIN } from '../../netlify/functions/lib/crewplan.js'

export const SEATS = { K1: 1, K2: 2, C1: 1, C2: 2 }
export const KINDS = Object.keys(SEATS)
export const isCanoe = kind => kind === 'C1' || kind === 'C2'
export const doubleOf = kind => (isCanoe(kind) ? 'C2' : 'K2') // a single's two-seater
export const singleOf = kind => (isCanoe(kind) ? 'C1' : 'K1')
export const SLACK = 0.02 // as in the planner: a K2 within 2% of someone's K1 counts as just as good
let next = 1
export const newBoatId = () => 'b' + Date.now().toString(36) + (next++).toString(36)

// the planner's suggestion (planCrews entries) as a line-up
export function fromSuggestion(entries, out = []) {
  const boats = entries.map(e => ({ id: newBoatId(), kind: e.kind, seats: e.members.map(m => m.id) }))
  return { boats, out: [...out], suggested: boats.map(crewKey) }
}

// where someone is: { boat, seat } | 'out' | 'squad'
export function whereIs(lineup, id) {
  for (const b of lineup.boats) {
    const s = b.seats.indexOf(id)
    if (s >= 0) return { boat: b.id, seat: s }
  }
  return lineup.out.includes(id) ? 'out' : 'squad'
}

const clone = l => ({ boats: l.boats.map(b => ({ ...b, seats: [...b.seats] })), out: [...l.out], suggested: [...(l.suggested || [])] })

// Move a paddler (id) to a target, returning the new line-up:
//   { type: 'squad' } | { type: 'out' }             take them out of any boat
//   { type: 'seat', boat, seat }                     into that seat; whoever was there swaps
//                                                    to where the moved paddler came from
//   { type: 'boat', boat }                           onto a boat: a K1 becomes a K2 with them
//                                                    in the back; a K2 with a free seat fills it
//   { type: 'new', kind: 'K1' | 'K2' | 'C1' | 'C2' }             a new boat of their own
// Boats left with nobody in them go; a K2 left with one paddler keeps its empty seat (to
// be filled, or turned into a K1).
export function move(lineup, id, target) {
  const l = clone(lineup)
  const from = whereIs(l, id)
  if (from && typeof from === 'object') l.boats.find(b => b.id === from.boat).seats[from.seat] = null
  if (from === 'out') l.out = l.out.filter(x => x !== id)
  const putBack = other => { // the swapped-out paddler goes where the moved one came from
    if (from && typeof from === 'object') l.boats.find(b => b.id === from.boat).seats[from.seat] = other
    else if (from === 'out') l.out.push(other)
  }
  switch (target.type) {
    case 'out':
      l.out.push(id)
      break
    case 'seat': {
      const b = l.boats.find(x => x.id === target.boat)
      if (!b) return lineup
      const there = b.seats[target.seat]
      b.seats[target.seat] = id
      if (there != null && there !== id) putBack(there)
      break
    }
    case 'boat': {
      const b = l.boats.find(x => x.id === target.boat)
      if (!b) return lineup
      const free = b.seats.indexOf(null)
      if (free >= 0) b.seats[free] = id
      else if (SEATS[b.kind] === 1) { b.kind = doubleOf(b.kind); b.seats.push(id) }
      else return lineup // a full double: drop on a seat to swap
      break
    }
    case 'new':
      if (!SEATS[target.kind]) return lineup
      l.boats.push({ id: newBoatId(), kind: target.kind, seats: SEATS[target.kind] === 2 ? [id, null] : [id] })
      break
    default: // squad
      break
  }
  return tidy(l)
}

// a double with one paddler -> a single; a double -> two singles (K2 -> K1s, C2 -> C1s)
export function toK1(lineup, boatId) {
  const l = clone(lineup)
  const i = l.boats.findIndex(b => b.id === boatId)
  if (i < 0) return lineup
  const people = l.boats[i].seats.filter(x => x != null)
  l.boats.splice(i, 1, ...people.map(p => ({ id: newBoatId(), kind: singleOf(l.boats[i].kind), seats: [p] })))
  return tidy(l)
}
// everyone in that boat back to the squad
export function removeBoat(lineup, boatId) {
  const l = clone(lineup)
  l.boats = l.boats.filter(b => b.id !== boatId)
  return l
}

function tidy(l) {
  l.boats = l.boats.filter(b => b.seats.some(x => x != null))
  for (const b of l.boats) if (SEATS[b.kind] === 1) b.seats = b.seats.filter(x => x != null).slice(0, 1)
  return l
}

// keep only people we know (members can leave), so an old saved plan still opens
export function clean(lineup, known) {
  const ok = id => known.has(id)
  const l = {
    boats: (lineup?.boats || []).map(b => ({
      id: String(b.id || newBoatId()),
      kind: SEATS[b.kind] ? b.kind : 'K1',
      seats: (b.seats || []).map(x => (x != null && ok(String(x)) ? String(x) : null)).slice(0, SEATS[b.kind] || 1)
    })),
    out: [...new Set((lineup?.out || []).map(String).filter(ok))],
    suggested: (lineup?.suggested || []).map(String)
  }
  for (const b of l.boats) while (SEATS[b.kind] === 2 && b.seats.length < 2) b.seats.push(null)
  // nobody in two places
  const seen = new Set()
  for (const b of l.boats) b.seats = b.seats.map(x => (x == null || seen.has(x) ? null : (seen.add(x), x)))
  l.out = l.out.filter(x => !seen.has(x))
  return tidy(l)
}

// What a boat is worth: its division, the share of that division's field it would beat,
// and anything to flag. people: id -> { name, div, a, n, nK1 } (no a: no race results)
export function assess(boat, people, fields, { familiar = false, learning = false, cut = 0.05 } = {}) {
  const fam = (m, kind) => (familiar ? familiarity(m, kind) : 1)
  const ms = boat.seats.map(id => (id == null ? null : people.get(id) || null))
  const rated = p => p && p.a != null && /^[1-9]$/.test(String(p.div)) && fields?.k1med?.[+p.div] != null
  const notes = []
  if (isCanoe(boat.kind)) { // no canoe ratings: nothing to compare a canoe crew with
    if (SEATS[boat.kind] === 2 && ms.some(m => !m)) notes.push({ kind: 'warn', text: 'Needs a partner' })
    notes.push({ kind: 'info', text: 'Canoe: not rated, so the planner can’t say how it would do' })
    return { D: null, beats: null, canoe: true, notes }
  }
  if (boat.kind === 'K2' && ms.some(m => !m)) { // one seat filled: shown with their own division
    const p = ms.find(Boolean)
    return { D: p && /^[1-9]$/.test(String(p.div)) ? +p.div : null, beats: null, notes: [{ kind: 'warn', text: 'Needs a partner' }] }
  }
  if (!ms.every(rated)) {
    const p = ms.find(m => m && /^[1-9]$/.test(String(m.div)))
    const D = boat.kind === 'K1' ? (p ? +p.div : null) : (ms.every(m => /^[1-9]$/.test(String(m?.div))) ? crewDivision(ms[0], ms[1]) : null)
    for (const m of ms) if (!rated(m)) notes.push({ kind: 'info', text: `${m.name}: no race results to go on` })
    return { D, beats: null, notes }
  }
  const lv = ms.map(m => level(m, fields))
  if (boat.kind === 'K1') {
    const m = ms[0]
    const beats = beatsK1(lv[0], +m.div, fields)
    if (m.n < THIN) notes.push({ kind: 'info', text: `Rough: only ${m.n} result${m.n === 1 ? '' : 's'} for ${m.name}` })
    else if (!m.nK1) notes.push({ kind: 'info', text: `Never raced a K1: ${m.name}'s K1 speed is worked out from K2s` })
    else if (m.nK1 < THIN && m.nK2 > 3 * m.nK1) notes.push({ kind: 'info', text: `Only ${m.nK1} K1 race${m.nK1 === 1 ? '' : 's'}: ${m.name}'s K1 speed is mostly worked out from K2s` })
    return { D: +m.div, beats, notes }
  }
  const D = crewDivision(ms[0], ms[1])
  const beats = beatsK2((lv[0] + lv[1]) / 2, D, fields)
  const lp = learning ? learningPair(ms[0], ms[1], fields, cut) : null
  if (lp) {
    // seats: [front, back]
    notes.push({ kind: 'learn', text: lp.learner === ms[1]
      ? `Learning crew: ${lp.learner.name} in the back, following ${lp.mentor.name}'s stroke`
      : `Learning crew: swap seats, so ${lp.learner.name} is in the back following ${lp.mentor.name}'s stroke` })
  }
  ms.forEach((m, i) => {
    const solo = beatsK1(lv[i], +m.div, fields)
    if (beats != null && solo != null && beats * fam(m, 'K2') < solo * fam(m, 'K1') - SLACK) {
      notes.push({ kind: lp ? 'info' : 'warn', text: `${m.name} would do better in a K1 (beats about ${pct(solo)} in div ${m.div})` })
    }
  })
  for (const m of ms) if (m.nK1 && !m.nK2) notes.push({ kind: 'info', text: `${m.name} has never raced a K2` })
  if (ms.some(m => m.n < THIN)) notes.push({ kind: 'info', text: 'Rough: one of them has only one or two results' })
  return { D, beats, notes }
}
export const pct = b => Math.round(b * 100) + '%'

// boats with what they're worth, by division (div 1 first), K2s before K1s, best first;
// boats whose division isn't known go last
export function ordered(lineup, people, fields, rules = [], { familiar = false, learning = false } = {}) {
  const cut = learning ? steadyCut([...people.values()]) : 0.05
  return lineup.boats
    .map(b => {
      const x = assess(b, people, fields, { familiar, learning, cut })
      // a crew a rule puts together: "would do better in a K1" is just for information
      const ruled = rules.some(r => r.kind === 'together' && b.seats.includes(r.a) && b.seats.includes(r.b))
      const notes = x.notes.map(n => (ruled && /would do better in a K1/.test(n.text) ? { ...n, kind: 'info' } : n))
      return { boat: b, ...x, notes: [...ruleNotes(b, lineup, rules, people), ...notes] }
    })
    .sort((x, y) => (x.canoe ? 98 : x.D ?? 99) - (y.canoe ? 98 : y.D ?? 99) || (x.boat.kind === y.boat.kind ? (y.beats ?? -1) - (x.beats ?? -1) : SEATS[y.boat.kind] - SEATS[x.boat.kind]))
}

// the same crew as the suggestion? (for marking what the coordinator changed)
export const crewKey = b => b.kind + ':' + b.seats.filter(x => x != null).slice().sort().join('+')

// The coordinator's rules: { kind: 'together' | 'apart', a, b } or { kind: 'K1' | 'K2', a }
export const RULE_KINDS = {
  together: 'must paddle with',
  apart: 'must not paddle with',
  K1: 'must race a K1',
  K2: 'must race a K2'
}
export function ruleText(r, people) {
  const name = id => people.get(id)?.name || 'someone no longer listed'
  return r.kind === 'K1' || r.kind === 'K2' ? `${name(r.a)} ${RULE_KINDS[r.kind]}` : `${name(r.a)} ${RULE_KINDS[r.kind]} ${name(r.b)}`
}
// a rule that's the same as (or the reverse of) one already there
export const sameRule = (x, y) => x.kind === y.kind && ((x.a === y.a && (x.b ?? null) === (y.b ?? null)) || (x.b != null && x.a === y.b && x.b === y.a))

// the rules this boat breaks
export function ruleNotes(boat, lineup, rules, people) {
  const notes = []
  const crew = boat.seats.filter(x => x != null)
  const where = id => lineup.boats.find(b => b.seats.includes(id))
  const name = id => people.get(id)?.name || 'someone'
  for (const r of rules) {
    const mine = crew.includes(r.a) ? r.a : r.b != null && crew.includes(r.b) ? r.b : null
    if (!mine) continue
    const other = mine === r.a ? r.b : r.a
    if (r.kind === 'together' && !crew.includes(other)) {
      const why = lineup.out.includes(other) ? ` (${name(other)} isn't racing)` : !where(other) ? ` (${name(other)} isn't in a boat)` : ''
      notes.push({ kind: 'warn', text: `Rule: ${name(mine)} must paddle with ${name(other)}${why}` })
    }
    if (r.kind === 'apart' && crew.includes(r.a) && crew.includes(r.b) && mine === r.a) notes.push({ kind: 'warn', text: `Rule: ${name(r.a)} must not paddle with ${name(r.b)}` })
    if (r.kind === 'K1' && mine === r.a && boat.kind === 'K2') notes.push({ kind: 'warn', text: `Rule: ${name(r.a)} must race a K1` })
    if (r.kind === 'K2' && mine === r.a && boat.kind === 'K1') notes.push({ kind: 'warn', text: `Rule: ${name(r.a)} must race a K2` })
  }
  return notes
}
