import test from 'node:test'
import assert from 'node:assert/strict'
import { analyse, partnersOf, crewForm, REGULAR_CREW, ladder, levelOf, GAP, describeLevel, fmtDuration, courseOf } from '../src/paddler/insights.js'

const K1MED = { 4: -0.12, 5: -0.06, 6: -0.002, 7: 0.056, 8: 0.114 } // 5.8% a division

test('levels: a typical div 5 result is 5.0, one division is 5.8%', () => {
  const lad = ladder(K1MED)
  assert.ok(Math.abs(levelOf(-0.06, lad) - 5) < 0.05)
  assert.ok(Math.abs(levelOf(-0.06 - GAP, lad) - 4) < 0.05)
  assert.equal(describeLevel(4.6), 'a strong div 5')
  assert.equal(describeLevel(5.1), 'a typical div 5')
  assert.equal(fmtDuration(125), '2m 05s')
})

test('an improving paddler: trend goes down the ladder, speed work shows the gap to the next division', () => {
  const lad = ladder(K1MED)
  const history = []
  for (let i = 0; i < 16; i++) {
    const level = 7 - i * 0.12 // getting quicker, about 0.6 of a division a year
    history.push({ date: new Date(Date.UTC(2024, 0, 5) + i * 45 * 864e5).toISOString().slice(0, 10), race: 'R' + i, k2: false, t: 3600, div: '6', rating: lad.alpha + level * GAP })
  }
  const r = analyse(history, K1MED, { now: Date.parse(history.at(-1).date) + 864e5, currentDiv: '6' })
  assert.ok(r.stats.change < -0.3, 'quicker than a year ago')
  assert.ok(r.stats.level < 5.6)
  const speed = r.ideas.find(i => i.kind === 'speed')
  assert.ok(speed)
  assert.match(speed.why, /div 5/)
  assert.ok(r.trend.length > 10)
})

test('fading in long races and slower K1s are picked up', () => {
  const lad = ladder(K1MED)
  const history = []
  for (let i = 0; i < 20; i++) {
    const long = i % 2 === 0
    const k2 = i % 4 === 1
    const level = 6 + (long ? 0.6 : 0) + (k2 ? -0.5 : 0)
    history.push({ date: new Date(Date.UTC(2025, 0, 1) + i * 20 * 864e5).toISOString().slice(0, 10), race: 'R' + i, k2, t: long ? 80 * 60 : 40 * 60, div: '6', rating: lad.alpha + level * GAP })
  }
  const r = analyse(history, K1MED, { now: Date.UTC(2026, 1, 1), currentDiv: '6' })
  assert.ok(r.stats.fadePct > 2, 'slower in long races')
  assert.ok(r.ideas.some(i => i.kind === 'endurance'))
  assert.ok(r.stats.k1GapPct > 1, 'K1s slower than K2s')
  assert.ok(r.ideas.some(i => i.kind === 'k1'))
})

test('course length from the division table: 7-9 short, 4-6 medium, 1-3 long, others none', () => {
  assert.equal(courseOf({ tab: 'div9' }), 'short')
  assert.equal(courseOf({ tab: 'div7_7' }), 'short')
  assert.equal(courseOf({ tab: 'div5_5' }), 'medium')
  assert.equal(courseOf({ tab: 'div4' }), 'medium')
  assert.equal(courseOf({ tab: 'div3' }), 'long')
  assert.equal(courseOf({ event: 'Div 2 K2' }), 'long')
  assert.equal(courseOf({ tab: 'k1-svet-m', event: 'K1 Svet M' }), null)
})

test('canoe results: C1 / C2 wording and canoe coaching ideas', () => {
  const lad = ladder(K1MED)
  const history = []
  for (let i = 0; i < 12; i++) {
    const k2 = i % 2 === 1
    history.push({ date: new Date(Date.UTC(2025, 0, 1) + i * 30 * 864e5).toISOString().slice(0, 10), race: 'R' + i, k2, t: 3000, div: '8', rating: lad.alpha + (8 + (k2 ? -0.6 : 0)) * GAP })
  }
  const r = analyse(history, K1MED, { now: Date.parse(history.at(-1).date) + 864e5, currentDiv: '8', boat: 'canoe' })
  const k1 = r.ideas.find(i => i.kind === 'k1')
  assert.match(k1.title, /C1/)
  assert.match(k1.why, /C1 results .* C2 ones/)
  assert.ok(k1.how.some(h => /switch/i.test(h)))
  assert.ok(!JSON.stringify(r.ideas).includes('K1') && !JSON.stringify(r.ideas).includes('K2'))
})

test('each race against their own form at the time', async () => {
  const { describeForm } = await import('../src/paddler/insights.js')
  const lad = ladder(K1MED)
  const history = []
  for (let i = 0; i < 10; i++) {
    const level = i === 5 ? 6.5 : 7.5 // one race a division quicker than usual
    history.push({ date: new Date(Date.UTC(2025, 0, 1) + i * 30 * 864e5).toISOString().slice(0, 10), race: 'R' + i, k2: false, t: 3600, div: '7', rating: lad.alpha + level * GAP })
  }
  const r = analyse(history, K1MED, { now: Date.UTC(2026, 0, 1) })
  const good = r.points[5]
  assert.ok(good.vsForm < -4 && good.vsForm > -7, String(good.vsForm))
  assert.match(describeForm(good.vsForm), /^A great race: about \d\.\d% quicker/)
  assert.ok(Math.abs(r.points[0].vsForm) < 1.5)
  assert.equal(describeForm(0.2), 'About their usual form at the time')
})

