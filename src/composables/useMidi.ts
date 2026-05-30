import { ref, onMounted, onUnmounted } from 'vue';
import { WebMidi, type Input } from 'webmidi';
import { ShaderEffect } from '@/utils';

export interface MidiConfig {
  onEffectToggle: (effect: ShaderEffect) => void;
  onIntensityChange: (effect: ShaderEffect, intensity: number) => void;
  onMidiConnect?: () => void;
}

const PADS: Record<number, ShaderEffect> = {
  40: ShaderEffect.INVERT,
  41: ShaderEffect.REALITY_GLITCH,
  42: ShaderEffect.DISPLACE,
  43: ShaderEffect.CHROMA,
  48: ShaderEffect.PIXELATE,
  49: ShaderEffect.VORONOI,
  50: ShaderEffect.RIPPLE,
  51: ShaderEffect.FEEDBACK_ECHO,
  36: ShaderEffect.GRAYSCALE,
  37: ShaderEffect.KALEIDOSCOPE,
  38: ShaderEffect.SWIRL,
  39: ShaderEffect.PALETTE_CYCLING,
  44: ShaderEffect.CONTOUR
};

const KNOB_CC_MAPPING: Record<number, ShaderEffect> = {
  21: ShaderEffect.INVERT,
  22: ShaderEffect.REALITY_GLITCH,
  23: ShaderEffect.DISPLACE,
  24: ShaderEffect.CHROMA,
  25: ShaderEffect.PIXELATE,
  26: ShaderEffect.VORONOI,
  27: ShaderEffect.RIPPLE,
  28: ShaderEffect.FEEDBACK_ECHO
};

export const KNOB_CONTROLLED_EFFECTS: ReadonlySet<ShaderEffect> = new Set(
  Object.values(KNOB_CC_MAPPING)
);

export function useMidi(config: MidiConfig) {
  const connected = ref(false);
  const deviceName = ref('');

  let inputRef: Input | null = null;
  const lastCCValues: Record<number, number> = {};

  function setupListeners() {
    if (!inputRef) return;

    inputRef.addListener('noteon', (event) => {
      const note = event.note.number;
      const effect = PADS[note];
      if (effect) config.onEffectToggle(effect);
    });

    inputRef.addListener('controlchange', (event) => {
      const ccNumber = event.controller.number;
      const value = event.rawValue ?? 0;
      const effect = KNOB_CC_MAPPING[ccNumber];
      if (effect === undefined) return;

      const lastValue = lastCCValues[ccNumber] ?? -1;
      if (value === lastValue) return;
      lastCCValues[ccNumber] = value;

      let intensity = value / 127;
      if (value <= 2) intensity = 0;
      if (value >= 125) intensity = 1;
      intensity = Math.max(0, Math.min(1, intensity));
      config.onIntensityChange(effect, intensity);
    });
  }

  async function initialize() {
    try {
      await WebMidi.enable();

      const launchkeyInput =
        WebMidi.getInputByName('Launchkey Mini MK3') ||
        WebMidi.getInputByName('Launchkey Mini') ||
        WebMidi.inputs.find((i) => i.name.toLowerCase().includes('launchkey'));

      if (!launchkeyInput) throw new Error('Launchkey Mini not found');

      inputRef = launchkeyInput;
      setupListeners();

      connected.value = true;
      deviceName.value = launchkeyInput.name;
      config.onMidiConnect?.();
    } catch {
      connected.value = false;
    }
  }

  function disconnect() {
    if (inputRef) {
      inputRef.removeListener();
      inputRef = null;
    }
    connected.value = false;
    deviceName.value = '';
  }

  onMounted(() => initialize());
  onUnmounted(() => disconnect());

  return { connected, deviceName };
}
