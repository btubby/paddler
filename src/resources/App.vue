<script setup>
import { ref, shallowRef, computed, onMounted, onBeforeUnmount } from 'vue'
import SiteNav from '../shared/SiteNav.vue'

// Resources: coaching videos. One player at the top shows the chosen video: this week's featured
// video by default, or another picked from the list beside it (the Ivan Lawler technique series is
// folded away into a small section). The choice is kept in the address (#leg-drive etc.), so a link
// can open a particular video, and Back goes to the previous one.
const FEATURED = { // this week's featured video: change this one entry each week
  slug: 'featured',
  title: 'Lisa Carrington technique',
  url: 'https://www.youtube.com/watch?v=hD4ZqF5bjuY',
  embed: 'https://www.youtube-nocookie.com/embed/hD4ZqF5bjuY?rel=0&modestbranding=1',
  thumb: 'https://i.ytimg.com/vi/hD4ZqF5bjuY/mqdefault.jpg',
  site: 'YouTube'
}
// an earlier featured video (Facebook's own player; the video is landscape 16:9)
const FACEBOOK = {
  slug: 'technique-reel',
  title: 'Technique video',
  url: 'https://www.facebook.com/reel/1019128319501614',
  embed: `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent('https://www.facebook.com/reel/1019128319501614')}&show_text=false&width=820`,
  site: 'Facebook'
}

