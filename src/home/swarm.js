// Motion engine for the kayakers on the river.
//
// Plain JavaScript with no Vue in it, so the same code can be exercised headless.
// Two rules: no kayaker ever overlaps another (hull, the whole sweep of the paddle,
// the stern wake and the drop shadow), and kayakers stay on the water, between the banks.
//
// How the rules are kept:
//   1. Every boat has a footprint made of circles, one shape per boat type (see TYPES).
//   2. Each boat paddles up or down the river in its own lane on the right-hand side
//      (like road traffic, so oncoming boats pass left side to left side). It looks
//      ahead along a few possible turns, predicting where its neighbours will be, and
//      picks the one that keeps the most water between it, them and the banks, slowing
//      down when it is hemmed in.
//   3. As a last line of defence, a move is only applied if the new position and
//      heading are clear of other boats and don't push the boat further into a bank.
//   4. Boats that paddle off either end of the river come back in, out of sight, at the
//      top or the bottom, heading the other way or the same way at random.

export const MAX_BOATS = 60
export const GAP = 8 // px of clear water normally kept between two kayakers
const SQUEEZE_GAP = 2 // ...which a boat boxed in for a while may squeeze to while working free (never 0)
const PLAN_GAP = GAP + 6 // clearance required when dropping a new boat in
const COMFORT = 36 // px: boats start steering away from each other inside this distance
const SLOW_MIN = 0.25 // the most a paddler eases off when the way ahead is tight
const SLOW_DIST = 36 // px: ease off only when the best path still passes this close
const FOLLOW_MIN = 15 // px/s: a boat ahead going slower than this is paddled round, not followed
const ACCEL = 1 // how quickly a boat gets back up to speed
const OVERTAKE_LOOK = 320 // px (at the usual boat size) to look ahead for oncoming boats
const KEEP_RIGHT_CLEAR = 4 // keep-right when nothing is coming the other way: free to pull out and overtake
const MAX_TURN = 1.1 // rad/s
// Two-way traffic: craft head both up and down the river and keep to their right.
const VESSEL_SCALE = 0.72 // narrowboats, relative to the kayaks' scale
const UPSTREAM = 0.45 // share of craft heading upstream
const KEEP_RIGHT = 16 // how strongly paddlers avoid the left of the river (oncoming traffic)
const KEEP_RIGHT_FROM = 0.05 // ...measured from just right of the middle
const KEEP_RIGHT_NEAR_VESSEL = 2 // ...doubled near a narrowboat, where a head-on meeting jams
const KEEP_RIGHT_MOORED = 0.25 // ...and eased off to pull out round a boat moored on its side
const GIVE_WAY_MAX = 6 // seconds a paddler waits to let oncoming traffic past a moored boat
const CRUISE_LANE = 0.33 // a cruising narrowboat keeps a third of the way out to its right
const MAKE_WAY_LANE = 0.62 // a paddler letting a quicker boat by pulls over this far towards its bank
const DENSITY = 0.046 // share of the water kayakers fill (two-way traffic needs room to pass; more and they pile up)
const LOOK_TIME = 1.2 // seconds of look-ahead
const LOOK_STEPS = 4
const STEP_WEIGHT = [1.3, 1.1, 0.9, 0.7] // trouble sooner matters more than trouble later

const TAU = Math.PI * 2
// Ripples: a tap or click on the water sends out rings, and paddlers steer round them
const RIPPLE_LIFE = 2.6 // seconds a ripple disturbs the water
const RIPPLE_R = 80 // px (world, at the usual boat size): how far out paddlers keep clear
const RIPPLE_COST = 8 // how strongly they avoid it (bank and boat trouble go up to 4)
const MAX_RIPPLES = 6
// Turning round: a paddler held up behind a busy stretch may spin round and go back the way
// it came (and now and then one turns for no reason, at the end of a piece of work)
const HELD_TURN = 4 // seconds held up (well under its pace) before thinking about it
const BUSY_AHEAD = 3 // ...and only if at least this many boats are in the way ahead
const TURN_LOOK = 260 // px (world, at the usual boat size) ahead counted as "in the way"
const TURN_ROOM = 0.4 // clear water needed all round, in boat lengths (from its middle), to swing round in
const TURN_COOLDOWN = 30 // seconds before the same paddler turns round again
const TURN_ANYWAY = 1 / 600 // chance per second of turning when the way is clear
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const wrapAngle = (d) => {
  d = (d + Math.PI) % TAU
  if (d < 0) d += TAU
  return d - Math.PI
}

const BOAT_HALF = 55 // half the width of a kayaker incl. paddle sweep, in SVG units

// ---- boat types -----------------------------------------------------------------
// Each type has a drawing (see components/Kayaker.vue) and, in the same SVG units measured
// from the centre of its box (bow points up), a collision footprint made of circles:
//   k1     the everyday single kayak                           box 120 x 170
//   racer  a longer, thinner, faster single (racing K1)        box 120 x 200
//   k2     a two-person kayak, two paddlers in step            box 120 x 240
//   c1     a high-kneeling racing canoe, single-bladed paddle  box 120 x 210
//   canoe  an open (Canadian) canoe for two, one blade each    box 120 x 230
//   oc1    an outrigger canoe: slim hull plus a float out on    box 120 x 230
//          the left, about three times as wide as a K1          (float at x -60)
//   narrowboat  a long pleasure boat, moored or cruising slowly  box 120 x 520
//               (not a paddler: see spawnVessel)
// Footprints cover the hull (circles every 8 units, generated from the drawn outline, each
// 4 units wider than the hull there), the whole sweep of each paddle and the stern wake,
// and are deliberately a little generous.
function footprint({ hull, wake, paddles, blades, extra }) {
  const c = hull.map(([y, r]) => [0, y, r])
  c.push(...wake)
  if (extra) c.push(...extra) // anything off the centre line: an outrigger's float and arms
  // canoes: a single blade on one side (either side, so both are covered), drawn back
  // along the hull from well ahead of the paddler to behind the hips
  if (blades) {
    const [reach, ...seats] = blades
    for (const py of seats) for (const side of [-1, 1]) for (const dy of [-26, -14, -2, 10, 20]) c.push([side * (reach - 4), py + dy, 10])
    // the grip hand, across the body from the blade
    for (const py of seats) for (const side of [-1, 1]) for (const dy of [-26, -16, -6, 4, 14]) c.push([side * 11, py + dy, 7])
  }
  for (const py of paddles) {
    // paddle: shaft sweep plus the arc each blade travels (+/-24 degrees about the pivot)
    for (const side of [-1, 1]) {
      c.push([side * 22, py, 9], [side * 34, py, 12])
      for (const deg of [-24, -12, 0, 12, 24]) {
        const a = (deg * Math.PI) / 180
        c.push([side * 44 * Math.cos(a), py + 44 * Math.sin(a), 9])
      }
    }
  }
  return c
}
// A cheaper, fatter footprint used only for planning ahead (the exact one still decides
// what is allowed to happen).
function coarse({ hull, wake, paddles, blades, extra }) {
  const c = hull.map(([y, r]) => [0, y, r])
  c.push(wake)
  if (extra) c.push(...extra)
  if (blades) {
    const [reach, ...seats] = blades
    for (const py of seats) c.push([-(reach + 2), py - 12, 21], [reach + 2, py - 12, 21], [-(reach + 2), py + 10, 21], [reach + 2, py + 10, 21])
  }
  for (const py of paddles) c.push([-26, py, 12], [-42, py, 18], [26, py, 12], [42, py, 18])
  return c
}
// A narrowboat seen from above: pointed bow (top), straight sides 33 units from the centre
// line, square-ish stern. Circles every `step` units, `extra` wider than the hull.
function narrowHull(step, extra) {
  const c = []
  for (let y = -246; y <= 246; y += step) {
    const hw = y < -170 ? 33 * Math.sqrt(Math.max(0, (y + 250) / 80)) : 33
    c.push([y, +(Math.max(hw, 2) + extra).toFixed(1)])
  }
  return c
}
const SHAPES = {
  k1: {
    box: 170,
    pace: [28, 58],
    fine: { hull: [[-78, 6.7], [-70, 9.2], [-62, 11.2], [-54, 12.8], [-46, 14.1], [-38, 15.1], [-30, 15.8], [-22, 16.4], [-14, 16.7], [-6, 16.8], [2, 16.8], [10, 16.6], [18, 16.3], [26, 15.7], [34, 15], [42, 13.9], [50, 12.6], [58, 11], [66, 9], [74, 6.6]],
      wake: [[0, 92, 13], [-16, 94, 10], [16, 94, 10]], paddles: [3] },
    rough: { hull: [[-68, 9], [-42, 13], [-14, 15], [14, 15], [42, 13], [68, 9]], wake: [0, 92, 14], paddles: [3] }
  },
  racer: {
    box: 200,
    pace: [66, 92], // the thinner racing K1s: quicker...
    agility: 1.6, // ...and they turn more sharply
    fine: { hull: [[-93, 5.7], [-85, 7.2], [-77, 8.5], [-69, 9.5], [-61, 10.3], [-53, 11], [-45, 11.5], [-37, 12], [-29, 12.3], [-21, 12.5], [-13, 12.6], [-5, 12.6], [3, 12.6], [11, 12.5], [19, 12.4], [27, 12.1], [35, 11.7], [43, 11.3], [51, 10.7], [59, 10], [67, 9.1], [75, 8.2], [83, 7], [91, 5.7], [93, 5.4]],
      wake: [[0, 108, 11], [-13, 110, 8], [13, 110, 8]], paddles: [12] },
    rough: { hull: [[-80, 7], [-50, 10], [-18, 11], [14, 11], [46, 10], [78, 7]], wake: [0, 108, 12], paddles: [12] }
  },
  k2: {
    box: 240,
    pace: [45, 65],
    fine: { hull: [[-113, 6.3], [-105, 8.5], [-97, 10.2], [-89, 11.6], [-81, 12.8], [-73, 13.8], [-65, 14.7], [-57, 15.4], [-49, 16], [-41, 16.5], [-33, 16.9], [-25, 17.2], [-17, 17.4], [-9, 17.5], [-1, 17.5], [7, 17.5], [15, 17.4], [23, 17.2], [31, 16.9], [39, 16.5], [47, 16.1], [55, 15.5], [63, 14.7], [71, 13.9], [79, 12.9], [87, 11.7], [95, 10.3], [103, 8.6], [111, 6.7], [113, 6.1]],
      wake: [[0, 128, 13], [-16, 130, 10], [16, 130, 10]], paddles: [-34, 38] },
    rough: { hull: [[-100, 9], [-70, 13], [-38, 15], [-6, 15.5], [26, 15], [58, 14], [88, 11], [108, 7]], wake: [0, 128, 14], paddles: [-34, 38] }
  },
  c1: {
    box: 210,
    pace: [38, 58],
    fine: { hull: [[-98, 5.8], [-90, 7.7], [-82, 9.2], [-74, 10.4], [-66, 11.4], [-58, 12.3], [-50, 13], [-42, 13.6], [-34, 14.1], [-26, 14.5], [-18, 14.7], [-10, 14.8], [-2, 14.9], [6, 14.9], [14, 14.8], [22, 14.6], [30, 14.3], [38, 13.9], [46, 13.4], [54, 12.7], [62, 11.9], [70, 11], [78, 9.8], [86, 8.4], [94, 6.8], [98, 5.9]],
      wake: [[0, 108, 13], [-16, 110, 10], [16, 110, 10]], paddles: [], blades: [24, 13] },
    rough: { hull: [[-84, 9], [-54, 13], [-22, 15], [12, 15], [44, 14], [76, 10], [96, 7]], wake: [0, 108, 14], paddles: [], blades: [24, 13] }
  },
  oc1: {
    box: 230,
    pace: [40, 60],
    reach: 66, // the float sticks out this far (SVG units) to the left: keep it off the bank
    fine: { hull: [[-108, 5.3], [-100, 6.6], [-92, 7.6], [-84, 8.5], [-76, 9.2], [-68, 9.8], [-60, 10.3], [-52, 10.8], [-44, 11.1], [-36, 11.4], [-28, 11.6], [-20, 11.8], [-12, 11.9], [-4, 11.9], [4, 11.9], [12, 11.8], [20, 11.7], [28, 11.6], [36, 11.4], [44, 11.1], [52, 10.7], [60, 10.2], [68, 9.7], [76, 9.1], [84, 8.3], [92, 7.4], [100, 6.5], [108, 5.2]],
      wake: [[0, 116, 13], [-16, 118, 10], [16, 118, 10]], paddles: [], blades: [24, 11],
      extra: [[-60, -72, 5.3], [-60, -64, 6.5], [-60, -56, 7.3], [-60, -48, 8], [-60, -40, 8.5], [-60, -32, 8.8], [-60, -24, 9.1], [-60, -16, 9.2], [-60, -8, 9.3], [-60, 0, 9.2], [-60, 8, 9.2], [-60, 16, 9], [-60, 24, 8.8], [-60, 32, 8.4], [-60, 40, 7.9], [-60, 48, 7.2], [-60, 56, 6.4], [-60, 64, 5.3], [-6, -37.6, 5], [-13, -39.5, 5], [-20, -40.7, 5], [-27, -41.4, 5], [-34, -41.5, 5], [-41, -41.0, 5], [-48, -39.9, 5], [-55, -38.2, 5], [-6, 34.4, 5], [-13, 32.5, 5], [-20, 31.3, 5], [-27, 30.6, 5], [-34, 30.5, 5], [-41, 31.0, 5], [-48, 32.1, 5], [-55, 33.8, 5], [-64, 72, 7]] },
    rough: { hull: [[-96, 8], [-64, 11], [-32, 12], [0, 12], [32, 12], [64, 11], [96, 8]], wake: [0, 116, 14], paddles: [], blades: [24, 11],
      extra: [[-60, -60, 10], [-60, -30, 12], [-60, 0, 12], [-60, 30, 12], [-60, 60, 10], [-30, -41, 9], [-30, 31, 9]] }
  },
  canoe: {
    box: 230,
    pace: [22, 36],
    fine: { hull: [[-106, 7.6], [-98, 10.7], [-90, 13], [-82, 15], [-74, 16.6], [-66, 17.9], [-58, 19.1], [-50, 20], [-42, 20.8], [-34, 21.3], [-26, 21.8], [-18, 22.1], [-10, 22.3], [-2, 22.4], [6, 22.4], [14, 22.3], [22, 22.1], [30, 21.7], [38, 21.3], [46, 20.6], [54, 19.8], [62, 18.8], [70, 17.6], [78, 16.2], [86, 14.4], [94, 12.2], [102, 9.4], [106, 7.7]],
      wake: [[0, 116, 13], [-16, 118, 10], [16, 118, 10]], paddles: [], blades: [30, -53, 61] },
    rough: { hull: [[-96, 12], [-66, 18], [-34, 22], [0, 23], [34, 22], [66, 18], [96, 12]], wake: [0, 116, 14], paddles: [], blades: [30, -53, 61] }
  },
  narrowboat: {
    box: 520,
    pace: [13, 19],
    vessel: true,
    fine: { hull: narrowHull(10, 4), wake: [[0, 258, 16]], paddles: [] },
    rough: { hull: narrowHull(30, 7), wake: [0, 258, 20], paddles: [] }
  }
}
export const TYPES = Object.fromEntries(Object.entries(SHAPES).map(([name, t]) => {
  const fp = footprint(t.fine)
  const cfp = coarse(t.rough)
  return [name, {
    name, box: t.box, pace: t.pace, vessel: !!t.vessel, reach: t.reach || BOAT_HALF, agility: t.agility || 1, fp, cfp,
    n3: fp.length * 3,
    nc3: cfp.length * 3,
    // radius (in SVG units) of a circle around the centre that encloses the whole footprint
    bound: Math.max(...fp.map(([x, y, r]) => Math.hypot(x, y) + r), ...cfp.map(([x, y, r]) => Math.hypot(x, y) + r))
  }]
}))
const MAX_N3 = Math.max(...Object.values(TYPES).map(t => t.n3))
const MAX_NC3 = Math.max(...Object.values(TYPES).map(t => t.nc3))
// how often each type turns up: about 1 boat in 7 is a K2, 1 in 5 a private racer,
// and more than 1 in 4 a canoe of some kind
function pickType(rng) {
  const r = rng()
  if (r < 0.14) return TYPES.k2
  if (r < 0.34) return TYPES.racer // private boats
  if (r < 0.44) return TYPES.c1 // canoes: high kneelers,
  if (r < 0.53) return TYPES.canoe // open canoes
  if (r < 0.61) return TYPES.oc1 // and outriggers
  return TYPES.k1
}

// Footprint circles in world space, written into `out` as [x, y, r, x, y, r, ...]
function place(fp, x, y, heading, scale, out) {
  const c = Math.cos(heading)
  const s = Math.sin(heading)
  for (let i = 0, k = 0; i < fp.length; i++, k += 3) {
    const f = fp[i]
    out[k] = x + scale * (f[0] * c - f[1] * s)
    out[k + 1] = y + scale * (f[0] * s + f[1] * c)
    out[k + 2] = scale * f[2]
  }
}
const circlesFor = (type, x, y, heading, scale, out) => place(type.fp, x, y, heading, scale, out)
const coarseCircles = (type, x, y, heading, scale, out) => place(type.cfp, x, y, heading, scale, out)

