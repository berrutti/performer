import { ref, onMounted, onUnmounted } from 'vue';
import { WebMidi, type Input, type PortEvent } from 'webmidi';
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
  21: ShaderEffect.REALITY_GLITCH,
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

  function findLaunchkey(): Input | undefined {
    return (
      WebMidi.getInputByName('Launchkey Mini MK3') ||
      WebMidi.getInputByName('Launchkey Mini') ||
      WebMidi.inputs.find((i) => i.name.toLowerCase().includes('launchkey'))
    );
  }

  function tryConnect() {
    if (inputRef) return;
    const input = findLaunchkey();
    if (!input) return;

    inputRef = input;
    setupListeners();
    connected.value = true;
    deviceName.value = input.name;
    config.onMidiConnect?.();
  }

  function onPortDisconnected(e: PortEvent) {
    const port = e.port as { id?: string };
    if (!inputRef || port.id !== inputRef.id) return;
    inputRef.removeListener();
    inputRef = null;
    connected.value = false;
    deviceName.value = '';
  }

  async function initialize() {
    try {
      await WebMidi.enable();
    } catch {
      return;
    }
    // Keep watching ports so the controller can be plugged in (or reconnected) mid-session.
    WebMidi.addListener('connected', tryConnect);
    WebMidi.addListener('disconnected', onPortDisconnected);
    tryConnect();
  }

  function teardown() {
    WebMidi.removeListener('connected', tryConnect);
    WebMidi.removeListener('disconnected', onPortDisconnected);
    if (inputRef) {
      inputRef.removeListener();
      inputRef = null;
    }
    connected.value = false;
    deviceName.value = '';
  }

  onMounted(() => initialize());
  onUnmounted(() => teardown());

  return { connected, deviceName };
}
