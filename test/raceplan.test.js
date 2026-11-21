import { coachCookie, coordinatorCookie, TEST_SECRET } from './helpers/session.js'
import test from 'node:test'
process.env.SESSION_SECRET = TEST_SECRET
import assert from 'node:assert/strict'
import { fromSuggestion, move, toK1, clean, ordered, whereIs, assess, crewKey } from '../src/raceplan/lineup.js'

// fields as /api/crews gives them: a division is 5.8% (0.058) apart
const k1med = { 5: -0.06, 6: -0.002, 7: 0.056, 8: 0.114 }
const dec = m => [-0.06, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.02, 0.03, 0.04, 0.06].map(x => +(m + x).toFixed(4))
const fields = { k1med, k1: Object.fromEntries(Object.entries(k1med).map(([d, m]) => [d, dec(m)])), k2: Object.fromEntries(Object.entries(k1med).map(([d, m]) => [d, dec(m - 0.07)])) }
const P = (id, name, div, a, n = 8) => [id, { id, name, div: String(div), a, n, nK1: 4, nK2: 4 }]
const people = new Map([P('1', 'Ann', 5, -0.06), P('2', 'Bob', 7, 0.056), P('3', 'Cat', 6, -0.002), P('4', 'Dan', 8, 0.114), [ '5', { id: '5', name: 'Eve', div: '', a: null, n: 0 } ]])

const base = () => fromSuggestion([
  { kind: 'K2', members: [{ id: '1' }, { id: '2' }] },
  { kind: 'K1', members: [{ id: '3' }] }
])

test('moving paddlers: into a seat swaps, onto a K1 makes a K2, new boats, out and back', () => {
  let l = base()
  const k2 = l.boats[0].id
  const k1 = l.boats[1].id
  // Dan (not in a boat) onto Bob's seat: Dan in, Bob back to the squad
  l = move(l, '4', { type: 'seat', boat: k2, seat: 1 })
  assert.deepEqual(l.boats.find(b => b.id === k2).seats, ['1', '4'])
  assert.equal(whereIs(l, '2'), 'squad')
  // Cat (K1) onto Ann's seat: they swap, Ann now in the K1
  l = move(l, '3', { type: 'seat', boat: k2, seat: 0 })
  assert.deepEqual(l.boats.find(b => b.id === k2).seats, ['3', '4'])
  assert.deepEqual(l.boats.find(b => b.id === k1).seats, ['1'])
  // Bob onto Ann's K1: it becomes a K2
  l = move(l, '2', { type: 'boat', boat: k1 })
  assert.equal(l.boats.find(b => b.id === k1).kind, 'K2')
  assert.deepEqual(l.boats.find(b => b.id === k1).seats, ['1', '2'])
  // Dan out: his K2 keeps an empty seat; then Cat to a new K1, and the empty boat goes
  l = move(l, '4', { type: 'out' })
  assert.deepEqual(l.out, ['4'])
  assert.deepEqual(l.boats.find(b => b.id === k2).seats, ['3', null])
  l = move(l, '3', { type: 'new', kind: 'K1' })
  assert.ok(!l.boats.some(b => b.id === k2))
  assert.equal(l.boats.length, 2)
  // back from "not racing"
  l = move(l, '4', { type: 'squad' })
  assert.deepEqual(l.out, [])
  // a K2 split into two K1s
  l = toK1(l, k1)
  assert.deepEqual(l.boats.map(b => b.kind).sort(), ['K1', 'K1', 'K1'])
})

test('a saved line-up is cleaned: unknown people dropped, nobody twice', () => {
  const l = clean({ boats: [{ id: 'x', kind: 'K2', seats: ['1', '99'] }, { id: 'y', kind: 'K1', seats: ['1'] }, { id: 'z', kind: 'K1', seats: ['99'] }], out: ['2', '1', '99'] }, new Set(['1', '2']))
  assert.deepEqual(l.boats, [{ id: 'x', kind: 'K2', seats: ['1', null] }])
  assert.deepEqual(base().suggested.sort(), ['K1:3', 'K2:1+2'])
  assert.deepEqual(l.out, ['2'])
})

test('boats ordered by division, K2s first; a K2 worse than a K1 is flagged', () => {
  const l = { boats: [
    { id: 'a', kind: 'K1', seats: ['4'] }, // div 8
    { id: 'b', kind: 'K2', seats: ['1', '4'] }, // div 5 + div 8 -> div 6; Ann would do better alone
    { id: 'c', kind: 'K1', seats: ['3'] }, // div 6
    { id: 'd', kind: 'K1', seats: ['5'] } // no results
  ], out: [] }
  const o = ordered(l, people, fields)
  assert.deepEqual(o.map(x => [x.boat.id, x.D]), [['b', 6], ['c', 6], ['a', 8], ['d', null]])
  assert.ok(o[0].notes.some(n => n.kind === 'warn' && /Ann would do better in a K1/.test(n.text)))
  assert.ok(o[3].notes.some(n => /no race results/.test(n.text)))
  assert.deepEqual(assess({ kind: 'K2', seats: ['2', null] }, people, fields).notes[0].text, 'Needs a partner')
  assert.equal(crewKey({ kind: 'K2', seats: ['4', '1'] }), crewKey({ kind: 'K2', seats: ['1', '4'] }))
})

