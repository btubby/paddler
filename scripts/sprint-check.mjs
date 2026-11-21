// node scripts/sprint-check.mjs UKSP2025-05.pdf [CLUB]
// Reads a National Sprint Regatta results PDF the same way the app does (sprint-index.js) and says
// what it found: how many races and entries, the lines it could not read, and a club's entries.
// Run it on a PDF or two after `npm install` to check the reading before relying on the index.
import fs from 'node:fs'
import { pdfPages } from '../netlify/functions/lib/sprintpdf.js'
import { resultPages, linesFromPages, parseResults, entriesOf } from '../netlify/functions/lib/sprint.js'

const [file, club = 'BSF'] = process.argv.slice(2)
if (!file) { console.log('usage: node scripts/sprint-check.mjs file.pdf [CLUB]'); process.exit(1) }
const all = await pdfPages(fs.readFileSync(file))
const pages = resultPages(all)
const { races, skipped } = parseResults(linesFromPages(pages))
const entries = entriesOf(races, file)
console.log(`${all.length} pages, ${pages.length} of results, ${races.length} races, ${races.reduce((n, r) => n + r.rows.length, 0)} rows, ${entries.length} entries, ${skipped.length} lines not read`)
for (const e of entries.filter(e => e.club === club.toUpperCase())) console.log(`${e.name.padEnd(20)} ${e.event.padEnd(42)} ${String(e.pos ?? '').padStart(2)}  ${e.time || e.status || ''}  ${e.with.join(' / ')}`)
if (skipped.length) console.log('\nNot read:\n' + skipped.slice(0, 40).join('\n'))