test('age groups change the coaching ideas: juniors skills first, veterans recovery', () => {
  const lad = ladder(K1MED)
  const history = Array.from({ length: 12 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 30 * 864e5).toISOString().slice(0, 10), race: 'R' + i, k2: false, t: 3600, div: '6', rating: lad.alpha + 6 * GAP }))
  const opts = group => ({ now: Date.parse(history.at(-1).date) + 864e5, currentDiv: '6', group })
  const junior = analyse(history, K1MED, opts('junior'))
  assert.ok(junior.ideas.some(i => i.kind === 'junior'))
  assert.ok(!junior.ideas.some(i => i.kind === 'strength'))
  const vet = analyse(history, K1MED, opts('veteran'))
  assert.ok(vet.ideas.some(i => i.kind === 'recovery'))
  assert.ok(vet.ideas.some(i => /Holding speed/.test(i.title)))
  assert.ok(analyse(history, K1MED, opts('')).ideas.some(i => i.kind === 'strength'))
})

test('promotions are picked out from the P/D column', async () => {
  const { promotedTo } = await import('../src/paddler/insights.js')
  assert.equal(promotedTo({ pd: 'P3' }), '3')
  assert.equal(promotedTo({ pd: 'p-gsb' }), 'GSB')
  assert.equal(promotedTo({ pd: 'D?' }), null)
  assert.equal(promotedTo({}), null)
})

test('a worked-out promotion goes on the win that earned it, not a later race still listing the old division', async () => {
  const { markPromotions } = await import('../src/paddler/insights.js')
  // Ben Tubby, July 2024: won div 4 at South Lakes (no P/D shown), the Nationals K2 a week
  // later still listed him as div 4, then his next K1 was in div 3
  const rows = markPromotions([
    { date: '2024-06-09', tab: 'div4', k2: false, div: '4', pos: 3 },
    { date: '2024-07-07', tab: 'div4', k2: false, div: '4', pos: 1 },
    { date: '2024-07-13', tab: 'div4', k2: true, div: '4', pos: 9 },
    { date: '2024-09-01', tab: 'div3', k2: false, div: '3', pos: 5 }
  ])
  assert.deepEqual(rows[1].promo, { to: '3', from: '4', inferred: true })
  assert.equal(rows.filter(r => r.promo).length, 1)
})

test('promotions on older results (no P/D column) are worked out from the K1 divisions raced', async () => {
  const { markPromotions } = await import('../src/paddler/insights.js')
  // Ben Tubby, 2022-23: div 8 K1s, then div 7, then K2s, then a div 4 K1 after a P4 in a K2
  const rows = markPromotions([
    { date: '2022-05-01', tab: 'div8', k2: false, div: '' },
    { date: '2022-05-22', tab: 'div8', k2: false, div: '' }, // won: promoted to div 7
    { date: '2022-07-10', tab: 'div7', k2: false, div: '' },
    { date: '2023-04-30', tab: 'div5_5', k2: true, div: '6', pd: 'P4' }, // told: P4
    { date: '2023-05-14', tab: 'div4', k2: false, div: '4' }
  ])
  assert.deepEqual(rows[1].promo, { to: '7', from: '8', inferred: true })
  // the K2 in April 2023 lists him as div 6: so he'd gone up again since his div 7 race
  assert.deepEqual(rows[2].promo, { to: '6', from: '7', inferred: true })
  assert.equal(rows[3].promo.to, '4')
  assert.ok(!rows[3].promo.inferred)
  assert.equal(rows[4].promo, undefined) // no double count after the P4
  assert.equal(rows.filter(r => r.promo).length, 3)
})

test('kayak coaching includes ergo training in the club gym (after the induction); canoe coaching doesn\'t', async () => {
  const { analyse } = await import('../src/paddler/insights.js')
  const k1med = { 3: -0.17, 4: -0.12, 5: -0.06, 6: -0.01, 7: 0, 8: 0.04, 9: 0.1 }
  const now = Date.parse('2026-10-01')
  const history = Array.from({ length: 12 }, (_, i) => ({
    date: new Date(now - (i + 1) * 30 * 864e5).toISOString().slice(0, 10), rating: -0.05 + (i % 3) * 0.01, k2: i % 2 === 1, t: 4000, tab: 'div5', div: '5', pos: 4
  }))
  const kayak = analyse(history, k1med, { now, currentDiv: 5 })
  const gym = kayak.ideas.find(i => i.kind === 'ergo')
  assert.ok(gym && /induction/.test(gym.how.join(' ')))
  assert.ok(kayak.ideas.find(i => i.kind === 'speed').how.some(h => /ergo/.test(h)))
  // another club's paddler: no BSCC gym
  const away = analyse(history, k1med, { now, currentDiv: 5, gym: false })
  assert.ok(!away.ideas.some(i => i.kind === 'ergo' || i.how.some(h => /ergo/.test(h))))
  const canoe = analyse(history, k1med, { now, currentDiv: 5, boat: 'canoe' })
  assert.ok(!canoe.ideas.some(i => i.kind === 'ergo' || i.how.some(h => /ergo/.test(h))))
})

