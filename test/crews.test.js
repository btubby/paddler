import { coachCookie, coordinatorCookie, TEST_SECRET } from './helpers/session.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fitRatings } from '../netlify/functions/lib/crewfit.js'
import { planCrews, level, beatsK1, beatsK2, crewDivision } from '../netlify/functions/lib/crewplan.js'
import { parseResults } from '../netlify/functions/crews.js'
process.env.SESSION_SECRET = TEST_SECRET // (signs the test sessions, and the share links)

// A made-up season: paddlers with known speeds race K1 and K2 on a few courses
function season() {
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const speed = {} // log-time offset: lower is quicker
  const divOf = {}
  const names = []
  for (let d = 4; d <= 8; d++) {
    for (let k = 0; k < 8; k++) {
      const name = `Pad${'abcdefgh'[k]}${'vwxyz'[d - 4]} Test` // (names: letters only, as in the results)
      names.push(name)
      divOf[name] = d
      speed[name] = (d - 6) * 0.058 + (k - 3.5) * 0.008 // spread within each division
    }
  }
  const club = n => (n.startsWith('Pada') ? 'BSF' : 'XYZ')
  const races = []
  for (let r = 0; r < 8; r++) {
    const rows = []
    const course = 3000 + r * 200 // a different course length each race
    for (let d = 4; d <= 8; d++) {
      const inDiv = names.filter(n => divOf[n] === d)
      // half race K1, the rest pair up in K2s (who does which changes from race to race)
      const turn = r % 2 ? [...inDiv.slice(4), ...inDiv.slice(0, 4)] : inDiv
      for (const n of turn.slice(0, 4)) {
        rows.push({ tab: `div${d}`, names: [n], clubs: [club(n)], divs: [String(d)], pd: [], t: Math.round(course * Math.exp(speed[n] + (rnd() - 0.5) * 0.01)) })
      }
      const k2 = turn.slice(4)
      for (let j = 0; j < k2.length; j += 2) {
        const a = k2[(j + r) % k2.length]
        const b = k2[(j + r + 1) % k2.length]
        rows.push({ tab: `div${d}_${d}`, names: [a, b], clubs: [a, b].map(club), divs: [String(d), String(d)], pd: [], t: Math.round(course * Math.exp((speed[a] + speed[b]) / 2 - 0.07 + (rnd() - 0.5) * 0.01)) })
      }
    }
    races.push({ key: `r${r}`, name: `Race ${r}`, date: Date.UTC(2026, 3, 1 + r * 7), rows })
  }
  return { races, speed }
}

test('ratings put paddlers in their true order, with K2 crews about 7% quicker', () => {
  const { races, speed } = season()
  const fit = fitRatings(races, { now: Date.UTC(2026, 6, 1) })
  assert.ok(Math.abs(fit.K + 0.07) < 0.01, `K2 bonus ${fit.K}`)
  const byName = Object.fromEntries(fit.paddlers.map(p => [p.name, p]))
  // differences between paddlers match the speeds they were given
  const d = (a, b) => byName[a].a - byName[b].a
  assert.ok(Math.abs(d('Padav Test', 'Padaz Test') - (speed['Padav Test'] - speed['Padaz Test'])) < 0.01)
  assert.ok(Math.abs(d('Padex Test', 'Padhx Test') - (speed['Padex Test'] - speed['Padhx Test'])) < 0.01)
  assert.equal(byName['Padaw Test'].club, 'BSF')
  assert.equal(byName['Padaw Test'].div, '5')
  assert.ok(fit.fields.k1[6] && fit.fields.k2[6] && fit.fields.k1med[6] != null)
})

const FIELDS = (() => {
  const dec = m => [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map(k => +(m + k * 0.01).toFixed(3))
  const f = { k1med: {}, k1: {}, k2: {} }
  for (let d = 3; d <= 8; d++) { f.k1med[d] = (d - 4) * 0.058; f.k1[d] = dec(f.k1med[d]); f.k2[d] = dec(f.k1med[d] + 0.01) }
  return f
})()

test('a paddler with no one to pair with races K1', () => {
  const plan = planCrews([{ name: 'Solo Paddler', div: '5', a: 0.06, n: 4, nK1: 4 }], FIELDS)
  assert.equal(plan.entries.length, 1)
  assert.equal(plan.entries[0].kind, 'K1')
  assert.equal(plan.entries[0].D, 5)
})

test('nobody is put in a K2 that does worse for them than their own K1; crews race in (div A + div B) / 2', () => {
  const people = [
    { name: 'Flying Four', div: '4', a: -0.08, n: 5, nK1: 5 }, // wins div 4 outright in a K1
    { name: 'Slow Four', div: '4', a: 0.04, n: 5, nK1: 5 },
    { name: 'Good Seven', div: '7', a: 0.15, n: 5, nK1: 5 }
  ]
  assert.ok(beatsK1(level(people[0], FIELDS), 4, FIELDS) > 0.99)
  const plan = planCrews(people, FIELDS)
  for (const e of plan.entries) if (e.kind === 'K2') assert.equal(e.D, crewDivision(e.members[0], e.members[1]))
  // whatever Flying Four does, it is at least as good for them as winning a K1 race
  const mine = plan.entries.find(e => e.members.some(m => m.name === 'Flying Four'))
  assert.equal(mine.kind, 'K1')
  for (const e of plan.entries.filter(e => e.kind === 'K2')) {
    for (const m of e.members) assert.ok(e.beats >= beatsK1(level(m, FIELDS), +m.div, FIELDS) - 0.02)
  }
})

test('the planner finds the best line-up (checked against trying every one)', () => {
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let trial = 0; trial < 40; trial++) {
    const people = Array.from({ length: 6 }, (_, i) => {
      const div = 3 + Math.floor(rnd() * 6)
      return { name: `T${trial}-${i}`, div: String(div), a: FIELDS.k1med[div] + (rnd() - 0.5) * 0.1, n: 3, nK1: 2 }
    })
    const plan = planCrews(people, FIELDS)
    // brute force: every way of splitting six people into K1s and K2s
    const ps = people.map(p => ({ ...p, lvl: level(p, FIELDS) }))
    const k1 = p => { const b = beatsK1(p.lvl, +p.div, FIELDS); return b * b }
    const k2 = (p, q) => { const D = crewDivision(p, q); const b = beatsK2((p.lvl + q.lvl) / 2, D, FIELDS); const solo = r => beatsK1(r.lvl, +r.div, FIELDS); return b < solo(p) - 0.02 || b < solo(q) - 0.02 ? -Infinity : 2 * b * b }
    const best = rest => {
      if (!rest.length) return 0
      const [p, ...others] = rest
      let v = k1(p) + best(others)
      others.forEach((q, i) => { v = Math.max(v, k2(p, q) + best(others.filter((_, j) => j !== i))) })
      return v
    }
    assert.ok(plan.total >= best(ps) - 1e-9 - 0.02 * best(ps), `trial ${trial}: ${plan.total} vs best ${best(ps)}`)
  }
})

test('results pages: K1 and K2 rows, crew order kept, no-time rows dropped', () => {
  const html = `<div class="tab-pane" id="div6"><table>
    <tr><th>#</th><th>Name</th><th>Club</th><th>Class</th><th>Div</th><th>Time</th><th>Points</th><th>P/D</th></tr>
    <tr><td>1</td><td><div><span data-full-name="Ann Able">Ann Able</span></div></td><td><div>BSF</div></td><td><div>VFK</div></td><td>6</td><td>1:10:05</td><td>50</td><td>P5</td></tr>
    <tr><td></td><td><div><span data-full-name="Bob Bee">Bob Bee</span></div></td><td><div>CAM</div></td><td><div>VMK</div></td><td>6</td><td>rtd</td><td></td><td></td></tr>
  </table></div>
  <div class="tab-pane" id="div5_5"><table>
    <tr><th>#</th><th>Name</th><th>Club</th><th>Class</th><th>Div</th><th>Time</th><th>Points</th><th>P/D</th></tr>
    <tr><td>2</td><td><div><span data-full-name="Cat Cee">Cat Cee</span></div><div><span data-full-name="Dan Dee">Dan Dee</span></div></td><td><div>BSF</div><div>BSF</div></td><td><div>VFK</div><div>VMK</div></td><td>4<br>6</td><td>1:08:52</td><td>49<br>49</td><td><br>P5</td></tr>
  </table></div>`
  const rows = parseResults(html)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { tab: 'div6', pos: 1, names: ['Ann Able'], clubs: ['BSF'], cls: ['VFK'], divs: ['6'], pd: ['P5'], t: 4205 })
  assert.deepEqual(rows[1].names, ['Cat Cee', 'Dan Dee'])
  assert.deepEqual(rows[1].divs, ['4', '6'])
  assert.deepEqual(rows[1].pd, ['', 'P5'])
  assert.equal(rows[1].t, 4132)
})

