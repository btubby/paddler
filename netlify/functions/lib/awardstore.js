// The "bscc-awards" Netlify Blobs store, shared by /api/awards (coaches) and /api/paddler (which shows
// only a recent award's level and date). Tests inject a store with useAwardsStore.
let override = null
export const useAwardsStore = s => { override = s }
export async function openAwardsStore() {
  if (override) return override
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'bscc-awards', consistency: 'strong' })
}
