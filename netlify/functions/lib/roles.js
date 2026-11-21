// Who has which role. A table of email address -> roles, kept by an admin on the roles page
// (/roles/) and stored in the "bscc-roles" Netlify Blobs store. ADMIN_EMAILS (a comma-separated
// list in the server's settings) are always admins, so there is always someone who can open the
// roles page, even before anything has been saved.
//
// Roles: coach (the coaches' pages), coordinator (the race planner) and admin (manages roles,
// and may do everything). Pure functions here; the store is passed in (a tiny { get, setJSON }).
import { ROLE_NAMES } from './session.js'

export const normaliseEmail = e => String(e || '').trim().toLowerCase()
export const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 160

export const adminEmails = (env = process.env) => String(env.ADMIN_EMAILS || '').split(/[,;\s]+/).map(normaliseEmail).filter(Boolean)

// table: { 'a@b.com': { roles: ['coach'], addedBy, at } }
export function rolesFor(email, table, admins = adminEmails()) {
  const e = normaliseEmail(email)
  const set = new Set((table?.[e]?.roles || []).filter(r => ROLE_NAMES.includes(r)))
  if (admins.includes(e)) set.add('admin')
  return ROLE_NAMES.filter(r => set.has(r))
}

export async function readTable(store) {
  const t = await store.get('roles', { type: 'json' })
  return t && typeof t === 'object' ? t : {}
}

// roles: the full list for that person ([] removes them). Returns the new table.
export async function setRoles(store, email, roles, by) {
  const e = normaliseEmail(email)
  if (!validEmail(e)) throw new Error('That is not an email address')
  const clean = ROLE_NAMES.filter(r => (roles || []).includes(r))
  const table = await readTable(store)
  if (clean.length) table[e] = { roles: clean, addedBy: normaliseEmail(by), at: new Date().toISOString() }
  else delete table[e]
  await store.setJSON('roles', table)
  return table
}