test('/api/crews: coaches only, reads the race list and pages, returns the club\'s ratings', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const cookie = coachCookie()
  const day = d => new Date(Date.now() - d * 864e5).toUTCString().split(' ').slice(1, 4).join(' ') // "17 Oct 2026"
  const list = `<table><tr><td><a href="/results/races/${new Date().getUTCFullYear()}/one">One Hasler</a> ${day(40)}</td></tr>
    <tr><td><a href="/results/races/${new Date().getUTCFullYear()}/two">Two Hasler</a> ${day(30)}</td></tr>
    <tr><td><a href="/results/races/${new Date().getUTCFullYear()}/three">Three Hasler (yesterday)</a> ${day(1)}</td></tr></table>`
  const page = (a, b) => `<div class="tab-pane" id="div5"><table><tr><th>#</th><th>Name</th><th>Club</th><th>Class</th><th>Div</th><th>Time</th><th>P/D</th></tr>
    <tr><td>1</td><td><div><span data-full-name="Ann Able">Ann Able</span></div></td><td><div>BSF</div></td><td><div>VFK</div></td><td>5</td><td>${a}</td><td></td></tr>
    <tr><td>2</td><td><div><span data-full-name="Bob Bee">Bob Bee</span></div></td><td><div>CAM</div></td><td><div>VMK</div></td><td>5</td><td>${b}</td><td></td></tr></table></div>`
  const realFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const u = String(url)
    const html = u.includes('/results/races/') && u.endsWith('/one') ? page('1:00:00', '1:03:00')
      : u.endsWith('/two') ? page('1:10:00', '1:13:30')
      : u.endsWith('/three') ? page('1:05:00', '1:08:00')
      : u.includes('/results/races') ? list : ''
    return new Response(html, { status: 200 })
  }
  try {
    // the ratings: coaches and the race coordinator; the paddler lookup: anyone; share links: coaches only
    const coordinator = coordinatorCookie()
    assert.equal((await handler(new Request('https://x/api/crews?club=BSF'))).status, 401)
    // the paddler lookup has no password (before the ratings exist it just says so)
    const anonLookup = await handler(new Request('https://x/api/paddler?club=BSF&name=Ann%20Able'))
    assert.equal(anonLookup.status, 200)
    assert.equal((await anonLookup.json()).viewer, 'public')
    assert.equal((await handler(new Request('https://x/api/paddler-link?club=BSF&name=Ann%20Able', { headers: { cookie: coordinator } }))).status, 401)
    // like the page: call again while it says there's more (reading, then the ratings in a
    // call of their own)
    let res, body
    const calls = []
    do {
      res = await handler(new Request('https://x/api/crews?club=BSF', { headers: { cookie: coordinator } }))
      body = await res.json()
      calls.push(body.more ? 'more' : res.status)
    } while (body.more && calls.length < 5)
    // reading the races (the settled ones, and the recent one, results not final yet), then the ratings
    assert.deepEqual(calls, ['more', 200])
    assert.equal(res.status, 200, JSON.stringify(body))
    assert.equal(body.races, 3) // yesterday's race counts straight away
    // once worked out, asking again just gives the saved ratings
    assert.equal((await (await handler(new Request('https://x/api/crews?club=BSF', { headers: { cookie: coordinator } }))).json()).races, 3)
    assert.deepEqual(body.paddlers.map(p => p.name), ['Ann Able'])
    assert.equal(body.paddlers[0].div, '5')
    assert.ok(body.fields.k1med)
  } finally {
    globalThis.fetch = realFetch
  }
})

test('crew divisions: (A + B) / 2 rounded down, but a div 1-3 paddler never races below div 3', () => {
  const d = (a, b) => crewDivision({ div: String(a) }, { div: String(b) })
  assert.equal(d(8, 5), 6)
  assert.equal(d(4, 6), 5)
  assert.equal(d(2, 6), 3) // not 4: the div 2 paddler can't race div 4
  assert.equal(d(3, 9), 3)
  assert.equal(d(1, 2), 1)
  assert.equal(d(3, 4), 3)
  assert.equal(d(4, 9), 6)
  assert.equal(d(5, 9), 6) // not 7: div 5 races the medium course, and can't race down to the short one
  assert.equal(d(6, 9), 6)
  assert.equal(d(7, 9), 8)
})

test('planner rules: must paddle together, must not, must race K1 / K2; and the boats people know', () => {
  const P = (id, div, off, nK1 = 6, nK2 = 6) => ({ id, name: id, div: String(div), a: FIELDS.k1med[div] + off, n: 12, nK1, nK2 })
  const people = [P('ann', 5, -0.01), P('bob', 6, 0.01), P('cat', 6, -0.02), P('dan', 7, 0.0), P('eve', 7, 0.02), P('fay', 5, 0.0)]
  const crewOf = (plan, id) => plan.entries.find(e => e.members.some(m => m.id === id))
  const mates = (plan, id) => crewOf(plan, id).members.map(m => m.id).filter(x => x !== id)
  let plan = planCrews(people, FIELDS, { rules: [{ kind: 'together', a: 'ann', b: 'eve' }] })
  assert.deepEqual(mates(plan, 'ann'), ['eve'])
  assert.deepEqual(plan.unmet, [])
  plan = planCrews(people, FIELDS, { rules: [{ kind: 'K1', a: 'cat' }, { kind: 'K2', a: 'dan' }] })
  assert.equal(crewOf(plan, 'cat').kind, 'K1')
  assert.equal(crewOf(plan, 'dan').kind, 'K2')
  const free = planCrews(people, FIELDS)
  const k2 = free.entries.find(e => e.kind === 'K2')
  if (k2) {
    const [x, y] = k2.members.map(m => m.id)
    plan = planCrews(people, FIELDS, { rules: [{ kind: 'apart', a: y, b: x }] })
    assert.notDeepEqual(mates(plan, x), [y])
  }
  // someone who has only ever raced K2s, with "familiar" on, isn't put in a K1 if a K2 is close
  const k2only = [P('gus', 6, 0.0, 1, 40), P('hal', 6, 0.0, 1, 40)]
  assert.equal(planCrews(k2only, FIELDS, { familiar: true }).entries.length, 1)
  // a rule that can't be kept is reported
  assert.equal(planCrews([P('ivy', 5, 0)], FIELDS, { rules: [{ kind: 'K2', a: 'ivy' }] }).unmet.length, 1)
})

test('one paddler, however their first name is written in the results', async () => {
  const { personKey } = await import('../netlify/functions/lib/crewfit.js')
  assert.equal(personKey('Dave Cayford'), personKey('David Cayford'))
  assert.equal(personKey('Eddie Kirtland'), personKey('Edward Kirtland'))
  assert.equal(personKey('Rich Winstanley'), personKey('Richard Winstanley'))
  assert.notEqual(personKey('Jamie Winstanley'), personKey('Rich Winstanley'))
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const fit = fitRatings([
    race('a', Date.UTC(2026, 0, 1), [{ tab: 'div7', names: ['Dave Cay'], clubs: ['BSF'], divs: ['7'], pd: [], t: 3000 }, { tab: 'div7', names: ['Other One'], clubs: ['CAM'], divs: ['7'], pd: [], t: 3100 }]),
    race('b', Date.UTC(2026, 1, 1), [{ tab: 'div7', names: ['David Cay'], clubs: ['BSF'], divs: ['7'], pd: [], t: 3000 }, { tab: 'div7', names: ['Other One'], clubs: ['CAM'], divs: ['7'], pd: [], t: 3100 }])
  ], { now: Date.UTC(2026, 2, 1) })
  const bsf = fit.paddlers.filter(p => p.club === 'BSF')
  assert.equal(bsf.length, 1)
  assert.equal(bsf[0].name, 'David Cay') // as they last raced
  assert.deepEqual(bsf[0].names.sort(), ['Dave Cay', 'David Cay'])
  assert.equal(bsf[0].n, 2)
})

