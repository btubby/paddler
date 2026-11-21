// The gate for the pages that aren't public (runs on Netlify before the page is served): the
// visitor must be signed in with Google (the `bscc_session` cookie: lib/session.js) with the
// role the page needs, or be an admin. Anyone else is sent to the homepage, where the menu bar
// opens the "Sign in with Google" box and says why; after signing in they are taken back to
// the page they asked for (see src/shared/SiteNav.vue).
//   /?signin=signin&next=/paddlers/       not signed in
//   /?signin=norole&need=coach&next=...   signed in, but the account doesn't have the role
// <page>/?leave signs out (clears the session cookie; the old password cookies from before
// Google sign-in are cleared too) and goes to the homepage.
import { readSession, sessionAllows, SESSION_COOKIE, clearSessionCookie } from './session.js'

const OLD_COOKIES = ['bscc_coaching_page', 'bscc_race_planner']

function redirect(to, extraCookies = []) {
  const res = new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store' } })
  for (const c of extraCookies) res.headers.append('Set-Cookie', c)
  return res
}

// role: 'coach' or 'coordinator' (an admin may open both)
export function roleGate({ role }) {
  return async (request, context) => {
    const secret = globalThis.Netlify?.env?.get('SESSION_SECRET')
    const url = new URL(request.url)
    const secure = url.protocol === 'https:'
    if (url.searchParams.has('leave')) {
      const old = OLD_COOKIES.flatMap(n => ['/', '/coaching-groups'].map(p => `${n}=; Path=${p}; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`))
      return redirect('/?signedout=1', [clearSessionCookie(secure), ...old])
    }
    const session = secret ? await readSession(context.cookies.get(SESSION_COOKIE), secret) : null
    if (sessionAllows(session, role)) return context.next()
    const next = encodeURIComponent(url.pathname + url.search)
    return redirect(`/?signin=${session ? 'norole' : 'signin'}&need=${role}&next=${next}`)
  }
}
