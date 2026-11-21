// GET /api/whoami: what this browser is signed in as, so the site menu can leave out the pages the
// visitor can't open and say "Logged in as ...": { coach, coordinator, admin, email, name, googleClientId }.
// `email` and `name` (their first name, from Google) are only there for a Google sign-in; googleClientId (public) is for the sign-in button.
import { signedInAs } from './lib/access.js'
import { sessionOf, sessionAllows } from './lib/session.js'

export default async req => {
  const session = sessionOf(req)
  return new Response(JSON.stringify({
    coach: signedInAs(req, 'coach'), coordinator: signedInAs(req, 'coordinator'),
    admin: sessionAllows(session, 'admin'), email: session?.email || '', name: session?.name || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID && process.env.SESSION_SECRET ? process.env.GOOGLE_CLIENT_ID : ''
  }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })
}

export const config = { path: '/api/whoami' }