// Would a footprint of `type` at (x, y) come within `gap` px of any other boat?
function hits(boats, type, circles, x, y, scale, selfId, gap) {
  const n3 = type.n3
  for (const o of boats) {
    if (o.id === selfId) continue
    const dx = x - o.x
    const dy = y - o.y
    const reach = type.bound * scale + o.type.bound * o.scale + gap
    if (dx * dx + dy * dy >= reach * reach) continue
    const oc = o.circles
    const on3 = o.type.n3
    for (let i = 0; i < n3; i += 3) {
      for (let j = 0; j < on3; j += 3) {
        const ddx = circles[i] - oc[j]
        const ddy = circles[i + 1] - oc[j + 1]
        const lim = circles[i + 2] + oc[j + 2] + gap
        if (ddx * ddx + ddy * ddy < lim * lim) return true
      }
    }
  }
  return false
}

// Smallest clear distance (px) between two coarse footprints (negative if they overlap)
function coarseClearance(a, na3, b, nb3) {
  let best = Infinity
  for (let i = 0; i < na3; i += 3) {
    for (let j = 0; j < nb3; j += 3) {
      const dx = a[i] - b[j]
      const dy = a[i + 1] - b[j + 1]
      const d2 = dx * dx + dy * dy
      const lim = a[i + 2] + b[j + 2]
      // only take the square root when this pair could beat the best so far
      const cutoff = lim + best
      if (cutoff > 0 && d2 >= cutoff * cutoff) continue
      const d = Math.sqrt(d2) - lim
      if (d < best) best = d
    }
  }
  return best
}

// ---- the river ------------------------------------------------------------------
// The club's own stretch of the River Stort, at South Mill Lock off Stylemans Lane
// (OpenStreetMap, checked against the aerial photo): the navigation comes down through the
// lock, the old river (the weir stream) winds round the west of the lock island and joins
// it just above the clubhouse and boatshed on the east bank, and the river carries on
// south towards Twyford Lock. Positions in metres from where the two meet: [north, east].
//
// Landscape screens turn the map so the river flows left to right (north on the left, the
// club along the top bank); portrait screens show it the right way up, flowing top to
// bottom with the club on the right. Ends lie off-screen so boats arrive and leave unseen.
//
// Craft go both ways and keep to the right, and the old river joins on the navigation's
// right-hand bank (looking downstream): its traffic merges straight into the downstream
// lane, and boats heading upstream on the far side never have to cross it.
export const SITE = {
  // the navigation (main channel), north to south, through South Mill Lock, and on round
  // the bends towards Twyford Lock
  main: [[364, -106], [323, -73], [291, -37], [262, -11], [236, 1], [178, 19], [131, 31], [100, 31], [83, 30], [64, 24],
    [26, 7], [0, 0], [-24, -2], [-59, 3], [-86, 7], [-112, 18], [-132, 45], [-156, 69], [-178, 100], [-193, 142],
    [-216, 190], [-250, 216], [-289, 260], [-320, 280], [-350, 272], [-386, 240], [-435, 219], [-463, 207], [-506, 177]],
  // the old river from the weir, joining just above the club. Moved a little west of the
  // map (so the lock island between the two shows at this size); its last bend runs into
  // the navigation's current
  trib: [[300, -78], [262, -70], [237, -64], [214, -68], [193, -64], [171, -54], [150, -52], [129, -59], [106, -54],
    [87, -63], [72, -60], [55, -46], [39, -37], [22, -26], [10, -12], [-2, -3], [-14, -1]],
  // Malcolm Barker Lake, west of the old river (moved west with it)
  lake: [[214, -134], [219, -128], [220, -119], [209, -107], [201, -101], [186, -95], [169, -95], [156, -101], [146, -103],
    [135, -105], [122, -104], [111, -107], [105, -115], [105, -126], [108, -137], [109, -145], [120, -147], [133, -150],
    [148, -151], [164, -149], [188, -143], [201, -138]],
  lock: { top: 131, bottom: 100 }, // north, on the main channel
  clubhouse: { a: [43, 27.5], b: [20, 30.7], width: 9, wide: 12 }, // a long building along the east bank (nudged a few metres upstream, clear of the boatshed)
  boatshed: { a: [-52, 42], b: [-56, 16], width: 11 }, // downstream of the clubhouse, the yard between them
  lane: [[-16, 40], [-12, 70], [2, 110], [14, 170], [20, 270]], // Stylemans Lane, off to the east, into the yard
  road: [[560, 120], [300, 200], [90, 275], [-150, 360], [-420, 450]], // Hallingbury Road (A1060), from the aerial photo
  railway: [[560, -205], [300, -238], [100, -262], [-100, -285], [-420, -318]] // the railway, west beyond the lake
}
// The view: as the map, from high up. centre [north, east] in the middle of the screen; rot
// turns the map (landscape: so the river runs left to right, upstream on the left, the
// club's bank along the top; portrait: north up, as the map); len: metres across the
// screen's long side
const VIEW = {
  landscape: { centre: [-30, 75], rot: -62, len: 540 },
  portrait: { centre: [-30, 30], rot: 0, len: 560 }
}
const CHANNELS = [{ name: 'main', width: 1, site: 'main' }, { name: 'tributary', width: 0.75, site: 'trib' }]
const SAMPLE = 8 // px between points along a channel
const CELL = 10 // px grid used to look up the nearest channel point quickly
const BANK_KEEP = 22 // px the hull centre-line keeps from the bank as a hard rule
const BANK_SQUEEZE = 8 // ...relaxed to this when a boxed-in boat is working itself free

// Catmull-Rom spline through the control points, resampled every SAMPLE px
function sampleChannel(ctrl) {
  const dense = []
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)]
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])])
    }
  }
  dense.push(ctrl[ctrl.length - 1])
  const out = [dense[0]]
  let carry = 0
  for (let i = 1; i < dense.length; i++) {
    let [ax, ay] = dense[i - 1]
    const [bx, by] = dense[i]
    let seg = Math.hypot(bx - ax, by - ay)
    while (carry + seg >= SAMPLE) {
      const t = (SAMPLE - carry) / seg
      ax += (bx - ax) * t
      ay += (by - ay) * t
      out.push([ax, ay])
      seg = Math.hypot(bx - ax, by - ay)
      carry = 0
    }
    carry += seg
  }
  out.push(dense[dense.length - 1])
  return out
}