test('canoe results (C1, C2) are left out: a paddler has a separate canoe division', () => {
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const fit = fitRatings([
    race('a', Date.UTC(2026, 0, 1), [
      { tab: 'div7', names: ['Kay Paddler'], clubs: ['BSF'], cls: ['VMK'], divs: ['7'], pd: [], t: 3000 },
      { tab: 'div7', names: ['Other One'], clubs: ['CAM'], cls: ['SMK'], divs: ['7'], pd: [], t: 3100 }
    ]),
    race('b', Date.UTC(2026, 5, 1), [
      // later, the same paddler in a C2 in the div 9 crew table
      { tab: 'div9_9', names: ['Kay Paddler', 'Can Partner'], clubs: ['BSF', 'BSF'], cls: ['VMC', 'VMC'], divs: ['9', '9'], pd: [], t: 2900 },
      { tab: 'div9_9', names: ['Two Kayakers', 'Three Kayakers'], clubs: ['CAM', 'CAM'], cls: ['SMK', 'SMK'], divs: ['9', '9'], pd: [], t: 2800 }
    ])
  ], { now: Date.UTC(2026, 6, 1) })
  const kay = fit.paddlers.find(p => p.name === 'Kay Paddler')
  assert.equal(kay.div, '7') // the kayak division, not the C2 one
  assert.equal(kay.n + kay.nK2, 1)
  assert.ok(!fit.paddlers.some(p => p.name === 'Can Partner'))
})

test('canoe ratings: only the C1 and C2 results, a separate canoe division', () => {
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const races = [
    race('a', Date.UTC(2026, 0, 1), [
      { tab: 'div7', names: ['Kay Paddler'], clubs: ['BSF'], cls: ['VMK'], divs: ['7'], pd: [], t: 3000 },
      { tab: 'div9', names: ['Kay Paddler'], clubs: ['BSF'], cls: ['VMC'], divs: ['9'], pd: [], t: 3300 },
      { tab: 'div9', names: ['Canoe Rival'], clubs: ['CAM'], cls: ['SMC'], divs: ['9'], pd: [], t: 3400 },
      { tab: 'div9', names: ['Kayak Rival'], clubs: ['CAM'], cls: ['SMK'], divs: ['9'], pd: [], t: 2900 }
    ]),
    race('b', Date.UTC(2026, 5, 1), [
      { tab: 'div9_9', names: ['Kay Paddler', 'Can Partner'], clubs: ['BSF', 'BSF'], cls: ['VMC', 'VMC'], divs: ['9', '8'], pd: [], t: 2900 },
      { tab: 'div9_9', names: ['Canoe Rival', 'Canoe Mate'], clubs: ['CAM', 'CAM'], cls: ['SMC', 'SMC'], divs: ['9', '9'], pd: [], t: 3000 },
      { tab: 'c1', names: ['Can Partner'], clubs: ['BSF'], cls: [], divs: [''], pd: [], t: 1800 },
      { tab: 'c1sup-adv', names: ['Sup Person'], clubs: ['CAM'], cls: ['SUP'], divs: [''], pd: [], t: 1900 }
    ])
  ]
  const fit = fitRatings(races, { now: Date.UTC(2026, 6, 1), historyClub: 'BSF' }).canoe
  const names = fit.paddlers.map(p => p.name).sort()
  assert.deepEqual(names, ['Can Partner', 'Canoe Mate', 'Canoe Rival', 'Kay Paddler'])
  const kay = fit.paddlers.find(p => p.name === 'Kay Paddler')
  assert.equal(kay.div, '9') // the canoe division
  const hist = fit.history.get(kay.key)
  assert.equal(hist.length, 2)
  assert.deepEqual(hist.map(h => h.event), ['Div 9 C1', 'Div 9 C2'])
  assert.ok(hist.every(h => h.boat === 'canoe'))
})

test('K2 family tree: partners on the line below, linked groups together, loners last', async () => {
  const { k2Tree } = await import('../src/coaching/data/k2tree.js')
  const people = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fay', 'Gus'].map(id => ({ id }))
  const pairs = [
    { a: 'Ann', b: 'Bob', races: 6 }, // Ann paddles most: she's at the top
    { a: 'Ann', b: 'Cat', races: 3 },
    { a: 'Cat', b: 'Dan', races: 1 }, // Cat's other partner goes on the line below her
    { a: 'Eve', b: 'Fay', races: 2 } // a separate pair
  ]
  const rows = k2Tree(people, pairs).map(r => [r.kind, r.people.map(p => p.id)])
  assert.deepEqual(rows, [
    ['top', ['Ann']],
    ['next', ['Bob', 'Cat']],
    ['next', ['Dan']],
    ['top', ['Eve']],
    ['next', ['Fay']],
    ['alone', ['Gus']]
  ])
})

test('K2 pairings keep each race: when, where, the event and the place', () => {
  const race = (key, name, date, rows) => ({ key, name, date, rows })
  const k2 = (a, b, pos, t) => ({ tab: 'div5_5', pos, names: [a, b], clubs: ['BSF', 'BSF'], cls: ['VMK', 'VFK'], divs: ['5', '5'], pd: [], t })
  const fit = fitRatings([
    race('a', 'Cambridge Hasler Marathon 2026', Date.UTC(2026, 3, 26), [k2('Ben Bee', 'Kay Bee', 1, 4000), k2('Other One', 'Other Two', 2, 4100)]),
    race('b', 'Chelmer Hasler 2025', Date.UTC(2025, 9, 19), [k2('Kay Bee', 'Ben Bee', 2, 4200), k2('Other One', 'Other Two', 1, 4100)])
  ], { now: Date.UTC(2026, 6, 1) })
  const pair = fit.pairs.find(x => x.a.club === 'BSF')
  assert.equal(pair.races, 2)
  assert.deepEqual(pair.list, [
    { date: '2026-04-26', race: 'Cambridge Hasler Marathon 2026', venue: 'CAM', event: 'Div 5 K2', pos: 1, of: 2 },
    { date: '2025-10-19', race: 'Chelmer Hasler 2025', venue: 'CLM', event: 'Div 5 K2', pos: 2, of: 2 }
  ])
})

test('/api/paddler: one paddler\'s results with how quick each was, once the ratings are worked out', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const cookie = coachCookie()
  const req = path => handler(new Request('https://x' + path, { headers: { cookie } }))
  // the earlier /api/crews test filled the in-memory store, so the history is there
  const res = await req('/api/paddler?club=BSF&name=Ann%20Able')
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.found, true)
  assert.equal(body.name, 'Ann Able')
  assert.equal(body.kayak.history.length, 3)
  assert.equal(body.kayak.history.at(-1).provisional, true) // yesterday's race: marked as not final
  assert.ok(body.kayak.history.every(h => typeof h.rating === 'number' && h.date && h.race))
  assert.ok(body.kayak.k1med)
  assert.equal(body.canoe, null) // no canoe results
  const none = await (await req('/api/paddler?club=BSF&name=Nobody%20Here')).json()
  assert.equal(none.found, false)
})

test('known misspellings in the results are one paddler', async () => {
  const { sameRacer } = await import('../netlify/functions/lib/match.js')
  const { personKey } = await import('../netlify/functions/lib/crewfit.js')
  assert.equal(personKey('PETR LUKSAH'), personKey('Petr Luksan'))
  assert.equal(personKey('Eddie Kirkland'), personKey('Edward Kirtland'))
  assert.ok(sameRacer('Jaroslav Klumpler', 'Jaroslav Klumper'))
  assert.ok(!sameRacer('Joshua Luksan', 'Petr Luksah'))
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const fit = fitRatings([
    race('a', Date.UTC(2022, 5, 1), [
      { tab: 'div8', names: ['PETR LUKSAH'], clubs: ['BSF'], cls: ['VMK'], divs: ['8'], pd: [], t: 3000 },
      { tab: 'div8', names: ['Some One'], clubs: ['CAM'], cls: ['SMK'], divs: ['8'], pd: [], t: 3100 }
    ]),
    race('b', Date.UTC(2023, 5, 1), [
      { tab: 'div8', names: ['Petr Luksan'], clubs: ['BSF'], cls: ['VMK'], divs: ['8'], pd: [], t: 2950 },
      { tab: 'div8', names: ['Some One'], clubs: ['CAM'], cls: ['SMK'], divs: ['8'], pd: [], t: 3100 }
    ])
  ], { now: Date.UTC(2023, 6, 1), historyClub: 'BSF' })
  const petr = fit.paddlers.filter(p => p.club === 'BSF')
  assert.equal(petr.length, 1)
  assert.equal(petr[0].name, 'Petr Luksan')
  // a misspelling isn't another name he raced under
  assert.deepEqual(petr[0].names, ['Petr Luksan'])
  assert.equal(fit.history.get(petr[0].key).length, 2)
  // last raced under the misspelling: still shown spelt right
  const later = fitRatings([
    race('a', Date.UTC(2021, 5, 1), [
      { tab: 'div8', names: ['Petr Luksan'], clubs: ['BSF'], cls: ['VMK'], divs: ['8'], pd: [], t: 3000 },
      { tab: 'div8', names: ['Some One'], clubs: ['CAM'], cls: ['SMK'], divs: ['8'], pd: [], t: 3100 }
    ]),
    race('b', Date.UTC(2022, 9, 16), [
      { tab: 'div8', names: ['PETR LUKSAH'], clubs: ['BSF'], cls: ['VMK'], divs: ['8'], pd: [], t: 2950 },
      { tab: 'div8', names: ['Some One'], clubs: ['CAM'], cls: ['SMK'], divs: ['8'], pd: [], t: 3100 }
    ])
  ], { now: Date.UTC(2023, 6, 1), historyClub: 'BSF' }).paddlers.filter(p => p.club === 'BSF')
  assert.equal(later[0].name, 'Petr Luksan')
  assert.deepEqual(later[0].names, ['Petr Luksan'])
})

