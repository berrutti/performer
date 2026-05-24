<template>
  <div class="tab-content">
    <div class="bpm-row">
      <span class="bpm-label">BPM</span>
      <input
        type="number"
        class="bpm-input"
        :value="bpm"
        min="40"
        max="300"
        step="1"
        @change="onBpmChange"
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <span v-if="isSettingBpm" class="bpm-tapping">tapping</span>
      <span class="bpm-hint">or tap spacebar</span>
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
        @click="emit('toggle-effect', effect)"
      >
        <span class="effect-btn__name">{{ formatName(effect) }}</span>
        <span v-if="midiControlledEffects.includes(effect)" class="effect-btn__midi-dot" />
        <input
          v-if="shaderEffects[effect].intensity !== undefined"
          type="range"
          class="effect-btn__slider"
          min="0"
          max="1"
          step="0.01"
          :value="effectIntensities[effect]"
          :disabled="
            !activeEffects[effect] || (midiConnected && midiControlledEffects.includes(effect))
          "
          @input="
            emit('intensity-change', effect, parseFloat(($event.target as HTMLInputElement).value))
          "
          @click.stop
        />
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
import { computed } from 'vue';
import { ShaderEffect, shaderEffects } from '../../utils';

const props = withDefaults(
  defineProps<{
    activeEffects: Record<ShaderEffect, boolean>;
    effectIntensities: Record<ShaderEffect, number>;
    showHelp: boolean;
    midiConnected?: boolean;
    midiDeviceName?: string;
    bpm: number;
    isSettingBpm: boolean;
  }>(),
  {
    midiConnected: false,
    midiDeviceName: ''
  }
);

const emit = defineEmits<{
  'toggle-effect': [effect: ShaderEffect];
  'intensity-change': [effect: ShaderEffect, intensity: number];
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
  ShaderEffect.GRAYSCALE,
  ShaderEffect.KALEIDOSCOPE,
  ShaderEffect.SWIRL,
  ShaderEffect.PALETTE_CYCLING,
  ShaderEffect.CONTOUR
];

function formatName(effect: ShaderEffect): string {
  return effect.replace(/_/g, ' ');
}

function onBpmChange(e: Event) {
  const val = parseInt((e.target as HTMLInputElement).value, 10);
  if (!isNaN(val) && val >= 40 && val <= 300) {
    emit('bpm-change', val);
  }
}
</script>
