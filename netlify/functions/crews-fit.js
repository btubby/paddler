// POST /api/crews-fit?club=BSF: works out the crew ratings and the paddler pages' results
// (crews.js computeRatings) in the background. Reading every race kept since 2010 and
// fitting everyone's speed takes longer than an ordinary call may run on Netlify (about 10
// seconds), so /api/crews starts this and the pages ask again until the ratings are saved.
// Background functions answer 202 straight away and may run for up to 15 minutes.
// Only for coaches and the race coordinator (the cookie /api/crews passes on), or the server
// itself when a paddler has merged their own results (x-fit-token).
import { signedInAs } from './lib/access.js'
import { computeRatings, currentBasis, openStore } from './crews.js'
import { fitToken } from './lib/share.js'
import { sameToken } from './lib/members.js'

export default async (req) => {
  const internal = fitToken() && sameToken(req.headers.get('x-fit-token') || '', fitToken()) // from /api/paddler-merge
  if (!internal && !signedInAs(req, 'coach') && !signedInAs(req, 'coordinator')) {
    console.log('[crews-fit] not signed in: nothing done')
    return
  }
  const club = String(new URL(req.url).searchParams.get('club') || '').trim().toUpperCase()
  if (!/^[A-Z]{2,5}$/.test(club)) return
  const now = Date.now()
  try {
    const st = await openStore()
    const basis = await currentBasis(st, now)
    if (!basis) return console.log('[crews-fit] no races kept yet')
    await computeRatings(st, club, basis, now)
    await st.setJSON(`fitting-${club}`, { basis, at: now, done: Date.now() })
  } catch (err) {
    console.log('[crews-fit] failed:', err?.stack || err)
  }
}

export const config = { path: '/api/crews-fit', background: true }
