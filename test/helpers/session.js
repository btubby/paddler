// Cookies for tests: a Google sign-in session holding the given roles (made-up person)
import { signSessionSync } from '../../netlify/functions/lib/session.js'

export const TEST_SECRET = 'test-session-secret-0123456789'
export function sessionCookie(roles, email = 'test.person@example.com') {
  process.env.SESSION_SECRET = TEST_SECRET
  return 'bscc_session=' + signSessionSync({ e: email, n: 'Test', r: roles, x: Date.now() + 3600e3 }, TEST_SECRET)
}
export const coachCookie = () => sessionCookie(['coach'])
export const coordinatorCookie = () => sessionCookie(['coordinator'])