test('share links: a coach makes one; it opens only that paddler, and can\'t be altered', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const { makeShareToken, readShareToken } = await import('../netlify/functions/lib/share.js')
  const cookie = coachCookie()
  const get = (path, headers = {}) => handler(new Request('https://club.example' + path, { headers }))
  // only coaches can make a link
  assert.equal((await get('/api/paddler-link?club=BSF&name=Ann%20Able')).status, 401)
  const made = await (await get('/api/paddler-link?club=BSF&name=Ann%20Able', { cookie })).json()
  assert.match(made.url, /^https:\/\/club\.example\/my-racing\/\?t=[\w-]+\.[\w-]{32}$/)
  const t = new URL(made.url).searchParams.get('t')
  // the link: that paddler's page, no password needed, whatever name is asked for
  const own = await (await get(`/api/paddler?t=${t}&club=BSF&name=Somebody%20Else`)).json()
  assert.equal(own.found, true)
  assert.equal(own.name, 'Ann Able')
  assert.ok(own.kayak.history.length)
  // a lookup by name needs no link or password any more (the public view)
  assert.equal((await get('/api/paddler?club=BSF&name=Ann%20Able')).status, 200) // the lookup has no password now: this is the public view
  // a changed or made-up token is refused
  const [body, sig] = t.split('.')
  const other = Buffer.from(JSON.stringify({ k: 'somebody else|BSF', v: 1 })).toString('base64url')
  assert.equal((await get(`/api/paddler?t=${other}.${sig}`)).status, 403)
  assert.equal((await get(`/api/paddler?t=${body}.${'A'.repeat(32)}`)).status, 403)
  assert.equal(readShareToken(makeShareToken('ann able|BSF')), 'ann able|BSF')
  // a new secret withdraws every link
  process.env.SHARE_LINK_SECRET = 'a different secret'
  assert.equal((await get(`/api/paddler?t=${t}`)).status, 403)
  delete process.env.SHARE_LINK_SECRET
})

test('a paddler\'s division: Hasler tables decide, and a promotion isn\'t undone by an out-of-date later result', async () => {
  const { divisionFromResults, ownDivision } = await import('../netlify/functions/lib/crewfit.js')
  // Oleh Kuzmenko: promoted to div 3 at Leighton Buzzard (June), then a winter series K2 in
  // October listing him as div 4
  assert.equal(divisionFromResults([
    { tab: 'div4_4', div: '4' },
    { tab: 'div4', div: '4', pd: 'P3' },
    { tab: 'k2-16-m', div: '4' }
  ]), '3')
  // a later Hasler result still showing the old division doesn't undo the promotion either...
  assert.equal(divisionFromResults([{ tab: 'div4', div: '4', pd: 'P3' }, { tab: 'div3_3', div: '4' }]), '3')
  // ...but a different one does (a demotion taken up), and so does the next Hasler result
  assert.equal(divisionFromResults([{ tab: 'div4', div: '4', pd: 'P3' }, { tab: 'div5', div: '5' }]), '5')
  assert.equal(divisionFromResults([{ tab: 'div4', div: '4', pd: 'P3' }, { tab: 'div3', div: '3' }, { tab: 'div3', div: '3', pd: 'P2' }]), '2')
  // no Hasler results at all: the other races are all there is
  assert.equal(divisionFromResults([{ tab: 'k1-u14-m', div: '8' }]), '8')
  // a K2 row with one division for the crew isn't either paddler's own division
  assert.equal(ownDivision({ names: ['A', 'B'], divs: ['4'] }, 1), '')
  assert.equal(ownDivision({ names: ['A', 'B'], divs: ['3', '5'] }, 1), '5')
  assert.equal(ownDivision({ names: ['A'], divs: ['6'] }, 0), '6')
  // in the ratings: Oleh's rows as the results give them
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const row = (tab, names, divs, pd, t) => ({ tab, names, clubs: names.map(() => 'BSF'), cls: names.map(() => 'JMK'), divs, pd, t })
  const fit = fitRatings([
    race('/lbz', Date.UTC(2026, 5, 21), [row('div4', ['Oleh Kuzmenko'], ['4'], ['P3'], 4183), row('div4', ['Other Paddler'], ['4'], [''], 4300)]),
    race('/cws', Date.UTC(2026, 9, 4), [row('k2-16-m', ['Jasper Kirtland', 'Oleh Kuzmenko'], ['4', '4'], ['', ''], 4040), row('k2-16-m', ['Two People', 'In A Boat'], ['5', '5'], ['', ''], 4100)])
  ], { now: Date.UTC(2026, 9, 18) })
  assert.equal(fit.paddlers.find(p => p.name === 'Oleh Kuzmenko').div, '3')
})

test('/api/paddler: anyone in the results, from any club', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const cookie = coachCookie()
  const get = async path => (await handler(new Request('https://x' + path, { headers: { cookie } }))).json()
  // the earlier /api/crews test worked out the ratings for races with Ann Able (BSF) and Bob Bee (CAM)
  const bob = await get('/api/paddler?club=BSF&name=Bob%20Bee')
  assert.equal(bob.found, true)
  assert.equal(bob.name, 'Bob Bee')
  assert.equal(bob.club, 'CAM')
  assert.ok(bob.kayak.history.length >= 2)
  const ann = await get('/api/paddler?club=BSF&name=Ann%20Able')
  assert.equal(ann.club, 'BSF')
  assert.equal((await get('/api/paddler?club=BSF&name=Nobody%20Here')).found, false)
  // a share link for a paddler from another club: made with in=<their club>, and it opens
  // only their page
  const link = await get('/api/paddler-link?club=BSF&name=Bob%20Bee&in=CAM')
  const t = new URL(link.url).searchParams.get('t')
  const viaLink = await (await handler(new Request('https://x/api/paddler?t=' + encodeURIComponent(t)))).json()
  assert.equal(viaLink.name, 'Bob Bee')
  assert.equal(viaLink.club, 'CAM')
  // without in=, Bob isn't one of the club's own (the page always sends in= for other clubs)
  assert.equal((await handler(new Request('https://x/api/paddler-link?club=BSF&name=Bob%20Bee', { headers: { cookie } }))).status, 404)
})

test('age groups from the Class column, and learning crews', async () => {
  const { ageGroup } = await import('../netlify/functions/lib/crewfit.js')
  const { learningPair } = await import('../netlify/functions/lib/crewplan.js')
  assert.equal(ageGroup('JMK'), 'junior')
  assert.equal(ageGroup('VFC'), 'veteran')
  assert.equal(ageGroup('SMK'), 'senior')
  assert.equal(ageGroup(''), '')
  // James Breeze (div 7, 11 results) behind Eddie Kirtland (div 4, 47 steady results)
  const eddie = { id: 'ek', name: 'Eddie', div: '4', a: FIELDS.k1med[4] + 0.01, n: 47, nK1: 29, nK2: 18, sd: 0.03 }
  const james = { id: 'jb', name: 'James', div: '7', a: FIELDS.k1med[7], n: 11, nK1: 6, nK2: 5, sd: 0.05 }
  const lp = learningPair(james, eddie, FIELDS)
  assert.equal(lp.mentor.id, 'ek')
  assert.equal(lp.learner.id, 'jb')
  // without learning crews they'd both race K1; with it, a K2 with Eddie in front
  assert.equal(planCrews([eddie, james], FIELDS).entries.length, 2)
  const plan = planCrews([eddie, james], FIELDS, { learning: true })
  assert.equal(plan.entries.length, 1)
  assert.deepEqual(plan.entries[0].members.map(m => m.id), ['ek', 'jb'])
  assert.equal(plan.entries[0].learning, true)
  assert.equal(plan.entries[0].D, 5) // (4 + 7) / 2 rounded down
  // two experienced paddlers, or someone too close in speed: not a learning crew
  assert.equal(learningPair(eddie, { ...eddie, id: 'x' }, FIELDS), null)
})

