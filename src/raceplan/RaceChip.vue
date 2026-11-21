<script setup>
// One paddler on the race planner: drag them, or click to pick them up and click where
// they should go. Their division, and how many results their rating rests on. The little
// chart button opens their paddler page ("see performance": results and progress) in a new tab.
import { computed } from 'vue'
import { THIN } from '../../netlify/functions/lib/crewplan.js'

const props = defineProps({
  person: { type: Object, required: true }, // { id, name, div, n, a, photo }
  photo: { type: String, default: null },
  selected: { type: Boolean, default: false },
  ghost: { type: Boolean, default: false } // the copy that follows the pointer
})
const emit = defineEmits(['grab', 'pick'])
const initials = computed(() => props.person.name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase())
const rough = computed(() => props.person.a != null && props.person.n < THIN)
const divText = computed(() => (/^[1-9]$/.test(String(props.person.div)) ? 'div ' + props.person.div : props.person.div || 'no div'))
</script>

<template>
  <span class="rchip-wrap" :class="{ 'rchip-wrap--ghost': ghost }">
  <button
    type="button"
    class="rchip"
    :class="{ 'rchip--selected': selected, 'rchip--ghost': ghost, 'rchip--unrated': person.a == null }"
    :aria-pressed="selected"
    :title="person.a == null ? `${person.name}: no race results to go on` : `${person.name}, ${divText}${rough ? ' (only ' + person.n + ' result' + (person.n === 1 ? '' : 's') + ': a rough rating)' : ''}. Drag, or click then click where they should go.`"
    @pointerdown="emit('grab', $event)"
    @click="emit('pick', $event)"
  >
    <img v-if="photo" :src="photo" alt="" class="rchip__face" draggable="false" />
    <span v-else class="rchip__face rchip__face--none" aria-hidden="true">{{ initials }}</span>
    <span class="rchip__name">{{ person.name }}</span>
    <span class="rchip__div" :class="{ 'rchip__div--none': !/^[1-9]$/.test(String(person.div)) }">{{ divText }}</span>
    <span v-if="rough" class="rchip__rough" aria-hidden="true">~</span>
  </button>
  <a
    v-if="!ghost && person.a != null"
    class="rchip__perf"
    :href="`/paddlers/paddler/?name=${encodeURIComponent(person.name)}&from=planner`"
    target="_blank"
    rel="noopener"
    :title="`See performance: ${person.name}'s results and progress (opens in a new tab)`"
    :aria-label="`See ${person.name}'s performance`"
    @pointerdown.stop
  ><svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 13 L6 8 L9 10 L14 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path d="M10 3 H14 V7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></a>
  </span>
</template>

<style scoped>
.rchip {
  display: inline-flex; align-items: center; gap: 7px; max-width: 100%;
  padding: 3px 9px 3px 3px; border: 1.5px solid var(--line); border-radius: 999px;
  background: var(--surface); color: var(--ink); font: 500 0.86rem/1.2 var(--font-body);
  cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none;
  transition: border-color 0.12s, box-shadow 0.12s, transform 0.12s;
}
.rchip:hover { border-color: var(--teal); }
.rchip:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.rchip--selected { border-color: var(--clay); box-shadow: 0 0 0 3px color-mix(in srgb, var(--clay) 30%, transparent); }
.rchip-wrap { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; }
.rchip-wrap--ghost { position: fixed; z-index: 1000; pointer-events: none; transform: translate(-50%, -60%) rotate(-2deg); }
.rchip--ghost { cursor: grabbing; box-shadow: 0 10px 24px rgba(0, 0, 0, 0.25); border-color: var(--clay); }
.rchip__perf { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; color: var(--muted); text-decoration: none; flex: none; }
.rchip__perf:hover, .rchip__perf:focus-visible { color: var(--heading); background: var(--mist); outline: none; }
.rchip__perf:focus-visible { box-shadow: 0 0 0 2px var(--gold); }
.rchip--unrated { border-style: dashed; }
.rchip__face { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; flex: none; pointer-events: none; }
.rchip__face--none { display: grid; place-items: center; background: var(--teal); color: var(--white); font-size: 0.66rem; font-weight: 700; }
.rchip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rchip__div { flex: none; font-size: 0.7rem; font-weight: 600; padding: 1px 6px; border-radius: 999px; background: var(--heading); color: var(--surface); }
.rchip__div--none { background: transparent; color: var(--muted); border: 1px solid var(--line); }
.rchip__rough { color: var(--muted); font-weight: 700; }
</style>
