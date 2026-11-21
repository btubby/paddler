// Race mode for the homepage: five kayaks line up on the water below the club, the starter calls
// "On your marks... Set... GO!", and they race downstream to a finish line. The player steers
// one of them (swarm.js keeps the boats in its list so the page draws them; here they are moved).
//
// Plain JavaScript with no Vue in it, so it can be exercised headless (test/race.test.js).
//
//   Controls (the page wires the keys): stroke() on each paddle tap, steer(-1|0|1), brake(on).
//   A stroke pushes the boat forward; how much depends on the rhythm: tapping too fast splashes
//   and is wasted, a steady beat of about 2.6 strokes a second is best, and a run of well-timed
//   strokes builds a small bonus.
//
// Phases: lineup (get on the start line; the starter waits for you, but not forever) ->
// marks -> set -> racing -> finished.
//
// All distances are world px, measured along the main channel from its top end ("d"), with "s"
// the offset across the river (positive to the right of the flow), as in swarm.js.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const TAU = Math.PI * 2
const wrap = a => {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

export const BOAT_NAMES = ['Kingfisher', 'Heron', 'Otter', 'Swan', 'Moorhen']
// hull / deck / shirt / helmet for each lane's boat; the player's is the first
export const LOOKS = [
  { hull: '#e63946', deck: '#ffffff', shirt: '#1d3557', helmet: '#ffe600', design: '' },
  { hull: '#1d78d6', deck: '#bfe3ff', shirt: '#0b2e55', helmet: '#ffffff', design: '' },
  { hull: '#2aa84a', deck: '#d7f5d0', shirt: '#14532d', helmet: '#ffffff', design: '' },
  { hull: '#8e44ad', deck: '#e8d5f2', shirt: '#3b1450', helmet: '#ffffff', design: '' },
  { hull: '#ff7f2a', deck: '#ffe2c6', shirt: '#7a2e00', helmet: '#ffffff', design: '' }
]

export const TUNE = {
  lanes: 5,
  bow: 50, // px from a boat's middle to its bow
  zoneBehind: 70, // the bow within this far behind the line counts as lined up
  minLineup: 12, // seconds before the starter will call, at the soonest
  maxLineup: 34, // ...and the longest the starter waits for the player
  holdOnLine: 0.8, // seconds lined up before the call
  marksFor: 1.8,
  setFor: [1.0, 2.4],
  falseStart: 3, // seconds added for crossing the line early
  drag: 0.55, // per second
  impulse: 22, // px/s a perfect stroke adds
  minGap: 0.2, // strokes closer than this splash and count for nothing
  // balance: mistakes (the same side twice, splashing, hitting a bank or a boat) rock the boat; steady good strokes and
  // time steady it. Too much and you fall in, which loses the race.
  rockSame: 0.1, rockSplash: 0.035, rockBump: 0.08, steadyStroke: 0.09, steadyRate: 0.12, // (out of 1)
  sameSide: 0.15, // a stroke on the same side as the last one is worth this much
  sweet: [0.32, 0.55], // the best gap between strokes, seconds
  turn: 1.9, // rad/s at full lock and full speed
  topSpeed: 112, // for the speed bar
  aiBase: 92, // px/s: a steady, well-timed paddler beats all of these; a sloppy one loses to most
  aiSkill: [-10, -5, 0, 5, 10],
  maxLength: 1700,
  goodLength: 1000, // a shorter course than this (a small screen) starts further up, past the club
  timeout: 110, // seconds of racing before the rest are counted as not finished
  afterWinner: 10 // ...and after the player has finished
}

// how well a stroke lands, by the gap since the last one (seconds)
export function efficiency(gap, t = TUNE) {
  if (gap < t.minGap) return 0
  const [lo, hi] = t.sweet
  if (gap < lo) return 0.35 + 0.65 * (gap - t.minGap) / (lo - t.minGap)
  if (gap <= hi) return 1
  return gap < 1 ? 1 - 0.2 * (gap - hi) / (1 - hi) : 0.8
}

// ---- the course -----------------------------------------------------------------------------
export function planCourse(river) {
  const ch = river.channels[0]
  const pts = ch.pts
  const n = pts.length
  const cum = [0]
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  const li = river.site?.landingIndex ?? Math.floor(n / 2)
  const seen = i => river.inView(pts[i], -80)
  const find = from => {
    let s = Math.min(from, n - 2)
    while (s < n - 2 && !seen(s)) s++
    let f = s
    while (f + 1 < n && seen(f + 1) && cum[f + 1] - cum[s] < TUNE.maxLength) f++
    return [s, Math.max(s, f - 5)] // the finish a little short of the edge of the screen
  }
  const lockHi = river.site?.lockRange?.[1] ?? 0
  let [iS, iF] = find(li + 26)
  // a short stretch on this screen (a phone, say): the line goes further up, past the club, so there is a race to be had
  while (cum[iF] - cum[iS] < TUNE.goodLength && iS - 1 > lockHi + 30 && seen(iS - 1)) iS--
  const line = i => {
    const [x, y] = pts[i]
    const [tx, ty] = ch.tan[i]
    const nx = -ty, ny = tx
    return { i, x, y, a: [x - nx * ch.half, y - ny * ch.half], b: [x + nx * ch.half, y + ny * ch.half], angle: Math.atan2(ty, tx) }
  }
  return { cum, landing: li, iStart: iS, iFinish: iF, startD: cum[iS], finishD: cum[iF], length: cum[iF] - cum[iS], half: ch.half, start: line(iS), finish: line(iF) }
}

// ---- the race -------------------------------------------------------------------------------
export function createRace(river, rng = Math.random, tune = {}) {
  const T = { ...TUNE, ...tune }
  const ch = river.channels[0]
  const pts = ch.pts
  const n = pts.length
  const course = planCourse(river)
  const { cum } = course
  const half = ch.half
  const rand = (a, b) => a + rng() * (b - a)

  // the point at distance d along the channel, and offset s across it
  function poseAt(d, s) {
    let lo = 0, hi = n - 1
    d = clamp(d, 0, cum[n - 1])
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m }
    const seg = cum[hi] - cum[lo] || 1
    const f = (d - cum[lo]) / seg
    let tx = ch.tan[lo][0] * (1 - f) + ch.tan[hi][0] * f
    let ty = ch.tan[lo][1] * (1 - f) + ch.tan[hi][1] * f
    const l = Math.hypot(tx, ty) || 1
    tx /= l; ty /= l
    const cx = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * f
    const cy = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * f
    return { x: cx - ty * s, y: cy + tx * s, h: Math.atan2(tx, -ty), tx, ty }
  }
  // where a point is on the course: distance along, offset across
  function whereIs(x, y, last) {
    const q = river.query(x, y)
    if (q.ch !== 0) return { d: last, s: 0, off: true }
    const i = Math.round(q.along * (n - 1))
    return { d: cum[i] + (x - q.cx) * q.tx + (y - q.cy) * q.ty, s: q.s, off: false }
  }

  const laneS = i => (i - (T.lanes - 1) / 2) * ((half - 30) / ((T.lanes - 1) / 2))
  const slotBowGap = () => 4 + rand(0, 5)
  const lanes = [...Array(T.lanes).keys()]
  // the player starts from the landing stage on the club's bank, so is given one of the two lanes there
  // (no need to push through the others to reach it)
  const clubSide = river.site?.clubSide || 1
  const playerLane = clubSide < 0 ? Math.floor(rng() * 2) : T.lanes - 1 - Math.floor(rng() * 2)
  const skills = [...T.aiSkill].sort(() => rng() - 0.5)

  const entrants = lanes.map(lane => {
    const you = lane === playerLane
    const idx = you ? 0 : lanes.filter(l => l !== playerLane).indexOf(lane) + 1
    const e = {
      you, lane, name: you ? 'You' : BOAT_NAMES[idx - 1] || 'Boat ' + idx, look: LOOKS[you ? 0 : idx],
      boat: null, d: 0, s: laneS(lane), x: 0, y: 0, h: 0, v: 0, finished: false, time: null, penalty: 0,
      top: 0, react: rand(0.18, 0.45), wob: rand(0, TAU), wobT: rand(2, 3.4), slotD: 0, bowD: 0
    }
    if (!you) {
      e.top = T.aiBase + skills[idx - 1] + rand(-2.5, 2.5)
      e.slotD = course.startD - T.bow - slotBowGap()
      e.d = e.slotD - rand(300, 380) // (they come down the river from above the club, past the landing stage)
      const p = poseAt(e.d, e.s)
      Object.assign(e, { x: p.x, y: p.y, h: p.h })
    } else {
      e.d = cum[course.landing]
      e.s = clubSide * (half - 26)
      const p = poseAt(e.d, e.s)
      // (a line above the landing stage: they set off facing it, and turn round at the line)
      Object.assign(e, { x: p.x, y: p.y, h: course.iStart < course.landing ? p.h + Math.PI : p.h })
    }
    return e
  })
  const player = entrants.find(e => e.you)
  player.stroke = { last: -9, streak: 0, side: 1, eff: 0 }
  player.steer = 0
  player.brake = false
  player.balance = 0
  player.capsized = false

  const st = {
    phase: 'lineup', clock: 0, phaseT: 0, raceT: 0, setFor: rand(...T.setFor), inZoneFor: 0, inZone: false,
    falseStart: false, bumps: 0, bumpCool: 0, finishedAt: null, done: false, call: '', hint: ''
  }
  const dMin = Math.min(cum[course.landing], course.startD - 160) - 30 // not back behind the landing stage, or the line
  const sync = e => {
    if (!e.boat) return
    e.boat.x = e.x
    e.boat.y = e.y
    e.boat.heading = e.h
    e.boat.speed = Math.abs(e.v)
    e.boat.pace = 60
    e.boat.opacity = e.capsized ? 0.45 : clamp(st.clock / 0.8, 0, 1) // (they fade in; a boat that has tipped over is half under)
    e.boat.capsized = !!e.capsized
  }

  function inZone() {
    const bow = player.d + T.bow
    const tan = poseAt(player.d, 0).h
    const aligned = Math.abs(wrap(player.h - tan)) < 0.8
    return bow <= course.startD - 2 && bow >= course.startD - T.zoneBehind && aligned && Math.abs(player.s) < half - 14
  }
  function begin(phase) {
    st.phase = phase
    st.phaseT = 0
    st.call = phase === 'marks' ? 'ON YOUR MARKS' : phase === 'set' ? 'SET' : phase === 'racing' ? 'GO!' : st.call
  }
  function penalise(why) {
    if (player.penalty || st.phase === 'finished') return
    player.penalty = T.falseStart
    st.falseStart = true
    st.hint = why
  }

  function rock(n) {
    if (player.capsized || player.finished) return
    player.balance = Math.min(1, player.balance + n)
    if (player.balance >= 1) {
      player.capsized = true
      st.call = 'YOU FELL IN!'
      st.hint = 'Too many mistakes: you are out of the race'
    }
  }
  function stepPlayer(dt) {
    const p = player
    const driving = !p.finished && !p.capsized
    const steer = driving ? p.steer : 0
    const speedK = clamp(Math.abs(p.v) / 35, 0, 1)
    p.h += T.turn * steer * (0.3 + 0.7 * speedK) * dt
    if (driving && p.brake) p.v = Math.max(-16, p.v - 75 * dt)
    p.v *= Math.exp(-(T.drag + 0.3 * Math.abs(steer) + (p.finished ? 1.1 : 0) + (p.capsized ? 2.2 : 0)) * dt)
    p.x += Math.sin(p.h) * p.v * dt
    p.y -= Math.cos(p.h) * p.v * dt
    // the banks (and not back behind the landing stage)
    const w = whereIs(p.x, p.y, p.d)
    const lim = half - 18
    if (!w.off && Math.abs(w.s) > lim) {
      const q = river.query(p.x, p.y)
      const over = Math.abs(q.s) - lim
      const sg = Math.sign(q.s)
      p.x += sg * over * q.ty
      p.y -= sg * over * q.tx
      if (over > 1.5 && st.bumpCool <= 0) { st.bumps++; st.bumpCool = 0.8; p.v *= 0.55 }
    }
    const w2 = whereIs(p.x, p.y, p.d)
    if (!w2.off) { p.d = w2.d; p.s = w2.s }
    if (p.d < dMin) {
      const t = poseAt(dMin, p.s)
      p.x += t.tx * (dMin - p.d)
      p.y += t.ty * (dMin - p.d)
      p.d = dMin
      p.v = Math.max(0, p.v)
    }
  }
  // boats are not allowed through each other: only the player gives way
  function bump() {
    const p = player
    const c = e => { const f = 22; return [[e.x + Math.sin(e.h) * f, e.y - Math.cos(e.h) * f], [e.x - Math.sin(e.h) * f, e.y + Math.cos(e.h) * f]] }
    for (const o of entrants) {
      if (o === p) continue
      for (const a of c(p)) for (const b of c(o)) {
        const dx = a[0] - b[0], dy = a[1] - b[1]
        const dist = Math.hypot(dx, dy)
        if (dist < 22 && dist > 0.01) {
          const push = (22 - dist) / 2 + 0.5
          p.x += (dx / dist) * push
          p.y += (dy / dist) * push
          if (st.bumpCool <= 0) { st.bumps++; st.bumpCool = 0.8; p.v *= 0.8 }
        }
      }
    }
  }
  function stepAI(e, dt) {
    if (st.phase === 'lineup') {
      const gap = e.slotD - e.d
      const want = gap > 0.5 ? clamp(gap * 0.9, 6, 46) : 0
      e.v += (want - e.v) * Math.min(1, 3 * dt)
      e.d = Math.min(e.slotD, e.d + e.v * dt)
    } else if (st.phase === 'marks' || st.phase === 'set') {
      e.v += (0 - e.v) * Math.min(1, 4 * dt)
    } else {
      const since = st.raceT - e.react
      if (e.finished) e.v *= Math.exp(-1.6 * dt)
      else if (since > 0) {
        e.wob += dt * TAU / e.wobT
        const target = e.top * (1 + 0.035 * Math.sin(e.wob)) * (1 - Math.exp(-since / 1.4) * 0.55)
        e.v += (target - e.v) * Math.min(1, 1.8 * dt)
      }
      e.d += e.v * dt
    }
    // keep out of the player's way: a boat close alongside (or sitting where it will pass) shifts over
    let avoid = 0
    const dd = player.d - e.d
    const ds = player.s - e.s
    if (Math.abs(dd) < 85 && Math.abs(ds) < 32) avoid = -Math.sign(ds || (e.lane < T.lanes / 2 ? 1 : -1)) * (32 - Math.abs(ds))
    const sTo = clamp(laneS(e.lane) + (st.phase === 'racing' ? 5 * Math.sin(e.wob * 0.7 + e.lane) : 0) + avoid, -(half - 22), half - 22)
    e.s += (sTo - e.s) * Math.min(1, 2.5 * dt)
    const p = poseAt(e.d, e.s)
    e.x = p.x; e.y = p.y; e.h = p.h
  }

  function standings() {
    return [...entrants].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.time - b.time : (b.d - a.d)))
  }

  function step(dt) {
    if (st.done) return
    st.clock += dt
    st.phaseT += dt
    st.bumpCool = Math.max(0, st.bumpCool - dt)

    if (st.phase === 'lineup' || st.phase === 'marks' || st.phase === 'set') {
      st.inZone = inZone()
      st.inZoneFor = st.inZone ? st.inZoneFor + dt : 0
      if (st.phase === 'lineup') {
        st.hint = st.phaseT < T.minLineup ? 'Paddle out to the start line and line up behind it'
          : st.inZone ? 'Hold it there...' : st.phaseT < T.maxLineup ? 'The starter is waiting: get behind the line, facing downstream' : 'Starting anyway!'
        if ((st.phaseT >= T.minLineup && st.inZoneFor >= T.holdOnLine) || st.phaseT >= T.maxLineup) begin('marks')
      } else {
        st.hint = 'Stay behind the line!'
        if (player.d + T.bow > course.startD + 2) penalise('FALSE START: ' + T.falseStart + ' seconds added')
        if (st.phase === 'marks' && st.phaseT >= T.marksFor) begin('set')
        else if (st.phase === 'set' && st.phaseT >= st.setFor) {
          if (player.d + T.bow > course.startD + 2) penalise('Over the line at the start: ' + T.falseStart + ' seconds added')
          begin('racing')
          st.hint = player.penalty ? st.hint : ''
        }
      }
    } else if (st.phase === 'racing') {
      st.raceT += dt
      if (st.raceT > 5 && !player.penalty) st.hint = ''
    }

    const bumps0 = st.bumps
    stepPlayer(dt)
    bump()
    if (st.phase === 'racing' && st.bumps > bumps0) rock(T.rockBump)
    if (st.phase === 'racing' && !player.capsized) player.balance = Math.max(0, player.balance - T.steadyRate * dt)
    for (const e of entrants) if (e !== player) stepAI(e, dt)
    for (const e of entrants) e.bowD = e.d + T.bow

    if (st.phase === 'racing') {
      for (const e of entrants) {
        if (!e.finished && e.bowD >= course.finishD) {
          const over = (e.bowD - course.finishD) / Math.max(20, Math.abs(e.v))
          e.finished = true
          e.time = Math.max(0.1, st.raceT - over) + e.penalty
          if (e === player) { st.finishedAt = st.raceT; st.call = 'FINISHED' }
        }
      }
      const everyone = entrants.every(e => e.finished || e.capsized)
      if (everyone || (player.finished && st.raceT - st.finishedAt > T.afterWinner) || st.raceT > T.timeout) {
        st.phase = 'finished'
        st.done = true
        st.call = player.finished ? 'FINISHED' : player.capsized ? 'YOU FELL IN!' : 'TIME'
      }
    }
    for (const e of entrants) sync(e)
  }

  function results() {
    const order = standings()
    const best = order.find(e => e.finished)
    return order.map((e, i) => ({ place: i + 1, name: e.name, you: e.you, time: e.finished ? e.time : null, penalty: e.penalty, fell: !!e.capsized, gap: e.finished && best ? e.time - best.time : null, look: e.look }))
  }

  return {
    course, entrants, player, state: st, step, results, standings, poseAt, laneS,
    // side: -1 (left blade) or 1 (right blade). A kayak is paddled by alternating, so two strokes on the
    // same side in a row barely move it. (No side given: counts as alternating.)
    stroke(side) {
      if (st.done || player.finished || player.capsized) return 0
      const gap = st.clock - player.stroke.last
      let eff = player.stroke.last < 0 ? 0.8 : efficiency(gap, T)
      if (player.stroke.last >= 0 && gap < T.minGap) return 0
      const repeat = side != null && side === player.stroke.side
      if (repeat) eff *= T.sameSide
      if (st.phase === 'racing') {
        if (repeat) rock(T.rockSame)
        else if (eff < 0.7) rock(T.rockSplash)
        else player.balance = Math.max(0, player.balance - T.steadyStroke * (eff >= 0.95 ? 1 : 0.4))
      }
      player.stroke.streak = eff >= 0.95 ? player.stroke.streak + 1 : 0
      player.stroke.eff = eff
      player.stroke.last = st.clock
      player.stroke.side = side != null ? side : -player.stroke.side
      player.v += T.impulse * eff * (1 + 0.015 * Math.min(player.stroke.streak, 5))
      return eff
    },
    steer(d) { player.steer = clamp(d, -1, 1) },
    brake(on) { player.brake = !!on },
    // what the panel shows
    hud() {
      const order = standings()
      const place = order.indexOf(player) + 1
      const prog = clamp((player.d + T.bow - course.startD) / course.length, 0, 1)
      return {
        phase: st.phase, call: st.call, hint: st.hint, raceT: st.raceT, lineT: st.phaseT,
        waitLeft: st.phase === 'lineup' ? Math.max(0, T.minLineup - st.phaseT) : 0,
        place, of: entrants.length, speed: clamp(Math.abs(player.v) / T.topSpeed, 0, 1),
        rhythm: clamp(player.stroke.eff, 0, 1), streak: player.stroke.streak, strokeAgo: st.clock - player.stroke.last,
        inZone: st.inZone, penalty: player.penalty, falseStart: st.falseStart, bumps: st.bumps, progress: prog,
        balance: player.balance, capsized: player.capsized, finished: player.finished, done: st.done
      }
    }
  }
}
