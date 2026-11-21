// The star awards record (the club's assessment book, on the site): who was assessed, when, by whom,
// for which award. Coaches only (the coach role, or admin). Kept in the "bscc-awards" Netlify Blobs
// store as one list, { rev, records }.
//   GET    /api/awards                 -> { records }  (newest first)
//   POST   /api/awards                 { date, paddler, assessor, award, memberId? } -> { records }
//   PUT    /api/awards                 { id, date, paddler, assessor, award, memberId? } -> { records }
//   DELETE /api/awards?id=...          -> { records }
// Every record notes who added it (their Google email) and when. Never cached, never public.
import { signedInAs } from './lib/access.js'
import { sessionOf } from './lib/session.js'
import { cleanRecord, isDuplicate, newId, sortRecords, MAX_RECORDS } from './lib/awards.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })

import { openAwardsStore, useAwardsStore } from './lib/awardstore.js'
export const _useStore = s => useAwardsStore(s)
const openStore = openAwardsStore

export default async req => {
  if (!signedInAs(req, 'coach')) return json({ error: 'Not signed in: sign in with Google as a coach' }, 401)
  const url = new URL(req.url)
  const store = await openStore()
  const data = (await store.get('records', { type: 'json' })) || { rev: 0, records: [] }
  const records = Array.isArray(data.records) ? data.records : []
  const save = async list => {
    await store.setJSON('records', { rev: (data.rev || 0) + 1, records: list })
    return json({ records: sortRecords(list) })
  }
  const who = sessionOf(req)?.email || ''

  if (req.method === 'GET') return json({ records: sortRecords(records) })

  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id') || ''
    if (!records.some(r => r.id === id)) return json({ error: 'That entry is not in the record any more' }, 404)
    return save(records.filter(r => r.id !== id))
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    let body
    try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
    const rec = cleanRecord(body)
    if (rec.error) return json({ error: rec.error }, 400)
    if (req.method === 'POST') {
      if (records.length >= MAX_RECORDS) return json({ error: 'The record is full' }, 413)
      if (isDuplicate(records, rec)) return json({ error: 'That assessment is already in the record' }, 409)
      return save([...records, { id: newId(), ...rec, addedBy: who, at: new Date().toISOString() }])
    }
    const old = records.find(r => r.id === body.id)
    if (!old) return json({ error: 'That entry is not in the record any more' }, 404)
    if (isDuplicate(records, rec, old.id)) return json({ error: 'That assessment is already in the record' }, 409)
    return save(records.map(r => (r.id === old.id ? { ...old, ...rec, editedBy: who, editedAt: new Date().toISOString() } : r)))
  }
  return json({ error: 'Not found' }, 404)
}

export const config = { path: '/api/awards' }
