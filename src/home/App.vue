<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount } from 'vue'
import Kayaker from './components/Kayaker.vue'
import NarrowBoat from './components/NarrowBoat.vue'
import { makeBoatLook } from './narrowboatLook.js'
import SiteNav from '../shared/SiteNav.vue'
import ArcadePanel from './ArcadePanel.vue'
import RacePanel from './RacePanel.vue'
import { createRace } from './race.js'
import { createSwarm, TYPES } from './swarm.js'
import { WEATHER, nextWeather, firstChange, nextChange, light, fmtClock } from './weather.js'

const PALETTE = [
  { hull: '#e63946', deck: '#ffd166', shirt: '#1d3557', helmet: '#f1faee' },
  { hull: '#3a86ff', deck: '#fb8500', shirt: '#023047', helmet: '#e63946' }, // (yellow is for club boats only)
  { hull: '#06d6a0', deck: '#ffffff', shirt: '#ef476f', helmet: '#ffd166' },
  { hull: '#9b5de5', deck: '#f15bb5', shirt: '#fee440', helmet: '#00bbf9' },
  { hull: '#ffffff', deck: '#e63946', shirt: '#3a86ff', helmet: '#ffbe0b' },
  { hull: '#fb5607', deck: '#ffbe0b', shirt: '#3a0ca3', helmet: '#ffffff' },
  { hull: '#2ec4b6', deck: '#cbf3f0', shirt: '#ff9f1c', helmet: '#e71d36' },
  { hull: '#ff006e', deck: '#8338ec', shirt: '#ffffff', helmet: '#3a86ff' },
]
// Club boats are bright yellow all over (club K1s, which go out in groups: see swarm.js)
const CLUB = { hull: '#ffd400', deck: '#ffd400' }
// privately owned racing boats: one of five paint jobs (drawn in Kayaker.vue)
const DESIGNS = ['carbon', 'arrow', 'flame', 'split', 'stealth']
// K2s: most get one of four paint jobs, the rest plain colours
const K2_DESIGNS = ['carbon', 'wave', 'sunset', 'green']
// outrigger canoes are dark blue (hull, and the float on its arms)
const OUTRIGGER = { hull: '#14295a', deck: '#2c5197' }
const CANOES = ['c1', 'canoe', 'oc1'] // single-bladed: everyone on one side, swapping now and then
const pick = list => list[Math.floor(Math.random() * list.length)]
// open canoes: outside of the hull, and the inside you see from above
const CANOE_PAINT = [
  { hull: '#b23a2b', deck: '#d9644f' }, // red
  { hull: '#2f6b3a', deck: '#4e8f58' }, // green
  { hull: '#9a6332', deck: '#d2a46a' }, // varnished wood
  { hull: '#1f4e8c', deck: '#3d73b5' }, // blue
]

// how far the camera is pulled back from the river: below 1 shows more of it, smaller
const ZOOM = 0.5 // (high up, like the map: the club's whole stretch of river in view)

const reduced =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// All movement and collision avoidance lives in swarm.js; this file only draws it.
const swarm = createSwarm({
  width: window.innerWidth,
  height: window.innerHeight,
  zoom: ZOOM,
  reducedMotion: reduced,
})

// ---- weather and time of day (weather.js) -----------------------------------------------
// Preview: ?weather=windy (rain, storm, cloudy, fair) keeps that weather; ?time=21:30 sets
// the clock; ?fast changes the weather every 15 seconds.
const params = new URLSearchParams(location.search)
const fixedWeather = WEATHER[params.get('weather')] ? params.get('weather') : null
const fixedTime = /^\d{1,2}:\d{2}$/.test(params.get('time') || '') ? params.get('time') : null
const fast = params.has('fast')
const weather = ref(fixedWeather || 'fair')
// how windy / rainy / cloudy it is right now, easing towards the weather's own levels (set
// as CSS variables on the page each frame, and passed to the swarm)
const level = { ...WEATHER[weather.value] }
let weatherTimer = fast ? 15 : firstChange()
const raining = ref(level.rain > 0.02)
const land = ref(null)
const fxHost = ref(null) // where the easter egg's effects are drawn (inside the zoomable scene)
const clock = () => {
  if (!fixedTime) return new Date()
  // the given time on the club's clock today (near enough: the offset only matters for sunrise)
  const [h, m] = fixedTime.split(':').map(Number)
  const d = new Date()
  const now = light(d).hours
  return new Date(d.getTime() + ((h + m / 60 - now) * 3600e3))
}
const sky = ref(light(clock()))
const night = computed(() => sky.value.dark > 0.5)
const weatherText = computed(() => {
  const w = WEATHER[weather.value]
  const icon = night.value && w.nightIcon ? w.nightIcon : w.icon
  const label = night.value && w.night ? w.night : w.label
  return `${icon} ${label} · ${fmtClock(sky.value.hours)} (${sky.value.label})`
})
function stepWeather(dt) {
  if (!fixedWeather && (weatherTimer -= dt) <= 0) {
    weather.value = nextWeather(weather.value)
    weatherTimer = fast ? 15 : nextChange()
  }
  const want = WEATHER[weather.value]
  // the wind gets up (and drops) over several seconds; rain sets in a little slower
  for (const [k, secs] of [['wind', 8], ['rain', 12], ['cloud', 10]]) {
    const d = want[k] - level[k]
    level[k] += Math.sign(d) * Math.min(Math.abs(d), dt / secs)
  }
  swarm.setWeather(level)
  raining.value = level.rain > 0.02
  const el = land.value
  if (el) {
    el.style.setProperty('--wind', level.wind.toFixed(3))
    el.style.setProperty('--rain', level.rain.toFixed(3))
    el.style.setProperty('--cloud', level.cloud.toFixed(3))
  }
}
// rain: streaks falling at random places and times (drawn by CSS)
const DROPS = Array.from({ length: 90 }, (_, i) => ({ i, x: Math.random() * 100, y: Math.random() * 100, d: -Math.random() * 1.2, t: 0.45 + Math.random() * 0.35, o: 0.35 + Math.random() * 0.5 }))
const GUSTS = Array.from({ length: 9 }, (_, i) => ({ i, y: 6 + Math.random() * 88, d: -Math.random() * 6, t: 3.5 + Math.random() * 2.5, w: 80 + Math.random() * 140 }))

// ---- debris (swarm.js): drawn from a few shapes, moved each frame like the boats --------------
const debrisList = ref([]) // { id, kind, shape } to draw
const debrisEls = new Map()
let debrisKey = ''
function debrisShape(d) {
  let seed = d.seed + 1
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const L = d.len
  if (d.kind === 'dynamite') return { dyn: { L }, size: L }
  if (d.kind === 'log') {
    const w = L * 0.17
    return { log: { L, w, knots: [r() * 0.6 - 0.3, r() * 0.6 - 0.3].map(k => k * L) } }
  }
  if (d.kind === 'branch') {
    const twigs = Array.from({ length: 3 + Math.floor(r() * 3) }, () => {
      const at = (r() - 0.45) * L * 0.8
      const side = r() < 0.5 ? -1 : 1
      const len = L * (0.18 + r() * 0.2)
      return { at, side, len, tx: at + len * 0.6, ty: side * len * 0.8 }
    })
    return { branch: { L, twigs, leaves: twigs.flatMap(t => [0, 1].map(k => ({ x: t.tx - k * (t.tx - t.at) * 0.4, y: t.ty * (1 - k * 0.4), rx: (7 + r() * 4) * L / 60, ry: (4 + r() * 2) * L / 60, a: r() * 180, c: r() < 0.6 ? '#4f7d2e' : '#7aa03a' }))) } }
  }
  return { size: L, leaves: Array.from({ length: 8 }, () => ({ x: (r() - 0.5) * L, y: (r() - 0.5) * L * 0.7, rx: (6 + r() * 4) * L / 33, ry: (3.5 + r() * 2) * L / 33, a: r() * 180, c: ['#a4782f', '#c99a3a', '#6f8f2e', '#8b5a2b'][Math.floor(r() * 4)] })) }
}
function syncDebris() {
  const list = swarm.debris()
  const key = list.map(d => d.id).join(',')
  if (key !== debrisKey) {
    debrisKey = key
    const have = new Map(debrisList.value.map(d => [d.id, d]))
    debrisList.value = list.map(d => have.get(d.id) || { id: d.id, kind: d.kind, shape: debrisShape(d) })
  }
  for (const d of list) {
    const el = debrisEls.get(d.id)
    if (!el) continue
    el.setAttribute('transform', `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)}) rotate(${d.rot.toFixed(1)})`)
    if (d.opacity < 1) el.setAttribute('opacity', d.opacity.toFixed(2))
  }
}
const bindDebris = (id, el) => (el ? debrisEls.set(id, el) : debrisEls.delete(id))

// paint for the cars in the yard
const CAR_PAINT = ['#c0392b', '#f1f1ee', '#2d4f8a', '#4a4f55', '#9aa3ab', '#2f6b3a', '#1c1c1e', '#e0a030']
const lockOpen = ref(false) // a narrowboat working through South Mill Lock
const fleet = ref([]) // what gets rendered: { id, look }
const river = ref(swarm.river().drawing) // the channels to draw (paths + half-widths)
// vegetation along the banks: reed tufts, bushes, trees (see buildRiver in swarm.js)
const veg = ref(vegetation())
function vegetation() {
  const r = swarm.river()
  return { reeds: r.reeds, bushes: r.bushes, trees: r.trees, bigTrees: r.bigTrees, bridge: r.bridge, site: r.site }
}

// Ripples: tap or click the water and rings spread out; paddlers steer round (swarm.js)
const ripples = ref([]) // { id, x, y } in world units, drawn until their rings have faded
let rippleId = 0
function tapAt(clientX, clientY) {
  const rect = land.value.getBoundingClientRect()
  const x = (clientX - rect.left - view.x) / view.k / ZOOM // (through the zoom, back to world units)
  const y = (clientY - rect.top - view.y) / view.k / ZOOM
  eggTap(x, y) // (three quick clicks on a kayak: see below)
  if (!swarm.addRipple(x, y)) return // on dry land
  const id = ++rippleId
  ripples.value.push({ id, x, y })
  if (ripples.value.length > 6) ripples.value.shift()
  setTimeout(() => { ripples.value = ripples.value.filter(r => r.id !== id) }, 2800)
}
// ---- zoom and pan: the scene (everything but the title box and menu) is drawn scaled about the
// top left, so a small screen (or a work PC full of tiny kayaks) can zoom in on the boats ----
const MAX_ZOOM = 5
const view = { k: 1, x: 0, y: 0 } // scale and offset in screen pixels (plain, and applied straight to the element: no page re-draw per frame)
const scene = ref(null)
const canIn = ref(true) // for the buttons
const canOut = ref(false)
const smooth = ref(false) // a button press eases; wheel, pinch and drag follow the fingers exactly
function setView(k, x, y) {
  k = Math.min(MAX_ZOOM, Math.max(1, k))
  const w = size.value.w
  const h = size.value.h
  // the scene always covers the screen: no edge of the world shows
  Object.assign(view, { k, x: Math.min(0, Math.max(w - w * k, x)), y: Math.min(0, Math.max(h - h * k, y)) })
  if (scene.value) scene.value.style.transform = k === 1 && !view.x && !view.y ? '' : `translate(${view.x.toFixed(1)}px, ${view.y.toFixed(1)}px) scale(${k.toFixed(4)})`
  canIn.value = k < MAX_ZOOM - 0.001
  canOut.value = k > 1.001
}
// zoom to scale k, keeping the point (px, py) of the screen where it is
function zoomAt(px, py, k2) {
  const { k, x, y } = view
  k2 = Math.min(MAX_ZOOM, Math.max(1, k2))
  setView(k2, px - (px - x) * (k2 / k), py - (py - y) * (k2 / k))
}
let smoothTimer = 0
function zoomBy(factor) { // the buttons and keys: about the middle of the screen, easing
  smooth.value = true
  clearTimeout(smoothTimer)
  smoothTimer = setTimeout(() => { smooth.value = false }, 320)
  zoomAt(size.value.w / 2, size.value.h / 2, view.k * factor)
}
function zoomReset() {
  smooth.value = true
  clearTimeout(smoothTimer)
  smoothTimer = setTimeout(() => { smooth.value = false }, 320)
  setView(1, 0, 0)
}
function onWheel(e) {
  e.preventDefault()
  if (mode.value === 'race') return
  const r = land.value.getBoundingClientRect()
  zoomAt(e.clientX - r.left, e.clientY - r.top, view.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))
}
function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test(e.target?.tagName || '')) return
  if (mode.value === 'race' && raceKey(e, true)) return
  if (e.key === '+' || e.key === '=') zoomBy(1.4)
  else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.4)
  else if (e.key === '0') zoomReset()
}
// pointers: one finger or the mouse (a click, or a drag to pan when zoomed in), two to pinch
const pointers = new Map() // id -> { x, y }
let gesture = null // { moved, sx, sy, startView, pinch: { d, k } }
function onDown(e) {
  if (mode.value === 'race') return // the camera follows your boat
  if (e.target.closest('a, button, nav, header, .zoomctl, .modeswitch, .arcade-screen')) return // the menu, title box and zoom buttons
  try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a drag that leaves the window still ends properly */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.size === 1) gesture = { moved: false, sx: e.clientX, sy: e.clientY, startView: { ...view }, pinch: null }
  else if (gesture) {
    const [a, b] = [...pointers.values()]
    gesture.moved = true // two fingers: never a tap
    gesture.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k }
  }
}
function onMove(e) {
  const p = pointers.get(e.pointerId)
  if (!p || !gesture) return
  p.x = e.clientX
  p.y = e.clientY
  const r = land.value.getBoundingClientRect()
  if (pointers.size >= 2 && gesture.pinch) {
    const [a, b] = [...pointers.values()]
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }
    zoomAt(mid.x, mid.y, gesture.pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.pinch.d))
    return
  }
  if (!gesture.moved && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > 8) gesture.moved = true
  if (gesture.moved && view.k > 1) {
    const s = gesture.startView
    setView(s.k, s.x + (e.clientX - gesture.sx), s.y + (e.clientY - gesture.sy))
  }
}
function onUp(e) {
  const had = pointers.delete(e.pointerId)
  if (!had || !gesture) return
  if (pointers.size === 0) {
    const g = gesture
    gesture = null
    if (!g.moved) tapAt(e.clientX, e.clientY) // a tap or click, not a drag or pinch
  } else if (pointers.size === 1) {
    // back to one finger after a pinch: carry on dragging from here
    const [p] = pointers.values()
    gesture = { moved: true, sx: p.x, sy: p.y, startView: { ...view }, pinch: null }
  }
}
function onCancel(e) {
  pointers.delete(e.pointerId)
  if (!pointers.size) gesture = null
}