test('/api/paddler: the race coordinator can see any paddler (marked as the coordinator)', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const coordinator = coordinatorCookie()
  const body = await (await handler(new Request('https://x/api/paddler?club=BSF&name=Ann%20Able', { headers: { cookie: coordinator } }))).json()
  assert.equal(body.found, true)
  assert.equal(body.viewer, 'coordinator')
})

test('a K2 result shares the crew\'s day equally: each dot is their own rating plus half the crew\'s gap', () => {
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const r = (tab, names, t) => ({ tab, names, clubs: names.map(() => 'BSF'), cls: names.map(() => 'SMK'), divs: names.map(() => '4'), pd: [], t })
  const races = []
  for (let i = 0; i < 6; i++) {
    races.push(race('k1-' + i, Date.UTC(2025, i, 1), [r('div4', ['Quick One'], 3000), r('div4', ['Slow One'], 3300), r('div4', ['Field A'], 3150), r('div4', ['Field B'], 3200)]))
  }
  races.push(race('k2', Date.UTC(2025, 7, 1), [r('div4_4', ['Quick One', 'Slow One'], 3000), r('div4_4', ['Field A', 'Field B'], 2950)]))
  const fit = fitRatings(races, { now: Date.UTC(2025, 8, 1), historyClub: 'BSF' })
  const p = name => fit.paddlers.find(x => x.name === name)
  const k2 = name => fit.history.get(p(name).key).find(h => h.k2)
  const [q, s] = [k2('Quick One'), k2('Slow One')]
  // the gap between their two dots is the gap between their ratings...
  assert.ok(Math.abs((s.rating - q.rating) - (p('Slow One').a - p('Quick One').a)) < 2e-4)
  // ...and each is moved from their own rating by the same amount (the crew's day, shared)
  assert.ok(Math.abs((q.rating - p('Quick One').a) - (s.rating - p('Slow One').a)) < 2e-4)
})

test('a paddler who changed their name (and club) is one paddler, under the name they race with now', () => {
  const row = (tab, names, clubs, divs, t) => ({ tab, names, clubs, divs, pd: [], t })
  const races = [
    { key: '/r1', name: 'Tonbridge', date: Date.UTC(2021, 8, 12), rows: [row('div6_6', ['KERSTIN QUEENEY', 'CATHERINE AYLING'], ['BSF', 'MAI'], ['6', '6'], 4400), row('div6_6', ['Two People', 'In A Boat'], ['XYZ', 'XYZ'], ['6', '6'], 4500)] },
    { key: '/r2', name: 'Pangbourne', date: Date.UTC(2023, 8, 10), rows: [row('div5', ['Catherine Ayling'], ['MAI'], ['5'], 4300), row('div5', ['Some One'], ['XYZ'], ['5'], 4350)] },
    { key: '/r3', name: 'Tonbridge', date: Date.UTC(2024, 7, 18), rows: [row('div5', ['Catherine Shirley'], ['EAL'], ['5'], 4250), row('div5', ['Some One'], ['XYZ'], ['5'], 4300)] }
  ]
  const fit = fitRatings(races, { now: Date.UTC(2026, 9, 1), historyClub: '*' })
  const cs = fit.paddlers.filter(p => /catherine/i.test(p.name))
  assert.equal(cs.length, 1)
  assert.equal(cs[0].name, 'Catherine Shirley')
  assert.equal(cs[0].club, 'EAL')
  assert.ok(cs[0].names.some(n => /ayling/i.test(n)))
  assert.equal(fit.history.get('catherine shirley|EAL').length, 3)
})

test('/api/paddler-names: coaches link or set aside an earlier name; it has the ratings worked out again', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const coach = coachCookie()
  const coordinator = coordinatorCookie()
  const post = (cookie, body) => handler(new Request('https://x/api/paddler-names?club=BSF', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  assert.equal((await post(coordinator, { action: 'link', from: 'bob bee|CAM', to: 'ann able|BSF' })).status, 401)
  assert.equal((await post(coach, { action: 'link', from: 'nonsense', to: 'ann able|BSF' })).status, 400)
  const res = await post(coach, { action: 'link', from: 'bob bee|CAM', to: 'ann able|BSF' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).refitting, true)
  // undo: and it won't be suggested again
  const undo = await post(coach, { action: 'unlink', from: 'bob bee|CAM', to: 'ann able|BSF' })
  assert.equal(undo.status, 200)
  assert.equal((await post(coach, { action: 'reject', from: 'bob bee|CAM', to: 'ann able|BSF' })).status, 200)
  // a coordinator's view of a page never has the guesses
  const page = await (await handler(new Request('https://x/api/paddler?club=BSF&name=Ann%20Able', { headers: { cookie: coordinator } }))).json()
  assert.equal('maybe' in page || 'linked' in page, false)
})

test('a paddler who moved clubs: the page for the old club lists the same name at the new club, with its key', async () => {
  const { paddler, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const person = name => ({ name, names: [name], kayak: { div: '4', a: 0, n: 3, last: '2024-07-13', group: 'veteran', history: [] } })
  const files = {
    'hist5-BSF': { v: HIST_VERSION, basis: 'b', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'chris sze|BSF': person('Chris Sze') } },
    'hist5-NOT': { v: HIST_VERSION, basis: 'b', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'chris sze|NOT': person('Chris Sze') } },
    'people-index': { basis: 'b', people: { 'chris sze|BSF': { club: 'BSF', name: 'Chris Sze', names: ['Chris Sze'], n: 57, last: '2024-07-13' }, 'chris sze|NOT': { club: 'NOT', name: 'Chris Sze', names: ['Chris Sze'], n: 12, last: '2026-10-18' } } }
  }
  const st = { get: async k => files[k] ?? null }
  const body = await (await paddler(st, 'BSF', 'Chris Sze')).json()
  assert.equal(body.key, 'chris sze|BSF')
  assert.equal(body.others.length, 1)
  assert.deepEqual({ ...body.others[0] }, { key: 'chris sze|NOT', name: 'Chris Sze', club: 'NOT', n: 12, last: '2026-10-18' })
  // the other club's page lists the BSF one, and no "others" at all when the name is unique
  const there = await (await paddler(st, 'BSF', 'Chris Sze', 'NOT')).json()
  assert.equal(there.key, 'chris sze|NOT')
  assert.equal(there.others[0].key, 'chris sze|BSF')
  delete files['people-index'].people['chris sze|NOT']
  const alone = await (await paddler(st, 'BSF', 'Chris Sze')).json()
  assert.equal(alone.others, undefined)
})

test('/api/paddler has no password (public view: no coach-only extras); share links, name links and /api/crews still need one', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const get = (path, headers = {}, init = {}) => handler(new Request('https://x' + path, { headers, ...init }))
  const anon = await get('/api/paddler?club=BSF&name=Ann%20Able')
  assert.equal(anon.status, 200)
  const body = await anon.json()
  assert.equal(body.found, true)
  assert.equal(body.viewer, 'public')
  assert.equal(body.maybe, undefined)
  assert.equal(body.linked, undefined)
  assert.equal((await get('/api/paddler-link?club=BSF&name=Ann%20Able')).status, 401)
  assert.equal((await get('/api/crews?club=BSF')).status, 401)
  assert.equal((await get('/api/paddler-names?club=BSF', {}, { method: 'POST', body: '{}' })).status, 401)
  // a coach is still recognised
  const coach = coachCookie()
  assert.equal((await (await get('/api/paddler?club=BSF&name=Ann%20Able', { cookie: coach })).json()).viewer, 'coach')
})

