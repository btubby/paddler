// npm run sync-members                 member list only
// npm run sync-members -- --photos     member list and photos
// npm run sync-members -- --dry-run    fetch from MemberMojo, upload nothing
// npm run sync-members -- --check      compare MemberMojo's directory with the live site, change nothing
//
// Run on your own computer. MemberMojo (behind Cloudflare) blocks sign-ins from cloud
// servers like Netlify's, but allows them from a home connection. This signs in to
// MemberMojo using the same code as netlify/functions/members.js, then uploads the
// member list (and photos) to the live site, which serves them to coaches from there.
//
// Needs in .env: MEMBERMOJO_EMAIL, MEMBERMOJO_PASSWORD,
//                SYNC_TOKEN and SYNC_SITE_URL (e.g. https://your-site.netlify.app)
process.env.MEMBERS_SOURCE = 'live' // this process talks to MemberMojo directly
const args = new Set(process.argv.slice(2))
const check = args.has('--check')
if (check) process.env.MEMBERS_PROFILES = 'off' // the check needs names only: one sign-in, no profile pages
const { default: handler } = await import('../netlify/functions/members.js')

const dryRun = args.has('--dry-run') || check
const withPhotos = args.has('--photos')
const need = k => {
  if (!process.env[k]) { console.error(`✗ ${k} is missing from .env`); process.exit(1) }
  return process.env[k]
}
need('MEMBERMOJO_EMAIL'); need('MEMBERMOJO_PASSWORD')
const site = dryRun && !check ? '' : need('SYNC_SITE_URL').replace(/\/$/, '')
const syncToken = need('SYNC_TOKEN') // also lets this script read the member list
if (site && /(^|\/\/)app\.netlify\.com/i.test(site)) {
  const name = (site.match(/\/(?:projects|sites)\/([^/?#]+)/) || [])[1]
  console.error(`✗ SYNC_SITE_URL is the Netlify dashboard (${site}), not your site.`)
  console.error(`  Use the address you open the app at${name ? `, probably https://${name}.netlify.app` : ', e.g. https://your-site.netlify.app'}`)
  process.exit(1)
}

// call the members function in this process (no server needed)
async function local(path) {
  const res = await handler(new Request('http://local' + path, { headers: { 'x-sync-token': syncToken } }))
  const data = await res.json()
  if (!res.ok) throw new Error(`${data.error || 'HTTP ' + res.status}${data.step ? ' [' + data.step + ']' : ''}`)
  return data
}
async function upload(path, body) {
  const res = await fetch(site + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-token': syncToken },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${site}${path}: HTTP ${res.status} ${data.error || ''}`)
  return data
}

// --check: is every member in MemberMojo's directory on the live site, and nobody extra?
async function runCheck() {
  console.log('→ Reading the member directory from MemberMojo…')
  const mojo = await local('/api/members?fresh=1')
  console.log(`✓ MemberMojo directory: ${mojo.count} members`)
  console.log(`→ Reading the member list from ${site}…`)
  const res = await fetch(site + '/api/members', { headers: { 'x-sync-token': syncToken } })
  const live = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${site}/api/members: HTTP ${res.status} ${live.error || ''}`)
  const when = live.fetchedAt ? new Date(live.fetchedAt).toLocaleString('en-GB') : '?'
  console.log(`✓ Live site: ${live.count} members (from MemberMojo on ${when}${live.source ? ', source: ' + live.source : ''})`)
  const liveIds = new Map(live.members.map(m => [m.id, m]))
  const mojoIds = new Map(mojo.members.map(m => [m.id, m]))
  const missing = mojo.members.filter(m => !liveIds.has(m.id))
  const extra = live.members.filter(m => !mojoIds.has(m.id))
  const renamed = mojo.members.filter(m => liveIds.has(m.id) && liveIds.get(m.id).name !== m.name)
  const photos = live.members.filter(m => m.photo).length
  console.log(`  coaches ${live.members.filter(m => m.coach).length}, volunteers (start hidden) ${live.members.filter(m => m.volunteer).length}, under 18 ${live.members.filter(m => m.junior).length}, photo consent ${photos}`)
  if (!missing.length && !extra.length && !renamed.length) {
    console.log('✓ All members in MemberMojo\'s directory are on the live site, and nobody else.')
    return
  }
  if (missing.length) console.log(`✗ In MemberMojo but not on the site (${missing.length}): ${missing.map(m => m.name).join(', ')}`)
  if (extra.length) console.log(`✗ On the site but no longer in MemberMojo (${extra.length}): ${extra.map(m => m.name).join(', ')}`)
  if (renamed.length) console.log(`✗ Name changed in MemberMojo (${renamed.length}): ${renamed.map(m => `${liveIds.get(m.id).name} → ${m.name}`).join(', ')}`)
  console.log('  Run `npm run sync-members -- --photos` to bring the site up to date.')
  process.exitCode = 2
}

if (check) {
  try { await runCheck() } catch (err) { console.error('\n✗ Check failed:', err.message); process.exit(1) }
  process.exit(process.exitCode || 0)
}

try {
  console.log('→ Signing in to MemberMojo and reading the member directory…')
  const list = await local('/api/members?fresh=1')
  const withConsent = list.members.filter(m => m.photo)
  console.log(`✓ ${list.count} members read from MemberMojo (${list.members.filter(m => m.coach).length} coaches, ${list.members.filter(m => m.volunteer).length} volunteers, ${list.members.filter(m => m.junior).length} under 18, ${withConsent.length} with photo consent)`)

  let photos = {}
  if (withPhotos) {
    const ids = withConsent.map(m => m.id) // photos only for members who consented
    for (let i = 0; i < ids.length; i += 40) {
      const chunk = ids.slice(i, i + 40)
      Object.assign(photos, (await local('/api/members/photos?ids=' + chunk.join(','))).photos)
      process.stdout.write(`\r→ Photos fetched: ${Math.min(i + 40, ids.length)}/${ids.length}`)
    }
    console.log(`\n✓ ${Object.values(photos).filter(Boolean).length} of ${ids.length} consenting members have a photo`)
  }

  if (dryRun) {
    console.log('Dry run: nothing uploaded. First few names:', list.members.slice(0, 3).map(m => m.name).join(', '))
    process.exit(0)
  }

  console.log(`→ Uploading the member list to ${site}…`)
  const r = await upload('/api/members/upload', { fetchedAt: list.fetchedAt, members: list.members })
  console.log(`✓ Uploaded ${r.count} members${r.photosDeleted ? ` (deleted ${r.photosDeleted} photo(s) of leavers or members without consent)` : ''}`)

  if (withPhotos && Object.keys(photos).length) {
    const entries = Object.entries(photos)
    for (let i = 0; i < entries.length; i += 15) {
      await upload('/api/members/upload-photos', { photos: Object.fromEntries(entries.slice(i, i + 15)) })
      process.stdout.write(`\r→ Photos uploaded: ${Math.min(i + 15, entries.length)}/${entries.length}`)
    }
    console.log('\n✓ Photos uploaded')
  }
  console.log('Done. Coaches will see the new list next time they open or refresh the app.')
} catch (err) {
  console.error('\n✗ Sync failed:', err.message)
  process.exit(1)
}