// ---- easter egg: click a kayak three times in quick succession and something happens to it ----
// One of three at random (blowing up most often): it takes off and flies at the camera, it blows up, or it sinks. Each is
// drawn over the page from a copy of the boat (the real boat is hidden, then removed from the
// river; a new paddler arrives in time, as when anyone leaves). Not for reduced motion.
const EGG_TAPS = 3
const EGG_GAP = 700 // ms allowed between clicks
let eggRun = { id: -1, n: 0, at: 0 }
const eggBusy = new Set()
// the paddler's boat under a tap (world units): the boats are drawn with pointer-events off
function boatAt(wx, wy) {
  let best = null
  let bestD = Infinity
  for (const b of swarm.boats) {
    if (b.vessel || b.waiting || (b.opacity ?? 1) < 0.5 || eggBusy.has(b.id)) continue
    const d = shown.get(b.id)
    if (!d || !elements.get(b.id)) continue
    const dist = Math.hypot(wx - d.x, wy - d.y) / b.scale // in the boat's own drawing units
    if (dist < Math.max(60, b.type.box * 0.4) && dist < bestD) { best = b; bestD = dist }
  }
  return best
}
// ---- scenic mode: now and then, as two paddlers pass, one says hello in a speech bubble ----
const bubbles = [] // { el, id, until }
const near = new Set() // pairs of boats close together right now
let lastGreet = 0
let greetCheck = 0
const GREET_DIST = 150 // world units
const sayings = () => {
  const h = clock().getHours()
  const day = h < 12 ? 'Morning!' : h < 17 ? 'Afternoon!' : 'Evening!'
  const list = [day, day, 'Hello!', 'Hi there!', 'Alright?', 'Hiya!', 'Lovely day for it!', 'Good paddle?', 'Mind the log!']
  if (level.rain > 0.4) list.push('Wet one today!', 'Nice weather for ducks!')
  else if (level.wind > 0.5) list.push('Bit breezy!', 'Windy out here!')
  else if (h >= 6 && h < 20) list.push('Beautiful out here!')
  return list
}
const replies = ['You too!', 'Cheers!', 'Hello!', 'Hiya!', 'Likewise!', 'Morning!']
function sayHello(boat, text) {
  if (!fxHost.value) return
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = 'position:absolute;left:0;top:0;z-index:70;pointer-events:none;white-space:nowrap;padding:5px 10px;border-radius:12px;background:#fff;color:#14313f;font:600 13px/1.2 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,25,40,0.35);opacity:0;transition:opacity 0.3s;'
  const tail = document.createElement('div')
  tail.style.cssText = 'position:absolute;left:50%;bottom:-5px;width:10px;height:10px;background:#fff;transform:translateX(-50%) rotate(45deg);border-radius:0 0 3px 0;'
  el.appendChild(tail)
  fxHost.value.appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = '1' })
  bubbles.push({ el, id: boat.id, until: performance.now() + 2600 })
}
function clearBubbles() { for (const b of bubbles) b.el.remove(); bubbles.length = 0 }
function greetings(now) {
  // keep the bubbles over their paddlers; fade and remove when done
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    const d = shown.get(b.id)
    if (!d || now > b.until) {
      if (!d || now > b.until + 300) { b.el.remove(); bubbles.splice(i, 1) } else b.el.style.opacity = '0'
      continue
    }
    if (now > b.until - 400) b.el.style.opacity = '0'
    b.el.style.transform = `translate(${d.x * ZOOM}px, ${d.y * ZOOM}px) scale(${1 / view.k}) translate(-50%, calc(-100% - 20px))`
  }
  if (mode.value !== 'scenic' || now - greetCheck < 250) return
  greetCheck = now
  const w = size.value.w
  const h = size.value.h
  const boats = swarm.boats.filter(b => !b.vessel && !b.waiting && b.away == null && !b.landed && (b.opacity ?? 1) >= 0.5 && !eggBusy.has(b.id) && shown.get(b.id) && elements.get(b.id))
  const now2 = new Set()
  for (let i = 0; i < boats.length; i++) {
    const a = boats[i]
    const da = shown.get(a.id)
    if (da.x * ZOOM < 0 || da.x * ZOOM > w || da.y * ZOOM < 0 || da.y * ZOOM > h) continue
    for (let j = i + 1; j < boats.length; j++) {
      const c = boats[j]
      if (a.dir === c.dir) continue // passing: heading the opposite way
      const dc = shown.get(c.id)
      if (Math.hypot(da.x - dc.x, da.y - dc.y) > GREET_DIST) continue
      const key = a.id < c.id ? `${a.id}-${c.id}` : `${c.id}-${a.id}`
      now2.add(key)
      if (near.has(key) || now - lastGreet < 2500 || bubbles.length >= 3 || Math.random() > 0.2) continue
      // one says hello, and sometimes the other answers
      lastGreet = now
      const [first, second] = Math.random() < 0.5 ? [a, c] : [c, a]
      sayHello(first, pick(sayings()))
      if (Math.random() < 0.55) setTimeout(() => { if (mode.value === 'scenic' && !gone && shown.get(second.id)) sayHello(second, pick(replies)) }, 1100)
    }
  }
  near.clear()
  for (const k of now2) near.add(k)
}

// ---- scenic mode and gaming mode ----
// Scenic: just the river. Gaming: an arcade game, "wreck the river": 30 seconds, click a boat three
// times (quickly) to wreck it in one of three ways, quick wrecks make combos.
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* not remembered: that's all */ } }
}
const ROUND = 30 // seconds
const HITS_TO_WRECK = 3
const HIT_GAP = 1200 // ms: hits on a boat further apart than this don't add up
const COMBO_GAP = 3500 // ms: a wreck this soon after the last one makes a combo
// Multipliers: every score in the round past each of these is worth one more (x2 at 1000, then x3...),
// on top of the combo, with a stripe across the screen when one is awarded
const MULT_AT = [1000, 2500, 5000, 10000]
const AWARD_MS = 2200
const mode = ref('scenic') // every visit starts scenic (gaming mode is opt-in, and not remembered)
// reactive (not a ref) and only read by ArcadePanel, so the ticking clock doesn't redraw the river
const game = reactive({ state: 'idle', score: 0, hi: +store.get('bscc-wreck-hi') || 0, time: ROUND, combo: 0, mult: 1, award: null, bestMult: 1, wrecked: 0, best: 0, newHi: false, board: [], wrecksBoard: [], myId: '', boardOk: false, qualifies: false, submitted: false, rank: 0, busy: false, error: '', name: store.get('bscc-wreck-name') || '' })
const hits = new Map() // boat id -> { n, at }
let gameTimer = 0
let comboTimer = 0
let awardTimer = 0
let awardN = 0
let lastWreckAt = 0
let nextDyn = 4 // seconds until the next stick of dynamite floats down
function setMode(m) {
  clearBubbles()
  if (mode.value === 'race' && m !== 'race') leaveRace()
  if (m === 'race') {
    if (reduced || mode.value === 'race') return
    stopGame()
    game.state = 'idle'
    mode.value = 'race'
    startRace()
    return
  }
  if (m === 'gaming') loadBoard()
  if (m === 'gaming' && reduced) return // far too much movement for someone who asked for less
  mode.value = m
  stopGame()
  game.state = 'idle'
}
function stopGame() {
  clearInterval(gameTimer)
  clearTimeout(comboTimer)
  clearTimeout(awardTimer)
  game.award = null
  hits.clear()
  for (const d of [...swarm.debris()]) if (d.kind === 'dynamite') swarm.removeDebris(d.id)
}
function startGame() {
  stopGame()
  restoreScenery()
  Object.assign(game, { state: 'playing', score: 0, time: ROUND, combo: 0, mult: 1, award: null, bestMult: 1, wrecked: 0, best: 0, newHi: false, qualifies: false, submitted: false, rank: 0, myId: '', error: '' })
  lastWreckAt = 0
  nextDyn = rnd(3, 6)
  gameTimer = setInterval(() => {
    game.time = Math.max(0, +(game.time - 0.1).toFixed(1))
    nextDyn -= 0.1
    if (nextDyn <= 0) nextDyn = swarm.spawnDebris('dynamite') ? rnd(7, 11) : 0.5
    if (game.time <= 0) endGame()
  }, 100)
}
function endGame() {
  stopGame()
  game.state = 'over'
  game.combo = 0
  if (game.score > game.hi) {
    game.hi = game.score
    game.newHi = true
    store.set('bscc-wreck-hi', String(game.hi))
  }
  // does it make the top five? (asks for a name if so)
  loadBoard().then(() => {
    if (game.state !== 'over' || !game.boardOk || game.score <= 0) return
    game.qualifies = (game.board.length < 5 || game.score > game.board[game.board.length - 1].score) || (game.wrecked > 0 && (game.wrecksBoard.length < 5 || game.wrecked > game.wrecksBoard[game.wrecksBoard.length - 1].wrecked))
  })
}
// the public top five (netlify/functions/crews.js, /api/wreck-scores)
async function loadBoard() {
  try {
    const r = await fetch('/api/wreck-scores')
    if (!r.ok) throw new Error(String(r.status))
    const j = await r.json()
    game.board = j.scores || []
    game.wrecksBoard = j.wrecks || []
    game.boardOk = true
    if (game.board[0]) game.hi = Math.max(game.hi, game.board[0].score)
  } catch { game.boardOk = false }
}
async function submitScore(name) {
  const clean = String(name || '').trim()
  if (!clean || game.busy) return
  game.busy = true
  game.error = ''
  try {
    const r = await fetch('/api/wreck-scores', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: clean, score: game.score, wrecked: game.wrecked }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { game.error = j.error || 'Could not save that: try again'; return }
    game.name = clean.slice(0, 14)
    store.set('bscc-wreck-name', game.name)
    game.board = j.scores || game.board
    game.wrecksBoard = j.wrecks || game.wrecksBoard
    game.rank = j.rank || 0
    game.myId = j.id || ''
    game.submitted = true
  } catch { game.error = 'Could not save that: check your connection' } finally { game.busy = false }
}
// a number floating up from where a boat was
function popup(text, ox, oy, colour = '#ffe600', big = false) {
  if (!fxHost.value) return
  const e = document.createElement('div')
  e.textContent = text
  e.style.cssText = `position:absolute;left:${ox}px;top:${oy}px;pointer-events:none;z-index:80;white-space:nowrap;font:${big ? 24 : 16}px 'Press Start 2P',ui-monospace,monospace;color:${colour};text-shadow:0 0 8px ${colour},2px 2px 0 #000;`
  fxHost.value.appendChild(e)
  const s = 1 / view.k // the same size on screen however far in you are
  e.animate([
    { opacity: 0, transform: `translate(-50%, 0) scale(${s * 0.5})` },
    { opacity: 1, transform: `translate(-50%, -20px) scale(${s * 1.1})`, offset: 0.2 },
    { opacity: 1, transform: `translate(-50%, -46px) scale(${s})`, offset: 0.7 },
    { opacity: 0, transform: `translate(-50%, -80px) scale(${s})` }
  ], { duration: 1200, easing: 'ease-out' }).onfinish = () => e.remove()
}

