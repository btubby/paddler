import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { linesFromPages, parseResults, entriesOf, nameKeys, readName, seconds, resultPages } from '../netlify/functions/lib/sprint.js'
import { pdfLinks } from '../netlify/functions/sprint-index.js'
import { sprintFor } from '../netlify/functions/crews.js'

const fixture = n => JSON.parse(fs.readFileSync(new URL(`./fixtures/${n}.items.json`, import.meta.url), 'utf8'))
const read = n => { const pages = resultPages(fixture(n)); const { races, skipped } = parseResults(linesFromPages(pages)); return { races, skipped, entries: entriesOf(races, n) } }

test('sprint: names are matched on first initial and surname, whatever the OCR did', () => {
  assert.deepEqual(nameKeys('Cathy Redeker'), ['c|redeker'])
  assert.ok(nameKeys('Sally Sanderson-Bellamy').includes('s|sandersonbellamy'))
  assert.ok(nameKeys('Mary Jane Smith').includes('m|smith'))
  assert.equal(readName('LSmith').text, 'L Smith')
  assert.equal(readName('0 Jackson').text, 'O Jackson')
  assert.deepEqual(readName('R Lucas (RIC)'), { text: 'R Lucas', club: 'RIC' })
  assert.equal(readName('J Russell NOT)').club, 'NOT')
  assert.equal(seconds('1:03.97'), 63.97)
  assert.equal(seconds('21 :51.45'), 1311.45)
  assert.equal(seconds('54.63'), 54.63)
})

test('sprint: the 2025 Masters regatta page is read (columns, K2 and K4 crews, odd OCR)', () => {
  const { races, entries, skipped } = read('UKSP2025-05')
  assert.ok(races.length > 40 && skipped.length < 40, `${races.length} races, ${skipped.length} unread lines`)
  const mine = entries.filter(e => e.club === 'BSF' && e.name === 'C Redeker')
  const k1 = mine.find(e => e.event === 'WMasters O34-64 K1 200m F' || /K1 200m F$/.test(e.event))
  assert.ok(k1, 'Redeker K1 200m final')
  assert.equal(k1.pos, 2)
  assert.equal(k1.time, '1:03.97')
  // a K2 (two clubs, "BSF/BSF") and the K4 whose names run over two lines
  const k2 = mine.find(e => /Mixed K2/.test(e.event))
  assert.deepEqual([k2.pos, k2.time, k2.with], [1, '2:31.48', ['B Tubby']])
  const k4 = mine.find(e => /K4/.test(e.event))
  assert.equal(k4.time, '2:38.05')
  assert.equal(k4.with.length, 3)
  assert.ok(k4.with.includes('K Queeney') && k4.with.includes('S Alexander'))
  // somebody who did not finish
  assert.ok(entries.some(e => e.status === 'DNF' || e.status === 'DSQ'))
})

test('sprint: the 2023 regatta page is read (three columns, bracketed clubs, partners on the next line)', () => {
  const { entries } = read('UKSP2023-04')
  const w = entries.filter(e => e.club === 'BSF' && e.name === 'R Winstanley')
  assert.ok(w.some(e => /K1 1000m F$/.test(e.event) && e.pos === 2 && e.time === '4:16.29'))
  // a partner from another club, on the line after
  const e = entries.find(e => e.name === 'S Bristow' && /K2/.test(e.event))
  assert.ok(e && e.with.includes('J Eccles') && e.club === 'ROY')
  assert.ok(entries.some(x => x.name === 'J Eccles' && x.club === 'ANK' && x.with.includes('S Bristow')))
})

test('sprint: the links to the PDFs are found on a year page', () => {
  const html = '<a href="https://canoeingresults.com/wp-content/uploads/2026/10/UKSP2025-05.pdf">31 May-1 June 2025</a><a href="/x/UKSP2025-07.pdf">July</a><a href="/other.pdf">no</a><a href="/x/UKSP2025-07.pdf">dup</a>'
  const l = pdfLinks(html, 'https://canoeingresults.com/a/')
  assert.deepEqual(l.map(x => x.id), ['UKSP2025-05', 'UKSP2025-07'])
  assert.equal(l[1].url, 'https://canoeingresults.com/x/UKSP2025-07.pdf')
})

test('sprint: a paddler gets their own entries, and is told when another paddler at the club shares the initial and surname', async () => {
  const files = new Map()
  const st = { get: async k => files.get(k) ?? null, setJSON: async (k, v) => { files.set(k, v) } }
  assert.deepEqual(await sprintFor(st, 'cathy redeker|BSF'), { indexed: false, entries: [] })
  const { entries } = read('UKSP2025-05')
  files.set('sprint-index', { at: 1, regattas: [{ id: 'UKSP2025-05', year: 2025, title: '31 May-1 June 2025' }] })
  files.set('sprint-club-BSF', { entries: entries.filter(e => e.club === 'BSF') })
  files.set('people-index', { people: { 'cathy redeker|BSF': { name: 'Cathy Redeker', names: ['Cathy Redeker'], club: 'BSF' } } })
  const r = await sprintFor(st, 'cathy redeker|BSF')
  assert.ok(r.entries.length >= 3 && r.entries.every(e => e.regatta === 'UKSP2025-05'))
  assert.equal(r.ambiguous, 0)
  assert.ok(!r.entries.some(e => e.keys))
  files.get('people-index').people['christine redeker|BSF'] = { name: 'Christine Redeker', names: ['Christine Redeker'], club: 'BSF' }
  assert.equal((await sprintFor(st, 'cathy redeker|BSF')).ambiguous, 1)
})
