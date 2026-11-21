// Reading a paddler's own Strava download (the "archive" Strava emails them: a zip with
// activities.csv inside), in their browser. Nothing is uploaded: the file is read here and
// turned into the same activity summaries the Strava connection gives (lib/strava.js
// trimActivity), so the charts don't mind where the data came from.
//
// The zip can be big (it holds every GPS file they've ever recorded), so only the end of it
// (the list of files) and activities.csv itself are read, never the whole thing.

// ---- zip --------------------------------------------------------------------------------
const u16 = (v, o) => v.getUint16(o, true)
const u32 = (v, o) => v.getUint32(o, true)
const bytes = async (file, from, to) => new DataView(await file.slice(from, to).arrayBuffer())

// the files in a zip: [{ name, method, size, compressed, offset }]
export async function zipEntries(file) {
  // the end-of-directory record is in the last 64 KB (it can have a comment after it)
  const tailFrom = Math.max(0, file.size - 65557)
  const tail = await bytes(file, tailFrom, file.size)
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('This doesn’t look like a zip file')
  let count = u16(tail, eocd + 10)
  let dirSize = u32(tail, eocd + 12)
  let dirAt = u32(tail, eocd + 16)
  // zip64 (archives over 4 GB): the real numbers are in the zip64 record before it
  if (dirAt === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw new Error('Couldn’t read this zip file')
    const at64 = Number(tail.getBigUint64(loc + 8, true))
    const rec = await bytes(file, at64, at64 + 56)
    count = Number(rec.getBigUint64(32, true))
    dirSize = Number(rec.getBigUint64(40, true))
    dirAt = Number(rec.getBigUint64(48, true))
  }
  const dir = await bytes(file, dirAt, dirAt + dirSize)
  const dec = new TextDecoder()
  const out = []
  for (let p = 0, n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (u32(dir, p) !== 0x02014b50) break
    const nameLen = u16(dir, p + 28), extraLen = u16(dir, p + 30), commentLen = u16(dir, p + 32)
    let compressed = u32(dir, p + 20), size = u32(dir, p + 24), offset = u32(dir, p + 42)
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen))
    // zip64 sizes and offset, in the extra field
    for (let e = p + 46 + nameLen, end = e + extraLen; e + 4 <= end;) {
      const id = u16(dir, e), len = u16(dir, e + 2)
      if (id === 1) {
        let q = e + 4
        if (size === 0xffffffff) { size = Number(dir.getBigUint64(q, true)); q += 8 }
        if (compressed === 0xffffffff) { compressed = Number(dir.getBigUint64(q, true)); q += 8 }
        if (offset === 0xffffffff) offset = Number(dir.getBigUint64(q, true))
      }
      e += 4 + len
    }
    out.push({ name, method: u16(dir, p + 10), size, compressed, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// one file from the zip, as text
export async function zipText(file, entry) {
  const head = await bytes(file, entry.offset, entry.offset + 30)
  if (u32(head, 0) !== 0x04034b50) throw new Error('Couldn’t read this zip file')
  const start = entry.offset + 30 + u16(head, 26) + u16(head, 28)
  const raw = file.slice(start, start + entry.compressed)
  if (entry.method === 0) return raw.text()
  if (entry.method !== 8) throw new Error('This zip uses a kind of compression the page can’t read')
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open zip files: unzip it and choose activities.csv instead')
  return new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
}

// ---- csv --------------------------------------------------------------------------------
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(x => x !== ''))
}

// ---- activities.csv ---------------------------------------------------------------------
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
// "Jan 5, 2023, 6:30:12 PM" (or "5 Jan 2023, 18:30:12", or ISO): UTC, as Strava writes them
export function parseStravaDate(s) {
  const t = String(s || '').trim()
  let m = t.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp][Mm])?$/)
  let y, mo, d, h, mi, se, ap
  if (m) [, mo, d, y, h, mi, se, ap] = m
  else if ((m = t.match(/^(\d{1,2}) ([A-Za-z]{3})[a-z]*\.? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))? ?([AaPp][Mm])?$/))) [, d, mo, y, h, mi, se, ap] = m
  else { const iso = Date.parse(t); return isNaN(iso) ? null : iso }
  const month = MONTHS[mo.toLowerCase()]
  if (month == null) return null
  let hour = +h
  if (ap) hour = (hour % 12) + (/p/i.test(ap) ? 12 : 0)
  return Date.UTC(+y, month, +d, hour, +mi, +(se || 0))
}

