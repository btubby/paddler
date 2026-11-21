<script setup>
import { computed } from 'vue'
// A racing kayak from above: a K1 has one cockpit, a K2 two (each with a paddler and
// their paddle). Drawn in currentColor; the label underneath says K1 or K2.
const props = defineProps({
  kind: { type: String, default: 'K1' }, // 'K1' | 'K2' | 'C1' | 'C2'
  width: { type: Number, default: 80 },
  label: { type: Boolean, default: false }
})
const wide = computed(() => props.kind === 'K2' || props.kind === 'C2')
</script>

<template>
  <span class="boat-icon" :class="'boat-icon--' + kind">
    <svg :viewBox="wide ? '0 0 120 30' : '0 0 92 30'" :width="width" :height="(width * 30) / (wide ? 120 : 92)" role="img" :aria-label="kind">
      <template v-if="kind === 'C2'">
        <line x1="40" y1="3" x2="30" y2="27" class="boat-icon__paddle" />
        <line x1="86" y1="27" x2="76" y2="3" class="boat-icon__paddle" />
        <path d="M1 11 C 14 14, 28 18, 38 18 L 82 18 C 92 18, 106 14, 119 11 C 112 22, 96 25, 82 25 L 38 25 C 24 25, 8 22, 1 11 Z" class="boat-icon__hull" />
        <circle cx="42" cy="12" r="3.4" class="boat-icon__head" />
        <circle cx="78" cy="12" r="3.4" class="boat-icon__head" />
      </template>
      <template v-else-if="kind === 'C1'">
        <line x1="54" y1="3" x2="44" y2="27" class="boat-icon__paddle" />
        <path d="M1 11 C 12 14, 22 18, 30 18 L 62 18 C 70 18, 80 14, 91 11 C 85 22, 74 25, 62 25 L 30 25 C 18 25, 7 22, 1 11 Z" class="boat-icon__hull" />
        <circle cx="46" cy="12" r="3.4" class="boat-icon__head" />
      </template>
      <template v-else-if="kind === 'K2'">
        <line x1="34" y1="2" x2="50" y2="28" class="boat-icon__paddle" />
        <line x1="70" y1="2" x2="86" y2="28" class="boat-icon__paddle" />
        <path d="M1 15 C 24 6.5, 96 6.5, 119 15 C 96 23.5, 24 23.5, 1 15 Z" class="boat-icon__hull" />
        <rect x="35" y="11" width="18" height="8" rx="4" class="boat-icon__cockpit" />
        <rect x="69" y="11" width="18" height="8" rx="4" class="boat-icon__cockpit" />
        <circle cx="42" cy="15" r="2.6" class="boat-icon__head" />
        <circle cx="76" cy="15" r="2.6" class="boat-icon__head" />
      </template>
      <template v-else>
        <line x1="40" y1="2" x2="56" y2="28" class="boat-icon__paddle" />
        <path d="M1 15 C 19 7, 73 7, 91 15 C 73 23, 19 23, 1 15 Z" class="boat-icon__hull" />
        <rect x="39" y="11" width="18" height="8" rx="4" class="boat-icon__cockpit" />
        <circle cx="46" cy="15" r="2.6" class="boat-icon__head" />
      </template>
    </svg>
    <span v-if="label" class="boat-icon__label">{{ kind }}</span>
  </span>
</template>

<style scoped>
.boat-icon { display: inline-flex; flex-direction: column; align-items: center; gap: 2px; color: inherit; vertical-align: middle; }
.boat-icon svg { display: block; overflow: visible; }
.boat-icon__hull { fill: currentColor; }
.boat-icon__paddle { stroke: currentColor; stroke-width: 2; stroke-linecap: round; opacity: 0.55; }
.boat-icon__cockpit { fill: var(--surface, #fff); }
.boat-icon__head { fill: currentColor; }
.boat-icon__label { font: 700 0.72rem/1 var(--font-body, sans-serif); letter-spacing: 0.04em; }
</style>
