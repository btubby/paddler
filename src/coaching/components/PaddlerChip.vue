<script setup>
import { ref, watch, inject, computed } from 'vue'
import { photoUrl } from '../data/photos.js'

// the paddler's own page: results over the years, coaching ideas and their MemberMojo link
const paddlerPage = () => `/paddlers/paddler/?id=${encodeURIComponent(props.person.id)}&name=${encodeURIComponent(props.person.fullName || props.person.name)}`
const props = defineProps({
  person: { type: Object, required: true },
  removeTitle: { type: String, default: 'Hide from board' }
})
const emit = defineEmits(['edit-division', 'remove'])

const starLevelOf = inject('starLevel', () => 0)
const stars = () => starLevelOf(props.person)
const isCoach = () => props.person.role === 'coach'

// MemberMojo photo (via our server, which is signed in); the initial shows until it
// arrives, and stays when the member has no photo or it fails to load
// Only fetched while "Show photos" is ticked (off by default, to spare MemberMojo sign-ins).
const showPhotos = inject('showPhotos', computed(() => false))
// simple view: just a round face, with the division and coach tags
const simple = inject('simpleView', computed(() => false))
// two initials, for people without a photo
const initials = () => props.person.name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
// The most recent race: 🏁 date, host club code, and a gold / silver / bronze star for
// finishing 1st / 2nd / 3rd in it ("🏁 21/06/26 LBZ ★")
const MEDALS = { 1: 'gold', 2: 'silver', 3: 'bronze' }
const ORDINAL = { 1: '1st', 2: '2nd', 3: '3rd' }
const medal = () => MEDALS[props.person.lastRacePlace] || ''
const raceText = () => {
  const p = props.person
  return ['🏁', shortDate(p.lastRaced), p.lastRaceVenue].filter(Boolean).join(' ')
}
const raceTitle = () => {
  const p = props.person
  const place = p.lastRacePlace ? ` · ${ORDINAL[p.lastRacePlace] || `${p.lastRacePlace}th`}` : ''
  return `Last raced ${shortDate(p.lastRaced)}: ${p.lastRace || 'race'}${place}${partnerText() ? ' · ' + partnerText() : ''} (click for results)`
}
// second line of the hover label (simple view): K2 partner, if known (the race is shown
// beside it with its star)
const details = () => partnerText()
const photoSrc = ref(null)
watch(
  () => [props.person.photo, showPhotos.value],
  ([path, show]) => {
    photoSrc.value = null
    if (!show || !path) return
    photoUrl(path).then(src => { if (props.person.photo === path && showPhotos.value) photoSrc.value = src })
  },
  { immediate: true }
)

function onDragStart(e) {
  e.dataTransfer.setData('text/plain', props.person.id)
  e.dataTransfer.effectAllowed = 'move'
}

// "9" -> "div9"; Geoff Sanders codes like "GSB" are shown as-is.
const badgeText = () => {
  const d = props.person.division
  if (!d) return 'div?'
  return /^\d+$/.test(d) ? `div${d}` : d
}
// "2026-06-21" -> "21/06/26"
const shortDate = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''
}
// "K2 with Zoe Norford" from the crew in the most recent race
const partnerText = () => {
  const ps = props.person.partners || []
  if (!ps.length) return ''
  return ps.length === 1 ? `K2 with ${ps[0]}` : `with ${ps.join(', ')}`
}
const badgeTitle = () => {
  const p = props.person
  const parts = ['Click to edit division']
  if (p.fullName && p.fullName !== p.name) parts.push(p.fullName)
  if (p.divisionSource) parts.push(`From ${p.divisionSource}`)
  if (p.demotionOffered) parts.push('Demotion offered')
  return parts.join(' · ')
}
</script>

