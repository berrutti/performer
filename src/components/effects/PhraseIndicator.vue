<template>
  <span class="phrase-indicator">
    <span class="beat-counter"
      ><span class="phrase-beat">{{ beat }}</span
      >&thinsp;/&thinsp;{{ phrase.total }}</span
    >
    <span class="phrase-bar" aria-hidden="true">
      <span
        v-for="n in phrase.total"
        :key="n"
        :class="[
          'phrase-cell',
          n < beat ? 'phrase-cell--done' : '',
          n === beat ? 'phrase-cell--current' : '',
          n > phrase.total - BEATS_PER_BAR ? 'phrase-cell--last-bar' : '',
          n > 1 && (n - 1) % BEATS_PER_BAR === 0 ? 'phrase-cell--bar-start' : ''
        ]"
      />
    </span>
  </span>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import type { RandomizePhrase } from '@/composables/useRandomizeMode';

const BEATS_PER_BAR = 4;

const props = defineProps<{ phrase: RandomizePhrase }>();

function currentBeat(): number {
  const elapsed = performance.timeOrigin + performance.now() - props.phrase.startedAt;
  return Math.min(Math.max(1, Math.floor(elapsed / props.phrase.beatMs) + 1), props.phrase.total);
}

// Checked every frame against this window's own clock, so beats tick exactly on time.
const beat = ref(currentBeat());
let rafId = 0;

function tick() {
  const next = currentBeat();
  if (next !== beat.value) beat.value = next;
  rafId = requestAnimationFrame(tick);
}

onMounted(() => {
  rafId = requestAnimationFrame(tick);
});

onUnmounted(() => cancelAnimationFrame(rafId));
</script>

<style scoped>
.phrase-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}

/* As wide as the two-digit phrase lengths, so the cells don't shift when the beat reaches 10. */
.phrase-beat {
  display: inline-block;
  min-width: 2ch;
  text-align: right;
}

.phrase-bar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.phrase-cell {
  width: 5px;
  height: 12px;
  border-radius: 1px;
  background: var(--color-border-2);
}

.phrase-cell--bar-start {
  margin-left: 4px;
}

.phrase-cell--last-bar {
  background: rgba(239, 68, 68, 0.25);
}

.phrase-cell--done {
  background: rgba(251, 191, 36, 0.45);
}

.phrase-cell--current {
  background: var(--color-accent);
}

.phrase-cell--last-bar.phrase-cell--done,
.phrase-cell--last-bar.phrase-cell--current {
  background: var(--color-red);
}
</style>