// the export's names for activity types ("Weight Training") to the API's ("WeightTraining")
const TYPE_NAMES = { canoe: 'Canoeing', canoeing: 'Canoeing', hiit: 'HighIntensityIntervalTraining', 'e-bike ride': 'EBikeRide', 'stair-stepper': 'StairStepper', 'stand up paddling': 'StandUpPaddling', 'virtual row': 'VirtualRow' }
export const typeFromExport = s => TYPE_NAMES[String(s).trim().toLowerCase()] || String(s).replace(/[^A-Za-z]/g, '') || 'Workout'

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/,/g, ''))
  return isFinite(n) ? n : undefined
}

// activities.csv -> [{ id, name, type, date, at, distance (m), moving (s), speed (m/s), ... }]
// Some column names appear twice: early on in the athlete's own units (km or miles, as text),
// and later in metres, seconds and m/s. The later ones are used.
export function activitiesFromCsv(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (rows.length < 1) throw new Error('activities.csv is empty')
  const head = rows[0].map(h => h.trim().toLowerCase())
  if (!head.includes('activity id') || !head.includes('activity date')) throw new Error('This isn’t Strava’s activities.csv')
  const col = name => head.lastIndexOf(name)
  const first = name => head.indexOf(name)
  const C = {
    id: first('activity id'), date: first('activity date'), name: first('activity name'), type: first('activity type'),
    elapsed: col('elapsed time'), moving: col('moving time'), distance: col('distance'), maxSpeed: col('max speed'),
    speed: col('average speed'), climb: col('elevation gain'), hr: col('average heart rate'), maxHr: col('max heart rate'),
    watts: col('average watts'), trainer: col('trainer')
  }
  const twoDistances = first('distance') !== col('distance')
  const out = []
  for (const r of rows.slice(1)) {
    const at = parseStravaDate(r[C.date])
    if (!r[C.id] || at == null) continue
    const moving = num(r[C.moving]) ?? num(r[C.elapsed]) ?? 0
    let distance = twoDistances ? num(r[C.distance]) : undefined
    let speed = num(r[C.speed])
    // only the athlete's-units distance: work it out from the speed if there is one
    if (distance == null) distance = speed && moving ? speed * moving : 0
    if (!speed && distance && moving) speed = distance / moving
    const hr = num(r[C.hr])
    out.push({
      id: String(r[C.id]).trim(),
      name: String(r[C.name] ?? '').slice(0, 80),
      type: typeFromExport(r[C.type]),
      date: new Date(at).toISOString().slice(0, 19),
      at: Math.floor(at / 1000),
      distance: +distance.toFixed(1),
      moving: Math.round(moving),
      elapsed: num(r[C.elapsed]),
      climb: num(r[C.climb]),
      speed: speed ? +speed.toFixed(3) : undefined,
      maxSpeed: num(r[C.maxSpeed]),
      hr: hr || undefined,
      maxHr: num(r[C.maxHr]) || undefined,
      watts: num(r[C.watts]) || undefined,
      trainer: C.trainer >= 0 && /^(1|true|yes)$/i.test(String(r[C.trainer]).trim()) ? true : undefined
    })
  }
  return out.sort((a, b) => a.at - b.at)
}

// a dropped file: the zip Strava sent, or activities.csv on its own (Safari, and some
// computers, unzip downloads into a folder by themselves) -> { activities, name }
export async function readStravaFile(file) {
  if (/\.csv$/i.test(file.name)) return { activities: activitiesFromCsv(await file.text()), name: '' }
  const entries = await zipEntries(file)
  const acts = entries.find(e => /(^|\/)activities\.csv$/i.test(e.name))
  if (!acts) throw new Error('There’s no activities.csv in this zip: is it the archive Strava emailed?')
  const activities = activitiesFromCsv(await zipText(file, acts))
  // their name, from profile.csv (nothing else from it: it also has their email)
  let name = ''
  const prof = entries.find(e => /(^|\/)profile\.csv$/i.test(e.name))
  if (prof && prof.size < 200000) {
    try {
      const [h, r] = parseCsv(await zipText(file, prof))
      const at = k => h.findIndex(x => x.trim().toLowerCase() === k)
      name = [r?.[at('first name')], r?.[at('last name')]].filter(Boolean).join(' ').slice(0, 80)
    } catch {}
  }
  return { activities, name }
}