<template>
  <!-- simple view: a round face; name, division and last race in the tooltip -->
  <div
    v-if="simple"
    :data-member-id="person.id"
    class="face"
    :class="{ 'face--coach': isCoach(), 'face--junior': !isCoach() && person.junior }"
    draggable="true"
    @dragstart="onDragStart"
  >
    <!-- the face opens the paddler's page (results, progress, coaching ideas, MemberMojo link) -->
    <a
      class="face__link"
      :href="paddlerPage()"
      draggable="false"
    >
      <img v-if="photoSrc" class="face__img" :src="photoSrc" alt="" draggable="false" @error="photoSrc = null" />
      <span v-else class="face__initials">{{ initials() }}</span>
      <span class="sr-only">{{ person.name }}: paddler page</span>
    </a>
    <!-- name label shown straight away on hover (and keyboard focus), above the face -->
    <span class="face__name" aria-hidden="true">
      <strong>{{ person.fullName || person.name }}</strong>
      <small v-if="person.lastRaced || details()">
        <template v-if="person.lastRaced">{{ raceText() }}<span v-if="medal()" class="star" :class="'star--' + medal()" :title="ORDINAL[person.lastRacePlace]">★</span></template>
        <template v-if="person.lastRaced && details()"> · </template>{{ details() }}
      </small>
    </span>
    <span class="face__tags">
      <span v-if="isCoach()" class="badge badge--coach">coach</span>
      <span v-if="stars()" class="badge badge--star" :title="`BSCC ${stars()} Star award`">{{ stars() }}★</span>
      <button
        class="badge"
        :class="{ 'badge--empty': !person.division }"
        :title="badgeTitle()"
        @click="emit('edit-division', person)"
      >{{ badgeText() }}</button>
    </span>
    <button class="face__remove" :title="removeTitle" @click="emit('remove', person)">×</button>
  </div>
  <div
    v-else
    :data-member-id="person.id"
    class="chip"
    :class="{
      'chip--coach': isCoach(),
      'chip--junior': !isCoach() && person.junior
    }" draggable="true" @dragstart="onDragStart">
    <!-- the photo opens the paddler's page, like the name -->
    <a
      class="avatar-link"
      :href="paddlerPage()"
      title="Open paddler page"
      draggable="false"
    >
      <img
        v-if="photoSrc"
        class="avatar avatar--photo"
        :src="photoSrc"
        alt=""
        draggable="false"
        @error="photoSrc = null"
      />
      <span v-else class="avatar">{{ person.name.charAt(0) }}</span>
    </a>
    <span class="who">
      <a
        class="name"
        :href="paddlerPage()"
        :title="(person.fullName || person.name) + ': paddler page'"
        draggable="false"
      >{{ person.name }}</a>
      <a
        v-if="person.lastRaced"
        class="raced"
        :href="person.lastRaceUrl || undefined"
        target="_blank"
        rel="noopener"
        :title="raceTitle()"
        draggable="false"
      >{{ raceText() }}<span v-if="medal()" class="star" :class="'star--' + medal()">★</span><template v-if="partnerText()"> · {{ partnerText() }}</template></a>
    </span>
    <!-- small tags on the card's top-right edge: coach, then division -->
    <span class="tags">
      <span v-if="isCoach()" class="badge badge--coach" title="Coach (MemberMojo membership)">coach</span>
      <span v-if="stars()" class="badge badge--star" :title="`BSCC ${stars()} Star award`">{{ stars() }}★</span>
      <button
        class="badge"
        :class="{ 'badge--empty': !person.division }"
        :title="badgeTitle()"
        @click="emit('edit-division', person)"
      >{{ badgeText() }}</button>
    </span>
    <button class="remove" :title="removeTitle" @click="emit('remove', person)">×</button>
  </div>
</template>

<style scoped>
/* every card the same, low height: photo (40px) + 4px padding top and bottom + border.
   Text never wraps (long names end in "…"), so nothing can make a card taller. */