test('a shared link can open that paddler\'s K2 partners, and nobody else', async () => {
  const { sharedPartner, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const hist = (partner, k2 = true) => ({ div: '5', a: 0, n: 2, last: '2025-01-01', history: [{ date: '2025-01-01', race: 'R', k2, partner, t: 3600, rating: 0 }] })
  const files = {
    'hist5-BSF': { v: HIST_VERSION, basis: 'b', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: {
      'ann able|BSF': { name: 'Ann Able', names: ['Ann Able'], kayak: hist('Bob Bee'), maybe: [{ key: 'x' }], linked: [{ key: 'y' }] },
      'bob bee|BSF': { name: 'Bob Bee', names: ['Bob Bee'], kayak: hist('Ann Able'), maybe: [{ key: 'z' }] },
      'cat cee|BSF': { name: 'Cat Cee', names: ['Cat Cee'], kayak: hist(undefined, false) }
    } },
    'people-index': { basis: 'b', people: {
      'ann able|BSF': { club: 'BSF', name: 'Ann Able', names: ['Ann Able'], n: 2, last: '2025-01-01' },
      'bob bee|BSF': { club: 'BSF', name: 'Bob Bee', names: ['Bob Bee'], n: 2, last: '2025-01-01' },
      'cat cee|BSF': { club: 'BSF', name: 'Cat Cee', names: ['Cat Cee'], n: 2, last: '2025-01-01' }
    } }
  }
  const st = { get: async k => files[k] ?? null }
  const ok = await sharedPartner(st, 'ann able|BSF', ' bob  BEE ')
  assert.equal(ok.status, 200)
  const body = await ok.json()
  assert.equal(body.found, true)
  assert.equal(body.name, 'Bob Bee')
  assert.equal(body.partnerOf, 'Ann Able')
  assert.equal(body.maybe, undefined) // coach-only extras stay out
  assert.equal(body.others, undefined)
  // someone she never raced a crew with: refused
  assert.equal((await sharedPartner(st, 'ann able|BSF', 'Cat Cee')).status, 403)
  assert.equal((await sharedPartner(st, 'ann able|BSF', '')).status, 403)
})

test('/api/whoami: says which passwords this browser has, nothing else', async () => {
  const { default: whoami } = await import('../netlify/functions/whoami.js')
  const ask = cookie => whoami(new Request('https://x/api/whoami', { headers: cookie ? { cookie } : {} })).then(r => r.json())
  const only = o => ({ coach: o.coach, coordinator: o.coordinator })
  assert.deepEqual(only(await ask('')), { coach: false, coordinator: false })
  assert.deepEqual(only(await ask(coachCookie())), { coach: true, coordinator: false })
  assert.deepEqual(only(await ask(coordinatorCookie())), { coach: false, coordinator: true })
  assert.deepEqual(only(await ask('bscc_session=wrong')), { coach: false, coordinator: false })
})

test('each result keeps the club the paddler raced for that day; merged paddlers list every club', async () => {
  const { fitRatings } = await import('../netlify/functions/lib/crewfit.js')
  const row = (names, clubs, t) => ({ tab: 'div4', pos: 1, names, clubs, cls: names.map(() => 'VMK'), divs: names.map(() => '4'), pd: [], t })
  const races = []
  for (let i = 0; i < 4; i++) {
    const club = ['SOR', 'PPL', 'NOT', 'NOT'][i]
    races.push({ key: '/r' + i, name: 'Race ' + i, date: Date.UTC(2016 + i * 3, 4, 1), rows: [row(['Duncan Jack'], [club], 3000), row(['Field A'], ['XYZ'], 3100), row(['Field B'], ['XYZ'], 3200), row(['Field C'], ['XYZ'], 3300)] })
  }
  // a coach merged the SOR and PPL Duncan Jacks into the NOT one
  const links = { 'duncan jack|SOR': { name: 'Duncan Jack', club: 'NOT' }, 'duncan jack|PPL': { name: 'Duncan Jack', club: 'NOT' } }
  const fit = fitRatings(races, { now: Date.UTC(2026, 10, 1), historyClub: '*', links })
  const h = fit.history.get('duncan jack|NOT')
  assert.equal(h.length, 4)
  assert.deepEqual(h.map(r => r.club), ['SOR', 'PPL', 'NOT', 'NOT'])
})

test('a paddler can merge results with their own name from their shared link, and undo it', async () => {
  const { mergeOwn, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const { default: handler } = await import('../netlify/functions/crews.js')
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, JSON.parse(JSON.stringify(v))) } }
  const person = (name, last) => ({ name, names: [name], kayak: { div: '4', a: 0, n: 3, last, group: 'veteran', history: [{ date: last, race: 'R', k2: false, club: 'X', t: 3600, rating: 0 }] } })
  const peopleOf = { NOT: { 'duncan jack|NOT': person('Duncan Jack', '2026-10-18'), 'duncan jackson|NOT': person('Duncan Jackson', '2026-10-18') }, PPL: { 'duncan jack|PPL': person('DUNCAN JACK', '2019-05-01') }, SOR: { 'duncan jack|SOR': person('DUNCAN JACK', '2016-05-01') } }
  for (const [c, people] of Object.entries(peopleOf)) files.set(`hist5-${c}`, { v: HIST_VERSION, basis: 'b|names 0', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people })
  const idx = {}
  for (const [c, people] of Object.entries(peopleOf)) for (const [k, p] of Object.entries(people)) idx[k] = { club: c, name: p.name, names: p.names, n: 3, first: p.kayak.last, last: p.kayak.last }
  files.set('people-index', { basis: 'b|names 0', people: idx })
  let kicked = 0
  const kick = async () => { kicked++ }
  // somebody who isn't a same-name paddler can't be pulled in
  assert.equal((await mergeOwn(st, 'duncan jack|NOT', { action: 'merge', keys: ['duncan jackson|NOT'] }, { kick })).status, 403)
  assert.equal((await mergeOwn(st, 'duncan jack|NOT', { action: 'merge', keys: [] }, { kick })).status, 403)
  // the real thing
  const done = await mergeOwn(st, 'duncan jack|NOT', { action: 'merge', keys: ['duncan jack|PPL', 'duncan jack|SOR'] }, { kick })
  assert.equal(done.status, 200)
  assert.equal((await done.json()).key, 'duncan jack|NOT')
  assert.equal(kicked, 1)
  const nl = files.get('name-links')
  assert.deepEqual(Object.keys(nl.links).sort(), ['duncan jack|PPL', 'duncan jack|SOR'])
  assert.equal(nl.links['duncan jack|PPL'].club, 'NOT')
  assert.ok(nl.at)
  // until the ratings have been worked out again, no more merging
  assert.equal((await mergeOwn(st, 'duncan jack|NOT', { action: 'unlink', from: 'duncan jack|PPL' }, { kick })).status, 409)
  // ratings worked out again (the basis carries the name-links time): undo one
  for (const c of ['NOT', 'PPL', 'SOR']) files.get(`hist5-${c}`).basis = 'b|names ' + nl.at
  files.get('people-index').basis = 'b|names ' + nl.at
  assert.equal((await mergeOwn(st, 'duncan jack|NOT', { action: 'unlink', from: 'duncan jack|SOR' }, { kick })).status, 200)
  assert.deepEqual(Object.keys(files.get('name-links').links), ['duncan jack|PPL'])
  // (the undo has the ratings worked out again too)
  const at2 = files.get('name-links').at
  for (const c of ['NOT', 'PPL', 'SOR']) files.get(`hist5-${c}`).basis = 'b|names ' + at2
  files.get('people-index').basis = 'b|names ' + at2
  assert.equal((await mergeOwn(st, 'duncan jack|NOT', { action: 'unlink', from: 'duncan jackson|NOT' }, { kick })).status, 404)
})

test('after results are merged the page says it is still waiting for the ratings, until they have been worked out again', async () => {
  const { paddler, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const files = {
    'hist5-BSF': { v: HIST_VERSION, basis: '10|1700|recent 0|names 0', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'ann able|BSF': { name: 'Ann Able', names: ['Ann Able'], kayak: { div: '4', a: 0, n: 1, last: '2025-01-01', history: [] } } } },
    'people-index': { basis: '10|1700|recent 0|names 0', people: { 'ann able|BSF': { club: 'BSF', name: 'Ann Able', names: ['Ann Able'], n: 1, last: '2025-01-01' } } }
  }
  const st = { get: async k => files[k] ?? null }
  assert.equal((await (await paddler(st, 'BSF', 'Ann Able')).json()).refitting, undefined) // nothing merged
  files['name-links'] = { links: {}, rejected: [], at: 555 } // a merge since
  assert.equal((await (await paddler(st, 'BSF', 'Ann Able')).json()).refitting, true)
  files['hist5-BSF'].basis = '10|1700|recent 0|names 555' // ratings worked out again
  assert.equal((await (await paddler(st, 'BSF', 'Ann Able')).json()).refitting, undefined)
})