// what is under a click: a kayak first, then a narrowboat, a car, a big tree, a small tree.
// Each has a key (to count its hits), a spot on the scene, and wreck(), which does it and
// returns the points it is worth.
function targetAt(wx, wy) {
  for (const d of swarm.debris()) { // dynamite: one click is enough
    if (d.kind !== 'dynamite') continue
    if (Math.hypot(wx - d.x, wy - d.y) < Math.max(45, d.r * 1.6)) {
      return { key: 'd' + d.id, single: true, ox: d.x * ZOOM, oy: d.y * ZOOM, wreck: () => eggDynamite(d) }
    }
  }
  const b = boatAt(wx, wy)
  if (b) {
    const d = shown.get(b.id)
    return { key: b.id, ox: d.x * ZOOM, oy: d.y * ZOOM, el: elements.get(b.id), wreck() {
      const fx = pickEffect()
      fx(b)
      return (EGG_EFFECTS.find(e => e[0] === fx) || EGG_EFFECTS[0])[2]
    } }
  }
  for (const v of swarm.boats) { // narrowboats
    if (!v.vessel || (v.opacity ?? 1) < 0.5 || eggBusy.has(v.id)) continue
    const d = shown.get(v.id)
    if (!d || !elements.get(v.id)) continue
    if (Math.hypot(wx - d.x, wy - d.y) / v.scale < v.type.box * 0.4) {
      return { key: v.id, ox: d.x * ZOOM, oy: d.y * ZOOM, el: elements.get(v.id), wreck: () => { eggMegaBoat(v); return 200 } }
    }
  }
  for (const c of allCars.value) { // cars in the yard
    if (burnt[c.n]) continue
    if (Math.hypot(wx - c.x, wy - c.y) < Math.max(c.len, c.wid) * 0.7) {
      return { key: 'c' + c.n, ox: c.x * ZOOM, oy: c.y * ZOOM, wreck: () => { eggBlowCar(c); return 120 } }
    }
  }
  const trees = [['b', veg.value.bigTrees], ['t', veg.value.trees]] // big ones are drawn on top
  for (const [pre, list] of trees) {
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i]
      if (!fallen[pre + i] && Math.hypot(wx - t.x, wy - t.y) < t.r * 0.9) {
        return { key: pre + i, ox: t.x * ZOOM, oy: t.y * ZOOM, wreck: () => { eggFellTree(pre + i, t); return pre === 'b' ? 90 : 60 } }
      }
    }
  }
  return null
}
// points on the board; passing a threshold awards the next multiplier (the stripe is ArcadePanel's)
function addScore(n) {
  game.score += n
  let got = false
  while (game.mult - 1 < MULT_AT.length && game.score >= MULT_AT[game.mult - 1]) { game.mult++; got = true }
  if (!got) return
  game.bestMult = game.mult
  game.award = { id: ++awardN, mult: game.mult }
  clearTimeout(awardTimer)
  awardTimer = setTimeout(() => { game.award = null }, AWARD_MS)
}
// a click in gaming mode: three quick hits wreck it
function eggTap(wx, wy) {
  if (reduced || mode.value !== 'gaming' || game.state !== 'playing') return
  const t = targetAt(wx, wy)
  if (!t) return
  const now = performance.now()
  const h = hits.get(t.key)
  const n = t.single ? HITS_TO_WRECK : h && now - h.at < HIT_GAP ? h.n + 1 : 1
  if (n < HITS_TO_WRECK) {
    hits.set(t.key, { n, at: now })
    if (t.el) { t.el.classList.remove('boat--hit'); void t.el.offsetWidth; t.el.classList.add('boat--hit') }
    addScore(10 * game.mult)
    popup('+' + 10 * game.mult, t.ox, t.oy - 30, '#00e5ff')
    return
  }
  hits.delete(t.key)
  const pts = t.wreck()
  game.combo = lastWreckAt && now - lastWreckAt < COMBO_GAP ? Math.min(5, game.combo + 1) : 1
  lastWreckAt = now
  game.best = Math.max(game.best, game.combo)
  const gain = pts * game.combo * game.mult
  game.wrecked++
  popup(`+${gain}${game.combo > 1 ? ' x' + game.combo : ''}`, t.ox, t.oy - 40, game.combo > 1 ? '#ff2bd6' : '#ffe600', true)
  addScore(gain)
}
let gone = false
// everything wrecked in the scenery comes back, and the visitors' cars go home
function restoreScenery() { // (a new game: the cars and trees are back; visitors stay parked)
  visitors.value = visitors.value.filter(v => !burnt[v.n])
  for (const k of Object.keys(burnt)) delete burnt[k]
  for (const k of Object.keys(fallen)) delete fallen[k]
}
function resetScenery() {
  for (const k of Object.keys(burnt)) delete burnt[k]
  for (const k of Object.keys(fallen)) delete fallen[k]
  visitors.value = []
}
// ---- cars arriving at the club (both modes): now and then one drives down Stylemans Lane
// and parks in a free space; it stays
const visitors = ref([]) // { n, x, y, angle, len, wid, path, seg, along, parked }
let visitorN = 100
const allCars = computed(() => [...(veg.value.site?.cars || []), ...visitors.value])
function sendCar() {
  const site = veg.value.site
  if (!site || !site.lane || site.lane.length < 2) return
  const taken = new Set(visitors.value.map(v => v.slot))
  const free = (site.carSlots || []).filter(sl => !taken.has(sl))
  if (!free.length) return
  const slot = free[Math.floor(Math.random() * free.length)]
  const path = [...site.lane].reverse().map(p => ({ x: p[0], y: p[1] }))
  path.push({ x: slot.x, y: slot.y })
  visitors.value.push({ n: visitorN++, x: path[0].x, y: path[0].y, angle: Math.atan2(path[1].y - path[0].y, path[1].x - path[0].x) * 180 / Math.PI, len: slot.len, wid: slot.wid, slot, path, seg: 0, along: 0, finalAngle: slot.angle, parked: false })
}
const carTimer = () => setTimeout(() => { sendCar(); carT = carTimer() }, 20000 + Math.random() * 25000)
let carT = 0
const turnTo = (from, to, k) => { let d = ((to - from + 540) % 360) - 180; return from + d * k }
function driveCars(dt) {
  for (const v of visitors.value) {
    if (burnt[v.n]) continue
    if (v.parked) { // after a while it drives off again, freeing the space
      v.stay -= dt
      if (v.stay <= 0 && veg.value.site?.lane) {
        v.path = [{ x: v.x, y: v.y }, ...veg.value.site.lane.map(p => ({ x: p[0], y: p[1] }))]
        v.seg = 0
        v.along = 0
        v.parked = false
        v.leaving = true
        v.finalAngle = Math.atan2(v.path[1].y - v.path[0].y, v.path[1].x - v.path[0].x) * 180 / Math.PI
      }
      continue
    }
    const a = v.path[v.seg], b = v.path[v.seg + 1]
    const segLen = Math.hypot(b.x - a.x, b.y - a.y) || 1
    const last = v.seg === v.path.length - 2 && !v.leaving
    const speed = last ? 60 : 170 // world units per second: slower for the last turn into the space
    v.along += speed * dt
    const k = Math.min(1, v.along / segLen)
    v.x = a.x + (b.x - a.x) * k
    v.y = a.y + (b.y - a.y) * k
    const head = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
    v.angle = turnTo(v.angle, last ? v.finalAngle : head, Math.min(1, dt * (last ? 4 : 6)))
    if (k >= 1) {
      v.along = 0
      v.seg++
      if (v.seg >= v.path.length - 1) {
        if (v.leaving) { v.gone = true; continue }
        v.parked = true
        v.stay = 30 + Math.random() * 40
        v.angle = v.finalAngle
      }
    }
  }
  if (visitors.value.some(v => v.gone)) visitors.value = visitors.value.filter(v => !v.gone)
}
const burnt = reactive({}) // car number -> true once blown up
const fallen = reactive({}) // 't3' / 'b1' -> { stage: 1 falling, 2 down, ex, ey, a } for a felled tree

// hide the real boat and draw a copy of it over the scene, scaled about the boat's own spot
function eggStage(b) {
  const el = elements.get(b.id)
  const d = shown.get(b.id)
  const ox = d.x * ZOOM
  const oy = d.y * ZOOM
  const wrap = document.createElement('div')
  wrap.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:60;transform-origin:${ox}px ${oy}px;`
  const clone = el.cloneNode(true)
  clone.style.willChange = 'auto' // so it stays sharp as it grows
  clone.style.opacity = '1'
  wrap.appendChild(clone)
  const fxLayer = document.createElement('div') // the smoke, flames and bubbles: not scaled with the boat
  fxLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:61;'
  fxHost.value.append(wrap, fxLayer) // inside the scene, so it zooms and pans with it
  el.classList.add('boat--away')
  eggBusy.add(b.id)
  return { wrap, fxLayer, ox, oy }
}
// the boat is gone for good (a new paddler arrives later, as when anyone leaves)
function eggRetire(b, ...layers) {
  for (const l of layers) l.remove()
  swarm.remove(b.id)
  fleet.value = fleet.value.filter(k => k.id !== b.id)
  shown.delete(b.id)
  eggBusy.delete(b.id)
}
// a little shape at (ox + dx, oy + dy), animated
function eggBit(layer, ox, oy, size, style, frames, ms, delay = 0, easing = 'ease-out') {
  const e = document.createElement('div')
  e.style.cssText = `position:absolute;left:${ox - size / 2}px;top:${oy - size / 2}px;width:${size}px;height:${size}px;pointer-events:none;opacity:0;${style}`
  layer.appendChild(e)
  e.animate(frames, { duration: ms, delay, easing, fill: 'both' })
  return e
}
const rnd = (a, b) => a + Math.random() * (b - a)

// 1. it takes off and flies straight at the camera: engine glow and sparks, the ground shadow
// left behind on the water, speed lines, the whole screen rumbling, and a flash as it goes through
function eggRocket(b) {
  const { wrap, fxLayer, ox, oy } = eggStage(b)
  const DUR = 3800
  // its shadow, left on the water as it leaves the surface
  const shadow = eggBit(wrap.parentNode, ox, oy, 70, 'border-radius:50%;background:radial-gradient(circle,rgba(0,20,35,0.5),rgba(0,20,35,0.25) 55%,transparent 70%);z-index:59;',
    [{ opacity: 0, transform: 'scale(1)' }, { opacity: 0.55, transform: 'scale(1)', offset: 0.12 }, { opacity: 0.3, transform: 'scale(0.7)', offset: 0.6 }, { opacity: 0, transform: 'scale(0.4)' }], DUR, 0, 'linear')
  // the engine glow under it: grows with it, pulsing
  const glow = document.createElement('div')
  glow.style.cssText = `position:absolute;left:${ox - 60}px;top:${oy - 60}px;width:120px;height:120px;border-radius:50%;opacity:0;pointer-events:none;background:radial-gradient(circle,rgba(255,250,200,0.95) 0%,rgba(255,190,60,0.85) 30%,rgba(255,100,20,0.55) 55%,transparent 70%);`
  wrap.insertBefore(glow, wrap.firstChild)
  glow.animate([
    { opacity: 0, transform: 'scale(0.2)', offset: 0 },
    { opacity: 0.9, transform: 'scale(0.8)', offset: 0.14 },
    { opacity: 0.7, transform: 'scale(1.2)', offset: 0.3 },
    { opacity: 1, transform: 'scale(1.5)', offset: 0.5 },
    { opacity: 0.8, transform: 'scale(1.9)', offset: 0.75 },
    { opacity: 0, transform: 'scale(2.4)', offset: 1 }
  ], { duration: DUR, fill: 'both' })
  // smoke at the launch spot
  for (let i = 0; i < 12; i++) {
    eggBit(fxLayer, ox + rnd(-16, 16), oy + rnd(-16, 16), rnd(30, 56), 'border-radius:50%;background:radial-gradient(circle,#fff,#dfe7ee 60%,transparent 72%);',
      [{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 0.85, transform: 'scale(1.4)', offset: 0.3 }, { opacity: 0, transform: `translate(${rnd(-70, 70)}px, ${rnd(10, 80)}px) scale(3.4)` }], rnd(1200, 2000), 300 + i * 50)
  }
  // sparks thrown off as it climbs
  for (let i = 0; i < 22; i++) {
    const a = rnd(0, Math.PI * 2)
    const dist = rnd(60, 220)
    eggBit(fxLayer, ox, oy, rnd(3, 6), 'border-radius:50%;background:#ffd36a;box-shadow:0 0 6px 2px #ff9a2a;',
      [{ opacity: 0, transform: 'translate(0,0)' }, { opacity: 1, offset: 0.15 }, { opacity: 0, transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist}px)` }], rnd(500, 900), 500 + i * 90)
  }
  // speed lines streaming outwards from it, then a flash as it passes through the camera
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * 360 + rnd(-6, 6)
    const line = document.createElement('div')
    line.style.cssText = `position:absolute;left:${ox}px;top:${oy}px;width:${rnd(90, 160)}px;height:${rnd(1.5, 3)}px;transform-origin:0 50%;opacity:0;pointer-events:none;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,0.9));`
    fxLayer.appendChild(line)
    line.animate([
      { opacity: 0, transform: `rotate(${a}deg) translateX(30px) scaleX(0.2)` },
      { opacity: 0.9, transform: `rotate(${a}deg) translateX(120px) scaleX(1)`, offset: 0.4 },
      { opacity: 0, transform: `rotate(${a}deg) translateX(520px) scaleX(3)` }
    ], { duration: DUR * 0.45, delay: DUR * (0.5 + rnd(0, 0.12)), easing: 'ease-in', fill: 'both' })
  }
  const flash = document.createElement('div')
  flash.style.cssText = 'position:absolute;inset:-50%;background:radial-gradient(circle at 50% 50%,#fff 0%,#fff 40%,rgba(255,255,255,0.6) 100%);opacity:0;pointer-events:none;z-index:70;'
  fxLayer.appendChild(flash)
  flash.animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 0.95, offset: 0.9 }, { opacity: 0 }], { duration: DUR, fill: 'both' })
  // the boat itself: a shake as the engine catches, then faster and faster, rolling a little
  const wob = [[-3, 1, -1.5], [3, -1, 1.5], [-4, 2, -2], [4, -2, 2], [-5, 1, -2.5], [5, -1, 2.5]]
  const frames = wob.map(([x, y, a], i) => ({ transform: `translate(${x}px, ${y}px) rotate(${a}deg) scale(${1 + i * 0.015})`, offset: 0.015 + i * 0.025 }))
  frames.unshift({ transform: 'translate(0,0) rotate(0) scale(1)', opacity: 1, offset: 0 })
  frames.push(
    { transform: 'translate(0,-8px) rotate(2deg) scale(1.2)', opacity: 1, offset: 0.24, easing: 'ease-in' },
    { transform: 'translate(0,-34px) rotate(6deg) scale(2.6)', opacity: 1, offset: 0.48, easing: 'ease-in' },
    { transform: 'translate(0,-100px) rotate(14deg) scale(12)', opacity: 1, offset: 0.78, easing: 'ease-in' },
    { transform: 'translate(0,-220px) rotate(26deg) scale(90)', opacity: 1, offset: 0.93, easing: 'ease-in' },
    { transform: 'translate(0,-260px) rotate(30deg) scale(130)', opacity: 0, offset: 1 }
  )
  wrap.animate(frames, { duration: DUR, fill: 'both' })
  // the screen rumbles, harder as it climbs
  const rumble = [{ transform: 'translate(0,0)' }]
  for (let i = 1; i <= 40; i++) { const m = Math.min(1, i / 28) * 5; rumble.push({ transform: `translate(${rnd(-m, m).toFixed(1)}px, ${rnd(-m, m).toFixed(1)}px)` }) }
  rumble.push({ transform: 'translate(0,0)' })
  land.value?.animate(rumble, { duration: DUR * 0.95 })
  setTimeout(() => eggRetire(b, wrap, fxLayer, shadow), DUR + 150)
}

