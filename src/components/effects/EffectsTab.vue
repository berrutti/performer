<template>
  <div class="tab-content">
    <div class="bpm-row">
      <span class="bpm-label">BPM</span>
      <input
        type="number"
        class="bpm-input"
        :value="localBpm"
        min="40"
        max="300"
        step="1"
        @focus="bpmFocused = true"
        @blur="bpmFocused = false"
        @input="localBpm = Number(($event.target as HTMLInputElement).value)"
        @change="onBpmChange"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
    </div>

    <div v-if="midiConnected" class="midi-status">
      <div class="midi-indicator">MIDI: {{ midiDeviceName }}</div>
      <p class="control-description">
        Knobs 1-7 control intensity. Top row pads toggle + knob. Bottom row pads toggle only.
      </p>
    </div>

    <div class="effects-grid">
      <div
        v-for="effect in allEffects"
        :key="effect"
        :class="[
          'effect-btn',
          activeEffects[effect] ? 'effect-btn--on' : '',
          midiControlledEffects.includes(effect) ? 'effect-btn--midi' : ''
        ]"
      >
        <button class="effect-btn__toggle" @click="emit('toggle-effect', effect)">
          <span class="effect-btn__name">{{ formatName(effect) }}</span>
          <span v-if="midiControlledEffects.includes(effect)" class="effect-btn__midi-dot" />
        </button>
        <input
          v-if="shaderEffects[effect].intensity !== undefined"
          type="range"
          class="effect-btn__slider"
          min="0"
          max="1"
          step="0.01"
          :value="effectIntensities[effect]"
          :disabled="midiConnected && midiControlledEffects.includes(effect)"
          @input="
            emit('intensity-change', effect, parseFloat(($event.target as HTMLInputElement).value))
          "
        />
        <button
          v-if="shaderEffects[effect].bpmSync"
          class="effect-btn__sync"
          :class="{ 'effect-btn__sync--on': bpmSyncEnabled[effect] }"
          :title="
            bpmSyncEnabled[effect]
              ? 'BPM sync on - click to disable'
              : 'BPM sync off - click to enable'
          "
          @click="emit('bpm-sync-change', effect, !bpmSyncEnabled[effect])"
        >
          {{ bpmSyncEnabled[effect] ? '▶ BPM' : '○ BPM' }}
        </button>
      </div>
    </div>

    <div class="checkbox-group">
      <input
        id="show-help"
        type="checkbox"
        class="control-checkbox"
        :checked="showHelp"
        @change="emit('toggle-help')"
      />
      <label for="show-help" class="checkbox-label">Show help overlay</label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ShaderEffect, shaderEffects } from '../../utils';

const props = withDefaults(
  defineProps<{
    activeEffects: Record<ShaderEffect, boolean>;
    effectIntensities: Record<ShaderEffect, number>;
    bpmSyncEnabled: Record<ShaderEffect, boolean>;
    showHelp: boolean;
    midiConnected?: boolean;
    midiDeviceName?: string;
    bpm: number;
  }>(),
  {
    midiConnected: false,
    midiDeviceName: ''
  }
);

const emit = defineEmits<{
  'toggle-effect': [effect: ShaderEffect];
  'intensity-change': [effect: ShaderEffect, intensity: number];
  'bpm-sync-change': [effect: ShaderEffect, enabled: boolean];
  'toggle-help': [];
  'bpm-change': [bpm: number];
}>();

const midiControlledEffects = computed<ShaderEffect[]>(() => {
  if (!props.midiConnected) return [];
  return [
    ShaderEffect.INVERT,
    ShaderEffect.REALITY_GLITCH,
    ShaderEffect.DISPLACE,
    ShaderEffect.CHROMA,
    ShaderEffect.PIXELATE,
    ShaderEffect.VORONOI,
    ShaderEffect.RIPPLE,
    ShaderEffect.FEEDBACK_ECHO
  ];
});

const allEffects: ShaderEffect[] = [
  ShaderEffect.INVERT,
  ShaderEffect.REALITY_GLITCH,
  ShaderEffect.DISPLACE,
  ShaderEffect.CHROMA,
  ShaderEffect.PIXELATE,
  ShaderEffect.VORONOI,
  ShaderEffect.RIPPLE,
  ShaderEffect.FEEDBACK_ECHO,
  ShaderEffect.AURORA,
  ShaderEffect.GRAYSCALE,
  ShaderEffect.KALEIDOSCOPE,
  ShaderEffect.SWIRL,
  ShaderEffect.PALETTE_CYCLING,
  ShaderEffect.CONTOUR
];

const localBpm = ref(props.bpm);
const bpmFocused = ref(false);

watch(
  () => props.bpm,
  (val) => {
    if (!bpmFocused.value) localBpm.value = val;
  }
);

function formatName(effect: ShaderEffect): string {
  return effect.replace(/_/g, ' ');
}

function onBpmChange(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10);
  if (!isNaN(val) && val >= 40 && val <= 300) {
    localBpm.value = val;
    emit('bpm-change', val);
  }
}
</script>
