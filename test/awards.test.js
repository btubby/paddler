// The star awards record (the assessment book): validation, the "highest award" view, and the
// coaches-only API. Made-up paddlers and assessors only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanRecord, isDuplicate, sortRecords, highest, toCsv } from '../netlify/functions/lib/awards.js'
import { coachCookie, coordinatorCookie, TEST_SECRET } from './helpers/session.js'

process.env.SESSION_SECRET = TEST_SECRET
const NOW = Date.parse('2026-11-20T12:00:00Z')

test('a record is cleaned and checked', () => {
  const ok = cleanRecord({ date: '2026-11-18', paddler: '  Pat   Example ', assessor: 'Sam Coach', award: '2', memberId: '123' }, NOW)
  assert.deepEqual(ok, { date: '2026-11-18', paddler: 'Pat Example', assessor: 'Sam Coach', award: 2, memberId: '123' })
  assert.equal(cleanRecord({ date: '2026-11-18', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1, memberId: 'x1' }, NOW).memberId, '', 'only a numeric member id is kept')
  for (const [bad, why] of [
    [{ date: '', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1 }, /date/],
    [{ date: '2026-02-30', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1 }, /date/],
    [{ date: '2030-01-01', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1 }, /future/],
    [{ date: '1990-01-01', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1 }, /long ago/],
    [{ date: '2026-11-18', paddler: 'P', assessor: 'Sam Coach', award: 1 }, /name/],
    [{ date: '2026-11-18', paddler: 'Pat Example', assessor: '', award: 1 }, /assessor/],
    [{ date: '2026-11-18', paddler: 'Pat Example', assessor: 'Sam Coach', award: 4 }, /star/]
  ]) assert.match(cleanRecord(bad, NOW).error, why)
  assert.equal(cleanRecord({ date: '2026-11-18', paddler: '<b>Pat</b> Example', assessor: 'Sam Coach', award: 1 }, NOW).paddler, 'b Pat /b Example', 'markup characters are removed')
})

test('duplicates, ordering, highest award per paddler, and the spreadsheet', () => {
  const r = (id, date, paddler, award, memberId = '') => ({ id, date, paddler, assessor: 'Sam Coach', award, memberId, at: date })
  const list = [r('a', '2026-03-01', 'Pat Example', 1, '7'), r('b', '2026-09-01', 'Pat Example', 2, '7'), r('c', '2026-05-01', 'Robin Test', 1), r('d', '2026-06-01', 'robin test', 1)]
  assert.equal(isDuplicate(list, { date: '2026-03-01', paddler: 'Pat Example', award: 1, memberId: '7' }), true)
  assert.equal(isDuplicate(list, { date: '2026-03-01', paddler: 'Pat Example', award: 1, memberId: '7' }, 'a'), false, 'not a duplicate of itself (editing)')
  assert.equal(isDuplicate(list, { date: '2026-03-01', paddler: 'Pat Example', award: 2, memberId: '7' }), false)
  assert.deepEqual(sortRecords(list).map(x => x.id), ['b', 'd', 'c', 'a'])
  const best = highest(list)
  assert.deepEqual(best.map(b => [b.paddler, b.award, b.count]), [['Pat Example', 2, 2], ['robin test', 1, 2]])
  const csv = toCsv([r('x', '2026-03-01', '=cmd|calc', 1), r('y', '2026-03-02', 'Lee, Test', 3)])
  assert.match(csv, /^Date of assessment,Paddler,Assessor,Award\n/)
  assert.match(csv, /'=cmd\|calc/, 'a name that looks like a formula is defused')
  assert.match(csv, /"Lee, Test"/)
})

test('/api/awards: coaches only; add, edit, remove, no duplicates', async () => {
  const mem = new Map()
  const { default: handler, _useStore } = await import('../netlify/functions/awards.js')
  _useStore({ // (like the real store: get() gives text unless asked for json)
    get: async (k, o) => (mem.has(k) ? (o?.type === 'json' ? JSON.parse(mem.get(k)) : mem.get(k)) : null),
    setJSON: async (k, v) => { mem.set(k, JSON.stringify(v)) }
  })
  const ask = (method, body, cookie = coachCookie(), q = '') => handler(new Request('https://x/api/awards' + q, {
    method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined
  }))
  // not for the public, or the race coordinator
  assert.equal((await ask('GET', null, '')).status, 401)
  assert.equal((await ask('GET', null, coordinatorCookie())).status, 401)
  assert.equal((await ask('POST', { date: '2026-11-01', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1 }, '')).status, 401)
  // add
  const first = { date: '2026-11-01', paddler: 'Pat Example', assessor: 'Sam Coach', award: 1, memberId: '7' }
  let res = await ask('POST', first)
  assert.equal(res.status, 200)
  let { records } = await res.json()
  assert.equal(records.length, 1)
  assert.equal(records[0].addedBy, 'test.person@example.com')
  assert.equal((await ask('POST', first)).status, 409, 'the same assessment twice')
  assert.equal((await ask('POST', { ...first, award: 9 })).status, 400)
  res = await ask('POST', { ...first, date: '2026-11-10', award: 2 })
  records = (await res.json()).records
  assert.deepEqual(records.map(r => r.award), [2, 1], 'newest first')
  // edit
  const id = records[1].id
  res = await ask('PUT', { ...first, id, assessor: 'Alex Coach' })
  assert.equal((await res.json()).records.find(r => r.id === id).assessor, 'Alex Coach')
  assert.equal((await ask('PUT', { ...first, id: 'nope' })).status, 404)
  // remove
  res = await ask('DELETE', null, coachCookie(), '?id=' + id)
  assert.equal((await res.json()).records.length, 1)
  assert.equal((await ask('DELETE', null, coachCookie(), '?id=' + id)).status, 404)
  assert.equal((await (await ask('GET')).json()).records.length, 1)
})

test('recentAwardFor: only awards from the last week, best first, level and date only', async () => {
  const { recentAwardFor } = await import('../netlify/functions/lib/awards.js')
  const now = Date.parse('2026-11-20T12:00:00Z')
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  const recs = [
    { paddler: 'Test Person', award: 1, date: '2026-11-15', assessor: 'Someone' },
    { paddler: 'test person', award: 2, date: '2026-11-18', assessor: 'Someone' },
    { paddler: 'Test Person', award: 3, date: '2026-10-01' },
    { paddler: 'Other Person', award: 3, date: '2026-11-19' }
  ]
  assert.deepEqual(recentAwardFor(recs, 'Test Person', same, now), { award: 2, date: '2026-11-18' })
  assert.equal(recentAwardFor(recs, 'Nobody', same, now), null)
  assert.equal(recentAwardFor([{ paddler: 'Test Person', award: 1, date: '2026-11-10' }], 'Test Person', same, now), null)
})

test('starLevelFor: the highest award, 0 for none', async () => {
  const { starLevelFor } = await import('../netlify/functions/lib/awards.js')
  const same = (a, b) => a.toLowerCase() === b.toLowerCase()
  const recs = [{ paddler: 'Test Person', award: 1 }, { paddler: 'test person', award: 2 }, { paddler: 'Other', award: 3 }]
  assert.equal(starLevelFor(recs, 'Test Person', same), 2)
  assert.equal(starLevelFor(recs, 'Nobody', same), 0)
  assert.equal(starLevelFor(undefined, 'Test Person', same), 0)
})