// 2. it blows up: flash, fireball, shock ring, smoke, wreckage, and nothing left
function eggExplode(b) {
  const { wrap, fxLayer, ox, oy } = eggStage(b)
  const boat = wrap.firstChild
  boat.animate([{ filter: 'none' }, { filter: 'brightness(3)', offset: 0.5 }, { filter: 'brightness(6)' }], { duration: 200, fill: 'forwards' })
  wrap.animate([{ opacity: 1 }, { opacity: 1, offset: 0.99 }, { opacity: 0 }], { duration: 200, fill: 'forwards' })
  setTimeout(() => {
    eggBit(fxLayer, ox, oy, 60, 'border-radius:50%;background:#fff;box-shadow:0 0 60px 30px #fff;', [{ opacity: 1, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(5)', offset: 0.35 }, { opacity: 0, transform: 'scale(7)' }], 500)
    eggBit(fxLayer, ox, oy, 70, 'border-radius:50%;background:radial-gradient(circle,#fff6b0 0%,#ffc02a 30%,#ff6a10 55%,rgba(200,40,0,0.5) 68%,transparent 72%);', [{ opacity: 1, transform: 'scale(0.2)' }, { opacity: 1, transform: 'scale(3.4)', offset: 0.45 }, { opacity: 0, transform: 'scale(5.2)' }], 900)
    eggBit(fxLayer, ox, oy, 80, 'border-radius:50%;border:5px solid rgba(255,255,255,0.9);', [{ opacity: 0.9, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(9)' }], 800)
    for (let i = 0; i < 8; i++) {
      eggBit(fxLayer, ox + rnd(-20, 20), oy + rnd(-20, 20), rnd(40, 70), 'border-radius:50%;background:radial-gradient(circle,rgba(70,70,70,0.9),rgba(40,40,40,0.6) 60%,transparent 72%);',
        [{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 0.8, transform: 'scale(1.4)', offset: 0.25 }, { opacity: 0, transform: `translate(${rnd(-70, 70)}px, ${rnd(-110, -30)}px) scale(3.2)` }], rnd(1300, 1900), 150 + i * 60)
    }
    const colours = ['#f0c420', '#d83a2a', '#2d6cdf', '#ffffff', '#222222', '#ff8a1a']
    for (let i = 0; i < 22; i++) {
      const a = rnd(0, Math.PI * 2)
      const dist = rnd(70, 230)
      const long = i < 4 // paddle blades and bits of hull
      eggBit(fxLayer, ox, oy, long ? 30 : rnd(6, 14), `background:${colours[i % colours.length]};${long ? 'height:5px;margin-top:-2px;' : ''}border-radius:2px;`,
        [{ opacity: 1, transform: 'translate(0,0) rotate(0deg)' }, { opacity: 1, transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist + rnd(10, 50)}px) rotate(${rnd(-720, 720)}deg)`, offset: 0.7 }, { opacity: 0, transform: `translate(${Math.cos(a) * dist * 1.15}px, ${Math.sin(a) * dist * 1.15 + 80}px) rotate(${rnd(-900, 900)}deg)` }], rnd(900, 1500))
    }
    land.value?.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-7px,5px)' }, { transform: 'translate(6px,-5px)' }, { transform: 'translate(-4px,-3px)' }, { transform: 'translate(3px,3px)' }, { transform: 'translate(0,0)' }], { duration: 380 })
  }, 150)
  setTimeout(() => eggRetire(b, wrap, fxLayer), 2300)
}

// a much bigger blast than a kayak's, for the vehicles: R is roughly how far the fire reaches (px)
function bigBlast(layer, ox, oy, R) {
  eggBit(layer, ox, oy, R * 0.5, 'border-radius:50%;background:#fff;box-shadow:0 0 80px 40px #fff;', [{ opacity: 1, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(5)', offset: 0.3 }, { opacity: 0, transform: 'scale(8)' }], 600)
  for (let i = 0; i < 9; i++) { // several fireballs going off one after another
    const fx = ox + rnd(-R * 0.6, R * 0.6)
    const fy = oy + rnd(-R * 0.6, R * 0.6)
    const sz = rnd(R * 0.5, R * 0.9)
    eggBit(layer, fx, fy, sz, 'border-radius:50%;background:radial-gradient(circle,#fff6b0 0%,#ffc02a 30%,#ff6a10 55%,rgba(200,40,0,0.5) 68%,transparent 72%);', [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'scale(2.6)', offset: 0.4 }, { opacity: 0, transform: 'scale(4)' }], rnd(900, 1400), i * 110)
    if (i % 3 === 0) eggBit(layer, fx, fy, sz * 0.5, 'border-radius:50%;border:4px solid rgba(255,255,255,0.8);', [{ opacity: 0.9, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(6)' }], 700, i * 110)
  }
  for (const [d, w] of [[0, 1], [220, 0.8]]) { // two shockwaves
    eggBit(layer, ox, oy, R * 0.6, `border-radius:50%;border:${6 * w}px solid rgba(255,255,255,0.85);`, [{ opacity: 0.9, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(11)' }], 1100, d)
  }
  for (let i = 0; i < 16; i++) { // a pall of black smoke that climbs and spreads
    eggBit(layer, ox + rnd(-R * 0.5, R * 0.5), oy + rnd(-R * 0.5, R * 0.5), rnd(R * 0.7, R * 1.2), 'border-radius:50%;background:radial-gradient(circle,rgba(40,40,40,0.95),rgba(20,20,20,0.6) 60%,transparent 72%);',
      [{ opacity: 0, transform: 'scale(0.3)' }, { opacity: 0.85, transform: 'scale(1.3)', offset: 0.25 }, { opacity: 0, transform: `translate(${rnd(-110, 110)}px, ${rnd(-190, -60)}px) scale(3.6)` }], rnd(2200, 3200), 200 + i * 90)
  }
  const colours = ['#f0c420', '#d83a2a', '#ffffff', '#222222', '#ff8a1a', '#8a8f96']
  for (let i = 0; i < 48; i++) { // wreckage thrown a long way
    const a = rnd(0, Math.PI * 2)
    const dist = rnd(R * 0.8, R * 3)
    const long = i % 6 === 0
    eggBit(layer, ox, oy, long ? 44 : rnd(7, 18), `background:${colours[i % colours.length]};${long ? 'height:7px;margin-top:-3px;' : ''}border-radius:2px;`,
      [{ opacity: 1, transform: 'translate(0,0) rotate(0deg)' }, { opacity: 1, transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist + rnd(10, 60)}px) rotate(${rnd(-900, 900)}deg)`, offset: 0.7 }, { opacity: 0, transform: `translate(${Math.cos(a) * dist * 1.15}px, ${Math.sin(a) * dist * 1.15 + 100}px) rotate(${rnd(-1100, 1100)}deg)` }], rnd(1100, 1900))
  }
  const sh = [{ transform: 'translate(0,0)' }]
  for (let i = 0; i < 12; i++) { const m = 16 * (1 - i / 12); sh.push({ transform: `translate(${rnd(-m, m).toFixed(1)}px, ${rnd(-m, m).toFixed(1)}px)` }) }
  sh.push({ transform: 'translate(0,0)' })
  land.value?.animate(sh, { duration: 700 })
}
// a narrowboat: the whole length goes up
function eggMegaBoat(b) {
  const { wrap, fxLayer, ox, oy } = eggStage(b)
  wrap.firstChild.animate([{ filter: 'none' }, { filter: 'brightness(3)', offset: 0.5 }, { filter: 'brightness(7)' }], { duration: 350, fill: 'forwards' })
  wrap.animate([{ opacity: 1 }, { opacity: 1, offset: 0.99 }, { opacity: 0 }], { duration: 350, fill: 'forwards' })
  setTimeout(() => bigBlast(fxLayer, ox, oy, b.type.box * ZOOM * 0.5), 250)
  setTimeout(() => {
    eggRetire(b, wrap, fxLayer)
    setTimeout(() => { if (!gone) addVessel(Math.random() < 0.5) }, 25000) // another comes along
  }, 4200)
}
// a car in the yard goes up and stays as a burnt-out shell
function eggBlowCar(c) {
  const ox = c.x * ZOOM
  const oy = c.y * ZOOM
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:61;'
  fxHost.value.appendChild(layer)
  eggBit(layer, ox, oy, 30, 'border-radius:50%;background:#fff;box-shadow:0 0 30px 15px #fff;', [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(3)' }], 220)
  setTimeout(() => {
    burnt[c.n] = true
    bigBlast(layer, ox, oy, Math.max(c.len, c.wid) * ZOOM * 1.2)
    for (let i = 0; i < 12; i++) { // it smoulders for a while
      eggBit(layer, ox + rnd(-8, 8), oy + rnd(-8, 8), rnd(24, 40), 'border-radius:50%;background:radial-gradient(circle,rgba(60,60,60,0.7),transparent 70%);', [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 0.6, transform: 'scale(1)', offset: 0.3 }, { opacity: 0, transform: `translate(${rnd(-20, 20)}px, -70px) scale(2.2)` }], 1800, 1400 + i * 450)
    }
  }, 200)
  setTimeout(() => layer.remove(), 8000)
}
// a tree topples: shudders, then goes over and lands with a thump and a cloud of leaves
function eggFellTree(key, t) {
  const R = t.r * ZOOM
  const ox = t.x * ZOOM
  const oy = t.y * ZOOM
  const a = rnd(0, Math.PI * 2)
  const dx = Math.cos(a) * t.r * 1.5
  const dy = Math.sin(a) * t.r * 1.5
  fallen[key] = { stage: 1, a, ex: t.x + dx, ey: t.y + dy }
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:62;'
  fxHost.value.appendChild(layer)
  const crown = eggBit(layer, ox, oy, R * 2, `border-radius:50%;background:radial-gradient(circle at 35% 35%,rgba(255,255,255,0.18),transparent 50%),${t.color};box-shadow:${R * 0.25}px ${R * 0.35}px ${R * 0.4}px rgba(20,40,15,0.35);`, [
    { opacity: 1, transform: 'translate(0,0) rotate(0deg) scale(1)' },
    { opacity: 1, transform: 'translate(-3px,0) rotate(-2deg) scale(1)', offset: 0.1 },
    { opacity: 1, transform: 'translate(3px,0) rotate(2deg) scale(1)', offset: 0.2 },
    { opacity: 1, transform: `translate(${dx * ZOOM * 0.3}px,${dy * ZOOM * 0.3}px) rotate(${Math.cos(a) * 8}deg) scale(1.08)`, offset: 0.5, easing: 'ease-in' },
    { opacity: 1, transform: `translate(${dx * ZOOM}px,${dy * ZOOM}px) rotate(${Math.cos(a) * 20}deg) scale(0.8)` }
  ], 1100, 0, 'ease-in-out')
  crown.style.opacity = '1'
  setTimeout(() => {
    fallen[key].stage = 2
    crown.remove()
    const ix = (t.x + dx) * ZOOM
    const iy = (t.y + dy) * ZOOM
    eggBit(layer, ix, iy, R, 'border-radius:50%;border:4px solid rgba(220,200,160,0.85);', [{ opacity: 0.9, transform: 'scale(0.4)' }, { opacity: 0, transform: 'scale(3.5)' }], 700)
    for (let i = 0; i < 18; i++) {
      const la = rnd(0, Math.PI * 2)
      const ld = rnd(R * 0.6, R * 2)
      eggBit(layer, ix, iy, rnd(6, 12), `border-radius:50% 0;background:${t.color};`, [{ opacity: 1, transform: 'translate(0,0) rotate(0deg)' }, { opacity: 0, transform: `translate(${Math.cos(la) * ld}px, ${Math.sin(la) * ld - 30}px) rotate(${rnd(-540, 540)}deg)` }], rnd(900, 1600))
    }
    land.value?.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(0,5px)' }, { transform: 'translate(0,-3px)' }, { transform: 'translate(0,0)' }], { duration: 260 })
    setTimeout(() => layer.remove(), 2000)
  }, 1100)
}

// a stick of dynamite: one click and everything round it goes up, a wave of explosions spreading
// out from it. Returns the points: a big bonus, and every wreck on top.
const DYN_RADIUS = 420 // world units
function eggDynamite(d) {
  const ox = d.x * ZOOM
  const oy = d.y * ZOOM
  swarm.removeDebris(d.id)
  let pts = 300
  const wait = (x, y) => Math.hypot(x - d.x, y - d.y) / DYN_RADIUS * 600 // the blast arrives
  const near = (x, y) => Math.hypot(x - d.x, y - d.y) < DYN_RADIUS
  for (const b of [...swarm.boats]) {
    const p = shown.get(b.id)
    if (!p || (b.opacity ?? 1) < 0.5 || b.waiting || eggBusy.has(b.id) || !elements.get(b.id) || !near(p.x, p.y)) continue
    pts += b.vessel ? 200 : 100
    setTimeout(() => {
      if (gone || eggBusy.has(b.id) || !elements.get(b.id) || !shown.get(b.id)) return
      if (b.vessel) eggMegaBoat(b)
      else pickEffect()(b)
    }, wait(p.x, p.y))
  }
  for (const c of allCars.value) {
    if (burnt[c.n] || !near(c.x, c.y)) continue
    pts += 120
    setTimeout(() => { if (!gone && !burnt[c.n]) eggBlowCar(c) }, wait(c.x, c.y))
  }
  for (const [pre, list] of [['b', veg.value.bigTrees], ['t', veg.value.trees]]) {
    list.forEach((t, i) => {
      if (fallen[pre + i] || !near(t.x, t.y)) return
      pts += pre === 'b' ? 90 : 60
      setTimeout(() => { if (!gone && !fallen[pre + i]) eggFellTree(pre + i, t) }, wait(t.x, t.y))
    })
  }
  // the dynamite itself: a flash over the whole screen, a huge fireball and a long shockwave
  const layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:70;'
  fxHost.value.appendChild(layer)
  const flash = document.createElement('div')
  flash.style.cssText = 'position:absolute;inset:0;z-index:90;pointer-events:none;background:#fff;opacity:0;'
  land.value?.appendChild(flash)
  flash.animate([{ opacity: 0.55 }, { opacity: 0.25, offset: 0.25 }, { opacity: 0 }], { duration: 600 }).onfinish = () => flash.remove()
  bigBlast(layer, ox, oy, 140)
  eggBit(layer, ox, oy, 120, 'border-radius:50%;border:10px solid rgba(255,230,160,0.9);', [{ opacity: 1, transform: 'scale(0.2)' }, { opacity: 0, transform: 'scale(' + (DYN_RADIUS * ZOOM * 1.8 / 120) + ')' }], 1100)
  setTimeout(() => land.value?.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(7px,-5px)' }, { transform: 'translate(-7px,5px)' }, { transform: 'translate(5px,4px)' }, { transform: 'translate(-3px,-2px)' }, { transform: 'translate(0,0)' }], { duration: 600 }), 250)
  popup('💥 DYNAMITE!', ox, oy - 90, '#ff3b2f', true)
  setTimeout(() => layer.remove(), 5000)
  return pts
}

// 3. it rolls over and sinks, with rings spreading and bubbles rising
function eggSink(b) {
  const { wrap, fxLayer, ox, oy } = eggStage(b)
  wrap.animate([
    { transform: 'rotate(0deg) scale(1)', opacity: 1, filter: 'none', offset: 0 },
    { transform: 'rotate(7deg) scale(0.98)', opacity: 1, filter: 'none', offset: 0.2 },
    { transform: 'rotate(-12deg) scale(0.92)', opacity: 1, filter: 'saturate(0.7) brightness(0.85)', offset: 0.45 },
    { transform: 'rotate(-30deg) scale(0.76)', opacity: 0.7, filter: 'saturate(0.4) brightness(0.6) blur(1px)', offset: 0.75 },
    { transform: 'rotate(-48deg) scale(0.55)', opacity: 0, filter: 'saturate(0.2) brightness(0.4) blur(2px)', offset: 1 }
  ], { duration: 3000, easing: 'ease-in-out', fill: 'both' })
  for (let i = 0; i < 4; i++) {
    eggBit(fxLayer, ox, oy, 70, 'border-radius:50%;border:3px solid rgba(255,255,255,0.8);', [{ opacity: 0.8, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(2.6)' }], 1500, i * 650, 'ease-out')
  }
  for (let i = 0; i < 14; i++) {
    const s = rnd(5, 11)
    eggBit(fxLayer, ox + rnd(-30, 30), oy + rnd(-30, 30), s, 'border-radius:50%;border:1.5px solid rgba(255,255,255,0.9);background:rgba(255,255,255,0.25);',
      [{ opacity: 0, transform: 'translate(0,0) scale(0.6)' }, { opacity: 0.9, offset: 0.2 }, { opacity: 0, transform: `translate(${rnd(-14, 14)}px, ${rnd(-60, -24)}px) scale(1.2)` }], rnd(900, 1500), 300 + i * 120)
  }
  setTimeout(() => eggRetire(b, wrap, fxLayer), 3300)
}
// the chance of each: most often it blows up
const EGG_EFFECTS = [[eggExplode, 0.6, 100], [eggRocket, 0.2, 150], [eggSink, 0.2, 75]]
const pickEffect = () => { let r = Math.random(); for (const [fx, w] of EGG_EFFECTS) { if (r < w) return fx; r -= w } return eggExplode }

const size = ref({ w: window.innerWidth, h: window.innerHeight })
const elements = new Map() // boat id -> DOM element

let raf = 0
let lastTime = 0

// the camera is pulled back: the swarm's world is drawn scaled down by ZOOM.
// What's drawn eases towards where each boat is (over about a twelfth of a second), so the
// small stop-starts of a boat working round others (most of all a quick one in a diamond)
// come out as smooth easing off and picking up again. A boat that jumps (coming back in at
// the far end of the river) is simply drawn where it is.
const SMOOTH = 0.08 // seconds
const shown = new Map() // boat id -> { x, y, h } as drawn
const turnBy = a => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
function place(boat, el, dt = 0) {
  let d = shown.get(boat.id)
  if (!d || !dt || Math.hypot(boat.x - d.x, boat.y - d.y) > 60) {
    d = { x: boat.x, y: boat.y, h: boat.heading }
    shown.set(boat.id, d)
  } else {
    const k = 1 - Math.exp(-dt / SMOOTH)
    d.x += (boat.x - d.x) * k
    d.y += (boat.y - d.y) * k
    d.h += turnBy(boat.heading - d.h) * k
  }
  // stopped (held up, giving way, waiting in the lock): paddles still and no wake, until
  // it gets going again (a little hysteresis, so a boat just easing off doesn't flicker)
  const still = el.classList.contains('boat--still')
  const pace = boat.pace || 1
  if (!still && boat.speed < pace * 0.12) el.classList.add('boat--still')
  else if (still && boat.speed > pace * 0.25) el.classList.remove('boat--still')
  if (boat.race) el.classList.toggle('boat--fell', !!boat.capsized)
  el.style.opacity = boat.opacity ?? 1 // a stuck paddler fades out before coming back in at one end of the river
  el.style.transform = `translate3d(${(d.x * ZOOM).toFixed(1)}px, ${(d.y * ZOOM).toFixed(1)}px, 0) rotate(${d.h.toFixed(3)}rad) scale(${(boat.scale * ZOOM).toFixed(3)})`
}

function bind(id, el) {
  if (!el) {
    elements.delete(id)
    return
  }
  elements.set(id, el)
  const boat = swarm.get(id)
  if (boat) place(boat, el)
}

// Returns false when there is nowhere clear to put another kayaker
// Returns false when there is nowhere clear to put another kayaker. New boats (one, or a
// whole club group) are drawn from the swarm's arrivals list, like later arrivals.
function addBoat(initial) {
  return !!swarm.spawn(initial)
}
function showArrivals() {
  for (const boat of swarm.takeArrivals()) {
    if (!swarm.get(boat.id)) continue // (gone again already)
    if (boat.vessel) showVessel(boat)
    else showBoat(boat)
  }
}

// Start drawing a paddler's boat: pick its colours / paint job
function showBoat(boat) {
  const type = boat.type.name
  if (boat.race) { // a boat in the race: its own colours, and a ring round yours
    fleet.value.push({ id: boat.id, type, box: boat.type.box, you: !!boat.raceLook?.you, look: { ...boat.raceLook, type, design: '', side: 1, swapping: false, stroke: 0.42, delay: -Math.random() * 0.4 } })
    return
  }
  // paddler's kit (and, for a privately owned K1 or K2, the boat's colours)
  let look = { ...pick(PALETTE) }
  let design = ''
  if (boat.club) {
    // a club boat: bright yellow all over (they go out in groups)
    look = { ...look, ...CLUB }
  } else if (type === 'racer') {
    design = pick(DESIGNS)
  } else if (type === 'k2') {
    if (Math.random() < 0.7) design = pick(K2_DESIGNS)
  } else if (type === 'canoe') {
    look = { ...look, ...pick(CANOE_PAINT) }
  } else if (type === 'oc1') {
    look = { ...look, ...OUTRIGGER }
  }
  // canoes paddle on one side with a single blade: which side, at random to start with
  const side = Math.random() < 0.5 ? 1 : -1
  // quicker boats paddle quicker
  // quicker boats paddle quicker (racing K1s fastest), but never frantically
  const stroke = Math.max(0.38, 0.9 - ((boat.pace - 28) / 30) * 0.35) * (reduced ? 2.5 : 1)
  fleet.value.push({
    id: boat.id,
    type, // k1, racer (a private boat), k2, c1, canoe or oc1 (narrowboats: see addVessel)
    box: boat.type.box, // drawing height (120 wide), for sizing the boat's box
    look: { ...look, type, design, side, swapping: false, stroke, delay: -Math.random() * 2 },
    nextSwap: CANOES.includes(type) ? performance.now() + swapGap() : Infinity,
  })
}


// a narrowboat, moored against a bank or cruising slowly; paddlers go around it
function addVessel(moored) {
  const boat = swarm.spawnVessel(moored)
  if (!boat) return false
  showVessel(boat)
  return true
}
function showVessel(boat) {
  const moored = boat.moored
  fleet.value.push({
    id: boat.id,
    type: 'narrowboat',
    box: boat.type.box,
    vessel: true,
    look: { ...makeBoatLook(), moving: !moored }, // every one different: paint, length, stern, roof
  })
}

// Canoeists change sides every so often, all together: blades lift out, come across,
// and go back in on the other side
const swapGap = () => 8000 + Math.random() * 16000 // ms between swaps
let swapTimer = 0
function swapSides() {
  const now = performance.now()
  for (const k of fleet.value) {
    // a moored narrowboat that has cast off gets its bow wave and wake
    if (k.vessel && !k.look.moving && swarm.get(k.id)?.moored === false) k.look.moving = true
    if (!(now >= k.nextSwap)) continue // only canoes have a nextSwap
    k.nextSwap = now + swapGap()
    k.look.swapping = true
    setTimeout(() => {
      k.look.side = -k.look.side
      k.look.swapping = false
    }, 320)
  }
}

// paddlers you can actually see: not those off out of sight down the river, carrying round
// the lock, or waiting to come back in
const paddlers = ref(0)

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0)
  lastTime = now
  stepWeather(dt)
  swarm.step(dt)
  if (race) stepRace(dt, now)
  lockOpen.value = swarm.lockBusy()
  paddlers.value = swarm.visiblePaddlers()
  syncDebris()
  driveCars(dt)
  greetings(now)
  // the boats on the water change over time: some leave, new ones arrive
  const left = swarm.takeDepartures()
  if (left.length) {
    fleet.value = fleet.value.filter(k => !left.includes(k.id))
    for (const id of left) shown.delete(id)
  }
  showArrivals()
  for (const boat of swarm.boats) {
    const el = elements.get(boat.id)
    if (el) place(boat, el, dt)
  }
  raf = requestAnimationFrame(frame)
}

// ---- race mode: five kayaks line up below the club, the starter calls, and you race one of them ----
// (the course, rules and boat physics are in race.js; this wires it to the page: keys, camera, display)
let race = null
const raceUi = reactive({ hud: null, results: null, best: +store.get('bscc-race-best') || 0, newBest: false, myTime: null })
const raceLines = ref(null) // the start and finish lines, in world px
let hudAt = 0
const held = new Set()
function startRace() {
  swarm.clearForRace()
  race = createRace(swarm.river())
  for (const e of race.entrants) {
    const b = swarm.addRaceBoat({ ...e.look, you: e.you })
    e.boat = b
  }
  const c = race.course
  raceLines.value = { start: c.start, finish: c.finish }
  Object.assign(raceUi, { hud: race.hud(), results: null, newBest: false, myTime: null })
  held.clear()
  restoreScenery()
}
function leaveRace() {
  race = null
  held.clear()
  raceLines.value = null
  raceUi.results = null
  swarm.endRace()
  smooth.value = true
  clearTimeout(smoothTimer)
  smoothTimer = setTimeout(() => { smooth.value = false }, 320)
  setView(1, 0, 0)
  populate()
}
function raceAgain() {
  if (!race) return
  swarm.endRace()
  startRace()
}
function stepRace(dt, now) {
  race.step(dt)
  // the camera follows your boat
  const p = race.player
  const w = size.value.w, h = size.value.h
  const kT = w < 700 ? 2.4 : 2
  const f = 1 - Math.exp(-dt * 3)
  const k = view.k + (kT - view.k) * f
  const tx = w / 2 - p.x * ZOOM * k, ty = h / 2 - p.y * ZOOM * k
  const g = view.k > kT - 0.05 ? 1 - Math.exp(-dt * 6) : f
  setView(k, view.x + (tx - view.x) * g, view.y + (ty - view.y) * g)
  if (now - hudAt > 90 || race.state.done) {
    hudAt = now
    raceUi.hud = race.hud()
    if (race.state.done && !raceUi.results) {
      const res = race.results()
      const me = res.find(r => r.you)
      raceUi.myTime = me?.time ?? null
      if (me && me.time != null && (!raceUi.best || me.time < raceUi.best)) {
        raceUi.newBest = true
        raceUi.best = me.time
        store.set('bscc-race-best', String(me.time))
      }
      raceUi.results = res
    }
  }
}
function applyHeld() {
  if (!race) return
  race.steer((held.has('R') ? 1 : 0) - (held.has('L') ? 1 : 0))
  race.brake(held.has('B'))
}
const RACE_KEYS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowDown: 'B' }
function raceKey(e, down) {
  if (!race) return false
  const k = e.key.toLowerCase()
  const stroke = k === 'z' || k === 'x' ? (k === 'z' ? -1 : 1) : 0
  const dir = RACE_KEYS[e.key]
  if (!stroke && !dir) return false
  e.preventDefault()
  if (stroke) { if (down && !e.repeat) race.stroke(stroke) }
  else { if (down) held.add(dir); else held.delete(dir); applyHeld() }
  return true
}
function onKeyUp(e) { if (mode.value === 'race') raceKey(e, false) }
function releaseKeys() { held.clear(); applyHeld() }
function raceTouchSteer(d) { held.delete('L'); held.delete('R'); if (d) held.add(d < 0 ? 'L' : 'R'); applyHeld() }
function raceTouchBrake(on) { if (on) held.add('B'); else held.delete('B'); applyHeld() }

function onResize() {
  // the river is redrawn for the new screen; boats move to the same place on it, and if
  // the river got smaller some leave (they are no longer drawn)
  const gone = swarm.resize(window.innerWidth, window.innerHeight)
  if (gone.length) fleet.value = fleet.value.filter(k => !gone.includes(k.id))
  for (const boat of swarm.boats) {
    const el = elements.get(boat.id)
    if (el) place(boat, el)
  }
  river.value = swarm.river().drawing
  veg.value = vegetation()
  resetScenery() // (the trees and cars are drawn afresh: what was wrecked belonged to the old drawing)
  size.value = { w: window.innerWidth, h: window.innerHeight }
  setView(view.k, view.x, view.y) // (keeps a zoomed view covering the screen)
  if (mode.value === 'race') setMode('scenic') // (the course was laid out for the old size)
}

// the river's usual traffic: narrowboats, paddlers and a diamond or two (at the start, and after a race)
function populate() {
  // one or two narrowboats, each either moored or cruising; placed first, as they need the most room
  const vessels = Math.random() < 0.5 ? 1 : 2
  for (let i = 0; i < vessels; i++) addVessel(Math.random() < 0.5)
  // and the narrowboats that live on their moorings on the old river
  for (const b of swarm.spawnMoorings(3)) showVessel(b)
  // a random number of paddlers: between about 80% and 100% of what the river holds comfortably
  const target = Math.round(swarm.suggestedCount() * (0.8 + 0.2 * Math.random()))
  for (let tries = 0; swarm.paddlerCount() < target && tries < target * 2; tries++) addBoat(true)
  // usually a diamond of racing boats (3 or 4) is already out, sometimes two
  if (Math.random() < 0.7) swarm.spawnGroup('diamond', true)
  if (Math.random() < 0.3) swarm.spawnGroup('diamond', true)
  showArrivals()
}

onMounted(() => {
  onResize()
  populate()
  showArrivals()
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', releaseKeys)
  swapTimer = setInterval(swapSides, 500)
  skyTimer = setInterval(() => { sky.value = light(clock()) }, 30000)
  carT = carTimer()
  setTimeout(sendCar, 4000) // one soon after the page opens
  stepWeather(0)
  raf = requestAnimationFrame(frame)
})
let skyTimer = 0

onBeforeUnmount(() => {
  gone = true
  clearBubbles()
  clearTimeout(carT)
  cancelAnimationFrame(raf)
  clearInterval(swapTimer)
  clearInterval(skyTimer)
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', releaseKeys)
  clearTimeout(smoothTimer)
  stopGame()
})
</script>

<template>
  <main ref="land" class="land" :class="{ 'land--arcade': mode === 'gaming', 'land--fast': WEATHER[weather].rain > 0.5, 'land--zoomed': canOut }" aria-label="Kayakers and canoeists paddling up and down a river" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onCancel" @wheel="onWheel">
    <div ref="scene" class="scene" :class="{ 'scene--smooth': smooth }">
    <!-- the river: all banks first, then all water, so the confluence joins seamlessly -->
    <svg class="river" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w / ZOOM} ${size.h / ZOOM}`" aria-hidden="true">
      <!-- round about: Hallingbury Road, the railway, Malcolm Barker Lake -->
      <g v-if="veg.site" class="around">
        <path :d="'M' + veg.site.road.map(p => p.join(' ')).join(' L')" class="around__road" />
        <path :d="'M' + veg.site.road.map(p => p.join(' ')).join(' L')" class="around__road-line" />
        <path :d="'M' + veg.site.railway.map(p => p.join(' ')).join(' L')" class="around__ballast" />
        <path :d="'M' + veg.site.railway.map(p => p.join(' ')).join(' L')" class="around__sleepers" />
        <path :d="'M' + veg.site.railway.map(p => p.join(' ')).join(' L')" class="around__rails" />
        <polygon :points="veg.site.lake.map(p => p.join(',')).join(' ')" class="around__lake-bank" />
        <polygon :points="veg.site.lake.map(p => p.join(',')).join(' ')" class="around__lake" />
      </g>
      <g fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path v-for="c in river" :key="c.name + '-reeds'" :d="c.d" class="river__reeds" :stroke-width="2 * c.half + 34" />
        <path v-for="c in river" :key="c.name + '-bank'" :d="c.d" class="river__bank" :stroke-width="2 * c.half + 16" />
        <path v-for="c in river" :key="c.name + '-water'" :d="c.d" class="river__water" :stroke-width="2 * c.half" />
        <path v-for="c in river" :key="c.name + '-deep'" :d="c.d" class="river__deep" :stroke-width="1.15 * c.half" />
        <template v-for="c in river" :key="c.name + '-flow'">
          <path v-for="(f, i) in c.flow" :key="i" :d="f" class="river__flow" :style="{ animationDelay: `${-i * 0.7}s` }" />
        </template>
      </g>
      <!-- the club (swarm.js SITE): Stylemans Lane and the yard, South Mill Lock, the landing
           stage, the towpath, the boatshed and the clubhouse -->
      <g v-if="veg.site" class="site">
        <path :d="'M' + veg.site.lane.map(p => p.join(' ')).join(' L')" class="site__lane-edge" />
        <path :d="'M' + veg.site.lane.map(p => p.join(' ')).join(' L')" class="site__lane" />
        <polygon :points="veg.site.yard.map(p => p.join(',')).join(' ')" class="site__yard" />
        <!-- cars parked on the yard -->
        <g v-for="c in allCars" :key="'car' + c.n" :transform="`translate(${c.x} ${c.y}) rotate(${c.angle})`">
          <g v-if="burnt[c.n]">
            <ellipse :rx="c.len * 0.75" :ry="c.wid * 0.85" fill="rgba(0, 0, 0, 0.35)" />
            <rect :x="-c.len / 2" :y="-c.wid / 2" :width="c.len" :height="c.wid" :rx="c.wid * 0.3" fill="#1d1b19" />
            <rect :x="-c.len * 0.3" :y="-c.wid * 0.35" :width="c.len * 0.6" :height="c.wid * 0.7" :rx="c.wid * 0.15" fill="#34302c" />
            <circle :cx="c.len * 0.1" :cy="c.wid * 0.1" :r="c.wid * 0.18" fill="#5a2a14" opacity="0.7" />
          </g>
          <g v-else>
          <rect :x="-c.len / 2 + 1.5" :y="-c.wid / 2 + 2.5" :width="c.len" :height="c.wid" :rx="c.wid * 0.3" fill="rgba(0, 0, 0, 0.25)" />
          <rect :x="-c.len / 2" :y="-c.wid / 2" :width="c.len" :height="c.wid" :rx="c.wid * 0.3" :fill="CAR_PAINT[c.n % CAR_PAINT.length]" />
          <!-- windscreen, roof, rear window -->
          <rect :x="c.len * 0.06" :y="-c.wid * 0.38" :width="c.len * 0.14" :height="c.wid * 0.76" :rx="c.wid * 0.12" fill="#2b3440" />
          <rect :x="-c.len * 0.22" :y="-c.wid * 0.36" :width="c.len * 0.28" :height="c.wid * 0.72" :rx="c.wid * 0.1" fill="rgba(255, 255, 255, 0.14)" />
          <rect :x="-c.len * 0.36" :y="-c.wid * 0.34" :width="c.len * 0.1" :height="c.wid * 0.68" :rx="c.wid * 0.1" fill="#2b3440" />
          <!-- a kayak on the roof bars, now and then -->
          <rect v-if="c.n % 3 === 1" :x="-c.len * 0.55" :y="-c.wid * 0.12" :width="c.len * 1.1" :height="c.wid * 0.24" :rx="c.wid * 0.12" fill="#f2c230" stroke="rgba(0,0,0,0.3)" stroke-width="0.6" />
          </g>
        </g>
        <!-- the towpath, along the club's bank past the lock -->
        <path :d="'M' + veg.site.towpath.map(p => p.join(' ')).join(' L')" class="site__towpath" />
        <!-- the lock: stone walls along both sides, white balance beams, and the gates: shut
             (mitred, pointing upstream: no paddling through), open while a narrowboat works
             through -->
        <g v-if="veg.site.lock.inView">
          <path v-for="(d, i) in veg.site.lock.walls" :key="'w' + i" :d="d" class="site__wall" />
          <path v-for="(d, i) in veg.site.lock.walls" :key="'c' + i" :d="d" class="site__coping" />
          <g v-for="(g, i) in veg.site.lock.gates" :key="'g' + i" :transform="`translate(${g.x} ${g.y}) rotate(${g.angle})`">
            <g v-for="side in [-1, 1]" :key="side">
              <line v-if="lockOpen" x1="0" :y1="side * (veg.site.lock.half + 2)" :x2="(i ? -1 : 1) * veg.site.lock.half * 0.55" :y2="side * (veg.site.lock.half - 5)" class="site__gate" />
              <line v-else x1="0" :y1="side * (veg.site.lock.half + 2)" :x2="-veg.site.lock.half * 0.42" y2="0" class="site__gate" />
              <rect :x="(i ? 6 : -14)" :y="side > 0 ? veg.site.lock.half + 8 : -veg.site.lock.half - 8 - 62" width="8" height="62" class="site__beam" />
              <rect :x="(i ? 6 : -14)" :y="side > 0 ? veg.site.lock.half + 8 + 52 : -veg.site.lock.half - 8 - 62" width="8" height="10" fill="#222" />
            </g>
          </g>
        </g>
        <!-- landing stages at each end of the lock, for the portage -->
        <g v-for="(st, i) in veg.site.portage" :key="'p' + i" :transform="`translate(${st.x} ${st.y}) rotate(${st.angle})`">
          <rect :x="-st.len / 2" :y="-st.wid / 2" :width="st.len" :height="st.wid" rx="2" fill="#a8743f" />
          <line v-for="n in Math.floor(st.len / 8)" :key="n" :x1="-st.len / 2 + n * 8" :x2="-st.len / 2 + n * 8" :y1="-st.wid / 2" :y2="st.wid / 2" stroke="#7d5229" stroke-width="1.2" />
        </g>
        <!-- the landing stage -->
        <g :transform="`translate(${veg.site.landing.x} ${veg.site.landing.y}) rotate(${veg.site.landing.angle})`">
          <rect :x="-veg.site.landing.len / 2" :y="-veg.site.landing.wid / 2" :width="veg.site.landing.len" :height="veg.site.landing.wid" rx="2" fill="#a8743f" />
          <line v-for="n in Math.floor(veg.site.landing.len / 8)" :key="n" :x1="-veg.site.landing.len / 2 + n * 8" :x2="-veg.site.landing.len / 2 + n * 8"
            :y1="-veg.site.landing.wid / 2" :y2="veg.site.landing.wid / 2" stroke="#7d5229" stroke-width="1.2" />
        </g>
        <!-- buildings: shadow, roof, ridge -->
        <g v-for="b in [veg.site.boatshed, veg.site.clubhouse]" :key="b.kind" :transform="`translate(${b.x} ${b.y}) rotate(${b.angle})`">
          <rect :x="-b.len / 2 + 7" :y="-b.wid / 2 + 9" :width="b.len" :height="b.wid" rx="3" fill="rgba(10, 30, 15, 0.3)" />
          <template v-if="b.kind === 'clubhouse'">
            <rect :x="-b.len / 2" :y="-b.wid / 2" :width="b.len" :height="b.wid" rx="3" fill="#3d434b" />
            <rect :x="-b.len / 2" :y="-b.wid / 2" :width="b.len" :height="b.wid / 2" rx="3" fill="#4a5159" />
            <line :x1="-b.len / 2 + 4" :x2="b.len / 2 - 4" y1="0" y2="0" stroke="#69717a" stroke-width="3" />
            <text x="0" :y="b.wid * 0.33" text-anchor="middle" :font-size="b.wid * 0.3" class="site__name"
              :transform="Math.abs(b.angle) > 90 ? 'rotate(180)' : null">BSCC</text>
          </template>
          <template v-else>
            <rect :x="-b.len / 2" :y="-b.wid / 2" :width="b.len" :height="b.wid" rx="2" fill="#b4bac1" />
            <line v-for="n in Math.floor(b.len / 9)" :key="n" :x1="-b.len / 2 + n * 9" :x2="-b.len / 2 + n * 9" :y1="-b.wid / 2" :y2="b.wid / 2" stroke="#9aa1a9" stroke-width="1.4" />
            <line :x1="-b.len / 2" :x2="b.len / 2" y1="0" y2="0" stroke="#8b929a" stroke-width="3" />
          </template>
        </g>
      </g>
      <!-- ripples from a tap on the water: three rings spreading out and fading -->
      <g class="ripples" fill="none">
        <g v-for="r in ripples" :key="r.id" :transform="`translate(${r.x} ${r.y})`">
          <circle v-for="n in (reduced ? 1 : 3)" :key="n" r="90" class="ripple" :style="{ animationDelay: `${(n - 1) * 0.35}s` }" />
        </g>
      </g>
      <!-- debris carried down the river in the wind: logs, branches, leaves -->
      <g class="debris">
        <g v-for="d in debrisList" :key="d.id" :ref="(el) => bindDebris(d.id, el)" transform="translate(-999 -999)">
          <!-- the water breaking round it -->
          <ellipse cx="0" cy="0" :rx="d.shape.log ? d.shape.log.L * 0.58 : d.shape.branch ? d.shape.branch.L * 0.55 : d.shape.size * 0.75" :ry="d.shape.log ? d.shape.log.w * 1.4 : d.shape.branch ? d.shape.branch.L * 0.32 : d.shape.size * 0.58" class="debris__foam" />
          <template v-if="d.shape.dyn">
            <circle cx="0" cy="0" :r="d.shape.dyn.L * 0.95" class="dyn__ring" />
            <rect :x="-d.shape.dyn.L / 2 + 2" :y="-d.shape.dyn.L * 0.14 + 3" :width="d.shape.dyn.L" :height="d.shape.dyn.L * 0.28" :rx="d.shape.dyn.L * 0.08" fill="rgba(10, 30, 40, 0.35)" />
            <rect :x="-d.shape.dyn.L / 2" :y="-d.shape.dyn.L * 0.14" :width="d.shape.dyn.L" :height="d.shape.dyn.L * 0.28" :rx="d.shape.dyn.L * 0.08" fill="#c62828" />
            <rect :x="-d.shape.dyn.L * 0.3" :y="-d.shape.dyn.L * 0.14" :width="d.shape.dyn.L * 0.08" :height="d.shape.dyn.L * 0.28" fill="#f5e6c8" />
            <rect :x="d.shape.dyn.L * 0.12" :y="-d.shape.dyn.L * 0.14" :width="d.shape.dyn.L * 0.08" :height="d.shape.dyn.L * 0.28" fill="#f5e6c8" />
            <path :d="`M${d.shape.dyn.L / 2} 0 Q${d.shape.dyn.L * 0.62} ${-d.shape.dyn.L * 0.05} ${d.shape.dyn.L * 0.72} ${-d.shape.dyn.L * 0.2}`" stroke="#d9c9a0" stroke-width="2" fill="none" stroke-linecap="round" />
            <circle :cx="d.shape.dyn.L * 0.72" :cy="-d.shape.dyn.L * 0.22" r="4" fill="#ffd23a" class="dyn__spark" />
          </template>
          <template v-else-if="d.shape.log">
            <rect :x="-d.shape.log.L / 2 + 2" :y="-d.shape.log.w / 2 + 3" :width="d.shape.log.L" :height="d.shape.log.w" :rx="d.shape.log.w / 2" fill="rgba(10, 30, 40, 0.3)" />
            <rect :x="-d.shape.log.L / 2" :y="-d.shape.log.w / 2" :width="d.shape.log.L" :height="d.shape.log.w" :rx="d.shape.log.w / 2" fill="#6b4a2b" />
            <line :x1="-d.shape.log.L * 0.42" :x2="d.shape.log.L * 0.38" :y1="-d.shape.log.w * 0.18" :y2="-d.shape.log.w * 0.12" stroke="#8a6239" stroke-width="1.2" stroke-linecap="round" />
            <line :x1="-d.shape.log.L * 0.3" :x2="d.shape.log.L * 0.42" :y1="d.shape.log.w * 0.2" :y2="d.shape.log.w * 0.16" stroke="#4e341d" stroke-width="1" stroke-linecap="round" />
            <ellipse v-for="(k, j) in d.shape.log.knots" :key="j" :cx="k" cy="0" rx="1.6" ry="1.2" fill="#4e341d" />
            <ellipse :cx="d.shape.log.L / 2 - 2" cy="0" :rx="d.shape.log.w * 0.22" :ry="d.shape.log.w * 0.42" fill="#c8a170" />
          </template>
          <template v-else-if="d.shape.branch">
            <path :d="`M${-d.shape.branch.L / 2} 0 Q0 ${d.shape.branch.L * 0.06} ${d.shape.branch.L / 2} -2`" stroke="#5a3d22" stroke-width="2" stroke-linecap="round" fill="none" />
            <path v-for="(t, j) in d.shape.branch.twigs" :key="'t' + j" :d="`M${t.at} 0 L${t.tx} ${t.ty}`" stroke="#6b4a2b" stroke-width="1.1" stroke-linecap="round" />
            <ellipse v-for="(l, j) in d.shape.branch.leaves" :key="'l' + j" :cx="l.x" :cy="l.y" :rx="l.rx" :ry="l.ry" :fill="l.c" :transform="`rotate(${l.a} ${l.x} ${l.y})`" />
          </template>
          <template v-else>
            <ellipse v-for="(l, j) in d.shape.leaves" :key="j" :cx="l.x" :cy="l.y" :rx="l.rx" :ry="l.ry" :fill="l.c" :transform="`rotate(${l.a} ${l.x} ${l.y})`" />
          </template>
        </g>
      </g>
      <!-- reeds on the water's edge -->
      <g class="reeds" fill="none" stroke-linecap="round">
        <path :d="veg.reeds[0]" stroke="#3f6e2a" stroke-width="1.9" />
        <path :d="veg.reeds[1]" stroke="#8aa845" stroke-width="1.6" />
      </g>
      <!-- bushes just behind them: shadow, a clump of rounded shrubs, some in flower -->
      <g class="bushes">
        <g v-for="(b, i) in veg.bushes" :key="i">
          <circle v-for="(c, j) in b.blobs" :key="'s' + j" :cx="b.x + c[0] + 3" :cy="b.y + c[1] + 4" :r="c[2]" fill="rgba(20, 40, 15, 0.22)" />
          <circle v-for="(c, j) in b.blobs" :key="'b' + j" :cx="b.x + c[0]" :cy="b.y + c[1]" :r="c[2]" :fill="b.color" />
          <circle :cx="b.x - b.r * 0.3" :cy="b.y - b.r * 0.35" :r="b.r * 0.45" fill="rgba(255, 255, 255, 0.12)" />
          <circle v-for="(f, j) in b.flowers" :key="'f' + j" :cx="b.x + f[0]" :cy="b.y + f[1]" r="1.8" :fill="b.blossom" />
        </g>
      </g>
      <!-- shade cast on the water by the big overhanging trees and the footbridge (their
           canopies and deck are drawn above the boats, further down) -->
      <g class="shade">
        <circle v-for="(t, i) in veg.bigTrees" :key="'ts' + i" :cx="t.x + t.r * 0.3" :cy="t.y + t.r * 0.4" :r="t.r * 1.05" fill="rgba(10, 30, 20, 0.22)" />
        <rect v-if="veg.bridge" :transform="`translate(${veg.bridge.x + 6} ${veg.bridge.y + 9}) rotate(${veg.bridge.angle})`"
          :x="-veg.bridge.span / 2" :y="-veg.bridge.width / 2" :width="veg.bridge.span" :height="veg.bridge.width" fill="rgba(10, 30, 20, 0.25)" />
      </g>
      <!-- trees set back from the water: shadow, canopy, a lighter top -->
      <g class="trees">
        <g v-for="(t, i) in veg.trees" :key="i">
          <template v-if="!fallen['t' + i]">
            <circle :cx="t.x + t.r * 0.25" :cy="t.y + t.r * 0.35" :r="t.r" fill="rgba(20, 40, 15, 0.28)" />
            <circle :cx="t.x" :cy="t.y" :r="t.r" :fill="t.color" />
            <circle :cx="t.x - t.r * 0.3" :cy="t.y - t.r * 0.3" :r="t.r * 0.5" fill="rgba(255, 255, 255, 0.12)" />
          </template>
          <template v-else>
            <circle :cx="t.x" :cy="t.y" :r="t.r * 0.2" fill="#8a6a45" stroke="#5a4028" stroke-width="1" />
            <template v-if="fallen['t' + i].stage === 2">
              <line :x1="t.x" :y1="t.y" :x2="fallen['t' + i].ex" :y2="fallen['t' + i].ey" stroke="#6b4a2b" :stroke-width="t.r * 0.18" stroke-linecap="round" />
              <circle :cx="fallen['t' + i].ex" :cy="fallen['t' + i].ey" :r="t.r * 0.8" :fill="t.color" stroke="rgba(0,0,0,0.25)" stroke-width="1" />
            </template>
          </template>
        </g>
      </g>
    </svg>

    <div
      v-for="k in fleet"
      :key="k.id"
      class="boat"
      :class="{ 'boat--you': k.you }"
      :style="{ height: k.box + 'px', marginTop: -k.box / 2 + 'px' }"
      :ref="(el) => bind(k.id, el)"
    >
      <NarrowBoat v-if="k.type === 'narrowboat'" v-bind="k.look" />
      <Kayaker v-else v-bind="k.look" />
    </div>

    <svg v-if="raceLines" class="river river--over race-lines" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w / ZOOM} ${size.h / ZOOM}`" aria-hidden="true">
      <g v-for="(ln, name) in raceLines" :key="name">
        <line :x1="ln.a[0]" :y1="ln.a[1]" :x2="ln.b[0]" :y2="ln.b[1]" stroke="#fff" stroke-width="7" opacity="0.9" />
        <line :x1="ln.a[0]" :y1="ln.a[1]" :x2="ln.b[0]" :y2="ln.b[1]" :stroke="name === 'finish' ? '#111' : '#e63946'" stroke-width="7" :stroke-dasharray="name === 'finish' ? '7 7' : '3 9'" />
      </g>
    </svg>

    <!-- above the boats: the footbridge they pass under, and the big trees overhanging the river -->
    <svg class="river river--over" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w / ZOOM} ${size.h / ZOOM}`" aria-hidden="true">
      <g v-if="veg.bridge" :transform="`translate(${veg.bridge.x} ${veg.bridge.y}) rotate(${veg.bridge.angle})`">
        <!-- abutments on each bank -->
        <rect :x="-veg.bridge.span / 2 - 6" :y="-veg.bridge.width / 2 - 5" :width="18" :height="veg.bridge.width + 10" rx="2" fill="#9a9184" />
        <rect :x="veg.bridge.span / 2 - 12" :y="-veg.bridge.width / 2 - 5" :width="18" :height="veg.bridge.width + 10" rx="2" fill="#9a9184" />
        <!-- deck of planks laid across the walkway -->
        <rect :x="-veg.bridge.span / 2" :y="-veg.bridge.width / 2" :width="veg.bridge.span" :height="veg.bridge.width" fill="#a8743f" />
        <line v-for="n in Math.floor(veg.bridge.span / 7)" :key="'p' + n"
          :x1="-veg.bridge.span / 2 + n * 7" :y1="-veg.bridge.width / 2" :x2="-veg.bridge.span / 2 + n * 7" :y2="veg.bridge.width / 2"
          stroke="#7d5229" stroke-width="1.2" />
        <!-- handrails and their posts -->
        <g v-for="side in [-1, 1]" :key="'r' + side">
          <rect :x="-veg.bridge.span / 2" :y="side * veg.bridge.width / 2 - 2.5" :width="veg.bridge.span" height="5" fill="#6b4422" />
          <rect v-for="n in Math.floor(veg.bridge.span / 28) + 1" :key="'q' + n"
            :x="-veg.bridge.span / 2 + (n - 1) * (veg.bridge.span / Math.floor(veg.bridge.span / 28)) - 3" :y="side * veg.bridge.width / 2 - 4"
            width="6" height="8" fill="#563519" />
        </g>
      </g>
      <template v-for="(t, i) in veg.bigTrees" :key="'bt' + i">
        <g v-if="!fallen['b' + i]" class="big-tree">
          <circle v-for="(l, j) in t.lobes" :key="'d' + j" :cx="t.x + l[0]" :cy="t.y + l[1]" :r="l[2]" :fill="t.color" />
          <circle v-for="(l, j) in t.lobes" :key="'h' + j" :cx="t.x + l[0] - l[2] * 0.25" :cy="t.y + l[1] - l[2] * 0.3" :r="l[2] * 0.55" fill="rgba(255, 255, 255, 0.1)" />
        </g>
        <g v-else>
          <circle :cx="t.x" :cy="t.y" :r="t.r * 0.12" fill="#8a6a45" stroke="#5a4028" stroke-width="1" />
          <template v-if="fallen['b' + i].stage === 2">
            <line :x1="t.x" :y1="t.y" :x2="fallen['b' + i].ex" :y2="fallen['b' + i].ey" stroke="#6b4a2b" :stroke-width="t.r * 0.12" stroke-linecap="round" />
            <circle :cx="fallen['b' + i].ex" :cy="fallen['b' + i].ey" :r="t.r * 0.8" :fill="t.color" stroke="rgba(0,0,0,0.25)" stroke-width="1" />
          </template>
        </g>
      </template>
    </svg>

    <!-- the weather: cloud shadows drifting over, gusts of wind, rain; then the light (night, and
         the warm glow around sunrise and sunset) over all of it -->
    <div class="sky sky--cloud" aria-hidden="true" />
    <div class="gusts" aria-hidden="true">
      <span v-for="g in GUSTS" :key="g.i" :style="{ top: g.y + '%', width: g.w + 'px', animationDelay: g.d + 's', animationDuration: g.t + 's' }" />
    </div>
    <div v-if="raining" class="rain" aria-hidden="true">
      <span v-for="r in DROPS" :key="r.i" :style="{ left: r.x + '%', top: reduced ? r.y + '%' : undefined, animationDelay: r.d + 's', animationDuration: r.t + 's', opacity: r.o }" />
    </div>
    <div class="sky sky--glow" :style="{ opacity: (sky.warm * 0.6).toFixed(2) }" aria-hidden="true" />
    <div class="sky sky--night" :style="{ opacity: (sky.dark * 0.74).toFixed(2) }" aria-hidden="true" />
    <!-- the club's lights after dark (above the night, so they glow) -->
    <svg v-if="veg.site && sky.dark > 0.3" class="river river--lights" :style="{ opacity: Math.min(1, (sky.dark - 0.3) * 2).toFixed(2) }" :width="size.w" :height="size.h" :viewBox="`0 0 ${size.w / ZOOM} ${size.h / ZOOM}`" aria-hidden="true">
      <defs>
        <radialGradient id="lamp"><stop offset="0" stop-color="#ffd98a" stop-opacity="0.55" /><stop offset="1" stop-color="#ffd98a" stop-opacity="0" /></radialGradient>
      </defs>
      <circle :cx="veg.site.clubhouse.x" :cy="veg.site.clubhouse.y" :r="veg.site.clubhouse.len * 0.6" fill="url(#lamp)" />
      <circle :cx="veg.site.boatshed.x" :cy="veg.site.boatshed.y" :r="veg.site.boatshed.len * 0.45" fill="url(#lamp)" />
      <circle :cx="veg.site.landing.x" :cy="veg.site.landing.y" :r="veg.site.landing.len * 0.7" fill="url(#lamp)" />
    </svg>

    <div ref="fxHost" class="fx-host" aria-hidden="true" />
    </div>

    <div class="modeswitch" role="group" aria-label="Page mode">
      <button type="button" :class="{ on: mode === 'scenic' }" :aria-pressed="mode === 'scenic'" @click="setMode('scenic')">🌿 Scenic mode</button>
      <button type="button" :class="{ on: mode === 'gaming' }" :aria-pressed="mode === 'gaming'" :disabled="reduced" :title="reduced ? 'Turned off because your device asks for less motion' : ''" @click="setMode('gaming')">🕹️ Gaming mode</button>
      <button type="button" :class="{ on: mode === 'race' }" :aria-pressed="mode === 'race'" :disabled="reduced" :title="reduced ? 'Turned off because your device asks for less motion' : ''" @click="setMode('race')">🏁 Race mode</button>
    </div>
    <div v-if="mode === 'gaming'" class="scanlines" aria-hidden="true" />
    <ArcadePanel v-if="mode === 'gaming'" :game="game" @start="startGame" @submit="submitScore" />
    <RacePanel v-if="mode === 'race'" :ui="raceUi" @again="raceAgain" @exit="setMode('scenic')" @stroke="s => race && race.stroke(s)" @steer="raceTouchSteer" @brake="raceTouchBrake" />
    <header v-if="mode === 'scenic'" class="hud">
      <h1>BSCC Coaching Resource</h1>
      <p>{{ paddlers }} paddlers on the water</p>
      <p class="hud__weather">{{ weatherText }}</p>
      <p class="hud__hint">Scroll, pinch or use + / − to zoom in</p>
    </header>
    <div v-if="mode !== 'race'" class="zoomctl" role="group" aria-label="Zoom">
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" :disabled="!canIn" @click="zoomBy(1.5)">+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out (−)" :disabled="!canOut" @click="zoomBy(1 / 1.5)">−</button>
      <button v-if="canOut" type="button" aria-label="Whole river" title="Whole river (0)" class="zoomctl__reset" @click="zoomReset">1×</button>
    </div>
    <SiteNav current="/" overlay />
  </main>
</template>

<style scoped>
/* a stopped boat: paddles rest where they are, and its wake (and bow wave) settles */
.scene { position: absolute; inset: 0; transform-origin: 0 0; }
.scene--smooth { transition: transform 0.28s ease-out; }
.fx-host { position: absolute; inset: 0; z-index: 9; pointer-events: none; }
.land--zoomed .boat { will-change: auto; } /* so boats are drawn sharp at the new scale */
.land { touch-action: none; } /* we handle pinch and drag ourselves */
.zoomctl { position: absolute; right: 16px; bottom: 16px; z-index: 12; display: flex; flex-direction: column; gap: 6px; }
.zoomctl button {
  width: 44px; height: 44px; border: 0; border-radius: 12px; cursor: pointer;
  background: rgba(6, 40, 58, 0.6); color: #fff; font: 600 1.5rem/1 inherit; backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px rgba(0, 20, 35, 0.3);
}
.zoomctl button:hover:not(:disabled) { background: rgba(6, 40, 58, 0.8); }
.zoomctl button:disabled { opacity: 0.4; cursor: default; }
.zoomctl__reset { font-size: 0.95rem !important; }
.hud__hint { margin: -4px 0 0 !important; font-size: 0.74rem !important; opacity: 0.7 !important; }
.boat--away { visibility: hidden; }
.boat--you::after { content: ''; position: absolute; left: 50%; top: 50%; width: 170px; height: 170px; margin: -85px 0 0 -85px; border: 4px solid #ffe600; border-radius: 50%; opacity: 0.8; pointer-events: none; box-shadow: 0 0 12px #ffe600; }
.boat--fell { filter: saturate(0.3) brightness(0.8); }
.boat--still :deep(*) { animation-play-state: paused !important; }
.boat--still :deep(.wake),
.boat--still :deep(.water-marks) { opacity: 0; }
.boat :deep(.wake),
.boat :deep(.water-marks) { transition: opacity 0.6s; }

.land {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  /* meadow: soft patches of lighter and darker grass */
  background:
    radial-gradient(ellipse at 15% 20%, #9cc46a 0%, transparent 45%),
    radial-gradient(ellipse at 80% 85%, #6f9e4c 0%, transparent 50%),
    radial-gradient(ellipse at 60% 10%, #a8cb78 0%, transparent 35%),
    linear-gradient(160deg, #8fb85f, #6c9a48);
}

.river {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* the bridge and overhanging trees, drawn over the boats */
.river--over {
  z-index: 5;
}
.race-lines { z-index: 9; }

.big-tree {
  opacity: 0.94; /* a boat underneath shows through, just */
}

.river__reeds { stroke: #557f3b; }
/* the club */
.site__lane-edge { fill: none; stroke: #b3a685; stroke-width: 34; stroke-linecap: round; stroke-linejoin: round; }
.site__lane { fill: none; stroke: #d3c8a8; stroke-width: 28; stroke-linecap: round; stroke-linejoin: round; }
.around__road { fill: none; stroke: #5d6166; stroke-width: 30; stroke-linecap: round; stroke-linejoin: round; }
.around__road-line { fill: none; stroke: #e9e4d2; stroke-width: 2; stroke-dasharray: 18 16; }
.around__ballast { fill: none; stroke: #8f8578; stroke-width: 22; stroke-linejoin: round; }
.around__sleepers { fill: none; stroke: #5b4636; stroke-width: 15; stroke-dasharray: 3 6; }
.around__rails { fill: none; stroke: #c9ccd0; stroke-width: 9; stroke-dasharray: none; opacity: 0.85; }
.around__lake-bank { fill: #c6b07a; stroke: #c6b07a; stroke-width: 16; stroke-linejoin: round; }
.around__lake { fill: color-mix(in srgb, #2b6f8d, #6d7550 calc(var(--rain, 0) * 30%)); stroke: #557f3b; stroke-width: 3; stroke-linejoin: round; }
.site__towpath { fill: none; stroke: #cbbf9c; stroke-width: 13; stroke-linecap: round; stroke-linejoin: round; opacity: 0.9; }
.site__yard { fill: #d3c8a8; stroke: #b3a685; stroke-width: 3; stroke-linejoin: round; }
.site__wall { fill: none; stroke: #8e877b; stroke-width: 12; stroke-linecap: square; }
.site__coping { fill: none; stroke: #d6d0c4; stroke-width: 3; }
.site__gate { stroke: #3b2a1a; stroke-width: 6; stroke-linecap: round; }
.site__beam { fill: #f4f4f0; stroke: #555; stroke-width: 1; }
.site__name { fill: rgba(255, 255, 255, 0.55); font-weight: 800; letter-spacing: 0.12em; font-family: inherit; }
.river--lights { z-index: 8; mix-blend-mode: screen; }
.river__bank { stroke: #c6b07a; }
.river__water { stroke: color-mix(in srgb, #2b86ad, #6d7550 calc(var(--rain, 0) * 45%)); } /* muddier after rain */
.river__deep { stroke: #2479a0; opacity: 0.7; }

/* dashes drifting downstream (paths run source -> mouth) */
.river__flow {
  stroke: #ffffff;
  stroke-opacity: 0.28;
  stroke-width: 2;
  stroke-dasharray: 14 34;
  animation: flow 2.4s linear infinite;
}
/* after rain the river runs faster */
.land--fast .river__flow { animation-duration: 1.1s; stroke-opacity: 0.4; }

@keyframes flow {
  to {
    stroke-dashoffset: -48;
  }
}

.boat {
  position: absolute;
  left: 0;
  top: 0;
  width: 120px;
  height: 170px; /* per boat type: set inline (K1 170, racing K1 200, K2 240) */
  margin: -85px 0 0 -60px;
  will-change: transform;
  pointer-events: none;
}

.hud {
  position: absolute;
  top: 62px; /* below the site menu */
  left: 16px;
  z-index: 10;
  padding: 12px 16px;
  border-radius: 14px;
  background: rgba(6, 40, 58, 0.55);
  backdrop-filter: blur(8px);
  box-shadow: 0 6px 20px rgba(0, 20, 35, 0.3);
}

.hud h1 {
  margin: 0;
  font-size: 1.25rem;
  letter-spacing: 0.04em;
}

.hud p {
  margin: 2px 0 10px;
  font-size: 0.85rem;
  opacity: 0.8;
}










/* ---- weather ---- */
/* trees, bushes and reeds sway in the wind */
.trees > g, .bushes > g, .big-tree {
  transform-box: fill-box;
  transform-origin: center;
  animation: sway 2.6s ease-in-out infinite alternate;
}
.bushes > g { animation-duration: 1.9s; }
.reeds { animation: reeds 1.4s ease-in-out infinite alternate; transform-box: fill-box; transform-origin: center; }
@keyframes sway {
  from { transform: rotate(calc(var(--wind, 0) * -2.5deg)) translate(calc(var(--wind, 0) * -1px), 0); }
  to { transform: rotate(calc(var(--wind, 0) * 2.5deg)) translate(calc(var(--wind, 0) * 2px), 0); }
}
@keyframes reeds {
  from { transform: translate(calc(var(--wind, 0) * -1.2px), calc(var(--wind, 0) * -0.6px)); }
  to { transform: translate(calc(var(--wind, 0) * 1.2px), calc(var(--wind, 0) * 0.6px)); }
}
.sky, .gusts, .rain { position: absolute; inset: 0; pointer-events: none; }
.dyn__ring { fill: rgba(255, 60, 40, 0.12); stroke: #ff3b2f; stroke-width: 2; animation: dynpulse 0.7s steps(2) infinite; }
.dyn__spark { animation: dynpulse 0.25s steps(2) infinite; }
@keyframes dynpulse { 50% { opacity: 0.15; } }
.debris__foam { fill: rgba(255, 255, 255, 0.1); stroke: rgba(255, 255, 255, 0.3); stroke-width: 2; }
/* clouds: the whole scene a little greyer, with big soft shadows drifting across */
.sky--cloud { z-index: 6; overflow: hidden; opacity: calc(var(--cloud, 0) * 0.9); background: rgba(70, 80, 95, 0.22); }
.sky--cloud::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 300%;
  height: 100%;
  background:
    radial-gradient(ellipse 10% 24% at 8% 30%, rgba(40, 50, 60, 0.34), transparent),
    radial-gradient(ellipse 9% 20% at 24% 70%, rgba(40, 50, 60, 0.3), transparent),
    radial-gradient(ellipse 11% 26% at 42% 25%, rgba(40, 50, 60, 0.32), transparent),
    radial-gradient(ellipse 9% 22% at 58% 75%, rgba(40, 50, 60, 0.3), transparent),
    radial-gradient(ellipse 10% 24% at 75% 35%, rgba(40, 50, 60, 0.34), transparent),
    radial-gradient(ellipse 9% 20% at 91% 70%, rgba(40, 50, 60, 0.3), transparent);
  background-repeat: no-repeat;
  animation: clouds 90s linear infinite alternate;
}
@keyframes clouds { from { transform: translateX(0); } to { transform: translateX(-66.6%); } }
/* gusts: streaks blowing across */
.gusts { z-index: 6; overflow: hidden; opacity: calc(var(--wind, 0) * var(--wind, 0) * 0.8); }
.gusts span {
  position: absolute;
  left: -20%;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.75), transparent);
  animation: gust 4s linear infinite;
}
@keyframes gust { from { transform: translateX(0); } to { transform: translateX(140vw); } }
/* rain: streaks falling, slanting with the wind */
.rain { z-index: 6; overflow: hidden; opacity: calc(var(--rain, 0) * 0.9); }
.rain span {
  position: absolute;
  top: -12%;
  width: 1.5px;
  height: 22px;
  background: linear-gradient(rgba(220, 235, 245, 0), rgba(220, 235, 245, 0.9));
  transform: rotate(calc(var(--wind, 0) * 14deg));
  animation: fall 0.6s linear infinite;
}
@keyframes fall {
  from { transform: translate(0, 0) rotate(calc(var(--wind, 0) * 14deg)); }
  to { transform: translate(calc(var(--wind, 0) * -28vh), 115vh) rotate(calc(var(--wind, 0) * 14deg)); }
}
/* the light: a warm glow around sunrise and sunset, and night (dark blue) */
.sky--glow { z-index: 7; background: linear-gradient(170deg, #ffb26b, #ff7a59 60%, #c4547a); mix-blend-mode: soft-light; transition: opacity 20s; }
.sky--night { z-index: 7; background: radial-gradient(ellipse at 70% 20%, #3a4f8c, #141c3d 75%); mix-blend-mode: multiply; transition: opacity 20s; }
.hud__weather { margin: -6px 0 2px !important; font-size: 0.8rem !important; opacity: 0.9 !important; }

/* a tap on the water */
.land { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ripple {
  stroke: #ffffff;
  stroke-width: 3;
  opacity: 0;
  transform: scale(0.05);
  transform-box: fill-box;
  transform-origin: center;
  animation: ripple 1.9s cubic-bezier(0.2, 0.6, 0.35, 1) forwards;
}
@keyframes ripple {
  0% { transform: scale(0.05); opacity: 0.85; stroke-width: 5; }
  100% { transform: scale(1); opacity: 0; stroke-width: 1.5; }
}

@media (prefers-reduced-motion: reduce) {
  .river__flow {
    animation: none;
  }
  .trees > g, .bushes > g, .big-tree, .reeds, .sky--cloud::before, .gusts span { animation: none; }
  .rain span { animation: none; }
  .ripple { animation-duration: 1.2s; animation-name: ripple-fade; transform: scale(0.6); }
}
@keyframes ripple-fade {
  0% { opacity: 0.7; }
  100% { opacity: 0; }
}

/* ---- scenic / gaming switch and the arcade look ---- */
.modeswitch {
  position: absolute; top: 62px; left: 50%; transform: translateX(-50%); z-index: 14; display: flex; padding: 5px;
  border-radius: 999px; background: rgba(6, 40, 58, 0.7); backdrop-filter: blur(8px); box-shadow: 0 6px 20px rgba(0, 20, 35, 0.35);
}
.modeswitch button {
  border: 0; border-radius: 999px; padding: 12px 22px; font: 700 1rem system-ui, sans-serif; color: #dff3fa; background: transparent; cursor: pointer; white-space: nowrap;
}
.modeswitch button.on { background: linear-gradient(#5fd0a0, #2e9e78); color: #04281c; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); }
.modeswitch button:nth-child(2).on { background: linear-gradient(#ff2bd6, #7a1fff); color: #fff; box-shadow: 0 0 16px #ff2bd6; }
.modeswitch button:nth-child(3).on { background: linear-gradient(#ffb347, #ff7b00); color: #3a1b00; }
.modeswitch button:disabled { opacity: 0.4; cursor: not-allowed; }
.land--arcade .scene { filter: saturate(1.5) contrast(1.15) hue-rotate(-25deg) brightness(0.8); }
.land--arcade::before {
  content: ''; position: absolute; inset: 0; z-index: 11; pointer-events: none;
  background: linear-gradient(135deg, rgba(120, 0, 255, 0.28), rgba(255, 0, 160, 0.14) 50%, rgba(0, 220, 255, 0.2)); mix-blend-mode: color;
}
.scanlines {
  position: absolute; inset: 0; z-index: 12; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px), radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.6));
}
.land--arcade :deep(.boat--hit) { animation: boat-hit 0.35s steps(2); }
@keyframes boat-hit { 50% { filter: brightness(3) saturate(0) drop-shadow(0 0 8px #fff); } }
@media (max-width: 720px) {
  .modeswitch { top: auto; bottom: 16px; }
  .modeswitch button { padding: 10px 10px; font-size: 0.78rem; }
}
</style>