test('anyone can merge same-name results, but only ones whose dates could be one person\'s', async () => {
  const { mergeOwn, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const mk = spans => {
    const files = new Map()
    const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, JSON.parse(JSON.stringify(v))) } }
    const people = {}, idx = {}
    for (const [club, first, last] of spans) {
      const key = `ant wright|${club}`
      people[key] = { name: 'Ant Wright', names: ['Ant Wright'], kayak: { div: '5', a: 0, n: 2, last, group: '', history: [] } }
      idx[key] = { club, name: 'Ant Wright', names: ['Ant Wright'], n: 2, first, last }
    }
    for (const club of new Set(spans.map(s => s[0]))) files.set(`hist5-${club}`, { v: HIST_VERSION, basis: 'b|names 0', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: Object.fromEntries(Object.entries(people).filter(([k]) => k.endsWith('|' + club))) })
    files.set('people-index', { basis: 'b|names 0', people: idx })
    return { st, files }
  }
  // moved clubs: BSF to 2019, WOR from 2022: fine
  const a = mk([['BSF', '2010-01-01', '2019-06-16'], ['WOR', '2022-03-01', '2026-10-18']])
  const ok = await mergeOwn(a.st, 'ant wright|BSF', { action: 'merge', keys: ['ant wright|WOR'] }, { strict: true })
  assert.equal(ok.status, 200)
  assert.equal((await ok.json()).key, 'ant wright|WOR') // under the club raced for most recently
  // racing for two clubs at once: a coach has to say
  const b = mk([['BSF', '2018-01-01', '2024-06-16'], ['WOR', '2022-03-01', '2026-10-18']])
  assert.equal((await mergeOwn(b.st, 'ant wright|BSF', { action: 'merge', keys: ['ant wright|WOR'] }, { strict: true })).status, 403)
  assert.equal((await mergeOwn(b.st, 'ant wright|BSF', { action: 'merge', keys: ['ant wright|WOR'] }, { strict: false })).status, 200)
  // no dates to go by: not for just anyone
  const c = mk([['BSF', '', ''], ['WOR', '2022-03-01', '2026-10-18']])
  assert.equal((await mergeOwn(c.st, 'ant wright|BSF', { action: 'merge', keys: ['ant wright|WOR'] }, { strict: true })).status, 403)
})

test('comments on a result: anyone adds and reads them, only the paddler or a coach can call a result unfair, only coaches remove', async () => {
  const { readNotes, addNote, removeNote, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, JSON.parse(JSON.stringify(v))) } }
  const me = { name: 'Melissa Test', names: ['Melissa Test'], kayak: { div: '4', a: 0, n: 1, last: '2026-10-18', group: 'veteran', history: [{ date: '2026-10-18', race: 'R', rid: '/r/1|div4', k2: false, t: 3600, rating: 0 }] } }
  files.set('hist5-BSF', { v: HIST_VERSION, basis: 'b|names 0', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'melissa test|BSF': me } })
  let kicked = 0
  const kick = async () => { kicked++ }
  const K = 'melissa test|BSF'
  const read = async () => (await (await readNotes(st, K)).json()).notes
  assert.deepEqual(await read(), {})
  assert.equal((await addNote(st, K, { rid: '/r/9|div4', text: 'x' }, { kick })).status, 404) // not one of her results
  assert.equal((await addNote(st, K, { rid: '/r/1|div4', text: '  ' }, { kick })).status, 400) // nothing to say
  // a visitor: text and ticks (junk ticks dropped, text cut to 280); "unfair" is ignored
  const v = await addNote(st, K, { rid: '/r/1|div4', text: ' Stopped to help ' + 'x'.repeat(400), flags: ['helped', 'bogus'], unfair: true }, { kick })
  assert.equal(v.status, 200)
  let list = (await read())['/r/1|div4']
  assert.equal(list.length, 1)
  assert.deepEqual(list[0].flags, ['helped'])
  assert.equal(list[0].text.length, 280)
  assert.equal(list[0].by, 'visitor')
  assert.equal(list[0].unfair, undefined)
  assert.equal(kicked, 0)
  // the paddler (own link): a second comment, and the result is called unfair, so ratings are worked out again
  const own = await (await addNote(st, K, { rid: '/r/1|div4', text: 'Capsized', unfair: true }, { own: true, kick })).json()
  assert.equal(kicked, 1)
  assert.deepEqual(files.get('notes-unfair').list, ['melissa test@/r/1|div4'])
  assert.equal((await read())['/r/1|div4'].length, 2)
  // taking the visitor's comment out leaves the unfair mark; taking out the paddler's removes it
  // a stranger can't; whoever wrote it can (with the secret their browser was given)
  assert.equal((await removeNote(st, K, { rid: '/r/1|div4', id: list[0].id }, { kick })).status, 403)
  assert.equal((await removeNote(st, K, { rid: '/r/1|div4', id: list[0].id, secret: 'wrong' }, { kick })).status, 403)
  assert.equal((await removeNote(st, K, { rid: '/r/1|div4', id: list[0].id, secret: (await v.clone().json()).secret }, { kick })).status, 200)
  assert.equal(kicked, 1)
  assert.equal(JSON.stringify(await read()).includes('"h"'), false) // the secret's hash is never shown
  // a coach or the paddler (allow) can remove any
  assert.equal((await removeNote(st, K, { rid: '/r/1|div4', id: 'nope' }, { allow: true, kick })).status, 404)
  await removeNote(st, K, { rid: '/r/1|div4', id: own.note.id }, { allow: true, kick })
  assert.deepEqual(await read(), {})
  assert.deepEqual(files.get('notes-unfair').list, [])
  assert.equal(kicked, 2)
})

test('comments on a K2 result show for both partners, labelled with who wrote them', async () => {
  const { readNotes, addNote, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, JSON.parse(JSON.stringify(v))) } }
  const person = (name, partner) => ({ name, names: [name], kayak: { div: '4', a: 0, n: 1, last: '2026-10-18', group: 'veteran', history: [{ date: '2026-10-18', race: 'R', rid: '/r/1|div4_4', k2: true, partner, t: 3600, rating: 0 }] } })
  files.set('hist5-BSF', { v: HIST_VERSION, basis: 'b|names 0', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'ann able|BSF': person('Ann Able', 'Bob Bee'), 'bob bee|BSF': person('Bob Bee', 'Ann Able') } })
  await addNote(st, 'bob bee|BSF', { rid: '/r/1|div4_4', text: 'Windy at the start' })
  const seen = async k => (await (await readNotes(st, k)).json()).notes['/r/1|div4_4']
  assert.equal((await seen('bob bee|BSF'))[0].about, undefined)
  const forAnn = await seen('ann able|BSF')
  assert.equal(forAnn.length, 1)
  assert.equal(forAnn[0].text, 'Windy at the start')
  assert.equal(forAnn[0].about, 'Bob Bee')
})

test('every comment can be exported for a backup (CSV is safe to open in a spreadsheet)', async () => {
  const { addNote, exportNotes, notesCsv, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, JSON.parse(JSON.stringify(v))) }, list: async ({ prefix }) => ({ blobs: [...files.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }) }
  const me = { name: 'Melissa Test', names: ['Melissa Test'], kayak: { div: '4', a: 0, n: 1, last: '2026-10-18', group: 'veteran', history: [{ date: '2026-10-18', race: 'Hasler Finals', event: 'Div 4 K1', rid: '/r/1|div4', k2: false, t: 3600, rating: 0 }] } }
  files.set('hist5-BSF', { v: HIST_VERSION, basis: 'b|names 0', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'melissa test|BSF': me } })
  await addNote(st, 'melissa test|BSF', { rid: '/r/1|div4', text: '=SUM(1,2) "windy"', flags: ['wind'] })
  const rows = await exportNotes(st)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].paddler, 'Melissa Test')
  assert.equal(rows[0].race, 'Hasler Finals')
  const csv = notesCsv(rows)
  assert.ok(csv.startsWith('paddler,date,race'))
  assert.ok(csv.includes('"\'=SUM(1,2) ""windy"""')) // quoted, and a leading = defused
})