// W x H is the world the camera sees (see createSwarm's zoom); sizeRef is the size the
// river and the trees are drawn for (the screen's shorter side), so zooming out makes
// them smaller on screen while more of the river comes into view.
export function buildRiver(W, H, sizeRef = Math.min(W, H)) {
  const portrait = H > W * 1.05
  // the lookup grid reaches this far beyond the screen: past both ends of every channel
  // (they start and finish up to 0.22 of the screen outside it)
  const PAD = Math.round(0.24 * Math.max(W, H)) + 40
  const base = clamp(sizeRef * 0.105, 76, 120) // (narrower than the map's scale would allow two-way traffic: wider than the real river)
  // metres [north, east] to world px
  const view = portrait ? VIEW.portrait : VIEW.landscape
  const mpx = Math.max(W, H) / view.len // world px a metre
  const rc = Math.cos((view.rot * Math.PI) / 180), rs = Math.sin((view.rot * Math.PI) / 180)
  const toXY = ([north, east]) => {
    const mx = east - view.centre[1], my = -(north - view.centre[0])
    return [W / 2 + mpx * (mx * rc - my * rs), H / 2 + mpx * (mx * rs + my * rc)]
  }
  // (control points well beyond the screen are dropped from the ends: past the lookup grid)
  const inGrid = ([x, y]) => x > -PAD + 30 && x < W + PAD - 30 && y > -PAD + 30 && y < H + PAD - 30
  const channels = CHANNELS.map((c, ci) => {
    let ctrl = SITE[c.site].map(toXY)
    while (ctrl.length > 4 && !inGrid(ctrl[0])) ctrl = ctrl.slice(1)
    while (ctrl.length > 4 && !inGrid(ctrl[ctrl.length - 1])) ctrl = ctrl.slice(0, -1)
    const pts = sampleChannel(ctrl)
    const tan = pts.map((_, i) => {
      const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
      return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]
    })
    return { name: c.name, index: ci, half: base * c.width, pts, tan }
  })

  // lookup grid: for each cell, the channel point it is "most inside"
  const cols = Math.ceil((W + 2 * PAD) / CELL)
  const rows = Math.ceil((H + 2 * PAD) / CELL)
  const gridCh = new Int8Array(cols * rows)
  const gridPt = new Int32Array(cols * rows)
  const chPt = channels.map(() => new Int32Array(cols * rows)) // nearest point of each channel
  for (let r = 0; r < rows; r++) {
    const y = -PAD + (r + 0.5) * CELL
    for (let c = 0; c < cols; c++) {
      const x = -PAD + (c + 0.5) * CELL
      // the channel this spot is most inside (distance from that channel's bank); at the
      // confluence the tributary joins flowing the same way, so the two currents agree
      let best = Infinity, bc = 0, bi = 0
      for (const ch of channels) {
        const pts = ch.pts
        let own = Infinity
        for (let i = 0; i < pts.length; i++) {
          const dx = x - pts[i][0], dy = y - pts[i][1]
          const d = Math.sqrt(dx * dx + dy * dy) - ch.half
          if (d < best) { best = d; bc = ch.index; bi = i }
          if (d < own) { own = d; chPt[ch.index][r * cols + c] = i }
        }
      }
      gridCh[r * cols + c] = bc
      gridPt[r * cols + c] = bi
    }
  }

  // Nearest point of the river to (x, y): centre point, downstream direction, half-width,
  // signed offset from the centre line (positive to the right of the flow), and how far
  // along its channel (0 source .. 1 mouth)
  const q = { cx: 0, cy: 0, tx: 0, ty: 0, half: 0, s: 0, along: 0, ch: 0 }
  function query(x, y) {
    const c = clamp(Math.floor((x + PAD) / CELL), 0, cols - 1)
    const r = clamp(Math.floor((y + PAD) / CELL), 0, rows - 1)
    const ch = channels[gridCh[r * cols + c]]
    const start = gridPt[r * cols + c]
    let bi = start, best = Infinity
    for (let i = Math.max(0, start - 3); i <= Math.min(ch.pts.length - 1, start + 3); i++) {
      const dx = x - ch.pts[i][0], dy = y - ch.pts[i][1]
      const d = dx * dx + dy * dy
      if (d < best) { best = d; bi = i }
    }
    const [cx, cy] = ch.pts[bi]
    const [tx, ty] = ch.tan[bi]
    q.cx = cx; q.cy = cy; q.tx = tx; q.ty = ty; q.half = ch.half; q.ch = ch.index
    q.s = (x - cx) * -ty + (y - cy) * tx
    q.along = bi / (ch.pts.length - 1)
    return q
  }

  // How far (x, y) is inside the water: distance to the nearest bank of whichever channel
  // it is deepest in (negative on land). Where the channels overlap this is the merged
  // river, with no seam where one channel's bank runs across the other's water.
  function inside(x, y) {
    const c = clamp(Math.floor((x + PAD) / CELL), 0, cols - 1)
    const r = clamp(Math.floor((y + PAD) / CELL), 0, rows - 1)
    let most = -Infinity
    for (const ch of channels) {
      const start = chPt[ch.index][r * cols + c]
      let best = Infinity
      for (let i = Math.max(0, start - 3); i <= Math.min(ch.pts.length - 1, start + 3); i++) {
        const dx = x - ch.pts[i][0], dy = y - ch.pts[i][1]
        const d = dx * dx + dy * dy
        if (d < best) best = d
      }
      const v = ch.half - Math.sqrt(best)
      if (v > most) most = v
    }
    return most
  }

  // Where the tributary meets the main river the lookup above hands a boat to whichever
  // channel it is most inside, which suits boats going downstream (both currents agree).
  // A boat heading upstream, though, has to choose: back up the main river or up the
  // tributary. routedQuery keeps it on the channel it chose while it is near the confluence.
  const te = channels[1].pts[channels[1].pts.length - 1]
  const CONF_R = 3.2 * channels[0].half
  const zone = channels.map(ch => ch.pts.map((p, i) => i).filter(i => Math.hypot(ch.pts[i][0] - te[0], ch.pts[i][1] - te[1]) < CONF_R + 2 * channels[0].half))
  function routedQuery(x, y, route) {
    query(x, y)
    if (route == null || q.ch === route) return q
    if (Math.hypot(x - te[0], y - te[1]) > CONF_R) return q
    const ch = channels[route]
    let bi = -1, best = Infinity
    for (const i of zone[route]) {
      const dx = x - ch.pts[i][0], dy = y - ch.pts[i][1]
      const d = dx * dx + dy * dy
      if (d < best) { best = d; bi = i }
    }
    if (bi < 0) return q
    const [cx, cy] = ch.pts[bi]
    const [tx, ty] = ch.tan[bi]
    q.cx = cx; q.cy = cy; q.tx = tx; q.ty = ty; q.half = ch.half; q.ch = ch.index
    q.s = (x - cx) * -ty + (y - cy) * tx
    q.along = bi / (ch.pts.length - 1)
    return q
  }

  const inView = ([x, y], m = 0) => x > -m && x < W + m && y > -m && y < H + m

  // water area on screen, for deciding how many kayakers to put on it
  let visibleArea = 0
  for (const ch of channels) for (const p of ch.pts) if (inView(p)) visibleArea += SAMPLE * 2 * ch.half
  // the main river's own visible stretch counts once where the tributary overlaps it
  visibleArea *= 0.95

  // SVG paths for drawing: centre line, plus lines either side for flow marks
  const path = (pts, off = 0, tan = null) =>
    pts
      .filter((_, i) => i % 2 === 0 || i === pts.length - 1)
      .map((p, i, arr) => {
        let [x, y] = p
        if (off && tan) {
          const j = Math.min(pts.length - 1, i * 2)
          x += -tan[j][1] * off
          y += tan[j][0] * off
        }
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
      })
      .join(' ')
  const drawing = channels.map(ch => ({
    name: ch.name,
    half: ch.half,
    d: path(ch.pts),
    flow: [-0.5, 0, 0.5].map(k => path(ch.pts, k * ch.half, ch.tan))
  }))

  // ---- the club: South Mill Lock, the clubhouse and boatshed, the yard and the lane ----
  // Positions from the map; the buildings drawn a little bigger than the map scale (so they
  // read next to the boats) and moved back from the water if they would reach it.
  const site = (() => {
    const main = channels[0]
    const nearestPt = (ch, [x, y]) => {
      let bi = 0, best = Infinity
      ch.pts.forEach(([px, py], i) => { const d = (px - x) ** 2 + (py - y) ** 2; if (d < best) { best = d; bi = i } })
      return bi
    }
    const BIG = 1.25
    const building = (kind, def, big = BIG) => {
      const A = toXY(def.a), B = toXY(def.b)
      const realLen = Math.hypot(def.a[0] - def.b[0], def.a[1] - def.b[1])
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]) * big
      const wid = len * (def.wide || def.width) / realLen
      const angle = Math.atan2(B[1] - A[1], B[0] - A[0])
      const x0 = (A[0] + B[0]) / 2, y0 = (A[1] + B[1]) / 2
      let x = x0, y = y0
      const corners = (cx, cy) => {
        const c = Math.cos(angle), sn = Math.sin(angle), out = []
        for (const [f, g] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]) out.push([cx + c * f * len / 2 - sn * g * wid / 2, cy + sn * f * len / 2 + c * g * wid / 2])
        return out
      }
      // back from the water: a grassy bank and the towpath between it and the river
      const back = clamp(main.half * 0.75, 45, 95)
      for (let k = 0; k < 80 && corners(x, y).some(([px, py]) => inside(px, py) > -back); k++) {
        const q = query(x, y)
        const side = Math.sign(q.s) || 1
        x += -q.ty * side * 6
        y += q.tx * side * 6
      }
      return { kind, x: +x.toFixed(1), y: +y.toFixed(1), len: +len.toFixed(1), wid: +wid.toFixed(1), angle: +(angle * 180 / Math.PI).toFixed(1), push: [x - x0, y - y0], ppm: Math.hypot(B[0] - A[0], B[1] - A[1]) / realLen }
    }
    const clubhouse = building('clubhouse', SITE.clubhouse, 1.7) // drawn big: the heart of the club
    const boatshed = building('boatshed', SITE.boatshed, 1.6) // bigger, to go with the clubhouse
    let frontage = null // { ux, uy, nx, ny, line }: the line the club's buildings face the river on
    // Line them up, as on the aerial photo: square to the line between them (the clubhouse
    // along it, the boatshed across it), and their river sides on one straight frontage, as
    // far back as the further back of the two needs to be
    {
      let ux = boatshed.x - clubhouse.x, uy = boatshed.y - clubhouse.y
      const ul = Math.hypot(ux, uy) || 1
      ux /= ul; uy /= ul
      let nx = -uy, ny = ux // away from the river
      if (inside(clubhouse.x + nx * 20, clubhouse.y + ny * 20) > inside(clubhouse.x, clubhouse.y)) { nx = -nx; ny = -ny }
      const along = Math.atan2(uy, ux) * 180 / Math.PI
      clubhouse.angle = +along.toFixed(1)
      boatshed.angle = +(along + 90).toFixed(1)
      // where each one's river side is, measured along n (the clubhouse lies along the line,
      // so half its width is towards the river; the boatshed across it, so half its length);
      // the frontage goes where the further back of the two has it
      const half = { clubhouse: clubhouse.wid / 2, boatshed: boatshed.len / 2 }
      const front = b => b.x * nx + b.y * ny - half[b.kind]
      const line = Math.max(front(clubhouse), front(boatshed))
      for (const b of [clubhouse, boatshed]) {
        const by = line - front(b)
        b.x = +(b.x + nx * by).toFixed(1)
        b.y = +(b.y + ny * by).toFixed(1)
      }
      frontage = { ux, uy, nx, ny, line }
    }
    // which side of the river the club is (sign of the offset to the right of the flow)
    const clubSide = Math.sign(query(clubhouse.x, clubhouse.y).s) || -1
    // South Mill Lock: lock walls along both banks, gates at each end (open: boats come and go)
    const i0 = nearestPt(main, toXY([SITE.lock.top, 31]))
    const i1 = nearestPt(main, toXY([SITE.lock.bottom, 31]))
    const lo = Math.min(i0, i1), hi = Math.max(i0, i1)
    const edge = side => main.pts.slice(lo, hi + 1).map(([x, y], k) => {
      const [tx, ty] = main.tan[lo + k]
      const o = main.half + 4
      return `${k ? 'L' : 'M'}${(x - ty * side * o).toFixed(1)} ${(y + tx * side * o).toFixed(1)}`
    }).join(' ')
    const gate = i => {
      const [x, y] = main.pts[i]
      const [tx, ty] = main.tan[i]
      return { x: +x.toFixed(1), y: +y.toFixed(1), angle: +(Math.atan2(ty, tx) * 180 / Math.PI).toFixed(1) }
    }
    const lock = { walls: [edge(-1), edge(1)], gates: [gate(lo), gate(hi)], half: main.half, inView: inView(main.pts[lo], 200) || inView(main.pts[hi], 200) }
    // the yard (hard standing) between the clubhouse and the boatshed, and the lane to it
    // (gravel, set back from the water like the buildings either side of it, with the lane
    // coming in from the east)
    // filling the gap between them exactly: from the clubhouse's downstream end to the
    // boatshed's upstream side
    // a rectangle: its river side on the buildings' frontage, as deep as the clubhouse
    const { ux, uy, nx, ny, line } = frontage
    const a0 = clubhouse.x * ux + clubhouse.y * uy + clubhouse.len / 2 // clubhouse's downstream end
    const a1 = boatshed.x * ux + boatshed.y * uy - boatshed.wid / 2 // boatshed's upstream side
    const pt = (a, n) => [ux * a + nx * n, uy * a + ny * n]
    const yardPts = [pt(a0, line), pt(a0, line + clubhouse.wid), pt(a1, line + clubhouse.wid), pt(a1, line)]
    const ycx = yardPts.reduce((t, p) => t + p[0], 0) / 4, ycy = yardPts.reduce((t, p) => t + p[1], 0) / 4
    const yard = yardPts.sort((p, q) => Math.atan2(p[1] - ycy, p[0] - ycx) - Math.atan2(q[1] - ycy, q[0] - ycx))
    const lane = SITE.lane.map(toXY)
    lane[0] = [ycx, ycy] // Stylemans Lane runs into the middle of the yard
    // a few cars parked on the gravel: in a row or two across the yard, noses towards the
    // clubhouse, leaving the middle clear where the lane comes in
    let carSlots = [] // the spaces nobody is parked in (the page sends visitors to them)
    const cars = (() => {
      const inYard = (x, y) => {
        let c = false
        for (let i = 0, j = yard.length - 1; i < yard.length; j = i++) {
          const [xi, yi] = yard[i], [xj, yj] = yard[j]
          if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
        }
        return c
      }
      const k = clubhouse.ppm * 2 // drawn big, like the buildings (and the boats)
      const L = 4.4 * k, Wd = 1.9 * k
      let ux = boatshed.x - clubhouse.x, uy = boatshed.y - clubhouse.y
      const ul = Math.hypot(ux, uy) || 1
      ux /= ul; uy /= ul
      const vx = -uy, vy = ux
      const slots = []
      for (const along of [-0.28, 0.28]) {
        for (let n = -4; n <= 4; n++) {
          if (Math.abs(n) < 1) continue // the way in from the lane
          const span = Math.hypot(yardPts[0][0] - yardPts[1][0], yardPts[0][1] - yardPts[1][1])
          const x = ycx + ux * along * span * 0.9 + vx * n * Wd * 1.6
          const y = ycy + uy * along * span * 0.9 + vy * n * Wd * 1.6
          const ends = [[x + ux * L / 2, y + uy * L / 2], [x - ux * L / 2, y - uy * L / 2], [x + vx * Wd / 2, y + vy * Wd / 2], [x - vx * Wd / 2, y - vy * Wd / 2]]
          if (ends.every(([px, py]) => inYard(px, py))) slots.push({ x: +x.toFixed(1), y: +y.toFixed(1), angle: +(Math.atan2(uy, ux) * 180 / Math.PI + (along < 0 ? 180 : 0)).toFixed(1), len: +L.toFixed(1), wid: +Wd.toFixed(1) })
        }
      }
      // some of the spaces taken (which ones is the same each time, for a given screen)
      let h = 7
      const pick = () => ((h = (h * 16807) % 2147483647) / 2147483647)
      const want = Math.min(slots.length, 3 + Math.floor(pick() * 3))
      const taken = []
      while (taken.length < want) {
        const i = Math.floor(pick() * slots.length)
        if (!taken.includes(slots[i])) taken.push(slots[i])
      }
      carSlots = slots.filter(c => !taken.includes(c))
      return taken.map((c, i) => ({ ...c, n: i }))
    })()
    // the landing stage, on the club's bank between the clubhouse and the boatshed
    const li = nearestPt(main, toXY([-16, 4]))
    const [lx, ly] = main.pts[li]
    const [ltx, lty] = main.tan[li]
    const lo2 = main.half - 6
    const landing = { x: +(lx - lty * clubSide * lo2).toFixed(1), y: +(ly + ltx * clubSide * lo2).toFixed(1), angle: +(Math.atan2(lty, ltx) * 180 / Math.PI).toFixed(1), len: +(main.half * 0.9).toFixed(1), wid: 16 }
    // the towpath along the club's bank: down from upstream, past the lock (where paddlers
    // portage, with a landing stage at each end) and the club, to beyond the boatshed
    const shedI = nearestPt(main, [boatshed.x, boatshed.y])
    const pathOff = main.half + clamp(main.half * 0.3, 22, 40)
    const towpath = main.pts.slice(0, Math.min(main.pts.length, shedI + 40)).map(([x, y], i) => {
      const [tx, ty] = main.tan[i]
      return [+(x - ty * clubSide * pathOff).toFixed(1), +(y + tx * clubSide * pathOff).toFixed(1)]
    }).filter((p, i, a) => i % 2 === 0 || i === a.length - 1)
    const stage = i => {
      const [x, y] = main.pts[i]
      const [tx, ty] = main.tan[i]
      return { x: +(x - ty * clubSide * (main.half - 5)).toFixed(1), y: +(y + tx * clubSide * (main.half - 5)).toFixed(1), angle: +(Math.atan2(ty, tx) * 180 / Math.PI).toFixed(1), len: +(main.half * 0.6).toFixed(1), wid: 14 }
    }
    const portage = [stage(Math.max(0, lo - 10)), stage(Math.min(main.pts.length - 1, hi + 10))]
    const lake = SITE.lake.map(toXY).map(p => p.map(v => +v.toFixed(1)))
    const road = SITE.road.map(toXY).map(p => p.map(v => +v.toFixed(1)))
    const railway = SITE.railway.map(toXY).map(p => p.map(v => +v.toFixed(1)))
    return { lake, road, railway, clubhouse, boatshed, lock, yard: yard.map(p => p.map(v => +v.toFixed(1))), cars, carSlots, lane: lane.map(p => p.map(v => +v.toFixed(1))), landing, towpath, portage, clubSide, lockRange: [lo, hi], landingIndex: li }
  })()
  // nothing grows on the club's ground: the buildings, the yard, the lane, the lock sides
  const distToSeg = (x, y, [ax, ay], [bx, by]) => {
    const dx = bx - ax, dy = by - ay
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1)
    return Math.hypot(x - ax - t * dx, y - ay - t * dy)
  }
  const inPoly = (x, y, poly) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const onSite = (x, y, r = 0) => {
    if (inPoly(x, y, site.lake) || site.lake.some((p, i) => distToSeg(x, y, p, site.lake[(i + 1) % site.lake.length]) < r + 10)) return true
    for (const b of [site.clubhouse, site.boatshed]) if (Math.hypot(x - b.x, y - b.y) < b.len / 2 + r + 20) return true
    if (inPoly(x, y, site.yard) || site.yard.some((p, i) => distToSeg(x, y, p, site.yard[(i + 1) % site.yard.length]) < r + 8)) return true
    for (let i = 0; i < site.lane.length - 1; i++) if (distToSeg(x, y, site.lane[i], site.lane[i + 1]) < r + 22) return true
    for (const line of [site.road, site.railway]) for (let i = 0; i < line.length - 1; i++) if (distToSeg(x, y, line[i], line[i + 1]) < r + 26) return true
    const m = channels[0]
    for (let i = site.lockRange[0]; i <= site.lockRange[1]; i += 2) if (Math.hypot(x - m.pts[i][0], y - m.pts[i][1]) < m.half + r + 34) return true
    if (Math.hypot(x - site.landing.x, y - site.landing.y) < site.landing.len / 2 + r + 6) return true
    for (const st of site.portage) if (Math.hypot(x - st.x, y - st.y) < st.len / 2 + r + 6) return true
    for (let i = 0; i < site.towpath.length - 1; i++) if (distToSeg(x, y, site.towpath[i], site.towpath[i + 1]) < r + 14) return true
    return false
  }

  // Vegetation all along both banks, placed with a fixed seed per screen size so it stays
  // put: reed tufts on the water's edge, bushes just behind them, trees set back further
  // (in a row along the bank, with a second, looser row behind). Nothing is ever over the
  // water: every piece is checked against both channels (inside() < 0 means on land).
  let seed = (Math.round(W) * 7919 + Math.round(H) * 104729) % 2147483647 || 1
  const trng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const tsize = clamp(sizeRef / 900, 0.6, 1.1)
  const GREENS = ['#3f7a34', '#4a8a3a', '#356b2e', '#5a9442', '#2f5f2a']
  const BUSH = ['#4f8f3a', '#5c9c44', '#467f35', '#6aa64c', '#3d7330']
  const BLOSSOM = ['#f4e9a1', '#ffffff', '#f2b5c9', '#e9d36b']
  const trees = []
  const bushes = []
  const reeds = ['', ''] // two shades, each one path of many short blades
  const land = (x, y, clear) => -inside(x, y) >= clear // at least `clear` px from any water
  const spot = (ch, i, side, out, along) => {
    const [cx, cy] = ch.pts[i]
    const [tx, ty] = ch.tan[i]
    // side: -1/1 for the two banks; along: shift up/downstream
    return [cx - ty * side * out + tx * along, cy + tx * side * out + ty * along, -ty * side, tx * side]
  }
  const crowded = (list, x, y, r, k) => list.some(t => Math.hypot(t.x - x, t.y - y) < (t.r + r) * k)
  for (const ch of channels) {
    for (const side of [-1, 1]) {
      // reeds: a tuft every few px along the edge, leaning away from the water
      for (let i = 0; i < ch.pts.length; i++) {
        if (trng() < 0.35) continue
        const [x, y, nx, ny] = spot(ch, i, side, ch.half + 3 + trng() * 9, (trng() - 0.5) * 8)
        if (!inView([x, y], 20) || !land(x, y, 2) || onSite(x, y)) continue
        const shade = trng() < 0.6 ? 0 : 1
        const blades = 3 + Math.floor(trng() * 3)
        for (let k = 0; k < blades; k++) {
          const a = (k / (blades - 1) - 0.5) * 1.1 + (trng() - 0.5) * 0.3
          const len = (9 + trng() * 9) * tsize
          // fan around the outward direction
          const dx = (nx * Math.cos(a) - ny * Math.sin(a)) * len
          const dy = (nx * Math.sin(a) + ny * Math.cos(a)) * len
          reeds[shade] += `M${x.toFixed(1)} ${y.toFixed(1)}l${dx.toFixed(1)} ${dy.toFixed(1)}`
        }
      }
      // bushes: clumps of a few round shrubs just behind the reeds, some in flower
      for (let i = 0; i < ch.pts.length; i += 3 + Math.floor(trng() * 4)) {
        if (trng() < 0.2) continue
        const r = (7 + trng() * 7) * tsize
        const [x, y] = spot(ch, i, side, ch.half + 17 + r + trng() * 14 * tsize, (trng() - 0.5) * 12)
        if (!inView([x, y], r * 2) || !land(x, y, 14 + r) || onSite(x, y, r)) continue
        if (crowded(bushes, x, y, r, 0.9)) continue
        const blobs = [[0, 0, r]]
        for (let k = 0; k < 2 + Math.floor(trng() * 2); k++) {
          const a = trng() * Math.PI * 2
          blobs.push([Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.7, r * (0.55 + trng() * 0.3)])
        }
        const flowers = trng() < 0.3
          ? Array.from({ length: 3 + Math.floor(trng() * 4) }, () => [(trng() - 0.5) * r * 1.6, (trng() - 0.5) * r * 1.6])
          : []
        bushes.push({
          x: +x.toFixed(1), y: +y.toFixed(1), r: +r.toFixed(1),
          color: BUSH[Math.floor(trng() * BUSH.length)],
          blobs: blobs.map(b => b.map(v => +v.toFixed(1))),
          flowers: flowers.map(f => f.map(v => +v.toFixed(1))),
          blossom: BLOSSOM[Math.floor(trng() * BLOSSOM.length)]
        })
      }
      // trees: a row along the bank and a looser row behind it
      for (const row of [0, 1]) {
        for (let i = 0; i < ch.pts.length; i += (row ? 6 : 4) + Math.floor(trng() * 4)) {
          if (trng() < (row ? 0.45 : 0.15)) continue
          const r = (16 + trng() * 14) * tsize
          const out = ch.half + 34 + r * 0.9 + (row ? 40 + trng() * 60 : trng() * 18) * tsize
          const [x, y] = spot(ch, i, side, out, (trng() - 0.5) * 30)
          if (!inView([x, y], r) || !land(x, y, 26 + r * 0.9) || onSite(x, y, r)) continue
          if (crowded(trees, x, y, r, 0.75)) continue
          trees.push({ x: +x.toFixed(1), y: +y.toFixed(1), r: +r.toFixed(1), color: GREENS[Math.floor(trng() * GREENS.length)] })
        }
      }
    }
  }
  // A wooden footbridge across the main river, square to it on a straight stretch that
  // is fully in view and away from the side stream (later in the river if it can).
  const main = channels[0]
  const trib = channels[1]
  const deckW = 24 * tsize // width of the walkway
  let bridge = null
  if (false) { // (the club's stretch has no footbridge in view: the lock is drawn instead)
    const k = 10
    let bestScore = Infinity
    for (let i = k; i < main.pts.length - k; i++) {
      const [ax, ay] = main.tan[i - k]
      const [bx, by] = main.tan[i + k]
      if (ax * bx + ay * by < 0.995) continue // straight
      const [cx, cy] = main.pts[i]
      const [tx, ty] = main.tan[i]
      const reach = main.half + 40
      if (!inView([cx - ty * reach, cy + tx * reach], -10) || !inView([cx + ty * reach, cy - tx * reach], -10)) continue
      if (trib.pts.some(([px, py]) => Math.hypot(px - cx, py - cy) < trib.half + main.half * 2.5)) continue
      const score = Math.abs(i / (main.pts.length - 1) - 0.78)
      if (score < bestScore) { bestScore = score; bridge = { i, x: cx, y: cy, tx, ty } }
    }
    if (bridge) {
      bridge = {
        x: +bridge.x.toFixed(1),
        y: +bridge.y.toFixed(1),
        // the deck runs across the river: along the normal, so the angle is the flow's + 90
        angle: +((Math.atan2(bridge.ty, bridge.tx) * 180) / Math.PI + 90).toFixed(1),
        span: +(2 * main.half + 2 * 30 * tsize).toFixed(1), // bank to bank, ending on dry land
        width: +deckW.toFixed(1),
        along: bridge.i / (main.pts.length - 1)
      }
    }
  }
  // nothing growing on the bridge or right at its ends
  const nearBridge = (x, y, r) => {
    if (!bridge) return false
    const a = ((bridge.angle - 90) * Math.PI) / 180
    const tx = Math.cos(a)
    const ty = Math.sin(a)
    const dx = x - bridge.x
    const dy = y - bridge.y
    const alongFlow = Math.abs(dx * tx + dy * ty) // distance up/downstream of the deck
    const across = Math.abs(-dx * ty + dy * tx) // distance across the river
    return alongFlow < bridge.width / 2 + r + 6 && across < bridge.span / 2 + r + 20
  }

  // A few big old trees leaning out over the water from the banks, on outer bends where
  // there's room; their canopies are drawn above the boats, which pass beneath them.
  const bigTrees = []
  {
    const want = 3 + Math.floor(trng() * 3)
    for (let tries = 0; tries < 400 && bigTrees.length < want; tries++) {
      const ch = trng() < 0.8 ? main : trib
      const i = 6 + Math.floor(trng() * (ch.pts.length - 12))
      const side = trng() < 0.5 ? -1 : 1
      const r = (64 + trng() * 30) * tsize
      // canopy centre over the bank, the crown reaching well out over the water
      const [x, y] = spot(ch, i, side, ch.half + r * 0.22, 0)
      if (!inView([x, y], -r * 0.3)) continue
      if (!land(x, y, 5)) continue // trunk on dry land
      if (nearBridge(x, y, r) || onSite(x, y, r * 0.6)) continue
      if (bigTrees.some(t => Math.hypot(t.x - x, t.y - y) < (t.r + r) * 1.4)) continue
      // keep well away from where the side stream joins (the canopy would hide the junction)
      if (Math.hypot(x - trib.pts.at(-1)[0], y - trib.pts.at(-1)[1]) < main.half * 3 + r) continue
      // the canopy: a big main crown and a few smaller lobes, mostly leaning over the water
      const [, , nx, ny] = spot(ch, i, side, 0, 0) // outward normal (away from the water)
      const lobes = [[0, 0, r]]
      for (let k = 0; k < 4; k++) {
        const a = trng() * Math.PI * 2
        const d = r * (0.45 + trng() * 0.25)
        lobes.push([Math.cos(a) * d - nx * r * 0.2, Math.sin(a) * d - ny * r * 0.2, r * (0.45 + trng() * 0.2)])
      }
      bigTrees.push({
        x: +x.toFixed(1), y: +y.toFixed(1), r: +r.toFixed(1),
        color: ['#2f6b2a', '#3a7a31', '#2a5e27', '#44853a'][Math.floor(trng() * 4)],
        lobes: lobes.map(l => l.map(v => +v.toFixed(1)))
      })
    }
  }
  // small trees and bushes don't grow under the big ones or on the bridge
  const clear = (list) => list.filter(t =>
    !nearBridge(t.x, t.y, t.r) && !bigTrees.some(b => Math.hypot(b.x - t.x, b.y - t.y) < b.r * 0.9 + t.r * 0.3))
  trees.splice(0, trees.length, ...clear(trees))
  bushes.splice(0, bushes.length, ...clear(bushes))

  // drawn back to front: the trees nearer the top of the screen first
  trees.sort((a, b) => a.y - b.y)
  bushes.sort((a, b) => a.y - b.y)
  bigTrees.sort((a, b) => a.y - b.y)

  // Above South Mill Lock the river is quiet (most paddlers turn back below it rather than
  // carry round), so that water counts for less when deciding how many to put out
  if (site) {
    const m = channels[0]
    for (let i = 0; i < site.lockRange[1] + 6; i++) if (inView(m.pts[i])) visibleArea -= 0.95 * 0.6 * SAMPLE * 2 * m.half
  }
  return { W, H, PAD, portrait, channels, query, routedQuery, inside, inView, visibleArea, drawing, trees, bushes, reeds, bigTrees, bridge, site }
}

