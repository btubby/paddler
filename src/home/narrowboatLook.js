// Every narrowboat looks different: its paint, how long it is, the shape of its stern, and
// what's on the roof (plants, logs, bikes, solar panels...). makeBoatLook() picks one at
// random; NarrowBoat.vue draws it. The collision footprint (TYPES.narrowboat in swarm.js)
// stays the same for all of them: the longest boat fills it, shorter ones sit inside it.

// cabin side, a contrasting panel/coachline colour, roof, and trim
const PAINT = [
  { hull: '#1f4d3a', panel: '#b8322c', roof: '#e9dfc4', trim: '#e0b43c' }, // racing green and red
  { hull: '#6b1e2b', panel: '#1f4d3a', roof: '#eadbbf', trim: '#d4b04a' }, // maroon and green
  { hull: '#1d3557', panel: '#d9a441', roof: '#efe4c8', trim: '#e6c35c' }, // navy and gold
  { hull: '#2b2d2f', panel: '#c0392b', roof: '#d9c9a3', trim: '#b8862b' }, // black and red
  { hull: '#c0392b', panel: '#f2c230', roof: '#2e5a3a', trim: '#f7e08a' }, // pillar-box red, green roof
  { hull: '#3b7dd8', panel: '#f4d35e', roof: '#f1ead6', trim: '#ffffff' }, // sky blue and yellow
  { hull: '#5b2c6f', panel: '#e8a33d', roof: '#e8dcc0', trim: '#f0c75e' }, // plum and orange
  { hull: '#2e7d6b', panel: '#f6d6a8', roof: '#3b3b3b', trim: '#f0e3c0' }, // teal and cream
  { hull: '#e07b39', panel: '#2a4d69', roof: '#efe7d2', trim: '#2a4d69' }, // orange and blue
  { hull: '#f1e3c6', panel: '#2f5d50', roof: '#2f5d50', trim: '#b23a48' }, // cream and green
  { hull: '#7a8b3a', panel: '#5c3a1e', roof: '#e9dcbc', trim: '#e7c55a' }, // olive and brown
  { hull: '#b23a6e', panel: '#2e2e5c', roof: '#eadfca', trim: '#f4cf5d' }, // raspberry and indigo
]
const FLOWERS = ['#e8475f', '#f2c94c', '#ffffff', '#c86dd7', '#ff8c42', '#ff5d8f', '#6ec3f4']
const GREENS = ['#4f8f3a', '#5ea347', '#3f7a32', '#6bb04f']

const pick = (rng, list) => list[Math.floor(rng() * list.length)]
const rand = (rng, a, b) => a + rng() * (b - a)

export function makeBoatLook(rng = Math.random) {
  const paint = pick(rng, PAINT)
  // between about 40 and 70 feet long: the longest fills the box
  const len = Math.round(rand(rng, 340, 500))
  const r = rng()
  const stern = r < 0.45 ? 'trad' : r < 0.75 ? 'semi' : 'cruiser'
  const deck = stern === 'trad' ? 30 : stern === 'semi' ? 62 : 96 // stern deck length
  const cratch = rng() < 0.45 // a canvas cover over the front well deck
  const cratchColour = pick(rng, ['#d8d2bf', '#3d5a4a', '#1f3350', '#6b2a2a', paint.panel])
  const roses = rng() < 0.4 // traditional painted diamonds on the bow

  // things on the roof, front to back, with gaps between
  const roofTop = 124
  const roofEnd = len - deck - 18
  const items = [{ kind: 'chimney', x: 0, y: roofTop + rand(rng, 14, 30) }]
  let y = items[0].y + 22
  const kinds = ['pots', 'pots', 'planter', 'planter', 'solar', 'logs', 'bike', 'vent', 'rope', 'can', 'buoy', 'pots']
  const used = new Set()
  while (y < roofEnd - 24) {
    let kind = pick(rng, kinds)
    if ((kind === 'bike' || kind === 'solar' || kind === 'buoy') && used.has(kind)) kind = 'pots'
    used.add(kind)
    const size = { pots: 26, planter: rand(rng, 40, 70), solar: rand(rng, 50, 80), logs: 34, bike: 62, vent: 12, rope: 20, can: 22, buoy: 22 }[kind]
    if (y + size > roofEnd) break
    const item = { kind, y, size, x: rand(rng, -6, 6) }
    if (kind === 'pots') {
      const n = 2 + Math.floor(rng() * 3)
      item.pots = Array.from({ length: n }, (_, i) => ({
        dx: (i % 2 ? 1 : -1) * rand(rng, 4, 11),
        dy: (i * size) / n + rand(rng, -2, 2),
        r: rand(rng, 4.5, 7.5),
        green: pick(rng, GREENS),
        flowers: Array.from({ length: Math.floor(rng() * 4) }, () => ({ dx: rand(rng, -3.5, 3.5), dy: rand(rng, -3.5, 3.5), c: pick(rng, FLOWERS) })),
        pot: pick(rng, ['#b4532a', '#8a4b2a', '#3b6e8f', '#2f2f2f']),
      }))
    }
    if (kind === 'planter') {
      item.flowers = Array.from({ length: Math.round(size / 7) }, (_, i) => ({ dy: 4 + i * 7 + rand(rng, -2, 2), dx: rand(rng, -9, 9), c: pick(rng, FLOWERS) }))
      item.green = pick(rng, GREENS)
    }
    if (kind === 'buoy') item.c = pick(rng, ['#e8473c', '#f28b30'])
    if (kind === 'can') item.c = pick(rng, ['#2f8f4a', '#c0392b', '#3b7dd8'])
    if (kind === 'bike') item.c = pick(rng, ['#d33', '#36c', '#2a2a2a', '#e6b800'])
    items.push(item)
    y += size + rand(rng, 6, 20)
  }
  return { ...paint, len, stern, deck, cratch, cratchColour, roses, items }
}
