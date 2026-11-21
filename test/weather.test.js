import test from 'node:test'
import assert from 'node:assert/strict'
import { createSwarm } from '../src/home/swarm.js'
import { sunTimes, light, nextWeather, WEATHER } from '../src/home/weather.js'

// a seeded random number generator, so a run is the same every time
const seeded = (seed = 7) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

function river({ wind = 0, rain = 0, seconds = 60, seed = 7 } = {}) {
  const swarm = createSwarm({ width: 1280, height: 800, zoom: 0.5, rng: seeded(seed) })
  const target = swarm.suggestedCount()
  for (let i = 0; swarm.paddlerCount() < target && i < target * 2; i++) swarm.spawn(true)
  swarm.takeArrivals()
  swarm.setWeather({ wind, rain })
  const seen = new Set()
  let overlaps = 0
  const moved = new Map(swarm.boats.map(b => [b.id, 0]))
  for (let t = 0; t < seconds * 30; t++) {
    const before = new Map(swarm.boats.map(b => [b.id, [b.x, b.y]]))
    swarm.step(1 / 30)
    swarm.takeArrivals(); swarm.takeDepartures()
    for (const b of swarm.boats) { const p = before.get(b.id); if (p) moved.set(b.id, (moved.get(b.id) || 0) + Math.hypot(b.x - p[0], b.y - p[1])) }
    for (const d of swarm.debris()) {
      seen.add(d.id)
      // nothing floats into a boat's hull
      for (const b of swarm.boats) if (!b.waiting && Math.hypot(b.x - d.x, b.y - d.y) < d.r) overlaps++
    }
  }
  return { swarm, seen, overlaps, moved }
}

test('wind brings debris down the river; paddlers and debris never run into each other', () => {
  const calm = river({ wind: 0, seconds: 30 })
  assert.equal(calm.seen.size, 0, 'no debris when it is calm')
  const windy = river({ wind: 1, seconds: 60 })
  assert.ok(windy.seen.size >= 4, `debris came down (${windy.seen.size})`)
  assert.equal(windy.overlaps, 0)
  // the paddlers kept going: most covered real distance
  const going = [...windy.moved.values()].filter(m => m > 200).length
  assert.ok(going >= windy.moved.size * 0.7, `${going} of ${windy.moved.size} kept paddling`)
})

test('rain raises the flow: quicker downstream, slower up', () => {
  const swarm = createSwarm({ width: 1280, height: 800, zoom: 0.5, rng: seeded(3) })
  assert.equal(swarm.current(), 0)
  swarm.setWeather({ rain: 1 })
  assert.ok(swarm.current() > 20)
})

test("time of day: sunrise and sunset in Bishop's Stortford, and how dark it is", () => {
  // midsummer: up before 5, down after 9 (BST); midwinter: about 8 till 4
  const june = sunTimes(new Date('2026-06-21T12:00:00+01:00'))
  assert.ok(june.rise > 4.4 && june.rise < 5.1 && june.set > 21 && june.set < 21.6, JSON.stringify(june))
  const dec = sunTimes(new Date('2026-12-21T12:00:00Z'))
  assert.ok(dec.rise > 7.8 && dec.rise < 8.3 && dec.set > 15.6 && dec.set < 16.2, JSON.stringify(dec))
  const at = h => light(new Date(`2026-10-22T${String(h).padStart(2, '0')}:00:00+01:00`))
  assert.equal(at(13).dark, 0)
  assert.ok(at(23).dark > 0.8)
  assert.ok(at(18).warm > 0 || at(18).dark > 0) // around sunset (about 17:50 in late October)
})

test('the weather changes: never the same twice running', () => {
  const r = seeded(5)
  let w = 'fair'
  for (let i = 0; i < 50; i++) {
    const n = nextWeather(w, r)
    assert.notEqual(n, w)
    assert.ok(WEATHER[n])
    w = n
  }
})

test('diamonds of 3 or 4 racing boats come through often, and slower paddlers pull over for quicker boats', () => {
  const swarm = createSwarm({ width: 1920, height: 1080, zoom: 0.5, rng: seeded(21) })
  const target = Math.round(swarm.suggestedCount() * 0.9) // as the page starts
  for (let i = 0; swarm.paddlerCount() < target && i < target * 2; i++) swarm.spawn(true)
  const seen = new Set()
  let pulledOver = 0
  // (four minutes: most now set out from the club and stay out a while, up to the lock and back)
  for (let t = 0; t < 240 * 30; t++) {
    swarm.step(1 / 30); swarm.takeArrivals(); swarm.takeDepartures()
    for (const b of swarm.boats) {
      if (b.group != null && !b.club) seen.add(b.group)
      if (b.makeWay > 0) pulledOver++
    }
  }
  assert.ok(seen.size >= 3, `${seen.size} diamonds in four minutes`)
  assert.ok(pulledOver > 0, 'slower paddlers pulled over to let quicker boats by')
})

test('the club stretch: narrowboats moored on the old river stay put; the clubhouse and boatshed are back from the water', () => {
  const swarm = createSwarm({ width: 1600, height: 900, zoom: 0.5, rng: seeded(9) })
  const moored = swarm.spawnMoorings(3)
  assert.ok(moored.length >= 1)
  const r = swarm.river()
  for (const b of moored) assert.equal(r.query(b.x, b.y).ch, 1) // on the old river
  const at = moored.map(b => [b.x, b.y])
  for (let i = 0; i < swarm.suggestedCount(); i++) swarm.spawn(true)
  for (let t = 0; t < 400 * 30; t++) { swarm.step(1 / 30); swarm.takeArrivals(); swarm.takeDepartures() }
  moored.forEach((b, i) => { assert.ok(b.moored && Math.hypot(b.x - at[i][0], b.y - at[i][1]) < 1, 'still on its moorings') })
  // a grassy bank and the towpath between the buildings and the river
  for (const b of [r.site.clubhouse, r.site.boatshed]) assert.ok(r.inside(b.x, b.y) < -b.wid / 2 - 40)
  assert.ok(r.site.towpath.length > 10)
})