// turnover: boats that leave are gone for good, and new ones (new types, new colours)
// arrive from either end over time, with the number on the water drifting up and down
// zoom: how far the camera is pulled back. The swarm works in world units, a world of
// width/zoom x height/zoom; the page draws it scaled down by zoom, so the river and the
// boats look smaller and more of the river is in view.
export function createSwarm({ width, height, zoom = 1, reducedMotion = false, rng = Math.random, turnover = true }) {
  let W = width / zoom
  let H = height / zoom
  let sizeRef = Math.min(width, height)
  let river = buildRiver(W, H, sizeRef)
  let nextId = 0
  const boats = []
  const speedFactor = reducedMotion ? 0.4 : 1
  const probe = new Float64Array(MAX_N3)
  const cand = new Float64Array(MAX_NC3)
  const pool = [] // predicted neighbour footprints, reused between plans
  const ripples = [] // { x, y, age } water disturbed by a tap: paddlers keep clear while it lasts
  // Weather (set by the page: setWeather): wind 0..1 brings debris down the river (logs,
  // branches, leaves) for paddlers to steer round; rain 0..1 raises the flow, so boats go
  // quicker downstream and slower up, and the debris comes down faster.
  const weather = { wind: 0, rain: 0 }
  const debris = [] // { id, x, y, r, kind, len, rot, spin, lane, drift, stuck, opacity }
  let debrisId = 0
  let debrisTimer = 3
  let turnarounds = 0 // count, for tests
  const rand = (a, b) => a + rng() * (b - a)

  const baseScale = () => 0.55 * clamp(sizeRef / 900, 0.6, 1.1)

  // How many paddlers look comfortably busy on the visible water without being jammed.
  // Narrowboats take more than their share of the river: their length times their beam
  // plus room for a paddler to pass either side, with extra for the traffic they cause.
  function suggestedCount() {
    const bs = baseScale()
    let water = river.visibleArea
    for (const b of boats) {
      // (a moving one more so: the paddlers turning back from the lock have to get past it too)
      if (b.vessel) water -= 1.8 * 2 * b.type.bound * b.scale * (66 * b.scale + 2 * BOAT_HALF * bs)
    }
    // fewer go out when the river's up after rain
    return clamp(Math.round((Math.max(0, water) * DENSITY * (1 - 0.35 * weather.rain)) / (10500 * bs * bs)), 4, MAX_BOATS)
  }

  // The most paddlers the river takes before it jams (a river is less forgiving than open water)
  const capacity = () => Math.min(MAX_BOATS, Math.round(suggestedCount() * 1.1))
  const paddlerCount = () => boats.reduce((n, b) => n + (b.vessel ? 0 : 1), 0)

  // a point on a channel, offset across the stream by `lane` (-1 .. 1 of the half-width)
  function pointOn(ch, i, lane) {
    const [x, y] = ch.pts[i]
    const [tx, ty] = ch.tan[i]
    const off = lane * ch.half
    return { x: x - ty * off, y: y + tx * off, heading: Math.atan2(tx, -ty) }
  }

  // the same, for a boat travelling in direction dir (1 downstream, -1 upstream), with lane
  // measured from the middle towards that boat's own right-hand bank
  function poseFor(ch, i, dir, lane) {
    const pose = pointOn(ch, i, dir * lane)
    if (dir < 0) pose.heading += Math.PI
    return pose
  }
  const pickDir = () => (rng() < UPSTREAM ? -1 : 1)
  // going upstream, everyone heads back up the main river: turning up the tributary would
  // mean cutting across the downstream lane at the confluence
  const pickRoute = (dir) => (dir < 0 ? 0 : null)
  // paddlers keep to the right: between a little right of the middle and near the bank
  const rightLane = () => rand(0.2, 0.5)

  // just downstream of where the main river leaves the screen (where upstream craft arrive)
  function mouthIndex(ch) {
    let i = ch.pts.length - 1
    while (i > 0 && !river.inView(ch.pts[i], 40)) i--
    return Math.min(ch.pts.length - 1, i + 6)
  }

  // just upstream of where a channel comes into view
  function sourceIndex(ch) {
    const i = ch.pts.findIndex(p => river.inView(p, 40))
    return Math.max(0, (i < 0 ? 0 : i) - 6)
  }

  // pick a channel: mostly the main river; the narrower tributary gets about 1 boat in 6,
  // so the confluence where they merge doesn't jam
  const pickChannel = () => (rng() < 0.84 ? river.channels[0] : river.channels[1])

  // Try to place a boat (new or reused) at a pose; true if it fitted
  function tryPlace(b, pose) {
    if (!b.vessel && inLock(pose.x, pose.y)) return false
    circlesFor(b.type, pose.x, pose.y, pose.heading, b.scale, probe)
    if (hits(boats, b.type, probe, pose.x, pose.y, b.scale, b.id, PLAN_GAP)) return false
    b.x = pose.x
    b.y = pose.y
    b.heading = pose.heading
    b.circles.set(probe.subarray(0, b.type.n3))
    return true
  }

  // Add a boat somewhere clear. Returns null if there is no room.
  // A paddler's boat (not yet on the water)
  function makePaddler(type, pace = rand(type.pace[0], type.pace[1])) {
    const bs = baseScale()
    return {
      id: nextId++,
      type, // see TYPES: k1, racer or k2
      x: 0, y: 0, heading: 0,
      // every boat of a type is the same size (a K1 is a K1)
      scale: bs,
      baseScale: bs,
      waiting: false, // parked out of sight until there's room at a source
      pace, // unscaled cruising speed, handy for picking a paddle tempo
      baseSpeed: pace * speedFactor,
      speed: pace * speedFactor,
      turn: 0, // current turn rate
      omega: 0, // turn rate the planner wants
      slow: 1, // 1 = full speed, down to 0.25 when hemmed in
      braking: false,
      blocked: 0,
      dir: pickDir(), // 1 heading downstream, -1 upstream
      route: null, // heading upstream: 0 back up the main river, 1 up the tributary
      lane: rightLane(), // where across the river this paddler likes to be (+ = its right)
      wander: 0,
      wanderTimer: rand(0.5, 3),
      thinkTimer: rand(0, 0.15),
      club: false, // a club boat (bright yellow): these go out in groups
      group: null, // id of the group it is paddling with, if any (see groups below)
      circles: new Float64Array(type.n3)
    }
  }

  function spawn(initial, only) {
    // past this many the river is too crowded for boats to move freely
    if (!initial && paddlerCount() >= capacity() + (only ? 1 : 0)) return null
    let type = only || pickType(rng)
    // only ever one outrigger on the water (there's just the one, the dark blue one)
    while (type === TYPES.oc1 && boats.some(b => b.type === TYPES.oc1)) type = pickType(rng)
    // club boats (yellow K1s) come out in groups, not on their own
    if (type === TYPES.k1 && !only && rng() < 0.5) return spawnGroup('club', initial)
    const boat = makePaddler(type)
    // most paddlers start out from the club; the rest are visitors arriving from either end
    // (and of those coming up from downstream, most are club paddlers on their way home)
    const fromClub = !initial && clubLanding() && rng() < CLUB_SHARE
    if (initial) setTrip(boat, rng() < CLUB_SHARE, rand(-20, 120))
    else if (!fromClub && boat.dir < 0) setTrip(boat, rng() < 0.8, 0)
    for (let attempt = 0; attempt < 80; attempt++) {
      let pose
      if (fromClub && attempt < 30) {
        if (launchAtClub(boat)) return boat
        continue
      }
      if (initial) {
        // anywhere on the visible water
        const ch = rng() < 0.84 ? river.channels[0] : river.channels[1]
        const visible = ch.pts.map((p, i) => i).filter(i => river.inView(ch.pts[i], -20))
        if (!visible.length) continue
        const i = visible[Math.floor(rng() * visible.length)]
        pose = poseFor(ch, i, boat.dir, clamp(boat.lane + rand(-0.1, 0.1), 0, 0.55))
        pose.heading += rand(-0.25, 0.25)
      } else if (boat.dir > 0) {
        const ch = pickChannel()
        // arriving from upstream, just out of view
        pose = poseFor(ch, Math.max(0, sourceIndex(ch) - Math.floor(rand(0, 6))), 1, boat.lane)
      } else {
        // coming up from the mouth, just out of view
        const ch = river.channels[0]
        pose = poseFor(ch, Math.min(ch.pts.length - 1, mouthIndex(ch) + Math.floor(rand(0, 6))), -1, boat.lane)
      }
      if (tryPlace(boat, pose)) {
        boat.route = pickRoute(boat.dir)
        boats.push(boat)
        arrivals.push(boat)
        return boat
      }
    }
    return null
  }

  // ---- the club: where most paddlers start and finish ------------------------------------
  // Most paddlers launch from the club's landing stage (fading in there), go for a paddle,
  // up to the lock or off downstream, and come back to lift out there again (fading out).
  const CLUB_SHARE = 0.75
  const clubLanding = () => river.site && river.site.landingIndex != null
  // a club paddler's time out before heading home (Infinity: a visitor, who doesn't)
  function setTrip(b, club, secs = rand(40, 150)) {
    b.fromClub = club
    b.trip = club ? secs : Infinity
  }
  // put a paddler in at the landing stage, heading off either way (more go downstream)
  function launchAtClub(b, d = rng() < 0.6 ? 1 : -1) {
    const ch = river.channels[0]
    const i = clamp(river.site.landingIndex + Math.floor(rand(-3, 4)), 0, ch.pts.length - 1)
    if (!tryPlace(b, poseFor(ch, i, d, clamp(river.site.clubSide * d * 0.45, -0.6, 0.6)))) return false
    b.dir = d
    b.route = pickRoute(d)
    setTrip(b, true)
    b.opacity = 0
    b.portage = { phase: 'in', t: 0, launch: true }
    boats.push(b)
    arrivals.push(b)
    return true
  }
  // which way the club is from a paddler on their way home (+1 downstream, -1 up), or 0
  // (not going home yet, a visitor, or off on the side stream)
  function homeDir(b) {
    if (!b.fromClub || b.trip > 0 || !clubLanding()) return 0
    const i = lockIndexAt(b.x, b.y)
    if (i == null) return 0
    return i < river.site.landingIndex ? 1 : -1
  }
  // on the way home: over to the club bank coming up to the landing stage, and lift out there
  function headHome(b) {
    const home = homeDir(b)
    const d = b.dir || 1
    if (!home || home !== d || b.portage) return
    const i = lockIndexAt(b.x, b.y)
    const dist = Math.abs(river.site.landingIndex - i) * SAMPLE
    if (dist > (220 * b.scale) / 0.55) return
    b.lane = clamp(river.site.clubSide * d * 0.7, -0.75, 0.75)
    if (dist <= SAMPLE * 2) {
      if (b.group != null) leaveGroup(b)
      b.portage = { phase: 'out', t: 0, finish: true }
    }
  }
  let landings = 0
  // a club paddler paddling on out of sight comes back the same way later (rather than
  // being gone for good, as a visitor is)
  function goAway(b) {
    if (b.group != null) leaveGroup(b)
    b.away = Math.max(b.trip, 0) + rand(10, 40)
    b.awayDir = -(b.dir || 1)
    b.trip = 0
    b.x = PARKED; b.y = PARKED; b.circles.fill(PARKED)
  }
  function comeBack(b) {
    const ch = river.channels[0]
    const dir = b.awayDir
    b.scale = baseScale() * clamp(b.scale / (b.baseScale || baseScale()), 0.85, 1.15)
    b.baseScale = baseScale()
    for (const back of [0, 3, 6, 9]) {
      const i = dir > 0 ? Math.max(0, sourceIndex(ch) - back) : Math.min(ch.pts.length - 1, mouthIndex(ch) + back)
      if (tryPlace(b, poseFor(ch, i, dir, rightLane()))) {
        b.dir = dir
        b.route = pickRoute(dir)
        b.lane = rightLane()
        b.blocked = 0
        b.heldFor = 0
        b.uTurn = 0
        b.lockChoice = null
        b.opacity = 1
        return true
      }
    }
    return false
  }

  // ---- groups: club boats paddling together, and the odd diamond of racing boats -------
  // club:    2-4 bright yellow club K1s out together, at one (gentle) pace, keeping close
  // diamond: a lead boat (a K2 sometimes, otherwise a racing K1) with three racing K1s
  //          riding its wash: one off each side of its stern, one behind them
  const groups = new Map() // id -> { id, kind, leader, members: [ids], pace }
  let nextGroup = 1
  const lengthOf = b => b.type.box * b.scale
  // a point in a boat's own frame (f ahead of its centre, r to its right), in world space
  const fromBoat = (h, x, y, f, r) => [x + Math.sin(h) * f + Math.cos(h) * r, y - Math.cos(h) * f + Math.sin(h) * r]
  // (spacings checked against the footprints: ~20 px of clear water between boats)
  const DIAMOND_W = 1.2 // wings this many paddle-spans out to the side
  // squeeze 0..1: a diamond meeting traffic (or a narrow stretch) strings out into a line
  // behind its leader, then spreads out again once past
  function diamondSlot(leader, b, k, squeeze = 0) {
    const ll = lengthOf(leader)
    const lm = lengthOf(b)
    const span = 114 * b.scale
    const spread = k === 0 ? [-(ll + lm) * 0.42, -DIAMOND_W * span] // left wing
      : k === 1 ? [-(ll + lm) * 0.42, DIAMOND_W * span] // right wing
        : [-(ll + lm) * 0.72, 0] // tail, on the leader's line behind the wings
    if (!squeeze) return spread
    // in line astern: the tail (already on the leader's line) first, then the right wing,
    // then the left, so the wings drop back behind it rather than cutting across it
    const place = k === 2 ? 1 : k === 1 ? 2 : 3
    const line = [-(ll + lm) * 0.62 * place, 0]
    return [spread[0] + (line[0] - spread[0]) * squeeze, spread[1] * (1 - squeeze)]
  }
  // should this diamond be in line just now? Oncoming paddlers within the look-ahead, or the
  // river too narrow for it to pass anyone spread out
  function diamondCrowded(lead) {
    const q = river.query(lead.x, lead.y)
    const tx = q.tx * lead.dir, ty = q.ty * lead.dir
    const half = q.half
    if (half < 114 * lead.scale * 2.6) return true
    const look = (OVERTAKE_LOOK * 1.3 * lead.scale) / 0.55
    for (const o of boats) {
      if (o.vessel ? o.moored : (o.group === lead.group || o.waiting)) continue
      const rx = o.x - lead.x, ry = o.y - lead.y
      const along = rx * tx + ry * ty
      if (along < -40 || along > look) continue
      if (Math.abs(rx * -ty + ry * tx) > half * 1.1) continue
      // oncoming, or going the same way slower in front (to be overtaken in line)
      if (o.dir !== lead.dir || o.vessel || o.speed < lead.speed * 0.8) return true
    }
    return false
  }

  function spawnGroup(kind, initial, fromClub) {
    const diamond = kind === 'diamond'
    // a diamond: a leader, two wings and (usually) a tail; three makes an arrowhead
    let n = diamond ? (rng() < 0.6 ? 4 : 3) : 2 + Math.floor(rng() * 3)
    if (!initial) n = Math.min(n, capacity() - paddlerCount())
    if (n < (diamond ? 3 : 2)) return null
    const id = nextGroup++
    const pace = diamond ? rand(54, 62) : rand(38, 48)
    // groups come up the river from downstream, and turn round below the lock (where most
    // paddlers turn: there's no paddling through it); one already out may be going either way
    // club groups set out from the club (as do many diamonds), heading off either way
    const atClub = !initial && clubLanding() && (fromClub ?? (!diamond || rng() < 0.8))
    const dir = atClub ? (rng() < 0.6 ? 1 : -1) : initial ? pickDir() : -1
    const members = []
    for (let k = 0; k < n; k++) {
      const type = diamond ? (k === 0 && rng() < 0.45 ? TYPES.k2 : TYPES.racer) : TYPES.k1
      const b = makePaddler(type, diamond ? (k === 0 ? pace : rand(type.pace[0], type.pace[1])) : pace + rand(-3, 3))
      b.dir = dir
      b.group = id
      b.club = !diamond
      b.lane = diamond ? 0 : k % 2 ? 0.46 : 0.36 // a diamond takes the middle of the river: it's wide
      b.slot = diamond ? k - 1 : -1 // diamond: 0 left wing, 1 right wing, 2 tail
      members.push(b)
    }
    const ch = diamond || dir < 0 || atClub ? river.channels[0] : pickChannel()
    const step = Math.ceil((lengthOf(members[0]) * 1.8) / SAMPLE) // club boats nearly a boat-length apart, bow to stern
    for (let attempt = 0; attempt < 14; attempt++) {
      let i0
      if (atClub) {
        i0 = clamp(river.site.landingIndex + dir * [0, 3, -3, 6, -6, 9, -9, 12, -12, 15, -15, 18, -18, 21][attempt], 0, ch.pts.length - 1)
      } else if (initial) {
        const visible = ch.pts.map((p, i) => i).filter(i => river.inView(ch.pts[i], -60))
        if (!visible.length) return null
        i0 = visible[Math.floor(rng() * visible.length)]
      } else {
        i0 = dir > 0 ? Math.max(0, sourceIndex(ch) - 2 - attempt * 3) : Math.min(ch.pts.length - 1, mouthIndex(ch) + 2 + attempt * 3)
      }
      const placed = []
      let ok = true
      for (const [k, b] of members.entries()) {
        let pose
        if (k === 0 || !diamond || atClub) { // (from the landing stage, one after another: they form up on the way)
          const i = clamp(i0 - dir * k * step, 0, ch.pts.length - 1)
          pose = poseFor(ch, i, dir, b.lane)
        } else {
          const lead = members[0]
          const [f, r] = diamondSlot(lead, b, b.slot)
          const [x, y] = fromBoat(lead.heading, lead.x, lead.y, f, r)
          pose = { x, y, heading: lead.heading }
        }
        if (!onWater(b, pose.x, pose.y) || !tryPlace(b, pose)) { ok = false; break }
        boats.push(b) // so the next member is checked against this one
        placed.push(b)
      }
      if (ok) {
        // a group's out for a paddle together (coming up from downstream: on its way home)
        const club = atClub || !diamond || rng() < 0.6
        const trip = atClub ? rand(60, 160) : initial ? rand(0, 120) : 0
        for (const b of members) {
          b.route = pickRoute(dir)
          setTrip(b, club, trip)
          if (atClub) {
            b.opacity = 0
            b.portage = { phase: 'in', t: 0, launch: true }
          }
          arrivals.push(b)
        }
        groups.set(id, { id, kind, leader: members[0].id, members: members.map(b => b.id), pace })
        return members[0]
      }
      for (const b of placed) remove(b.id)
    }
    return null
  }

  // a boat leaving takes itself out of its group; a diamond without its leader breaks up
  function leaveGroup(b) {
    const g = groups.get(b.group)
    b.group = null
    if (!g) return
    g.members = g.members.filter(id => id !== b.id)
    if (g.kind === 'diamond' && g.leader === b.id) {
      for (const id of g.members) {
        const m = get(id)
        if (m) m.group = null
      }
      g.members = []
    }
    if (!g.members.length) groups.delete(g.id)
  }

  // How a group member steers and paces itself. Returns a heading to aim for (diamond
  // wing and tail boats hold their places off the leader), or null to steer as usual.
  function groupSteer(b) {
    const g = groups.get(b.group)
    if (!g) { b.group = null; return null }
    const fx = Math.sin(b.heading)
    const fy = -Math.cos(b.heading)
    if (g.kind === 'diamond') {
      if (g.leader === b.id) {
        b.baseSpeed = g.pace * speedFactor
        // string out into a line when meeting traffic; the line keeps a little right of the
        // middle (spread out, the diamond has the middle)
        const want = diamondCrowded(b) ? 1 : 0
        g.squeeze = clamp((g.squeeze || 0) + Math.sign(want - (g.squeeze || 0)) * 0.12, 0, 1) // (planned every ~0.15 s)
        b.lane = 0.05 + 0.3 * g.squeeze
        return null
      }
      const lead = get(g.leader)
      if (!lead || lead.waiting || lead.leaving || lead.dir !== b.dir) { leaveGroup(b); return null }
      const [f, r] = diamondSlot(lead, b, b.slot, g.squeeze || 0)
      const [sx, sy] = fromBoat(lead.heading, lead.x, lead.y, f, r)
      const along = (sx - b.x) * fx + (sy - b.y) * fy // how far behind its place (+) it is
      // aim a little ahead of its place, and match the leader's speed, a touch quicker when
      // behind (gently: chasing its place hard has it surging and bumping into the others,
      // which looks jerky)
      const [ax, ay] = fromBoat(lead.heading, sx, sy, 22 * b.scale / 0.5, 0)
      const L = lengthOf(b)
      b.baseSpeed = clamp(lead.speed * (1 + clamp(along / L, -0.5, 0.5) * 0.3), lead.speed * 0.6, Math.min(lead.speed * 1.15 + 4, b.type.pace[1] * speedFactor * 1.15))
      return Math.atan2(ax - b.x, -(ay - b.y))
    }
    // club: one gentle pace for all, a touch quicker if the others are ahead, easing off if
    // it is out in front; and drifting towards the others' line across the river
    let ahead = 0
    let lane = 0
    let n = 0
    for (const id of g.members) {
      const m = id !== b.id && get(id)
      if (!m || m.waiting || m.dir !== b.dir) continue
      ahead += (m.x - b.x) * fx + (m.y - b.y) * fy
      lane += m.lane
      n++
    }
    const L = lengthOf(b)
    // (gently: catching up hard just has them running into each other)
    b.baseSpeed = g.pace * speedFactor * (n ? clamp(1 + ahead / n / (5 * L), 0.92, 1.1) : 1)
    if (n) b.lane += (lane / n - b.lane) * 0.05
    return null
  }

  function remove(id) {
    const i = boats.findIndex((b) => b.id === id)
    if (i >= 0) boats.splice(i, 1)
  }

  const PARKED = -1e5 // where boats wait, out of sight, for room at a source
  let lifts = 0 // how many times a stuck paddler has lifted out (see step)

  // The river is redrawn for the new screen (a rotated tablet gets a different river), so
  // each boat moves to the same place on it: same channel, same distance along, same lane.
  // Anyone who can't fit waits out of sight and comes in at a source when there's room.
  function resize(w, h) {
    if (w / zoom === W && h / zoom === H) return []
    debris.length = 0 // the river is redrawn: anything floating on it starts afresh
    const where = boats.map(b => {
      const q = river.query(b.x, b.y)
      return { b, ch: q.ch, along: q.along, lane: clamp(((b.dir || 1) * q.s) / q.half, -0.6, 0.6) }
    })
    W = w / zoom
    H = h / zoom
    sizeRef = Math.min(w, h)
    river = buildRiver(W, H, sizeRef)
    for (const b of boats) { b.x = PARKED; b.y = PARKED } // clear the water, then re-seat
    const bs = baseScale()
    const order = (a, z) => (z.b.vessel - a.b.vessel) || (z.along - a.along)
    for (const { b, ch: ci, along, lane } of where.sort(order)) {
      b.scale = b.vessel ? bs * VESSEL_SCALE : bs * clamp(b.scale / (b.baseScale || bs), 0.85, 1.15)
      b.baseScale = bs
      const ch = river.channels[ci] || river.channels[0]
      const i0 = Math.round(along * (ch.pts.length - 1))
      let placed = false
      if (b.fixed) {
        // a boat on the old river's moorings: back on its moorings, near where it was
        const tc = river.channels[1]
        const j0 = Math.round(along * (tc.pts.length - 1))
        for (const di of [0, -4, 4, -8, 8, -14, 14, -22, 22]) {
          const j = clamp(j0 + di, 0, tc.pts.length - 1)
          const pose = poseFor(tc, j, 1, mooredLane(b, tc))
          if (b.facingUp) pose.heading += Math.PI
          if (hullOut(b, pose.x, pose.y, pose.heading) <= 5 && tryPlace(b, pose)) { placed = true; break }
        }
      } else if (b.moored) placed = placeVessel(b) // any straight stretch in view
      else {
        for (const di of [0, -4, 4, -8, 8, -12, 12, -18, 18]) {
          const i = clamp(i0 + di, 0, ch.pts.length - 1)
          if (tryPlace(b, poseFor(ch, i, b.dir || 1, b.vessel ? vesselLane(b, ch) : lane))) { placed = true; break }
        }
      }
      b.turn = b.omega = 0
      b.blocked = 0
      b.thinkTimer = 0
      b.waiting = !placed
      if (!placed) { b.x = PARKED; b.y = PARKED }
    }
    // a smaller river takes fewer boats: the extras leave, those waiting out of sight first.
    // Returns the ids that left, so the page can stop drawing them.
    const gone = []
    while (paddlerCount() > capacity()) {
      let i = boats.findIndex(b => b.waiting && !b.vessel)
      if (i < 0) i = boats.findLastIndex(b => !b.vessel)
      gone.push(boats[i].id)
      boats.splice(i, 1)
    }
    return gone
  }

  const get = (id) => boats.find((b) => b.id === id)

  // Is this footprint clear of every other boat at the given pose?
  function fits(b, x, y, heading, gap = GAP) {
    circlesFor(b.type, x, y, heading, b.scale, probe)
    return !hits(boats, b.type, probe, x, y, b.scale, b.id, gap) && clearOfDebris(b.type.n3, b, x, y)
  }
  // ...and of anything floating down the river (a hull already touching some, from a
  // resize say, may still move: just not further into it)
  function clearOfDebris(n3, b, x, y) {
    for (const d of debris) {
      const reach = b.type.bound * b.scale + d.r + 2
      const dx = x - d.x
      const dy = y - d.y
      if (dx * dx + dy * dy >= reach * reach) continue
      for (let i = 0; i < n3; i += 3) {
        const ex = probe[i] - d.x
        const ey = probe[i + 1] - d.y
        const lim = probe[i + 2] * 0.8 + d.r // (the paddle-sweep circles are generous: a blade may pass over a twig)
        if (ex * ex + ey * ey < lim * lim) return false
      }
    }
    return true
  }

  // On the water: the hull keeps BANK_KEEP px inside the bank, or at least isn't
  // pushed further out than it already is (so a boat squeezed by a resize can recover)
  // how far from the bank this boat's centre line keeps: wider for an outrigger, whose
  // float rides well out to one side
  const keepFor = b => (b.type.reach > BOAT_HALF ? Math.max(BANK_KEEP, b.type.reach * b.scale - 2) : BANK_KEEP)
  // An outrigger's float rides well out to the side, so turning on the spot or sliding
  // along a bend could swing it over the bank: check points along it too (on the water,
  // or at least no further out than they already are).
  const FLOAT_PTS = [-70, -35, 0, 35, 65]
  function floatOut(b, x, y, h) {
    const c = Math.cos(h)
    const sn = Math.sin(h)
    let worst = -Infinity
    for (const yy of FLOAT_PTS) {
      const px = x + b.scale * (-64 * c - yy * sn)
      const py = y + b.scale * (-64 * sn + yy * c)
      worst = Math.max(worst, 2 - river.inside(px, py))
    }
    return worst // > 0: that far over (2 px margin)
  }
  const floatOK = (b, x, y, h) => b.type.reach <= BOAT_HALF || floatOut(b, x, y, h) <= Math.max(0, floatOut(b, b.x, b.y, b.heading) + 0.01)
  function onWater(b, x, y, keep = keepFor(b)) {
    if (!b.vessel && inLock(x, y) && !inLock(b.x, b.y)) return false // the lock: no way through in a paddle boat
    const out = keep - river.inside(x, y)
    if (out <= 0) return true
    return out <= keep - river.inside(b.x, b.y) + 0.01
  }

  function commit(b, x, y, heading) {
    b.x = x
    b.y = y
    b.heading = heading
    b.circles.set(probe.subarray(0, b.type.n3))
  }

  // ---- making way for quicker boats --------------------------------------------------------
  const inDiamond = b => b.group != null && groups.get(b.group)?.kind === 'diamond'
  // A slower paddler makes way (pulls over towards its own bank) for: a quicker boat, or a
  // diamond, close behind it going the same way; or a diamond coming towards it.
  function shouldMakeWay(b, tx, ty) {
    const L = lengthOf(b)
    for (const o of boats) {
      if (o === b || o.vessel || o.waiting || o.leaving) continue
      const rx = o.x - b.x
      const ry = o.y - b.y
      const along = rx * tx + ry * ty // + ahead of b (along the river, b's way)
      const across = Math.abs(rx * -ty + ry * tx)
      if (across > 160 * b.scale / 0.55) continue
      const diamond = inDiamond(o)
      if (o.dir === b.dir) {
        // behind, within a few lengths, and quicker (by a good margin) or in a diamond
        if (along > 0 || along < -(L * 3.5 + (diamond ? L * 2 : 0))) continue
        if (diamond || o.baseSpeed > b.baseSpeed * 1.2) return true
      } else if (diamond && along > 0 && along < (OVERTAKE_LOOK * 1.5 * b.scale) / 0.55) {
        return true
      }
    }
    return false
  }

  // Pick a turn rate (and how much to ease off) for the next fraction of a second
  function plan(b) {
    // preferred turn: follow the river the way this boat is going, drifting back towards its
    // lane on its own right-hand side
    const q = river.routedQuery(b.x, b.y, b.route)
    const d = b.dir || 1
    const tx = q.tx * d
    const ty = q.ty * d
    const nx = -ty
    const ny = tx
    // making way: a quicker boat (or a diamond) coming up behind, or a diamond coming the
    // other way, and this one pulls over towards its bank for a few seconds and lets it by
    if (!(b.makeWay > 0) && !inDiamond(b) && (b.makeWayCheck = (b.makeWayCheck || 0) - 1) <= 0) {
      b.makeWayCheck = 3 // every few plans is plenty
      if (shouldMakeWay(b, q.tx * d, q.ty * d)) b.makeWay = 3.5
    }
    let lane = b.makeWay > 0 ? Math.max(b.lane, MAKE_WAY_LANE) : b.lane
    // going upstream when the river's up: hug the bank, out of the strongest current
    if (d < 0 && weather.rain > 0 && !inDiamond(b)) lane = Math.max(lane, 0.3 + 0.25 * weather.rain)
    const err = (q.s * d - lane * q.half) / q.half // + means right of the lane
    const k = clamp(err * 1.6, -1.3, 1.3)
    let want = Math.atan2(tx - nx * k, -(ty - ny * k)) + b.wander
    const inFormation = b.group != null && groups.get(b.group)?.kind === 'diamond'
    if (b.group != null) {
      const g = groupSteer(b)
      if (g != null) want = g
    }
    const ag = b.type.agility
    const maxTurn = MAX_TURN * ag
    let pref = clamp(wrapAngle(want - b.heading) * 2, -maxTurn, maxTurn)
    // turning round: swing left, across towards the middle of the river (it's on its
    // right-hand side, and the bank is the other way), until it faces the new way
    if (b.uTurn > 0 && Math.abs(wrapAngle(want - b.heading)) > 0.9) pref = -maxTurn

    const dt = LOOK_TIME / LOOK_STEPS
    const v = b.baseSpeed

    // neighbours that could matter within the look-ahead, and where each will be
    // if it simply carries on as it is
    const near = []
    let used = 0
    for (const o of boats) {
      if (o === b) continue
      const dx = o.x - b.x
      const dy = o.y - b.y
      const reach = b.type.bound * b.scale + o.type.bound * o.scale + (v + o.speed) * LOOK_TIME + COMFORT
      if (dx * dx + dy * dy >= reach * reach) continue
      // A boat coming up behind, going the same way, is its paddler's to steer round: this
      // one carries on regardless (easing off for it made whole lines of boats crawl).
      if (dx * Math.sin(b.heading) - dy * Math.cos(b.heading) < 0 && Math.cos(o.heading - b.heading) > 0.5) continue
      // boats in the same diamond hold their places off each other (close, as when riding
      // a wash); only the hard no-overlap rule applies between them
      if (inFormation && o.group === b.group) continue
      const vx = Math.sin(o.heading) * o.speed
      const vy = -Math.cos(o.heading) * o.speed
      near.push(used)
      for (let k2 = 0; k2 < LOOK_STEPS; k2++) {
        const slot = pool[used] || (pool[used] = { x: 0, y: 0, reach: 0, n3: 0, c: new Float64Array(MAX_NC3) })
        used++
        slot.x = o.x + vx * dt * (k2 + 1)
        slot.y = o.y + vy * dt * (k2 + 1)
        slot.reach = o.type.bound * o.scale
        slot.n3 = o.type.nc3
        // a club boat close behind or beside another of its group is expected there: it
        // doesn't make either of them ease off (they'd slow each other to a crawl)
        slot.mate = b.group != null && o.group === b.group
        coarseCircles(o.type, slot.x, slot.y, o.heading, o.scale, slot.c)
      }
    }

    const reachBank = b.type.reach * b.scale
    // near a narrowboat there is little room to meet oncoming traffic, so keep right harder
    // (followers wait behind a cruising one rather than pull out; see the follow cap below)
    // Keeping right matters when something is coming the other way. With the way ahead
    // clear of oncoming boats, a paddler may pull out to the left to overtake.
    let keepRight = inFormation ? 1 : KEEP_RIGHT_CLEAR
    const halfHere = q.half
    {
      const fx = Math.sin(b.heading)
      const fy = -Math.cos(b.heading)
      const ahead = (OVERTAKE_LOOK * b.scale) / 0.55
      for (const o of boats) {
        if (o === b || o.waiting || (o.dir || 1) === d || (o.moored)) continue
        const rx = o.x - b.x
        const ry = o.y - b.y
        const along = rx * fx + ry * fy
        if (along < -40 || along > ahead + o.type.bound * o.scale) continue
        if (Math.abs(rx * fy - ry * fx) > halfHere * 1.6) continue
        keepRight = KEEP_RIGHT
        break
      }
    }
    for (const o of boats) {
      if (!o.vessel || o.waiting || Math.hypot(o.x - b.x, o.y - b.y) >= o.type.bound * o.scale + 140 * b.scale / 0.55) continue
      // a boat moored on this paddler's side blocks its lane: it has to pull out round it
      if (o.moored && river.query(o.x, o.y).s * d > 0) { keepRight = Math.min(keepRight, KEEP_RIGHT * KEEP_RIGHT_MOORED); break }
      if (keepRight === KEEP_RIGHT) keepRight = KEEP_RIGHT * KEEP_RIGHT_NEAR_VESSEL // oncoming traffic by a narrowboat
    }
    let bestW = pref
    let bestScore = Infinity
    let bestEarly = Infinity
    for (const w of [pref, 0, 0.3 * ag, -0.3 * ag, 0.6 * ag, -0.6 * ag, 0.9 * ag, -0.9 * ag, maxTurn, -maxTurn]) {
      let x = b.x
      let y = b.y
      let h = b.heading
      let cost = 0
      let early = Infinity // closest approach to a neighbour over the first half of the look-ahead
      for (let k2 = 0; k2 < LOOK_STEPS; k2++) {
        h += w * dt
        x += Math.sin(h) * v * dt
        y -= Math.cos(h) * v * dt

        let cl = Infinity
        let clBrake = Infinity // ...not counting its own group, for easing off
        if (near.length) {
          coarseCircles(b.type, x, y, h, b.scale, cand)
          for (const base of near) {
            const slot = pool[base + k2]
            const dx = x - slot.x
            const dy = y - slot.y
            const reach = b.type.bound * b.scale + slot.reach + COMFORT
            if (dx * dx + dy * dy >= reach * reach) continue
            const d = coarseClearance(cand, b.type.nc3, slot.c, slot.n3)
            if (d < cl) cl = d
            if (d < clBrake && !slot.mate) clBrake = d
          }
        }
        if (k2 < 2 && clBrake < early) early = clBrake

        // the banks count as neighbours: clear water between the paddle tips and the bank
        const bank = river.inside(x, y) - reachBank
        const rq = river.query(x, y)
        // keep right: drifting over to the left of the middle (into oncoming traffic) costs,
        // so overtaking and passing happen there only when the right is blocked
        const side = (rq.s * d) / rq.half
        if (side < KEEP_RIGHT_FROM) cost += STEP_WEIGHT[k2] * keepRight * (KEEP_RIGHT_FROM - side)
        // (a diamond is wide: its boats only mind a bank when really close to it)
        const trouble = Math.min(cl, inFormation ? bank + COMFORT - 10 : bank)
        if (trouble < COMFORT) {
          const sq = (COMFORT - trouble) / COMFORT
          cost += STEP_WEIGHT[k2] * (trouble <= 0 ? 4 - trouble * 0.1 : 4 * sq * sq)
        }
        // stay roughly pointing along the river: a boat turned across it blocks it
        const fq = river.routedQuery(x, y, b.route)
        const across = Math.abs(wrapAngle(h - Math.atan2(fq.tx * d, -fq.ty * d)))
        if (across > 0.6) cost += STEP_WEIGHT[k2] * 2.5 * (across - 0.6)
        // ripples: keep out of the disturbed water, more so while it is fresh
        for (const r of ripples) {
          const rr = (RIPPLE_R * b.scale) / 0.55
          const dx = x - r.x
          const dy = y - r.y
          const d2 = dx * dx + dy * dy
          if (d2 >= rr * rr) continue
          const near = 1 - Math.sqrt(d2) / rr
          cost += STEP_WEIGHT[k2] * RIPPLE_COST * near * near * (1 - r.age / RIPPLE_LIFE)
        }
        // debris: give it a wide berth, seen coming
        for (const dbr of debris) {
          const rr = dbr.r + (70 * b.scale) / 0.55
          const dx = x - dbr.x
          const dy = y - dbr.y
          const d2 = dx * dx + dy * dy
          if (d2 >= rr * rr) continue
          const near = 1 - Math.sqrt(d2) / rr
          cost += STEP_WEIGHT[k2] * 9 * near * near
        }
      }
      // staying close to the wanted turn is cheap; leaving it costs, turning left a touch more
      // so that two boats meeting head-on both pass on the same side
      cost += 1.2 * Math.abs(w - pref) + (w < pref ? 0.08 : 0)
      if (cost < bestScore) {
        bestScore = cost
        bestW = w
        bestEarly = early
      }
    }

    b.omega = bestW
    b.pref = pref
    b.slow = clamp(SLOW_MIN + ((1 - SLOW_MIN) * (bestEarly - 4)) / (SLOW_DIST - 4), SLOW_MIN, 1)
    b.braking = b.slow < 0.6

    // Close behind a slower boat in the same line: match its speed rather than ramming
    // or squeezing past (overtaking still happens when there's room to the side).
    const fx = Math.sin(b.heading)
    const fy = -Math.cos(b.heading)
    b.cap = Infinity
    for (const o of boats) {
      if (o === b) continue
      const rx = o.x - b.x
      const ry = o.y - b.y
      const ahead = rx * fx + ry * fy
      if (ahead <= 0) continue
      // only boats going the same way are followed; oncoming ones are passed (keeping right)
      if (Math.cos(o.heading - b.heading) < 0.3) continue
      // in a diamond, each boat keeps its own place (the tail sits close behind the leader)
      if (inFormation && o.group === b.group) continue
      const side = Math.abs(rx * fy - ry * fx)
      if (o.vessel) {
        // a narrowboat is overtaken (or passed, if moored), not followed: only ease off when
        // right on its stern
        const gapAhead = ahead - o.type.bound * o.scale - b.type.bound * b.scale * 0.6
        if (gapAhead < 25 && side < (33 + 10) * o.scale + BOAT_HALF * b.scale * 0.6 && o.speed < b.cap) b.cap = o.speed
        continue
      }
      const length = (b.type.bound * b.scale + o.type.bound * o.scale) * 0.8 + 30
      const width = BOAT_HALF * (b.scale + o.scale) * 0.9
      // a boat ahead that has (nearly) stopped is not followed: paddle round it instead
      if (ahead < length && side < width && o.speed < b.cap && o.speed >= FOLLOW_MIN) b.cap = o.speed
    }

    // Give way at a moored narrowboat: one moored on this paddler's side of the river
    // blocks its lane, so it waits short of the boat while anyone is coming the other way
    // past it (as on a real river). Not for ever, in case the other side is jammed too.
    b.yielding = false
    if (b.goAnyway > 0) return
    for (const o of boats) {
      if (!o.moored || o.waiting) continue
      const rx = o.x - b.x
      const ry = o.y - b.y
      const gapAhead = rx * fx + ry * fy - o.type.bound * o.scale - b.type.bound * b.scale
      if (gapAhead < 0 || gapAhead > 80 * b.scale / 0.55) continue
      const oq = river.query(o.x, o.y)
      if (oq.s * d <= 0) continue // moored on the far side: no need
      // only where it leaves too little river for two boats to pass beside it: mostly
      // there's plenty, and paddlers just keep going past it
      const free = 2 * oq.half - (70 * o.scale + 10)
      if (free > 2 * 2 * BOAT_HALF * b.scale) continue
      const reach = o.type.bound * o.scale + 90 * b.scale / 0.55
      const oncoming = boats.some(p => !p.vessel && !p.waiting && p.dir !== b.dir && Math.hypot(p.x - o.x, p.y - o.y) < reach)
      if (oncoming) {
        b.cap = 0
        b.yielding = true
        return
      }
    }
  }

  // Unit vector pointing away from the nearest part of the nearest neighbour, or null
  function awayFrom(b) {
    let best = Infinity
    let vx = 0
    let vy = 0
    for (const o of boats) {
      if (o === b) continue
      const dx = b.x - o.x
      const dy = b.y - o.y
      const reach = b.type.bound * b.scale + o.type.bound * o.scale + 40
      if (dx * dx + dy * dy >= reach * reach) continue
      const oc = o.circles
      for (let i = 0; i < b.type.n3; i += 3) {
        for (let j = 0; j < o.type.n3; j += 3) {
          const ex = b.circles[i] - oc[j]
          const ey = b.circles[i + 1] - oc[j + 1]
          const d = Math.sqrt(ex * ex + ey * ey) - b.circles[i + 2] - oc[j + 2]
          if (d < best && ex * ex + ey * ey > 0) {
            best = d
            const l = Math.sqrt(ex * ex + ey * ey)
            vx = ex / l
            vy = ey / l
          }
        }
      }
    }
    return best === Infinity ? null : { x: vx, y: vy }
  }

  // ---- narrowboats: moored against a bank, or cruising slowly down the middle ----------
  // Moored: hull 5 px off the bank, facing either way, on a straight stretch of the main
  // river in full view. Paddlers treat them like any other boat and paddle around them.
  const vesselHalfLength = b => b.type.bound * b.scale
  const mooredLane = (b, ch) => b.side * Math.max(0.2, 1 - (5 + 33 * b.scale) / ch.half)
  // cruising, a narrowboat keeps a little to one side (a third of the way out from the
  // middle), leaving a wide lane for paddlers to overtake it, but enough room from the
  // bank for its long hull to follow the bends
  const cruiseLane = (b) => b.side * CRUISE_LANE // side is +1 (its right) when cruising
  const vesselLane = (b, ch = river.channels[0]) => (b.moored ? mooredLane(b, ch) : cruiseLane(b, ch))
  function placeVessel(b) {
    const ch = river.channels[0]
    const k = Math.ceil(vesselHalfLength(b) / SAMPLE)
    const spots = []
    for (let i = k; i < ch.pts.length - k; i++) {
      if (!river.inView(ch.pts[i - k], -10) || !river.inView(ch.pts[i + k], -10)) continue
      const [ax, ay] = ch.tan[i - k]
      const [bx, by] = ch.tan[i + k]
      if (b.moored && ax * bx + ay * by < 0.96) continue // moor on a straight stretch
      const [px, py] = ch.pts[i]
      if (river.site && i >= river.site.lockRange[0] - k - 12 && i <= river.site.lockRange[1] + k + 12) continue // not in or by the lock
      // not under or right by the footbridge
      if (river.bridge && Math.hypot(px - river.bridge.x, py - river.bridge.y) < vesselHalfLength(b) + river.bridge.span / 2 + 40) continue
      // not at the confluence: well clear of every part of the tributary
      const tribGap = vesselHalfLength(b) + 2.5 * river.channels[1].half
      if (river.channels[1].pts.some(([tx, ty]) => Math.hypot(px - tx, py - ty) < tribGap)) continue
      // well clear of other narrowboats (two moored opposite each other would choke the river)
      if (boats.some(o => o.vessel && o !== b && !o.waiting && Math.hypot(o.x - px, o.y - py) < vesselHalfLength(b) + vesselHalfLength(o) + 160)) continue
      spots.push(i)
    }
    for (let attempt = 0; attempt < 60 && spots.length; attempt++) {
      const i = spots[Math.floor(rng() * spots.length)]
      const pose = poseFor(ch, i, b.dir, vesselLane(b, ch))
      if (b.facingUp) pose.heading += Math.PI
      // whole hull on the water (a moored boat may sit 5 px off the bank, inside the 6 px margin)
      if (hullOut(b, pose.x, pose.y, pose.heading) > (b.moored ? 5 : 0)) continue
      if (tryPlace(b, pose)) return true
    }
    return false
  }
  // tries the asked-for kind first; if no spot fits, the other kind (so there's always a boat)
  function spawnVessel(moored) {
    return spawnVesselAs(moored) || spawnVesselAs(!moored)
  }
  function spawnVesselAs(moored) {
    const boat = makeVessel(moored)
    if (!placeVessel(boat)) return null
    boats.push(boat)
    return boat
  }
  // The narrowboats moored along the old river near where it joins (they live there: they
  // never cast off). On its right-hand bank, the car park side, as in the aerial photo,
  // on the straighter stretches in view, a little apart. Returns the boats placed.
  function spawnMoorings(want = 3) {
    const ch = river.channels[1]
    const main = river.channels[0]
    const end = ch.pts[ch.pts.length - 1]
    const placed = []
    for (let n = 0; n < want; n++) {
      const b = makeVessel(true)
      b.fixed = true
      b.castOff = Infinity
      b.side = 1
      b.facingUp = rng() < 0.5
      b.dir = 1
      const k = Math.ceil(vesselHalfLength(b) / SAMPLE)
      const spots = []
      for (let i = k; i < ch.pts.length - k; i++) {
        if (!river.inView(ch.pts[i - k], -10) || !river.inView(ch.pts[i + k], -10)) continue
        const [ax, ay] = ch.tan[i - k]
        const [bx, by] = ch.tan[i + k]
        if (ax * bx + ay * by < 0.9) continue
        const [px, py] = ch.pts[i]
        // clear of the junction, and of the other boats
        if (Math.hypot(px - end[0], py - end[1]) < vesselHalfLength(b) + 2.2 * main.half) continue
        if (boats.some(o => o.vessel && !o.waiting && Math.hypot(o.x - px, o.y - py) < vesselHalfLength(b) + vesselHalfLength(o) + 30)) continue
        spots.push(i)
      }
      // nearest the junction first: the moorings are by the club
      spots.sort((a, b2) => b2 - a)
      let ok = false
      for (const i of spots.slice(0, 40)) {
        const pose = poseFor(ch, i, 1, mooredLane(b, ch))
        if (b.facingUp) pose.heading += Math.PI
        if (hullOut(b, pose.x, pose.y, pose.heading) > 5) continue
        if (tryPlace(b, pose)) { ok = true; break }
      }
      if (!ok) break
      b.route = 1
      boats.push(b)
      placed.push(b)
    }
    return placed
  }
  // a new narrowboat cruising in from one end of the river, out of sight
  function arriveVessel() {
    const boat = makeVessel(false)
    if (!recycle(boat)) return null
    boats.push(boat)
    return boat
  }
  function makeVessel(moored) {
    const type = TYPES.narrowboat
    const bs = baseScale()
    const pace = rand(type.pace[0], type.pace[1])
    const boat = {
      id: nextId++,
      type,
      vessel: true,
      moored,
      // moored: which bank, and which way it faces. Cruising: either way along the river,
      // keeping to its right
      dir: moored ? 1 : pickDir(),
      side: moored ? (rng() < 0.5 ? -1 : 1) : 1,
      facingUp: moored && rng() < 0.5,
      x: 0, y: 0, heading: 0,
      scale: bs * VESSEL_SCALE, // a narrowboat drawn smaller than true to scale beside the kayaks
      baseScale: bs * VESSEL_SCALE,
      waiting: false,
      pace,
      baseSpeed: pace * speedFactor,
      speed: moored ? 0 : pace * speedFactor,
      lane: rand(-0.12, 0.12),
      turn: 0, omega: 0, slow: 1, braking: false, blocked: 0, cap: Infinity,
      wander: 0, wanderTimer: Infinity, thinkTimer: Infinity,
      // a moored boat casts off after a while and cruises away (turnover)
      castOff: moored ? rand(90, 300) : Infinity,
      age: 0,
      circles: new Float64Array(type.n3)
    }
    return boat
  }
  // casting off: it heads the way it faces, over to its own right-hand side, and on its way
  function castOff(b) {
    b.moored = false
    b.dir = b.facingUp ? -1 : 1
    b.facingUp = false
    b.side = 1
    b.speed = 0
    b.blocked = 0
  }
  // A narrowboat move must keep the whole hull on the water: both sides, checked along
  // its length, at least 6 px inside the bank (or no further out than it already is).
  function hullOut(b, x, y, heading) {
    const c = Math.cos(heading)
    const sn = Math.sin(heading)
    let worst = -Infinity
    for (let yy = -240; yy <= 240; yy += 40) {
      for (const xx of [-33, 33]) {
        const px = x + b.scale * (xx * c - yy * sn)
        const py = y + b.scale * (xx * sn + yy * c)
        worst = Math.max(worst, 6 - river.inside(px, py))
      }
    }
    return worst // > 0: that far over the 6 px margin
  }
  const vesselOnWater = (b, x, y, heading) => {
    const out = hullOut(b, x, y, heading)
    return out <= 0 || out <= hullOut(b, b.x, b.y, b.heading) + 0.01
  }

  // cruising: follow its lane down the river at its own pace; it never pushes through a
  // paddler or onto the bank, it just waits until the way ahead is clear
  function advanceVessel(b, dt) {
    if (b.moored) return
    // working through the lock: a narrowboat waits in it a while (gates, paddles, the water
    // filling or emptying) before going on
    const locked = inLock(b.x, b.y)
    if (locked && !b.lockDone) { b.lockDone = true; b.lockWait = rand(14, 24) }
    if (!locked) b.lockDone = false
    if (b.lockWait > 0) { b.lockWait -= dt; b.speed = 0; return }
    // a narrowboat heading upstream keeps to the main river
    const q = river.routedQuery(b.x, b.y, b.dir < 0 ? 0 : null)
    const tx = q.tx * b.dir
    const ty = q.ty * b.dir
    const err = (q.s * b.dir - cruiseLane(b) * q.half) / q.half
    const k = clamp(err * 1.2, -0.8, 0.8)
    const want = Math.atan2(tx + ty * k, -(ty - tx * k))
    const heading = b.heading + clamp(wrapAngle(want - b.heading) * 1.2, -0.35, 0.35) * dt
    const dist = Math.max(3, b.baseSpeed + current() * 0.5 * b.dir) * dt
    const nx = b.x + Math.sin(heading) * dist
    const ny = b.y - Math.cos(heading) * dist
    // Turning swings the long stern sideways, possibly into paddlers following it, so if it
    // can't take its preferred heading it tries carrying straight on, then a slight steer
    // either way. Held up for a couple of seconds, it may pass a paddler more closely
    // (still never touching), so it can't be pinned by one squeezed against the bank.
    const gap = b.blocked > 2 ? SQUEEZE_GAP : GAP
    // steering back towards its lane first, then straight on, then small steers either way
    const back = Math.sign(wrapAngle(want - b.heading)) || 1
    for (const h of [heading, b.heading, b.heading + back * 0.06, b.heading + back * 0.15, b.heading - back * 0.06]) {
      const mx = b.x + Math.sin(h) * dist
      const my = b.y - Math.cos(h) * dist
      if (fits(b, mx, my, h, gap) && vesselOnWater(b, mx, my, h)) {
        commit(b, mx, my, h)
        b.speed = b.baseSpeed
        b.blocked = Math.max(0, b.blocked - dt * 2)
        return
      }
    }
    // held up for a second: edge sideways towards the middle of the river, away from
    // whatever has it pinned (a paddler squeezed between it and the bank can then get out)
    if (b.blocked > 1) {
      const nxv = -q.ty
      const nyv = q.tx
      const towards = -Math.sign(q.s) || 1
      const step = 10 * dt
      for (const f of [1, 0.5]) {
        const mx = b.x + nxv * towards * step * f
        const my = b.y + nyv * towards * step * f
        if (fits(b, mx, my, b.heading, gap) && vesselOnWater(b, mx, my, b.heading)) {
          commit(b, mx, my, b.heading)
          break
        }
      }
    }
    b.speed = 0
    b.blocked += dt
  }

  // off the end of the river, out of sight: come back in, going either way (if there's room)
  function recycle(b) {
    const was = b.dir
    if (recycleAs(b)) return true
    b.dir = was // no room yet: carry on as before and try again shortly
    return false
  }
  function recycleAs(b) {
    if (b.vessel) {
      // a cruising narrowboat comes back on the main river, fully out of sight, at the top
      // or the bottom of it
      const ch = river.channels[0]
      const back = Math.ceil(vesselHalfLength(b) / SAMPLE)
      const dir = b.waiting ? b.dir : pickDir()
      for (const extra of [0, 4, 8, 12]) {
        const i = dir > 0 ? Math.max(0, sourceIndex(ch) - back - extra) : Math.min(ch.pts.length - 1, mouthIndex(ch) + back + extra)
        b.dir = dir
        if (tryPlace(b, poseFor(ch, i, dir, cruiseLane(b, ch)))) {
          b.blocked = 0
          return true
        }
      }
      return false
    }
    const dir = pickDir()
    const ch = dir > 0 ? pickChannel() : river.channels[0]
    const lane = rightLane()
    b.scale = baseScale() * clamp(b.scale / (b.baseScale || baseScale()), 0.85, 1.15)
    b.baseScale = baseScale()
    for (const back of [0, 3, 6, 9]) {
      const i = dir > 0 ? Math.max(0, sourceIndex(ch) - back) : Math.min(ch.pts.length - 1, mouthIndex(ch) + back)
      b.dir = dir
      if (tryPlace(b, poseFor(ch, i, dir, lane))) {
        b.lane = lane
        b.route = pickRoute(dir)
        b.turn = b.omega = 0
        b.blocked = 0
        b.thinkTimer = 0
        return true
      }
    }
    return false
  }

  // ---- South Mill Lock: no paddling through it ------------------------------------------
  // The lock chamber (and its gates) is out of bounds to paddlers. Coming up to it from
  // below, most turn round and head back downstream; a few portage: they pull in to the
  // landing stage below the lock, lift out (fading away), carry round on the towpath and
  // put in again at the landing above it. Coming down to it from above, everyone portages.
  // Narrowboats work through it (advanceVessel).
  const LOCK_PAD = 5 // sample points beyond each gate counted as part of it
  const PORTAGE_SHARE = 0.15 // of those reaching it (either way): the rest turn round
  function lockIndexAt(x, y) {
    if (!river.site) return null
    const q = river.query(x, y)
    if (q.ch !== 0) return null
    return Math.round(q.along * (river.channels[0].pts.length - 1))
  }
  function inLock(x, y) {
    const i = lockIndexAt(x, y)
    if (i == null) return false
    const [lo, hi] = river.site.lockRange
    return i >= lo - LOCK_PAD && i <= hi + LOCK_PAD
  }
  // px to the lock gate ahead of b, or null if the lock isn't ahead of it
  function lockAhead(b) {
    const i = lockIndexAt(b.x, b.y)
    if (i == null) return null
    const [lo, hi] = river.site.lockRange
    const d = b.dir || 1
    if (d < 0 && i > hi + LOCK_PAD) return (i - hi - LOCK_PAD) * SAMPLE
    if (d > 0 && i < lo - LOCK_PAD) return (lo - LOCK_PAD - i) * SAMPLE
    return null
  }
  function turnRound(b) {
    const q = river.query(b.x, b.y)
    b.dir = -(b.dir || 1)
    b.route = b.dir < 0 ? q.ch : null
    b.uTurn = 5
    b.turnCooldown = TURN_COOLDOWN
    b.heldFor = 0
    b.cap = Infinity
    b.thinkTimer = 0
    turnarounds++
  }
  // returns true while the lock has this paddler's attention (no other turning round)
  function handleLock(b, dt) {
    if (b.portage) return stepPortage(b, dt)
    const ahead = lockAhead(b)
    if (ahead == null || ahead > (300 * b.scale) / 0.55) { b.lockChoice = null; b.turnAt = null; return false }
    if (b.group != null) leaveGroup(b) // a group splits up here: each turns (or carries) on its own
    // (on the way home to the club, the only way is round it)
    if (!b.lockChoice) b.lockChoice = homeDir(b) === (b.dir || 1) || rng() < PORTAGE_SHARE ? 'portage' : 'turn'
    if (b.lockChoice === 'turn') {
      // swing round somewhere short of the lock, each at their own spot (not all on one line,
      // where they'd bunch up), sooner if someone's in the way
      if (b.turnAt == null) b.turnAt = rand(0.15, 1) * (300 * b.scale) / 0.55
      if (ahead > b.turnAt && b.speed > b.pace * 0.4) return false
      b.lockChoice = null
      b.turnAt = null
      if (b.fromClub && rng() < 0.6) b.trip = 0 // that'll do: back to the club
      turnRound(b)
      return false
    }
    // portaging: head for the landing stage on the towpath side, and lift out there
    const d = b.dir || 1
    b.lane = clamp(river.site.clubSide * d * 0.7, -0.75, 0.75)
    const st = river.site.portage[d < 0 ? 1 : 0]
    const near = Math.hypot(b.x - st.x, b.y - st.y)
    if (near < 70 * b.scale / 0.55 || ahead < 40) b.portage = { phase: 'out', t: 0 }
    return false
  }
  const FADE_PORTAGE = 0.8
  function stepPortage(b, dt) {
    const p = b.portage
    p.t += dt
    if (p.phase === 'out') {
      b.speed = Math.max(0, b.speed - dt * 60)
      b.opacity = Math.max(0, 1 - p.t / FADE_PORTAGE)
      if (p.t >= FADE_PORTAGE) {
        if (p.finish) { p.phase = 'home'; b.landed = true; landings++; return true } // back at the club
        p.phase = 'carry'; p.t = 0; b.x = PARKED; b.y = PARKED; b.circles.fill(PARKED)
      }
      return true
    }
    if (p.phase === 'home') return true
    if (p.phase === 'carry') {
      // round on the towpath, then in again on the other side of the lock, if there's room
      if (p.t < 3) return true
      const main = river.channels[0]
      const [lo, hi] = river.site.lockRange
      const d = b.dir || 1
      const lane = clamp(river.site.clubSide * d * 0.55, -0.7, 0.7)
      for (const k of [8, 12, 16, 20]) {
        const i = d < 0 ? lo - LOCK_PAD - k : hi + LOCK_PAD + k
        if (i < 0 || i >= main.pts.length) continue
        if (tryPlace(b, poseFor(main, i, d, lane))) {
          p.phase = 'in'; p.t = 0; b.opacity = 0; b.speed = 0; b.lane = rightLane()
          return true
        }
      }
      return true
    }
    // putting in again: fade in, then on its way
    b.opacity = Math.min(1, p.t / FADE_PORTAGE)
    if (p.t >= FADE_PORTAGE) { b.portage = null; b.lockChoice = null; b.opacity = 1; b.thinkTimer = 0; if (!p.launch) portages++ }
    return p.t < FADE_PORTAGE * 0.5
  }
  let portages = 0

  // Should this paddler turn round and head back the other way? Coming up to a busy, slow
  // stretch of river ahead, or held up in one for a few seconds, it may; once in a while one
  // turns anyway (the end of a piece of work). It needs clear water to swing round in, nothing
  // coming the other way close by, and stays away from where the side stream joins.
  function considerTurning(b, dt) {
    if (b.uTurn > 0) b.uTurn -= dt
    if (b.trip > 0) b.trip -= dt
    b.turnCooldown = (b.turnCooldown ?? rand(5, TURN_COOLDOWN)) - dt
    const slowNow = b.speed < b.pace * speedFactor * 0.45 && !b.yielding
    b.heldFor = slowNow ? (b.heldFor || 0) + dt : Math.max(0, (b.heldFor || 0) - dt * 2)
    if ((b.turnCheck = (b.turnCheck ?? rand(0, 1)) - dt) > 0) return
    const every = rand(0.8, 1.6)
    b.turnCheck = every
    if (b.group != null || b.leaving || b.fadeIn > 0 || b.turnCooldown > 0) return
    if (!river.inView([b.x, b.y], -40)) return
    const d = b.dir || 1
    const len = lengthOf(b)
    const q = river.query(b.x, b.y)
    // away from the confluence, where the two streams' traffic meets
    const mouth = river.channels[1].pts.at(-1)
    if (Math.hypot(b.x - mouth[0], b.y - mouth[1]) < q.half * 1.5 + len * 0.5) return
    // the river has to be wide enough to swing round in
    if (2 * q.half < len * 0.9) return
    const fx = Math.sin(b.heading)
    const fy = -Math.cos(b.heading)
    const look = (TURN_LOOK * b.scale) / 0.55
    let ahead = 0 // boats in the way ahead
    let jammed = 0 // ...of which barely moving
    let roomy = true
    let oncoming = false
    for (const o of boats) {
      if (o === b || o.waiting) continue
      const rx = o.x - b.x
      const ry = o.y - b.y
      const dist = Math.hypot(rx, ry)
      if (dist < len * TURN_ROOM + o.type.bound * o.scale * 0.7 + GAP) roomy = false
      if ((o.dir || 1) !== d && !o.moored && dist < look * 0.35) oncoming = true
      const along = rx * fx + ry * fy
      if (along > 0 && along < look && Math.abs(rx * fy - ry * fx) < q.half * 1.5) {
        ahead++
        if (o.vessel || o.speed < Math.max(FOLLOW_MIN, o.baseSpeed * 0.35)) jammed++
      }
    }
    let chance = b.heldFor > HELD_TURN && ahead >= BUSY_AHEAD ? 0.5
      : jammed >= BUSY_AHEAD ? 0.35
      : TURN_ANYWAY * every
    // time to go home: turn for the club if it's behind; don't turn away from it if it's ahead
    const home = homeDir(b)
    if (home) chance = home !== d ? 0.9 : b.heldFor > HELD_TURN && ahead >= BUSY_AHEAD ? 0.2 : 0
    if (rng() > chance || !roomy || oncoming) return
    // turn round
    b.dir = -d
    b.route = b.dir < 0 ? q.ch : null // back up the stream it's on
    b.uTurn = 5
    b.turnCooldown = TURN_COOLDOWN
    b.heldFor = 0
    b.cap = Infinity
    b.thinkTimer = 0
    turnarounds++
  }

  function advance(b, dt) {
    if (b.makeWay > 0) b.makeWay -= dt
    // held up for a moment in a tangle: pull over to its own bank and let it sort itself out
    // (as paddlers do), rather than everyone pushing for the same gap
    else if (b.blocked > 1.2 && !inDiamond(b)) b.makeWay = 3
    b.wanderTimer -= dt
    if (b.wanderTimer <= 0) {
      b.wander = rand(-0.18, 0.18)
      b.wanderTimer = rand(1.5, 4.5)
      if (b.group == null) {
        b.baseSpeed = rand(b.type.pace[0], b.type.pace[1]) * speedFactor
        if (rng() < 0.3) b.lane = clamp(b.lane + rand(-0.25, 0.25), 0.15, 0.55) // always right of the middle
      }
    }

    b.thinkTimer -= dt
    if (b.thinkTimer <= 0) {
      b.thinkTimer = rand(0.1, 0.2)
      plan(b)
    }

    b.turn += (b.omega - b.turn) * Math.min(1, dt * 4 * b.type.agility)
    const heading = b.heading + b.turn * dt
    // waited long enough to give way: go for a few seconds whatever is coming
    b.yieldTime = b.yielding ? (b.yieldTime || 0) + dt : 0
    if (b.yieldTime > GIVE_WAY_MAX) { b.goAnyway = 4; b.yieldTime = 0; b.yielding = false; b.cap = Infinity }
    if (b.goAnyway > 0) b.goAnyway -= dt
    // the current: after rain the river runs faster, helping boats downstream and holding
    // back those going up (who dig in harder, so it costs them less than it gives the others;
    // a boat following another already has its speed, current and all)
    const target = Math.max(6 * speedFactor, Math.min(b.baseSpeed * b.slow + current() * ((b.dir || 1) > 0 ? 1 : -0.6), b.cap ?? Infinity))
    b.speed += (target - b.speed) * Math.min(1, dt * (target < b.speed ? 3 : ACCEL))

    const dist = b.speed * dt
    const pad = river.PAD - 20
    const nx = clamp(b.x + Math.sin(heading) * dist, -pad, W + pad)
    const ny = clamp(b.y - Math.cos(heading) * dist, -pad, H + pad)

    // Apply the most complete move that keeps every boat clear of every other and on the water
    if (fits(b, nx, ny, heading) && onWater(b, nx, ny) && floatOK(b, nx, ny, heading)) {
      commit(b, nx, ny, heading)
      b.blocked = Math.max(0, b.blocked - dt * 2)
    } else if (fits(b, nx, ny, b.heading) && onWater(b, nx, ny) && floatOK(b, nx, ny, b.heading)) {
      commit(b, nx, ny, b.heading)
    } else if (fits(b, b.x, b.y, heading) && floatOK(b, b.x, b.y, heading) && b.blocked < 1) {
      // can only turn on the spot: that counts as held up, and after a second it starts
      // working its way out like a boat that can't move at all
      commit(b, b.x, b.y, heading)
      b.blocked += dt
    } else {
      // boxed in: stay put, and if it lasts, back gently out of it
      b.blocked += dt
      b.speed = Math.min(b.speed, b.baseSpeed * 0.25)
      b.thinkTimer = Math.min(b.thinkTimer, 0.05)
      const away = awayFrom(b)
      const back = 24 * dt
      const moves = []
      if (away) moves.push([b.x + away.x * 30 * dt, b.y + away.y * 30 * dt])
      moves.push([b.x - Math.sin(b.heading) * back, b.y + Math.cos(b.heading) * back], [b.x, b.y])
      // the longer it is stuck, the harder it twists to find a way out, and after a few
      // seconds it may pass a little closer to its neighbours (still never touching)
      const twist = (0.8 + Math.min(2, b.blocked)) * dt
      const gap = b.blocked > 3 ? SQUEEZE_GAP : GAP
      // first, simply turn on the spot the way the planner wants (a boat nosed into the bank,
      // say, after giving way to oncoming traffic), rather than backing up
      const hTurn = b.heading + (Math.sign(Math.abs(b.omega) > 0.05 ? b.omega : b.pref || 0) || 1) * twist
      if (fits(b, b.x, b.y, hTurn, gap) && floatOK(b, b.x, b.y, hTurn)) {
        commit(b, b.x, b.y, hTurn)
        return
      }
      for (const [px, py] of moves) {
        for (const h of [b.heading, b.heading + twist, b.heading - twist]) {
          if (px === b.x && py === b.y && h === b.heading) continue
          if (fits(b, px, py, h, gap) && onWater(b, px, py, keepFor(b) - (BANK_KEEP - BANK_SQUEEZE)) && floatOK(b, px, py, h)) {
            commit(b, px, py, h)
            return
          }
        }
      }
    }
  }

  // Last resort: a paddler stuck for more than STUCK_LIMIT seconds (pinned against a bank in
  // heavy traffic, say) fades out where it is, as if lifting out at the bank, and comes back
  // in at a source upstream. Rare, and it never overlaps anyone on the way.
  const STUCK_LIMIT = 12
  const FADE = 0.8

  // Turnover: how many paddlers the river is aiming for drifts between about 80% and 100%
  // of what it holds comfortably; new boats come in from the ends while there are fewer
  // than that, and boats that leave (off either end, or lifting out) are gone for good.
  // Narrowboats come and go too: 0-2 of them, moored ones casting off after a few minutes.
  let targetFrac = rand(0.8, 1)
  let targetTimer = rand(20, 45)
  let arriveTimer = rand(0.8, 2.5)
  let diamondTimer = rand(5, 15)
  let vesselTarget = -1 // -1: keep however many the page started with, until the first re-pick
  let vesselTimer = rand(60, 150)
  let vesselArriveTimer = rand(8, 20)
  const departures = [] // ids of boats that have left (for the page to stop drawing)
  const arrivals = [] // boats that have just come in (for the page to start drawing)
  const vesselCount = () => boats.reduce((n, b) => n + (b.vessel && !b.fixed ? 1 : 0), 0)

  // up to three diamonds at a time on a big river (two on a small one; one in the rain)
  const maxDiamonds = () => (weather.rain > 0.5 ? 1 : suggestedCount() < 14 ? 2 : 3)
  let diamondFromClub = null
  let diamondTries = 0
  let outriggerTimer = 20
  function churn(dt) {
    if ((targetTimer -= dt) <= 0) {
      targetTimer = rand(20, 45)
      targetFrac = rand(0.8, 1)
    }
    if ((arriveTimer -= dt) <= 0) {
      // (room is kept for a diamond to come through, rather than packing the river fuller)
      const diamonds = [...groups.values()].filter(g => g.kind === 'diamond').length
      const reserve = diamonds < maxDiamonds() && suggestedCount() >= 8 ? 4 : 0
      const short = Math.round(suggestedCount() * targetFrac) - reserve - paddlerCount()
      arriveTimer = short >= 2 ? rand(0.4, 1) : rand(0.8, 2.5) // quicker when the river is emptying
      if (short > 0) spawn(false) // new boats are listed in arrivals
    }
    // diamonds of 3 or 4 racing boats come through often (a share of the paddlers, not extra): up to three at a time (fewer in
    // the rain), even when the river's at its usual number, up to its capacity
    if ((diamondTimer -= dt) <= 0) {
      diamondTimer = rand(10, 26) * (1 + weather.rain)
      const diamonds = [...groups.values()].filter(g => g.kind === 'diamond').length
      if (paddlerCount() + 3 <= capacity() && diamonds < maxDiamonds()) {
        // (where it sets out from is settled first, and kept until it gets out: otherwise the
        // busier landing stage would lose out to the open river downstream)
        diamondFromClub ??= rng() < 0.8
        if (spawnGroup('diamond', false, diamondFromClub)) { diamondFromClub = null; diamondTries = 0 }
        else if (++diamondTries >= 3) { diamondFromClub = false; diamondTimer = rand(1, 3) } // (no room at the landing: one coming up from downstream instead)
        else diamondTimer = rand(2, 5)
      }
    }
    // the club's one outrigger (the dark blue one) is out often: new boats only come along
    // when there's room, and the diamonds take most of it, so it gets a place of its own
    // rather than waiting its turn among the other single boats
    if ((outriggerTimer -= dt) <= 0) {
      outriggerTimer = rand(4, 8)
      if (!boats.some(b => b.type === TYPES.oc1) && paddlerCount() < capacity() + 1 && rng() < 0.18) spawn(false, TYPES.oc1)
    }
    if ((vesselTimer -= dt) <= 0) {
      vesselTimer = rand(60, 150)
      const r = rng()
      vesselTarget = r < 0.15 ? 0 : r < 0.65 ? 1 : 2
    }
    if (vesselTarget >= 0 && (vesselArriveTimer -= dt) <= 0) {
      vesselArriveTimer = rand(8, 20)
      if (vesselCount() < vesselTarget) {
        const b = arriveVessel()
        if (b) arrivals.push(b)
      }
    }
  }

  // ---- weather ------------------------------------------------------------------------
  function setWeather({ wind = 0, rain = 0 } = {}) {
    weather.wind = clamp(wind, 0, 1)
    weather.rain = clamp(rain, 0, 1)
  }
  // how fast the river runs (px/s, world): barely at all in fair weather, briskly after rain
  const current = () => 22 * weather.rain * speedFactor
  const DEBRIS_KINDS = [
    // all small (about half a kayak's width at most for leaves; a log under half a K1's
    // length): mostly leaves and twigs, a log only now and then
    { kind: 'leaves', p: 0.55, len: [12, 19] },
    { kind: 'branch', p: 0.35, len: [22, 36] },
    { kind: 'log', p: 0.1, len: [40, 58] }
  ]
  const MAX_DEBRIS = 5
  // (gaming mode) a stick of dynamite, carried down briskly whatever the weather
  const DYNAMITE = { kind: 'dynamite', len: [44, 50] }
  function spawnDebris(forceKind) {
    const ch = rng() < 0.85 || forceKind ? river.channels[0] : river.channels[1]
    let u = rng()
    const t = forceKind === 'dynamite' ? DYNAMITE : DEBRIS_KINDS.find(k => (u -= k.p) < 0) || DEBRIS_KINDS[0]
    const k = baseScale() / 0.55
    const len = rand(t.len[0], t.len[1]) * k
    // a log or branch is long and thin: it's kept clear of as a circle a bit under half its length
    const r = t.kind === 'leaves' ? len / 2 : len * (t.kind === 'log' ? 0.42 : 0.4)
    const lane = rand(-0.5, 0.5)
    const pose = pointOn(ch, sourceIndex(ch), lane)
    const d = { id: ++debrisId, x: pose.x, y: pose.y, r, len, kind: t.kind, rot: rand(0, 360), spin: rand(-14, 14), lane, drift: rand(0.8, 1.2), stuck: 0, opacity: 1, seed: Math.floor(rng() * 1000) }
    if (t.kind === 'dynamite') { d.fixed = 85; d.spin = rand(-20, 20); d.drift = 1 }
    // not on top of a boat coming in at that end
    if (boats.some(o => Math.hypot(o.x - d.x, o.y - d.y) < o.type.bound * o.scale + r + 10)) return null
    debris.push(d)
    return d
  }
  // Is a piece of debris at (x, y) clear of every boat? (it waits, or slides round, rather
  // than floating into one)
  function debrisFits(d, x, y) {
    if (d.kind === 'dynamite') return true // floats on regardless: it has to reach the player
    for (const o of boats) {
      if (o.waiting) continue
      const dx = x - o.x
      const dy = y - o.y
      const reach = o.type.bound * o.scale + d.r + 2
      if (dx * dx + dy * dy >= reach * reach) continue
      const oc = o.circles
      for (let j = 0; j < o.type.n3; j += 3) {
        const ex = oc[j] - x
        const ey = oc[j + 1] - y
        const lim = oc[j + 2] * 0.8 + d.r + 2
        if (ex * ex + ey * ey < lim * lim) return false
      }
    }
    return true
  }
  function stepDebris(dt) {
    // in the wind, things blow into the river upstream now and then
    if (weather.wind > 0.4 && turnover) {
      debrisTimer -= dt * weather.wind
      if (debrisTimer <= 0) {
        debrisTimer = rand(5, 10)
        if (debris.length < MAX_DEBRIS) spawnDebris()
      }
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i]
      const q = river.query(d.x, d.y)
      const tx = q.tx, ty = q.ty, half = q.half, s = q.s, along = q.along, ch = q.ch
      // carried downstream at the speed of the water (a little more in the wind), easing
      // towards its line across the river
      const v = (d.fixed || 9 + 26 * weather.rain + 5 * weather.wind) * d.drift * speedFactor
      const pull = clamp(d.lane - s / half, -0.3, 0.3) * half * 0.25
      const nx = d.x + (tx * v - ty * pull) * dt
      const ny = d.y + (ty * v + tx * pull) * dt
      d.rot += d.spin * dt * (0.5 + weather.rain)
      if (debrisFits(d, nx, ny)) {
        d.x = nx
        d.y = ny
        d.stuck = Math.max(0, d.stuck - dt)
      } else {
        // a boat in the way: slide sideways round it, towards the middle of the river
        const side = (-Math.sign(s) || 1) * 18 * dt
        const sx = d.x - ty * side
        const sy = d.y + tx * side
        if (debrisFits(d, sx, sy)) { d.x = sx; d.y = sy }
        d.stuck += dt
      }
      // caught for long (against a moored boat, say): it sinks out of sight
      if (d.stuck > 6) d.opacity = Math.max(0, d.opacity - dt)
      const gone = (ch === 0 && along > 0.85 && !river.inView([d.x, d.y], 80)) || d.opacity <= 0
      if (gone) debris.splice(i, 1)
    }
  }

  // A tap on the water at (x, y), in world units. Returns false on dry land.
  function addRipple(x, y) {
    if (river.inside(x, y) <= 0) return false
    ripples.push({ x, y, age: 0 })
    if (ripples.length > MAX_RIPPLES) ripples.shift()
    return true
  }

  // ---- race mode (src/home/race.js): the river is cleared, and the boats of the race are moved by
  // the race itself; the swarm just keeps them in the list so the page draws them
  let raceMode = false
  function addRaceBoat(look) {
    const b = makePaddler(TYPES.racer)
    b.race = true
    b.raceLook = look
    b.x = PARKED
    b.y = PARKED
    b.opacity = 1
    boats.push(b)
    arrivals.push(b)
    return b
  }
  function clearForRace() {
    raceMode = true
    for (const b of [...boats]) {
      if (b.race) continue
      if (b.group != null) leaveGroup(b)
      remove(b.id)
      departures.push(b.id)
    }
    groups.clear()
    debris.length = 0
  }
  function endRace() {
    raceMode = false
    for (const b of [...boats]) {
      if (!b.race) continue
      remove(b.id)
      departures.push(b.id)
    }
  }

  function step(dt) {
    if (turnover && !raceMode) churn(dt)
    if (!raceMode) stepDebris(dt)
    for (let i = ripples.length - 1; i >= 0; i--) if ((ripples[i].age += dt) > RIPPLE_LIFE) ripples.splice(i, 1)
    const left = []
    for (const b of boats) {
      if (b.race) continue // (moved by the race)
      if (b.vessel && b.moored && (b.age += dt) > b.castOff && turnover) castOff(b)
      if (b.away != null) {
        // a club paddler off out of sight (down the river, or above the lock): back later,
        // the way they went, on their way home
        if ((b.away -= dt) <= 0 && comeBack(b)) b.away = null
        continue
      }
      if (b.waiting) {
        if (b.fixed) continue // off its moorings (no room after a resize): out of sight
        if (b.moored ? placeVessel(b) : recycle(b)) {
          b.waiting = false
          b.opacity = 1
        }
        continue
      }
      if (!b.vessel && !b.leaving && b.blocked > STUCK_LIMIT) {
        b.leaving = FADE
        lifts++
      }
      if (b.leaving) {
        b.leaving = Math.max(0, b.leaving - dt)
        b.opacity = b.leaving / FADE
        if (!b.leaving) {
          if (turnover) left.push(b) // lifted out: gone (a new boat will come along)
          else {
            b.x = PARKED
            b.y = PARKED
            b.waiting = true
            b.blocked = 0
          }
        }
        continue
      }
      if (b.vessel) advanceVessel(b, dt)
      else if (!handleLock(b, dt)) {
        considerTurning(b, dt)
        headHome(b)
        advance(b, dt)
      }
      if (b.landed) {
        // lifted out at the club: gone (or, without turnover, back out again later)
        b.landed = false
        b.portage = null
        if (turnover) left.push(b)
        else {
          b.x = PARKED; b.y = PARKED; b.circles.fill(PARKED)
          b.waiting = true
          b.blocked = 0
        }
        continue
      }
      if (b.portage) continue // carrying round the lock
      // paddled off the end of the river (the mouth, or back up past a source), out of sight
      const q = river.query(b.x, b.y)
      const gone = (b.dir || 1) > 0 ? q.ch === 0 && q.along > 0.85 : q.along < 0.3
      if (gone && !river.inView([b.x, b.y], 60) && !(b.vessel && b.moored)) {
        if (turnover && b.fromClub && !b.vessel) goAway(b)
        else if (turnover) left.push(b)
        else recycle(b)
      }
    }
    for (const b of left) {
      if (b.group != null) leaveGroup(b)
      remove(b.id)
      departures.push(b.id)
    }
  }
  // the page collects these each frame
  const takeDepartures = () => departures.splice(0)
  const takeArrivals = () => arrivals.splice(0)

  return { boats, spawn, spawnGroup, paddlerCount, spawnVessel, spawnMoorings, remove, get, resize, step, addRaceBoat, clearForRace, endRace, suggestedCount, capacity, takeDepartures, takeArrivals, addRipple, ripples: () => ripples, river: () => river, setWeather, weather: () => weather, debris: () => debris, spawnDebris, removeDebris: id => { const i = debris.findIndex(d => d.id === id); if (i >= 0) debris.splice(i, 1) }, current, lifts: () => lifts, turnarounds: () => turnarounds, portages: () => portages, landings: () => landings, inLock,
    lockBusy: () => boats.some(b => b.vessel && !b.waiting && inLock(b.x, b.y)),
    // paddlers on screen right now (the count shown on the page)
    visiblePaddlers: () => boats.reduce((n, b) => n + (!b.vessel && !b.waiting && b.away == null && !b.landed &&
      (b.opacity ?? 1) > 0.3 && b.x > -9e4 && river.inView([b.x, b.y], 30 * b.scale / 0.55) ? 1 : 0), 0) }
}

// Exposed so tests can check against the same numbers
export const _internals = { RIPPLE_LIFE, TYPES, circlesFor, hits, GAP, SQUEEZE_GAP, BANK_KEEP }