.chip {
  position: relative;
  box-sizing: border-box;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 4px 5px;
  background: var(--surface);
  border: 1.5px solid var(--teal);
  border-radius: 4px;
  cursor: grab;
  user-select: none;
}
.chip:active { cursor: grabbing; }
.chip--coach { border-color: var(--clay); background: var(--coach-bg); }
/* under-18 paddlers: light orange (coaches keep their clay border, so the two stay distinct) */
.chip--junior { background: var(--junior-bg); }
.avatar {
  box-sizing: border-box;
  width: 40px;
  height: 40px;
  font-size: 1rem;
  border-radius: 50%;
  background: var(--teal);
  color: var(--white);
  display: grid;
  place-items: center;
  font-weight: 600;
  flex-shrink: 0;
}
.chip--coach .avatar { background: var(--clay); color: var(--on-clay); }
.avatar--photo {
  object-fit: cover;
  background: var(--mist);
  border: 1.5px solid var(--teal);
}
.chip--coach .avatar--photo { border-color: var(--clay); background: var(--mist); }
.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.name, .raced {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.raced {
  font-size: 0.72rem;
  color: var(--muted);
  text-decoration: none;
}
.raced:hover { color: var(--heading); text-decoration: underline; }
.name {
  color: var(--ink);
  text-decoration: none;
  font-weight: 500;
}
.name:hover { text-decoration: underline; }
/* small tags sitting on the card's top-right edge, out of the row, to save space */
.tags {
  position: absolute;
  top: -8px;
  right: 18px; /* left of the × */
  display: flex;
  gap: 4px;
}
.badge {
  border: none;
  border-radius: 999px;
  background: var(--teal);
  color: var(--white);
  font-size: 0.62rem;
  font-weight: 600;
  line-height: 1.4;
  padding: 0 6px;
  cursor: pointer;
}
.badge--star { background: #123430; color: #ffd23f; box-shadow: 0 0 0 1px #ffd23f inset; cursor: default; }
.badge--empty { background: var(--mist); color: var(--heading); border: 1px solid var(--teal); }
/* unranked: no badge, except while hovering the card, so a division can still be set by hand */
.badge--empty { display: none; }
.chip:hover .badge--empty, .badge--empty:focus-visible { display: inline-block; }
/* coach: same shape and size as the division badge, in the coach colour; not clickable */
.badge--coach { background: var(--clay); color: var(--on-clay); cursor: default; }
/* × sits on the card's top-right corner, out of the row, so the name and race line get
   the full width */
.remove {
  position: absolute;
  top: -8px;
  right: -7px;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 0 0 1px var(--line);
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 18px;
  text-align: center;
  cursor: pointer;
}
.remove:hover { color: var(--clay); box-shadow: 0 0 0 1px var(--clay); }

/* ---- simple view: a round face ---- */
.face {
  position: relative;
  box-sizing: border-box;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 3px solid var(--teal);
  background: var(--teal);
  cursor: grab;
  user-select: none;
  flex: 0 0 auto;
}
.face:active { cursor: grabbing; }
.face--coach { border-color: var(--clay); background: var(--clay); }
.face--coach .face__initials { color: var(--on-clay); }
/* under-18: an orange ring */
.face--junior { border-color: #f4a340; }
.face__img {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  background: var(--mist);
}
.face__initials {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  color: var(--white);
  font-weight: 600;
  font-size: 1.15rem;
  letter-spacing: 0.02em;
}
/* the name label: a small dark pill above the face, on hover */
.face__name {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 9px;
  border-radius: 6px;
  background: var(--teal-deep);
  color: var(--white);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
}
.face__name::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  margin-left: -5px;
  border: 5px solid transparent;
  border-top-color: var(--heading);
}
.face__name strong { font-size: 0.82rem; font-weight: 600; line-height: 1.25; }
.face__name small { font-size: 0.68rem; opacity: 0.8; line-height: 1.25; }
.face:hover .face__name, .face:focus-within .face__name { opacity: 1; }
.face:hover { z-index: 15; }
/* the whole circle is the link */
.face__link { display: block; width: 100%; height: 100%; border-radius: 50%; text-decoration: none; }
.face__link[href] { cursor: pointer; }
.avatar-link { display: block; flex-shrink: 0; border-radius: 50%; text-decoration: none; }
/* tags across the bottom edge of the circle: coach, then division */
.face__tags {
  position: absolute;
  left: 50%;
  bottom: -9px;
  transform: translateX(-50%);
  display: flex;
  gap: 3px;
  white-space: nowrap;
}
.face__tags .badge { box-shadow: 0 0 0 1.5px var(--white); }
.face:hover .badge--empty, .face .badge--empty:focus-visible { display: inline-block; }
/* × to take someone off: only while hovering */
.face__remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--surface);
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 20px;
  box-shadow: 0 0 0 1px var(--line);
  cursor: pointer;
  opacity: 0;
}
.face:hover .face__remove, .face__remove:focus-visible { opacity: 1; }
.face__remove:hover { color: var(--clay); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* place in the last race: gold / silver / bronze star */
.star { margin-left: 3px; font-size: 1.05em; line-height: 1; }
.star--gold { color: #e3a91c; }
.star--silver { color: #a7b0b8; }
.star--bronze { color: #b8733e; }
.face__name .star { text-shadow: 0 0 1px rgba(0, 0, 0, 0.4); }

/* phones: smaller cards */
@media (max-width: 640px) {
  .chip { height: 44px; gap: 7px; padding: 4px 7px 4px 4px; }
  .avatar { width: 34px; height: 34px; font-size: 0.9rem; }
  .name { font-size: 0.86rem; }
  .raced { font-size: 0.66rem; }
  .tags { top: -7px; right: 16px; gap: 3px; }
  .badge { font-size: 0.56rem; }
  .remove { width: 16px; height: 16px; line-height: 16px; font-size: 0.8rem; top: -7px; right: -6px; }
  .face { width: 54px; height: 54px; }
  .face__initials { font-size: 1rem; }
}
</style>