test('a paddler can download what is kept about them and have it all deleted (comments and name links)', async () => {
  const { addNote, myData, eraseMine, readNotes, HIST_VERSION } = await import('../netlify/functions/crews.js')
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, JSON.parse(JSON.stringify(v))) } }
  const me = { name: 'Melissa Test', names: ['Melissa Test'], kayak: { div: '4', a: 0, n: 1, last: '2026-10-18', group: 'veteran', history: [{ date: '2026-10-18', race: 'R', rid: '/r/1|div4', k2: false, t: 3600, rating: 0 }] } }
  files.set('hist5-BSF', { v: HIST_VERSION, basis: 'b|names 5', fetchedAt: 'x', kayak: { K: 1, k1med: {} }, canoe: { K: 1, k1med: {} }, people: { 'melissa test|BSF': me } })
  files.set('name-links', { at: 5, links: { 'melissa jones|NOT': { name: 'Melissa Test', club: 'BSF', to: 'melissa test|BSF' }, 'someone else|NOT': { name: 'Someone Else', club: 'XYZ', to: 'someone else|XYZ' } }, rejected: [] })
  let kicked = 0
  const kick = async () => { kicked++ }
  const K = 'melissa test|BSF'
  await addNote(st, K, { rid: '/r/1|div4', text: 'Windy', flags: ['wind'] })
  await addNote(st, K, { rid: '/r/1|div4', text: 'Capsized', unfair: true }, { own: true, kick })
  const mine = await (await myData(st, K)).json()
  assert.equal(mine.commentsOnYourResults.length, 2)
  assert.equal(mine.namesPutTogether.length, 1)
  assert.equal(JSON.stringify(mine).includes('"h"'), false)
  const out = await (await eraseMine(st, K, { kick })).json()
  assert.deepEqual({ comments: out.comments, links: out.links }, { comments: 2, links: 1 })
  assert.deepEqual((await (await readNotes(st, K)).json()).notes, {})
  assert.deepEqual(files.get('notes-unfair').list, [])
  assert.deepEqual(Object.keys(files.get('name-links').links), ['someone else|NOT']) // only theirs
  assert.ok(files.get('name-links').at > 5)
})

test('nobody but the paddler (their own link) or a coach can erase or remove other people\'s comments', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const post = body => handler(new Request('https://x/api/paddler-notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  // an anonymous visitor naming a paddler
  assert.equal((await post({ key: 'melissa test|BSF', action: 'erase', confirm: true })).status, 403)
  // a made-up or tampered link
  assert.equal((await post({ t: 'not-a-real-token', action: 'erase', confirm: true })).status, 403)
  // a visitor removing a comment without its secret
  const r = await post({ key: 'melissa test|BSF', action: 'remove', rid: '/r/1|div4', id: 'c1' })
  assert.ok([403, 404, 409].includes(r.status))
  // and the personal-data download
  assert.equal((await handler(new Request('https://x/api/paddler-notes?key=melissa%20test%7CBSF&mydata=1'))).status, 403)
})

test('a result marked "not a fair result" hardly counts in the ratings and shows as odd', () => {
  const rows = (t2) => [
    { tab: 'a', names: ['Alan Aaa'], clubs: ['BSF'], divs: ['5'], pd: [], t: 3600 },
    { tab: 'a', names: ['Bob Bbb'], clubs: ['BSF'], divs: ['5'], pd: [], t: 3700 },
    { tab: 'a', names: ['Cat Ccc'], clubs: ['BSF'], divs: ['5'], pd: [], t: t2 }
  ]
  const races = [0, 1, 2, 3].map(i => ({ key: '/r/' + i, name: 'R' + i, date: Date.UTC(2026, 5, 1 + i * 7), rows: rows(i === 3 ? 5200 : 3800) }))
  const base = fitRatings(races, { historyClub: '*' })
  const fair = fitRatings(races, { historyClub: '*', unfair: new Set(['cat ccc@/r/3|a']) })
  const h = f => f.history.get('cat ccc|BSF').find(r => r.rid === '/r/3|a')
  assert.ok(h(base))
  assert.equal(h(fair).odd, true)
  const a = f => f.paddlers.find(p => p.key === 'cat ccc|BSF').a
  assert.ok(a(fair) < a(base)) // the slow day no longer drags her rating down
})

test('wreck the river leaderboard keeps the top five, cleans names, and only a coach removes entries', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const post = (body, headers = {}) => handler(new Request('https://x/api/wreck-scores', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '9.9.9.' + Math.floor(Math.random() * 250), ...headers }, body: JSON.stringify(body) }))
  assert.equal((await post({ name: '', score: 100 })).status, 400)
  assert.equal((await post({ name: 'Cheat', score: 99999999 })).status, 400)
  const first = await (await post({ name: '  <b>Ben</b>   Tubby the Great  ', score: 500 })).json()
  assert.equal(first.rank, 1)
  assert.ok(!/[<>]/.test(first.scores[0].name) && first.scores[0].name.length <= 14)
  for (const [n, sc] of [['A', 900], ['B', 800], ['C', 700], ['D', 600], ['E', 1000]]) await post({ name: n, score: sc })
  const board = await (await handler(new Request('https://x/api/wreck-scores'))).json()
  assert.deepEqual(board.scores.map(e => e.name), ['E', 'A', 'B', 'C', 'D'])
  assert.equal((await (await post({ name: 'Low', score: 10 })).json()).rank, 0)
  assert.equal((await post({ action: 'remove', id: board.scores[0].id })).status, 401)
  // the second board: most things destroyed in a round
  assert.deepEqual(board.wrecks, [])
  await post({ name: 'W1', score: 100, wrecked: 4 })
  const r2 = await (await post({ name: 'W2', score: 50, wrecked: 9 })).json()
  assert.equal(r2.wreckRank, 1)
  assert.deepEqual(r2.wrecks.map(e => e.name), ['W2', 'W1'])
  assert.equal((await post({ name: 'X', score: 100, wrecked: 9999 })).status, 400)
})


test('answers that are the same for everyone are cached, and nothing that depends on who is asking', async () => {
  const { default: handler } = await import('../netlify/functions/crews.js')
  const board = await handler(new Request('https://x/api/wreck-scores'))
  assert.match(board.headers.get('cache-control'), /public, max-age=\d+/)
  assert.match(board.headers.get('netlify-cdn-cache-control'), /s-maxage=\d+/)
  // a lookup depends on who is signed in: never cached
  const who = await handler(new Request('https://x/api/paddler?club=BSF&name=nobody'))
  assert.match(who.headers.get('cache-control'), /no-store/)
  // ...and the CDN keeps its copies apart by the sign-in cookies
  assert.match(who.headers.get('netlify-vary') || '', /cookie=bscc_session/)
  // a share link's answers aren't kept by the CDN
  const t = await handler(new Request('https://x/api/paddler-notes?t=nonsense'))
  assert.doesNotMatch(t.headers.get('cache-control') || '', /public/)
})

test('a division table with no Class column is marked: it counted as a kayak result but may be a canoe one', () => {
  const race = (key, date, rows) => ({ key, name: key, date, rows })
  const mk = (cls) => [
    { tab: 'div7', names: ['Kay Paddler'], clubs: ['BSF'], cls, divs: ['7'], pd: [], t: 3000 },
    { tab: 'div7', names: ['Kayak Rival'], clubs: ['CAM'], cls, divs: ['7'], pd: [], t: 3100 }
  ]
  const fit = fitRatings([race('/results/races/2021/old', Date.UTC(2021, 9, 1), mk([])), race('/results/races/2025/new', Date.UTC(2025, 9, 1), mk(['SMK']))], { now: Date.UTC(2026, 0, 1), historyClub: 'BSF' })
  const rows = fit.history.get(fit.paddlers.find(p => p.name === 'Kay Paddler').key)
  assert.equal(rows.find(r => r.date.startsWith('2021')).nc, true)
  assert.equal(rows.find(r => r.date.startsWith('2025')).nc, undefined)
})

test('the first lookup that finds the ratings not ready starts the recalculation, once', async () => {
  const { startFitIfIdle } = await import('../netlify/functions/crews.js')
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, v) } }
  const req = new Request('https://x/api/paddler?club=BSF&name=anyone')
  const realFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (u, o) => { calls.push(String(u)); return { status: 202 } }
  try {
    assert.equal(await startFitIfIdle(st, req), 'no-races') // nothing read yet: the board's job
    assert.equal(calls.length, 0)
    files.set('manifest', { years: { 2025: { races: [{ key: '/r/a', date: Date.UTC(2025, 5, 1) }] } }, stored: { '/r/a': true } })
    const t0 = Date.UTC(2026, 10, 12, 10, 0)
    assert.equal(await startFitIfIdle(st, req, t0), 'started')
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/api\/crews-fit\?club=BSF$/)
    assert.equal(await startFitIfIdle(st, req, t0 + 60e3), 'running') // the next visitor doesn't start another
    assert.equal(calls.length, 1)
  } finally { globalThis.fetch = realFetch }
})
