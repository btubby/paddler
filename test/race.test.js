import test from 'node:test'
import assert from 'node:assert/strict'
import { createSwarm } from '../src/home/swarm.js'
import { createRace, efficiency, planCourse, TUNE } from '../src/home/race.js'

function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
const SIZES = [[1440, 900], [390, 844], [820, 1180], [1920, 1080], [1024, 768]]
const RACE_SIZES = SIZES.filter(([w]) => w !== 390) // (a phone's line is above the stage: the player turns round first)
const riverFor = (w, h) => createSwarm({ width: w, height: h, zoom: 0.5, turnover: false, rng: mulberry(5) }).river()
const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a))

// a simple player: strokes every `gap` seconds, keeps to its lane, eases up short of the line
function drive(race, { gap = 0.4, early = false, idle = false, maxT = 200 } = {}) {
  const dt = 1 / 60
  const p = race.player
  const c = race.course
  const lane = race.laneS(p.lane)
  let next = 0
  let t = 0
  for (let i = 0; i < maxT * 60 && !race.state.done; i++) {
    t += dt
    if (!idle) {
      const ph = race.state.phase
      const bow = p.d + TUNE.bow
      if (ph === 'racing') {
        race.brake(false)
        if (!p.finished && t >= next) { race.stroke(); next = t + gap }
      } else if (early && ph === 'set') {
        if (t >= next) { race.stroke(); next = t + gap }
      } else {
        const room = c.startD - 25 - bow // how far short of the line it wants to stop
        const coast = Math.max(0, p.v) / TUNE.drag // (how far it will glide)
        if (room > coast + 60 && p.v < 40) { if (t >= next) { race.stroke(); next = t + 0.45 } race.brake(false) }
        else race.brake(p.v > 0 && room < coast - 10)
      }
      // steer along the course, towards its lane
      const want = race.poseAt(p.d, 0).h + Math.max(-0.4, Math.min(0.4, (lane - p.s) * 0.02))
      const err = wrapA(want - p.h)
      race.steer(Math.abs(err) < 0.04 ? 0 : Math.sign(err))
    }
    race.step(dt)
  }
}

test('stroke efficiency: a steady beat is best, splashing and long gaps are worse', () => {
  assert.equal(efficiency(0.1), 0)
  assert.ok(efficiency(0.25) > 0.35 && efficiency(0.25) < 1)
  assert.equal(efficiency(0.45), 1)
  assert.ok(efficiency(0.8) < 1 && efficiency(0.8) >= 0.8)
  assert.equal(efficiency(3), 0.8)
})

test('the course fits on the screen, below the club, on every screen shape', () => {
  for (const [w, h] of SIZES) {
    const river = riverFor(w, h)
    const c = planCourse(river)
    assert.ok(c.length >= 400, `${w}x${h}: course ${c.length.toFixed(0)}px`)
    assert.ok(c.iFinish > c.iStart)
    for (const l of [c.start, c.finish]) assert.ok(river.inView([l.x, l.y], 0), `${w}x${h}: line in view`)
  }
})

test('five boats, one of them the player, line up behind the start line', () => {
  const race = createRace(riverFor(1440, 900), mulberry(3))
  assert.equal(race.entrants.length, 5)
  assert.equal(race.entrants.filter(e => e.you).length, 1)
  for (let i = 0; i < 60 * 14; i++) race.step(1 / 60)
  assert.equal(race.state.phase, 'lineup')
  for (const e of race.entrants.filter(e => !e.you)) assert.ok(e.d + TUNE.bow < race.course.startD, 'behind the line')
})

test('a steady paddler finishes among the front boats, and everyone gets a result', () => {
  let places = []
  for (const [w, h] of RACE_SIZES) for (const seed of [1, 2, 3]) {
    const river = riverFor(w, h)
    const race = createRace(river, mulberry(seed))
    drive(race, { gap: 0.4 })
    assert.ok(race.state.done, `${w}x${h}/${seed} finished`)
    const r = race.results()
    assert.equal(r.length, 5)
    const me = r.find(x => x.you)
    assert.ok(me.time > 6 && me.time < 70, `${w}x${h}/${seed}: ${me.time} s`)
    places.push(me.place)
    for (const e of race.entrants) assert.ok(river.inside(e.x, e.y) > 0, 'boats stay on the water')
  }
  assert.ok(places.filter(p => p <= 3).length >= places.length - 2, 'steady paddling is competitive: ' + places)
})

test('splashing (tapping far too fast) is slower than a steady beat', () => {
  const river = riverFor(1440, 900)
  const a = createRace(river, mulberry(7)); drive(a, { gap: 0.4 })
  const b = createRace(river, mulberry(7)); drive(b, { gap: 0.22 })
  const ta = a.results().find(x => x.you).time
  const tb = b.results().find(x => x.you)?.time ?? Infinity
  assert.ok(tb > ta, `splashing ${tb} vs steady ${ta}`)
})

test('crossing the line before GO costs time', () => {
  const race = createRace(riverFor(1440, 900), mulberry(4))
  drive(race, { gap: 0.4, early: true })
  assert.equal(race.state.falseStart, true)
  assert.equal(race.player.penalty, TUNE.falseStart)
})

test('the starter does not wait forever for a player who never moves, and the race still ends', () => {
  const race = createRace(riverFor(1440, 900), mulberry(9))
  drive(race, { idle: true, maxT: 400 })
  assert.ok(race.state.done)
  const r = race.results()
  assert.equal(r.find(x => x.you).time, null)
  assert.equal(r.find(x => x.you).place, 5)
})

test('too many mistakes and the player falls in and loses; steady paddling does not', () => {
  const run = alt => {
    const race = createRace(riverFor(1440, 900), mulberry(3))
    const p = race.player
    // skip the line-up: put the race straight into its racing phase
    race.state.phase = 'racing'
    let side = 1
    for (let i = 0; i < 40 && !p.capsized; i++) {
      for (let t = 0; t < 0.4; t += 1 / 60) race.step(1 / 60)
      if (alt) side = -side
      race.stroke(side)
    }
    return p.capsized
  }
  assert.equal(run(true), false, 'alternating steadily is fine')
  assert.equal(run(false), true, 'the same side over and over tips you in')
  const race = createRace(riverFor(1440, 900), mulberry(3))
  race.state.phase = 'racing'
  race.player.capsized = true
  assert.equal(race.stroke(1), 0, 'a boat that has tipped over cannot paddle')
})
