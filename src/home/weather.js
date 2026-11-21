// The home page's weather and time of day.
//
// Weather: it starts fair, then after a while changes every minute or two (never the same
// twice running). Each kind sets how windy, rainy and cloudy it is (0..1); the page eases
// between them over several seconds. Wind brings debris down the river; rain makes it run
// faster (swarm.js setWeather), and both show on screen.
//
// Time of day: the real time in Bishop's Stortford, with sunrise and sunset worked out for
// the date (the usual sunrise equation: close enough to the minute for a picture), so it's
// dark on the page when it's dark at the club, with a warm glow around sunrise and sunset.

export const WEATHER = {
  fair: { wind: 0.1, rain: 0, cloud: 0, label: 'Sunny', night: 'Clear', icon: '☀️', nightIcon: '🌙' },
  cloudy: { wind: 0.3, rain: 0, cloud: 0.5, label: 'Cloudy', icon: '☁️' },
  windy: { wind: 1, rain: 0, cloud: 0.3, label: 'Windy: watch out for debris', icon: '💨' },
  rain: { wind: 0.25, rain: 1, cloud: 0.8, label: 'Raining: the river’s running fast', icon: '🌧️' },
  storm: { wind: 1, rain: 1, cloud: 1, label: 'Stormy: fast water and debris', icon: '⛈️' }
}
const CHANCE = { fair: 35, cloudy: 20, windy: 20, rain: 15, storm: 10 }

// the next weather: any but the current one, fair the likeliest
export function nextWeather(now, rng = Math.random) {
  const options = Object.entries(CHANCE).filter(([k]) => k !== now)
  let u = rng() * options.reduce((s, [, w]) => s + w, 0)
  for (const [k, w] of options) if ((u -= w) < 0) return k
  return options[0][0]
}
// how long until it changes (seconds): a while at first, then every minute or two
export const firstChange = (rng = Math.random) => 40 + rng() * 30
export const nextChange = (rng = Math.random) => 60 + rng() * 60

// ---- time of day ----------------------------------------------------------------------
const LAT = 51.87, LON = 0.16 // Bishop's Stortford
const TZ = 'Europe/London'
const rad = d => (d * Math.PI) / 180
// hours (decimal) of an instant, on the clock in Bishop's Stortford
export function clockHours(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date)
    const get = t => +parts.find(p => p.type === t).value
    return get('hour') + get('minute') / 60
  } catch {
    return date.getHours() + date.getMinutes() / 60
  }
}
// sunrise and sunset that day, in hours on the local clock: { rise, set }
export function sunTimes(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const n = Math.floor((date.getTime() - start) / 864e5) // day of the year
  const decl = rad(23.44) * Math.sin((2 * Math.PI * (284 + n)) / 365)
  const B = (2 * Math.PI * (n - 81)) / 364
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B) // minutes
  const noonUtc = 12 - LON / 15 - eot / 60
  const cosW = (Math.sin(rad(-0.833)) - Math.sin(rad(LAT)) * Math.sin(decl)) / (Math.cos(rad(LAT)) * Math.cos(decl))
  const w = (Math.acos(Math.max(-1, Math.min(1, cosW))) * 180) / Math.PI / 15 // hours from noon
  // the clock's offset from UTC that day (an hour in summer time)
  const noon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12))
  const offset = Math.round((clockHours(noon) - 12) * 4) / 4
  return { rise: noonUtc - w + offset, set: noonUtc + w + offset }
}
const smooth = t => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x) }
// How dark it is (0 day .. 1 night) and how warm the light (0..1, around sunrise and
// sunset), with a name for the time of day. Twilight lasts about an hour and a quarter.
export function light(date = new Date()) {
  const h = clockHours(date)
  const { rise, set } = sunTimes(date)
  const TWI = 1.25
  const dark = h < rise ? smooth((rise - h) / TWI) : h > set ? smooth((h - set) / TWI) : 0
  const glow = x => Math.max(0, 1 - Math.abs(x) / 1.1)
  const warm = Math.max(glow(h - rise + 0.15), glow(h - set - 0.15)) * (1 - dark * 0.7)
  const label = dark > 0.85 ? 'night' : h < rise + 0.5 && h < 12 ? 'dawn' : h < 12 ? 'morning' : h < set - 1.5 ? 'afternoon' : h < set + 0.3 ? 'evening' : 'dusk'
  return { dark, warm, rise, set, hours: h, label }
}
export const fmtClock = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`
