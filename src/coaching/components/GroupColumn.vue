<script setup>
import { ref, inject, computed } from 'vue'
import PaddlerChip from './PaddlerChip.vue'

const props = defineProps({
  title: { type: String, required: true },
  people: { type: Array, required: true },
  emptyText: { type: String, default: 'Drag people here' },
  isPool: { type: Boolean, default: false },
  // lay the cards out in a wrapping row across the page (used for the coaches strip)
  horizontal: { type: Boolean, default: false },
  // tooltip for the × on each card
  removeTitle: { type: String, default: 'Hide from board' },
  // optional: the cards laid out in lines (the K2 family tree, data/k2tree.js) instead of
  // one list: [{ key, kind: 'top' | 'next' | 'alone', people }]
  rows: { type: Array, default: null }
})
const emit = defineEmits(['drop-paddler', 'rename', 'remove-group', 'edit-division', 'remove-person'])

const over = ref(false)
// simple view: round faces, laid out in wrapping rows
const simple = inject('simpleView', computed(() => false))

function onDrop(e) {
  over.value = false
  const id = e.dataTransfer.getData('text/plain')
  if (id) emit('drop-paddler', id)
}
</script>

<template>
  <section
    class="col"
    :class="{ 'col--over': over, 'col--pool': isPool, 'col--row': horizontal, 'col--faces': simple }"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <header class="col__head">
      <h2 v-if="isPool">{{ title }}</h2>
      <input
        v-else
        class="col__title"
        :value="title"
        @change="emit('rename', $event.target.value)"
      />
      <span class="count">{{ people.length }}</span>
      <button v-if="!isPool" class="del" title="Delete group" @click="emit('remove-group')">×</button>
    </header>
    <div v-if="$slots.tools" class="col__tools"><slot name="tools" /></div>

    <div v-if="rows" class="col__body col__body--tree">
      <div v-for="r in rows" :key="r.key" class="tree-line" :class="'tree-line--' + r.kind">
        <p v-if="r.kind === 'alone'" class="tree-line__label">No K2 partner on the board</p>
        <PaddlerChip
          v-for="p in r.people"
          :key="p.id"
          :person="p"
          :remove-title="removeTitle"
          @edit-division="emit('edit-division', $event)"
          @remove="emit('remove-person', $event)"
        />
      </div>
      <p v-if="!people.length" class="empty">{{ emptyText }}</p>
    </div>
    <div v-else class="col__body">
      <PaddlerChip
        v-for="p in people"
        :key="p.id"
        :person="p"
        :remove-title="removeTitle"
        @edit-division="emit('edit-division', $event)"
        @remove="emit('remove-person', $event)"
      />
      <p v-if="!people.length" class="empty">{{ emptyText }}</p>
    </div>
  </section>
</template>

<style scoped>
.col {
  background: var(--mist);
  border-radius: 6px;
  padding: 14px;
  min-height: 220px;
  border: 2px solid transparent;
}
.col--pool { background: var(--pool); }
.col--over { border-color: var(--clay); }
.col__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.col__head h2 { font-size: 1.5rem; flex: 1; color: var(--heading); }
.col__title {
  flex: 1;
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--heading);
  background: transparent;
  border: none;
  border-bottom: 1.5px dashed transparent;
  min-width: 0;
}
.col__title:hover, .col__title:focus { border-bottom-color: var(--teal); outline: none; }
.count {
  background: var(--teal-deep);
  color: var(--white);
  font-size: 0.75rem;
  font-weight: 600;
  border-radius: 999px;
  padding: 1px 8px;
}
.del {
  border: none;
  background: transparent;
  font-size: 1.3rem;
  color: var(--heading);
  cursor: pointer;
}
.del:hover { color: var(--clay); }
.col__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: -4px 0 12px;
  font-size: 0.82rem;
  color: var(--heading);
}
.col__body { display: flex; flex-direction: column; gap: 12px 8px; padding-top: 6px; }
.col--row { min-height: 0; }
.col--row .col__body { flex-direction: row; flex-wrap: wrap; }
.col--row .col__body > :deep(.chip) { flex: 0 1 240px; min-width: 200px; }
.empty { color: var(--muted); font-size: 0.9rem; margin: 8px 0; }
/* simple view: faces in wrapping rows, room below each for its tags */
.col--faces .col__body { flex-direction: row; flex-wrap: wrap; align-content: flex-start; gap: 18px 12px; padding: 6px 2px 10px; }
.col--faces .empty { flex-basis: 100%; }

/* phones: narrower cards in the strip, so two fit side by side */
@media (max-width: 640px) {
  .col { padding: 10px; min-height: 0; }
  .col__head h2, .col__title { font-size: 1.2rem; }
  .col__body { gap: 10px 6px; }
  .col--row .col__body > :deep(.chip) { flex: 1 1 150px; min-width: 0; }
}
/* the K2 family tree: each line centred, with room between lines for the links */
.col__body--tree { display: block !important; }
.tree-line { display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 10px 14px; margin-top: 26px; }
.tree-line--top { margin-top: 34px; padding-top: 18px; border-top: 1px dashed var(--line); }
.tree-line--top:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.tree-line--alone { margin-top: 34px; padding-top: 14px; border-top: 1px dashed var(--line); justify-content: flex-start; }
.tree-line__label { flex-basis: 100%; margin: 0 0 4px; font-size: 0.8rem; color: var(--muted); }
.tree-line > :deep(.chip) { flex: 0 1 230px; min-width: 190px; }
</style>