test("children's divisions: GSC, GSB, GSA below div 9, and promotion from GSB to GSA, then to div 9", async () => {
  const { analyse, markPromotions, divRank, divLabel, scaleFor } = await import('../src/paddler/insights.js')
  assert.equal(divRank('GSA'), 10)
  assert.equal(divRank('gs_divb'), 11)
  assert.equal(divLabel('GSA'), 'GSA')
  assert.equal(divLabel('5'), 'div 5')
  // Georgia Clements, 2026: GSB races, then P-GSA at the Hasler Finals
  const rows = markPromotions([
    { date: '2026-06-07', tab: 'gs_divb', k2: false, div: 'GSB', pos: 3 },
    { date: '2026-09-13', tab: 'gs_divb', k2: false, div: 'GSB', pos: 3 },
    { date: '2026-10-18', tab: 'gs_divb', k2: false, div: 'GSB', pos: 3, pd: 'P-GSA' }
  ])
  assert.equal(rows[2].promo.to, 'GSA')
  assert.equal(rows[2].promo.from, 'GSB')
  assert.equal(rows.filter(r => r.promo).length, 1)
  // the ladder: div 1-9 as usual, the GS divisions slower again (from their own K1 tables)
  const k1med = { 4: -0.1249, 5: -0.0608, 6: -0.0129, 7: -0.0029, 8: 0.0379, 9: 0.1038, 10: 0.17, 11: 0.24 }
  const sc = scaleFor(k1med)
  assert.ok(sc.rankLevel(10) > 9 && sc.rankLevel(11) > sc.rankLevel(10))
  assert.match(sc.describe(sc.rankLevel(10)), /typical GSA/)
  assert.match(sc.describe(7), /div 7/)
  // her page: in GSA now, and next is div 9 (not div 8)
  const history = rows.map(r => ({ ...r, race: 'Race', t: 1300, rating: 0.2 }))
  const res = analyse(history, k1med, { currentDiv: 'GSA', group: 'junior', now: Date.parse('2026-10-22') })
  assert.equal(res.stats.div, 10)
  assert.equal(res.stats.nextLabel, 'div 9')
  assert.ok(res.stats.toNextPct > 0)
  assert.match(res.scale.describe(res.stats.level), /GS[AB]/)
})

test('K2 partners: races together per partner, most first; K1s and no-partner rows ignored', () => {
  const rows = [
    { date: '2024-03-01', k2: true, partner: 'Sam Lee', pos: 1, of: 8 },
    { date: '2024-04-01', k2: true, partner: 'sam  lee', pos: 5, of: 8 },
    { date: '2025-01-10', k2: true, partner: 'Sam Lee', pos: 3, of: 8 },
    { date: '2024-06-01', k2: true, partner: 'Jo Ng', pos: 2, of: 6 },
    { date: '2024-07-01', k2: false, partner: undefined, pos: 1, of: 6 },
    { date: '2024-08-01', k2: true, partner: undefined }
  ]
  const p = partnersOf(rows)
  assert.equal(p.length, 2)
  assert.equal(p[0].name, 'Sam Lee')
  assert.equal(p[0].races, 3)
  assert.equal(p[0].first, '2024-03-01')
  assert.equal(p[0].last, '2025-01-10')
  assert.equal(p[0].wins, 1)
  assert.equal(p[0].podiums, 2)
  assert.equal(p[1].name, 'Jo Ng')
  assert.equal(p[1].races, 1)
  assert.deepEqual(partnersOf([]), [])
})

test('a regular crew: average against their form, best and worst, and whether it is getting better', () => {
  assert.equal(REGULAR_CREW, 4)
  const rows = [3.0, 1.0, -1.0, -3.0].map((v, i) => ({ date: `2025-0${i + 1}-01`, k2: true, partner: 'Sam Lee', race: 'R' + i, vsForm: v }))
  rows.push({ date: '2025-06-01', k2: true, partner: 'Jo Ng', vsForm: 5 })
  const p = partnersOf(rows)
  assert.equal(p[0].name, 'Sam Lee')
  assert.equal(p[0].avg, 0) // (3+1-1-3)/4
  assert.equal(p[0].best.v, -3)
  assert.equal(p[0].worst.v, 3)
  assert.equal(p[0].change, -4) // (-1-3)/2 - (3+1)/2: getting quicker
  assert.equal(p[0].forms.length, 4)
  assert.equal(p[1].avg, null) // one race: nothing to say
  assert.equal(crewForm([{ date: '2025-01-01', v: 1 }, { date: '2025-02-01', v: 2 }]).avg, null)
})