const PLAYLIST = 'PLUJ0Ij3ZYveiYQLSuI_5C911MvKDA0i23'
const SERIES = [
  { title: 'Foot Drive', id: '2BYRlT9lYoA' },
  { title: 'Leg Drive', id: 'sEU33-FSrPk' },
  { title: 'Trunk', id: '174QEvSrcTU' },
  { title: 'Chest and Shoulders', id: 'S1X68tQoOKM' },
  { title: 'Upper Arm', id: 'qri4jEnCx-c' },
  { title: 'Lower Arm', id: 'CL_h6lLaNMM' }
].map((v, i) => ({
  ...v,
  n: i + 1,
  slug: v.title.toLowerCase().replace(/[^a-z]+/g, '-'),
  url: `https://www.youtube.com/watch?v=${v.id}&list=${PLAYLIST}&index=${i + 1}`,
  // youtube-nocookie: no YouTube cookies until the video is played
  embed: `https://www.youtube-nocookie.com/embed/${v.id}?list=${PLAYLIST}&index=${i + 1}&rel=0&modestbranding=1`,
  thumb: `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
  site: 'YouTube'
}))

// Other single videos, listed under the featured one
const MORE = [FACEBOOK]

const all = [FEATURED, ...MORE, ...SERIES]
const fromHash = () => all.find(v => v.slug === location.hash.slice(1)) || FEATURED
const current = shallowRef(fromHash()) // shallow: compared by identity with the entries above
// autoplay when a viewer picks a video (not on first load)
const picked = ref(false)
const src = computed(() => current.value.embed + (picked.value && current.value.site === 'YouTube' ? '&autoplay=1' : ''))

const player = ref(null)
function choose(v) {
  if (v.slug === current.value.slug) return
  picked.value = true
  current.value = v
  history.pushState(null, '', v === FEATURED ? location.pathname : '#' + v.slug)
  // bring the player into view on small screens, where the list is below it
  player.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
const onPop = () => { current.value = fromHash() }
onMounted(() => window.addEventListener('popstate', onPop))
onBeforeUnmount(() => window.removeEventListener('popstate', onPop))
</script>

<template>
  <SiteNav current="/resources/" />
  <main class="resources">
    <h1>Training inspiration and resources</h1>
    <p class="intro">Videos for coaches and paddlers. Pick one from the list to watch it here.</p>

    <section ref="player" class="video" aria-label="Video player">
      <div class="video__frame">
        <!-- keyed, so switching videos loads a fresh player -->
        <iframe
          :key="current.slug"
          :src="src"
          :title="current.title"
          scrolling="no"
          referrerpolicy="strict-origin-when-cross-origin"
          allowfullscreen
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        ></iframe>
      </div>
      <div class="video__caption">
        <h2>
          <span v-if="current === FEATURED" class="video__series">This week’s featured video</span>
          <span v-else-if="current.n" class="video__series">Ivan Lawler technique series · {{ current.n }} of {{ SERIES.length }}</span>
          {{ current.title }}
        </h2>
        <p class="video__fallback">
          Video not showing? Some browsers and ad blockers block embedded videos.
          <a :href="current.url" target="_blank" rel="noopener" class="link">Watch it on {{ current.site }}</a>
        </p>
      </div>
    </section>

    <section class="list" aria-label="More videos">
      <h2 class="list__title list__title--first">This week’s featured video</h2>
      <button type="button" class="pick pick--featured" :class="{ 'is-current': current === FEATURED }" :aria-pressed="current === FEATURED" @click="choose(FEATURED)">
        <span class="pick__thumb"><img :src="FEATURED.thumb" alt="" width="160" height="90" loading="lazy" /></span>
        <span class="pick__text"><strong>{{ FEATURED.title }}</strong><small>YouTube</small></span>
      </button>

      <h2 class="list__title">More technique videos</h2>
      <ul class="series">
        <li v-for="v in MORE" :key="v.slug">
          <button type="button" class="pick" :class="{ 'is-current': current === v }" :aria-pressed="current === v" @click="choose(v)">
            <span v-if="v.thumb" class="pick__thumb"><img :src="v.thumb" alt="" width="160" height="90" loading="lazy" /></span>
            <span v-else class="pick__thumb pick__thumb--fb" aria-hidden="true">▶</span>
            <span class="pick__text"><strong>{{ v.title }}</strong><small>{{ v.site }}</small></span>
          </button>
        </li>
      </ul>

      <!-- the Ivan Lawler series: six short links, folded away unless one of them is playing -->
      <details class="ivan" :open="!!current.n">
        <summary>Ivan Lawler technique series <span>({{ SERIES.length }} videos)</span></summary>
        <ol class="chips">
          <li v-for="v in SERIES" :key="v.id">
            <button type="button" class="chip" :class="{ 'is-current': current === v }" :aria-pressed="current === v" @click="choose(v)"><span>{{ v.n }}</span>{{ v.title }}</button>
          </li>
        </ol>
      </details>

      <!-- the club's Strava page: a link only, nothing is fetched from Strava -->
      <aside class="strava">
        <h2 class="list__title">Join the club on Strava</h2>
        <p>Bishops Stortford Canoe Club has a Strava club. Share your paddles with the rest of us.</p>
        <a class="strava__btn" href="https://www.strava.com/clubs/stortcanoe" target="_blank" rel="noopener">Bishops Stortford Canoe Club on Strava ↗</a>
      </aside>
    </section>

  </main>
</template>

<style scoped>
.resources {
  max-width: 1180px;
  margin: 0 auto;
  padding: 48px 28px 56px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  grid-template-areas:
    'title title'
    'intro intro'
    'video list';
  column-gap: 32px;
}
h1 {
  grid-area: title;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.2rem, 6.5vw, 4.2rem);
  line-height: 0.95;
  color: var(--teal-deep);
}
.intro {
  grid-area: intro;
  max-width: 60ch;
  margin: 16px 0 28px;
  font-size: 1.05rem;
  color: var(--teal);
}

/* the player: every video here is landscape 16:9, so the frame is exactly that shape */
.video {
  grid-area: video;
  scroll-margin-top: 16px;
}
.video__frame {
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #10201e;
  border: 1.5px solid var(--teal);
  border-radius: 8px;
  overflow: hidden;
}
.video__frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.video__caption h2 {
  margin: 14px 0 0;
  font-family: var(--font-display);
  font-size: 1.8rem;
  line-height: 1.05;
  color: var(--teal-deep);
}
.video__series {
  display: block;
  margin-bottom: 2px;
  font-family: Inter, sans-serif;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--clay);
}
.video__fallback {
  margin: 8px 0 0;
  font-size: 0.88rem;
  color: #5c6765;
}

/* the list of videos to pick from */
.list { grid-area: list; }
.list__title--first { margin-top: 0 !important; }
.strava { margin-top: 22px; padding: 12px 14px; background: #fff; border: 1.5px solid #cfd8d5; border-left: 5px solid #fc4c02; border-radius: 8px; }
.strava .list__title { margin-top: 0; }
.strava p { margin: 4px 0 10px; font-size: 0.92rem; color: var(--teal); }
.strava__btn { display: inline-block; padding: 9px 14px; border-radius: 6px; background: #fc4c02; color: #fff; font-weight: 700; font-size: 0.9rem; text-decoration: none; }
.strava__btn:hover { background: #d94100; }
.strava__btn:focus-visible { outline: 3px solid var(--teal-deep); outline-offset: 2px; }
.ivan { margin-top: 22px; padding: 10px 12px; background: #fff; border: 1.5px solid #cfd8d5; border-radius: 8px; }
.ivan summary { cursor: pointer; font-weight: 600; color: var(--teal-deep); }
.ivan summary span { font-weight: 400; color: var(--teal); }
.chips { list-style: none; margin: 10px 0 2px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px 5px 6px; font: inherit; font-size: 0.85rem; color: var(--teal-deep); background: #f1f6f4; border: 1.5px solid #cfd8d5; border-radius: 999px; cursor: pointer; }
.chip span { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--teal-deep); color: #fff; font-size: 0.7rem; }
.chip:hover { border-color: var(--clay); }
.chip.is-current { background: var(--teal-deep); color: #fff; border-color: var(--teal-deep); }
.chip.is-current span { background: #fff; color: var(--teal-deep); }
.list__title {
  margin: 22px 0 10px;
  font-family: var(--font-display);
  font-size: 1.45rem;
  line-height: 1.05;
  color: var(--teal-deep);
}
.series {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}
.pick {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 6px;
  font: inherit;
  text-align: left;
  color: inherit;
  background: #fff;
  border: 1.5px solid #cfd8d5;
  border-radius: 8px;
  cursor: pointer;
}
.pick:hover { border-color: var(--teal); }
.pick:focus-visible { outline: 2px solid var(--teal-deep); outline-offset: 2px; }
.pick.is-current { border-color: var(--teal-deep); background: #eef5f3; box-shadow: inset 4px 0 0 var(--clay); }
.pick__thumb {
  position: relative;
  flex: 0 0 auto;
  width: 112px;
  aspect-ratio: 16 / 9;
  border-radius: 5px;
  overflow: hidden;
  background: #10201e;
}
.pick__thumb img { display: block; width: 100%; height: 100%; object-fit: cover; }
.pick__thumb--fb {
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 1.3rem;
  background: linear-gradient(135deg, #1f5c56, #123430);
}
.pick__n {
  position: absolute;
  left: 4px;
  top: 4px;
  min-width: 20px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 700;
  text-align: center;
  color: #fff;
  background: rgba(18, 52, 48, 0.85);
}
.pick__text { display: flex; flex-direction: column; min-width: 0; }
.pick__text strong { font-weight: 600; color: var(--teal-deep); }
.pick__text small { font-size: 0.78rem; color: #6b7572; }

.link { color: var(--teal-deep); font-weight: 600; text-underline-offset: 3px; }
.link:hover, .link:focus-visible { color: var(--clay); }

/* narrower screens: the list goes under the player */
@media (max-width: 900px) {
  .resources {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas: 'title' 'intro' 'video' 'list';
  }
  .list { margin-top: 18px; }
}
@media (max-width: 640px) {
  .resources { padding: 28px 14px 40px; }
}
</style>
