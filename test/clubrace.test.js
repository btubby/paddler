import test from 'node:test'
import assert from 'node:assert/strict'
import { clubRaces, clubRace, formAgainst } from '../netlify/functions/lib/clubrace.js'
import { clubRaceFor, HIST_VERSION } from '../netlify/functions/crews.js'

// made-up paddlers and races
const row = (date, rating, extra = {}) => ({ date, race: 'Race ' + date, rid: `/results/races/2026/r-${date}|k1`, url: `/results/races/2026/r-${date}`, tab: 'k1', event: 'Division 6 K1', boat: 'kayak', k2: false, div: '6', pos: 5, of: 20, t: 3600, rating, ...extra })
const priors = [['2025-03-01', -0.02], ['2025-05-01', -0.03], ['2025-07-01', -0.01], ['2025-09-01', -0.02]]
const people = {
  'ann example|BSF': { name: 'Ann Example', kayak: { history: [...priors.map(([d, r]) => row(d, r)), row('2026-10-04', -0.05, { pos: 1, of: 18 })] } },
  'bob sample|BSF': { name: 'Bob Sample', kayak: { history: [row('2026-10-04', 0.01, { pos: 12, of: 18, pd: 'P' })] } },
  'cat test|BSF': { name: 'Cat Test', kayak: { history: [row('2026-09-20', 0)] } },
  'dan one|BSF': { name: 'Dan One', kayak: { history: [row('2026-10-04', 0, { tab: 'k2', event: 'Division 6 K2', k2: true, partner: 'Eve Two', pos: 2, of: 9, rid: '/results/races/2026/r-2026-10-04|k2' })] } },
  'eve two|BSF': { name: 'Eve Two', kayak: { history: [row('2026-10-04', 0, { tab: 'k2', event: 'Division 6 K2', k2: true, partner: 'Dan One', pos: 2, of: 9, rid: '/results/races/2026/r-2026-10-04|k2' })] } }
}

test('club race: the newest race the club went to, and the recent ones', () => {
  const r = clubRaces(people)
  assert.equal(r[0].date, '2026-10-04')
  assert.equal(r[0].n, 4)
  assert.equal(r[1].date, '2026-09-20')
})

test('club race: against their form needs earlier results, and says quicker as a minus', () => {
  const ann = people['ann example|BSF'].kayak.history
  assert.equal(formAgainst(ann, ann[4]), -3) // (-0.05 - -0.02) * 100
  const bob = people['bob sample|BSF'].kayak.history
  assert.equal(formAgainst(bob, bob[0]), null)
})

test('club race: totals, a K2 of two club paddlers is one crew, wins and podiums', () => {
  const r = clubRace(people)
  assert.equal(r.race.date, '2026-10-04')
  assert.equal(r.totals.paddlers, 4)
  assert.equal(r.totals.crews, 3)
  assert.equal(r.totals.wins, 1)
  assert.equal(r.totals.podiums, 2)
  assert.equal(r.totals.promotions, 1)
  assert.equal(r.totals.quicker, 1)
  assert.deepEqual(r.totals.best.map(b => b.name), ['Ann Example'])
  const k2 = r.crews.find(c => c.k2)
  assert.equal(k2.members.length, 2)
  assert.equal(k2.partner, '')
  assert.equal(clubRace(people, '/results/races/2026/r-2026-09-20').crews.length, 1)
  assert.equal(clubRace({}).race, null)
})

test('club race: pending until the ratings exist for this version', async () => {
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, v) } }
  assert.deepEqual(await clubRaceFor(st, 'BSF'), { pending: true })
  files.set('hist5-BSF', { v: HIST_VERSION, fetchedAt: 'x', people })
  const r = await clubRaceFor(st, 'BSF')
  assert.equal(r.club, 'BSF')
  assert.equal(r.totals.crews, 3)
})