test('rule warnings on the boats that break them', async () => {
  const { ruleNotes, ruleText } = await import('../src/raceplan/lineup.js')
  const l = { boats: [{ id: 'a', kind: 'K2', seats: ['1', '2'] }, { id: 'b', kind: 'K1', seats: ['3'] }], out: ['4'] }
  const rules = [{ kind: 'apart', a: '2', b: '1' }, { kind: 'together', a: '3', b: '4' }, { kind: 'K1', a: '1' }, { kind: 'K2', a: '3' }]
  const a = ruleNotes(l.boats[0], l, rules, people).map(n => n.text)
  const b = ruleNotes(l.boats[1], l, rules, people).map(n => n.text)
  assert.deepEqual(a, ['Rule: Bob must not paddle with Ann', 'Rule: Ann must race a K1'])
  assert.deepEqual(b, ["Rule: Cat must paddle with Dan (Dan isn't racing)", 'Rule: Cat must race a K2'])
  assert.equal(ruleText(rules[1], people), 'Cat must paddle with Dan')
})

test('/api/race-plan: the race coordinator only (not coaches); a stale save is refused', async () => {
  const { default: handler } = await import('../netlify/functions/race-plan.js')
  const cookie = coordinatorCookie()
  const coachOnly = coachCookie()
  const call = (method, body, withCookie = true) => handler(new Request('https://x/api/race-plan?club=BSF', {
    method, headers: { ...(withCookie ? { cookie } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }))
  assert.equal((await call('GET', null, false)).status, 401)
  // the coaches' password is a different role: no way in
  assert.equal((await handler(new Request('https://x/api/race-plan?club=BSF', { headers: { cookie: coachOnly } }))).status, 401)
  assert.deepEqual(await (await call('GET')).json(), { version: 0, plan: null, canEdit: true })
  const plan = { race: 'Chelmer Hasler', date: '2026-10-25', lineup: { boats: [{ id: 'b1', kind: 'K2', seats: ['kerry tubby', 'benjamin tubby'] }, { id: 'b2', kind: 'K1', seats: ['<script>'] }], out: ['zoe norford'], suggested: ['K2:benjamin tubby+kerry tubby', 'bad'] } }
  assert.equal((await call('PUT', { ...plan, base: 0 }, false)).status, 401)
  const saved = await (await call('PUT', { ...plan, base: 0 })).json()
  assert.equal(saved.version, 1)
  assert.deepEqual(saved.plan.lineup.boats[0].seats, ['kerry tubby', 'benjamin tubby'])
  assert.deepEqual(saved.plan.lineup.boats[1].seats, [null]) // only paddler keys are kept
  assert.deepEqual(saved.plan.lineup.suggested, ['K2:benjamin tubby+kerry tubby'])
  const stale = await call('PUT', { ...plan, base: 0 })
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).current.version, 1)
  const got = await (await call('GET')).json()
  assert.equal(got.plan.race, 'Chelmer Hasler')
  const withRules = await (await call('PUT', { ...plan, base: 1, familiar: false, rules: [{ kind: 'together', a: 'kerry tubby', b: 'benjamin tubby' }, { kind: 'K1', a: 'zoe norford', b: 'x' }, { kind: 'apart', a: 'kerry tubby', b: 'kerry tubby' }, { kind: 'bad', a: 'zoe norford' }] })).json()
  assert.deepEqual(withRules.plan.rules, [{ kind: 'together', a: 'kerry tubby', b: 'benjamin tubby' }, { kind: 'K1', a: 'zoe norford' }])
  assert.equal(withRules.plan.familiar, false)
})

test('canoes: new C1/C2 boats, a C1 becomes a C2, a C2 splits into C1s, and they are not rated', async () => {
  const L = await import('../src/raceplan/lineup.js')
  let l = { boats: [], out: [], suggested: [] }
  l = L.move(l, 'ann', { type: 'new', kind: 'C2' })
  assert.deepEqual(l.boats[0].seats, ['ann', null])
  l = L.move(l, 'bob', { type: 'boat', boat: l.boats[0].id })
  assert.deepEqual(l.boats[0].seats, ['ann', 'bob'])
  l = L.move(l, 'cat', { type: 'new', kind: 'C1' })
  l = L.move(l, 'dan', { type: 'boat', boat: l.boats[1].id })
  assert.equal(l.boats[1].kind, 'C2') // a C1 + a paddler = a C2, not a K2
  l = L.toK1(l, l.boats[0].id)
  assert.deepEqual(l.boats.slice(0, 2).map(b => b.kind), ['C1', 'C1'])
  assert.equal(L.move(l, 'eve', { type: 'new', kind: 'X9' }), l) // unknown kinds are ignored
  const people = new Map([['ann', { name: 'Ann', div: '3', a: 1, n: 9 }]])
  const x = L.assess({ id: 'z', kind: 'C1', seats: ['ann'] }, people, null)
  assert.equal(x.canoe, true)
  assert.equal(x.beats, null)
  const kept = L.clean({ boats: [{ id: 'q', kind: 'C2', seats: ['ann'] }] }, new Set(['ann']))
  assert.deepEqual(kept.boats[0].seats, ['ann', null])
  const { cleanPlan } = await import('../netlify/functions/race-plan.js')
  assert.equal(cleanPlan({ lineup: { boats: [{ id: 'q', kind: 'C2', seats: ['ann', 'bob'] }] } }).lineup.boats[0].kind, 'C2')
})
