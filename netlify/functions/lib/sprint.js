// National sprint regatta results (canoeingresults.com): turns the text of the results PDFs into
// rows, and matches the names in them ("C Redeker", club BSF) to the paddlers of this app.
//
// The PDFs are scanned and run through OCR, so the text is full of slips ("Kl" for K1, "lO00m" for
// 1000m, "21 :51.45", "I" or "\" between crew members): everything here is forgiving. Pure
// functions only: reading the PDF itself is lib/sprintpdf.js, fetching them is sprint-index.js.

// ---- from pieces of text with positions to lines, in reading order ----
// pages: [{ w, items: [{ x, y, str }] }]  (a piece may be a word or a few words)
const cluster = (xs, tol) => {
  const out = []
  for (const x of [...xs].sort((a, b) => a - b)) {
    const last = out[out.length - 1]
    if (last && x - last.sum / last.n <= tol) { last.sum += x; last.n++ } else out.push({ sum: x, n: 1 })
  }
  return out.map(c => ({ x: c.sum / c.n, n: c.n }))
}
// the pages that hold the results (not the notes, medal list, promotions or penalty points)
export const resultPages = pages => pages.filter(p => p.items.some(i => /\bOFFICIAL\b/.test(i.str)))
// where the columns start: the "Class:" headings always sit at a column's left edge
export function columnEdges(pages) {
  const xs = []
  for (const p of pages) for (const it of p.items) if (/^Class:/i.test(it.str.trim())) xs.push(it.x)
  const edges = cluster(xs, 12).filter(c => c.n >= 2).map(c => c.x)
  return edges.length ? edges : [0]
}
export function linesFromPages(pages, edges = columnEdges(pages)) {
  const lines = []
  for (const p of pages) {
    const cols = edges.map(() => [])
    for (const it of p.items) {
      let c = 0
      for (let i = 0; i < edges.length; i++) if (it.x + 6 >= edges[i]) c = i
      cols[c].push(it)
    }
    for (const col of cols) {
      const rows = []
      for (const it of col.sort((a, b) => a.y - b.y || a.x - b.x)) {
        const r = rows.find(r => Math.abs(r.y - it.y) <= 2.5)
        if (r) r.items.push(it)
        else rows.push({ y: it.y, items: [it] })
      }
      for (const r of rows.sort((a, b) => a.y - b.y)) lines.push(r.items.sort((a, b) => a.x - b.x).map(i => i.str.trim()).filter(Boolean).join(' '))
    }
  }
  return lines
}

// ---- reading the lines ----
const STAGE = '(?:F\\d?|H[\\dJ]|SF\\d?|S\\d|Q\\d|B?F|Final|[A-C]F)'
// "37 WMasters O34-64 K1 200m F", "118 WMasters O34-64 K11000m F", "1 WMasters O34-64 K2 1 000m F"
const HEADER = new RegExp(`^(\\d{1,3})\\s+(.+?)\\s+([0-9lIOoSs][0-9lIOoSs ]*\\s?m)\\s+(${STAGE})$`)
const HEADER_GLUED = new RegExp(`^(\\d{1,3})\\s+(.+?[KCV]\\d)([0-9lIOoSs]{3,4}\\s?m)\\s+(${STAGE})$`)
const TIME = /^(?:(\d{1,2})\s?:\s?)?(\d{1,2})\s?\.\s?(\d{2})$/
const STATUS = /^(DNS|DNF|DSQ|DQ|NS|RTD|WD|DNQ|ERR)$/i
const metres = s => {
  const t = s.replace(/\s+/g, '').replace(/m$/i, '').replace(/[lI]/g, '1').replace(/[Oo]/g, '0').replace(/[Ss]/g, '5')
  const n = Number(t)
  return [100, 200, 500, 1000, 2000, 5000, 10000].includes(n) ? n : n || 0
}
// "1:03.97" -> seconds (63.97), or null
export function seconds(str) {
  const t = String(str || '').replace(/[lI]/g, '1').replace(/[Oo]/g, '0').replace(/\s+/g, '').replace(/,/g, '.')
  const m = t.match(/^(?:(\d{1,2}):)?(\d{1,2})\.(\d{2})$/)
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) + Number(m[3]) / 100 : null
}
const timeText = t => t.replace(/\s+/g, '').replace(/[lI]/g, '1').replace(/[Oo]/g, '0')

// a name as printed ("C Redeker", "LSmith", "Miklos Szabadvari", "D O Drisceoil", "R Lucas (RIC)")
export function readName(raw) {
  let s = raw.replace(/\s+/g, ' ').trim()
  let club = ''
  const b = s.match(/[({]?\b([A-Za-z]{2,4})[)}]\s*$/)
  if (b) { club = b[1].toUpperCase(); s = s.slice(0, b.index).trim() }
  s = s.replace(/^[^A-Za-z0-9]+|[^A-Za-z.'\- ]+$/g, '').trim()
  const glued = s.match(/^([A-Z])([A-Z][a-z'\-].*)$/) // "LSmith", "WShort"
  if (glued) s = `${glued[1]} ${glued[2]}`
  s = s.replace(/\s+[Il]$/, '') // (a separator left on the end)
  s = s.replace(/^0 /, 'O ') // "0 Jackson" (OCR) is O
  return { text: s, club }
}
// the same person written two ways: first initial + surname, nothing but the letters
const letters = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '')
export function nameKeys(full) {
  const parts = String(full || '').replace(/\./g, ' ').split(/\s+/).filter(Boolean)
  if (parts.length < 2) return []
  const initial = letters(parts[0])[0]
  if (!initial) return []
  const rest = parts.slice(1)
  const keys = new Set([letters(rest.join(''))])
  keys.add(letters(rest[rest.length - 1])) // "Mary Jane Smith" is "M Smith"
  if (rest.length > 2) keys.add(letters(rest.slice(-2).join('')))
  return [...keys].filter(k => k.length >= 2).map(k => `${initial}|${k}`)
}

const isClub = tok => /^(?:[A-Za-z]{2,4}|\d[A-Za-z]{2})$/.test(tok) // (some club codes start with a digit: 4AS)
const isClubs = tok => tok.split('/').every(isClub)
const isBib = tok => /^\d{1,2}$|^[A-Z]{1,2}\d{1,3}$|^\d{1,2}\/[A-Z]\d+$|^\d{1,2}[A-Z]{1,2}\d{1,3}$/.test(tok)
const splitCrew = s => s.split(/\s*[\\/|]\s*|\s+I\s+(?=[A-Z])|\s+l\s+(?=[A-Z])/).map(x => x.trim()).filter(Boolean)

// one results line -> { pos, lane, clubs, names, time } or null
function readRow(line) {
  const toks = line.split(' ')
  // the time (or DNS/DNF/DSQ) at the end, possibly "1 :05.42" or "21 :51.45"
  let time = null
  let status = null
  let end = toks.length
  const last = toks[end - 1]
  if (STATUS.test(last)) { status = last.toUpperCase(); end-- }
  else {
    const strict = t => TIME.test(timeText(t))
    if (strict(toks[end - 1])) { time = timeText(toks[end - 1]); end-- }
    else if (end >= 2 && /^:/.test(toks[end - 1]) && strict(toks[end - 2] + toks[end - 1])) { time = timeText(toks[end - 2] + toks[end - 1]); end -= 2 } // "21 :51.45"
    if (!time) return null
  }
  const head = toks.slice(0, end)
  let i = 0
  let pos = null
  let lane = null
  // leading numbers: "1 6 NOT" (place, lane), "6 RLS ... DNS" (lane only), "2 CW17 ANK" (place, bib), "W72 ELM" (bib)
  let j = 1
  while (j <= 3 && !(j < head.length && isClubs(head[j]) && head.slice(0, j).every(isBib))) j++
  if (j > 3) return null
  const nums = head.slice(0, j)
  i = j
  if (nums.length === 1) { // "1CW15" is place 1, bib CW15
    const g = nums[0].match(/^(\d)([A-Z]{1,2}\d{1,3})$/)
    if (g) { nums[0] = g[1]; nums.push(g[2]) }
  }
  if (nums.length >= 2) { pos = Number(nums[0]); lane = nums[1] }
  else if (status) lane = nums[0]
  else if (/^\d{1,2}$/.test(nums[0])) pos = Number(nums[0])
  else lane = nums[0]
  if (!isClubs(head[i] || '')) return null
  const clubs = head[i++].toUpperCase().split('/')
  const namesText = head.slice(i).join(' ')
  if (!namesText && !status) return null
  const names = splitCrew(namesText).map(readName).filter(n => n.text)
  return { pos, lane, clubs, names, time: time ? time : null, seconds: time ? seconds(time) : null, status }
}
// a continuation of a crew's names on the next line ("B Sirrell I S Walsh")
const fixZero = line => line.replace(/(^|[\\ ])0(?= [A-Z])/g, '$1O')
const nameOnly = line => {
  const t = line.replace(/[({]?\b[A-Za-z]{2,4}[)}]/g, '').replace(/[\\\/|I]\s*$/, '').trim()
  return !!t && !/\d/.test(t) && /^[A-Z]/.test(t) && /^[A-Za-z'\- \\\/|]+$/.test(t) && !/^(Class|Issue|Page|Race|Men|Women|Boys|Girls)\b/.test(t) && t.split(' ').length <= 9
}

export function parseResults(lines) {
  const races = []
  const skipped = []
  let cls = ''
  let race = null
  let row = null
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const c = line.match(/^Class:\s*(.+)$/i)
    if (c) { cls = c[1].trim(); race = null; row = null; continue }
    let h = line.match(HEADER_GLUED) || line.match(HEADER)
    if (h) {
      const title = h[2].replace(/\s+/g, ' ').trim().replace(/\b0(\d{2}-\d{2})/g, 'O$1') // ("O34-64" is over 34: OCR reads the O as 0)
      const boat = title.match(/\b[KCV](\d)\b/)
      race = { no: Number(h[1]), crew: boat ? Number(boat[1]) : 1, class: cls, title, event: `${title} ${metres(h[3])}m ${h[4]}`, metres: metres(h[3]), stage: h[4], rows: [] }
      races.push(race)
      row = null
      continue
    }
    if (!race) continue
    const r = readRow(line)
    if (r) { row = r; race.rows.push(r); continue }
    if (row && row.names.length < (race.crew || 4) && nameOnly(fixZero(line))) { row.names.push(...splitCrew(fixZero(line)).map(readName).filter(n => n.text)); continue }
    if (!/Issue:|Page \d|©|OFFICIAL|National|Sprint|Regatta|^\W*$/i.test(line)) skipped.push(line)
  }
  return { races, skipped }
}

// everyone in a regatta's results, one entry per paddler per race, by club
export function entriesOf(races, regatta) {
  const out = []
  for (const race of races) {
    for (const r of race.rows) {
      r.names.forEach((n, i) => {
        const club = (n.club || r.clubs[i] || r.clubs[0] || '').toUpperCase()
        if (!club) return
        const keys = nameKeys(n.text)
        if (!keys.length) return
        out.push({
          club, keys, name: n.text,
          regatta, race: race.no, class: race.class, event: race.event, metres: race.metres, stage: race.stage,
          pos: r.pos, lane: r.lane, time: r.time, seconds: r.seconds, status: r.status,
          with: r.names.filter((_, j) => j !== i).map(x => x.text)
        })
      })
    }
  }
  return out
}
