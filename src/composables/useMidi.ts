import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { ShaderEffect } from '@/utils';

export interface MidiConfig {
  onEffectToggle: (effect: ShaderEffect) => void;
  onIntensityChange: (effect: ShaderEffect, intensity: number) => void;
  onMidiConnect?: () => void;
  activeEffects?: Ref<Record<ShaderEffect, boolean>>;
}

// Per-effect pad colors, expressed as Launchkey palette velocity indices (0 = LED off).
const PAD_COLORS: Partial<Record<ShaderEffect, number>> = {
  [ShaderEffect.INVERT]: 5,
  [ShaderEffect.GRAYSCALE]: 3,
  [ShaderEffect.REALITY_GLITCH]: 9,
  [ShaderEffect.KALEIDOSCOPE]: 49,
  [ShaderEffect.DISPLACE]: 45,
  [ShaderEffect.SWIRL]: 37,
  [ShaderEffect.CHROMA]: 13,
  [ShaderEffect.PIXELATE]: 53,
  [ShaderEffect.VORONOI]: 21,
  [ShaderEffect.RIPPLE]: 17,
  [ShaderEffect.FEEDBACK_ECHO]: 57,
  [ShaderEffect.PALETTE_CYCLING]: 61,
  [ShaderEffect.CONTOUR]: 41,
  [ShaderEffect.AURORA]: 33,
  [ShaderEffect.REACTION_DIFFUSION]: 29
};

const DEFAULT_PAD_COLOR = 1;
const NOTE_ON_CHANNEL_1 = 0x90;

// The 8 knobs are banked over all intensity effects: knob N controls
// KNOB_EFFECT_ORDER[activeBank * KNOB_BANK_SIZE + N]. Shift cycles the bank.
export const KNOB_EFFECT_ORDER: ShaderEffect[] = [
  ShaderEffect.REALITY_GLITCH,
  ShaderEffect.DISPLACE,
  ShaderEffect.CHROMA,
  ShaderEffect.PIXELATE,
  ShaderEffect.VORONOI,
  ShaderEffect.RIPPLE,
  ShaderEffect.FEEDBACK_ECHO,
  ShaderEffect.PALETTE_CYCLING,
  ShaderEffect.CONTOUR,
  ShaderEffect.AURORA,
  ShaderEffect.REACTION_DIFFUSION
];

export const KNOB_BANK_SIZE = 8;
export const KNOB_BANK_COUNT = Math.ceil(KNOB_EFFECT_ORDER.length / KNOB_BANK_SIZE);

const FIRST_KNOB_CC = 21;
const SHIFT_CC = 108;

// Launchkey Mini MK3 Session-layout pad notes (top row 96-103, bottom row 112-119,
// the two rows are offset by 16). Pads share the knob order: bank-1 effects fill the
// top row (under knobs 1-8), bank-2 effects fill the bottom-left (under knobs 1-3),
// and the remaining toggle-only effects sit to the right of the bottom row.
const PAD_NOTES = [96, 97, 98, 99, 100, 101, 102, 103, 112, 113, 114, 115, 116, 117, 118, 119];
const TOGGLE_ONLY_EFFECTS = Object.values(ShaderEffect).filter(
  (effect) => !KNOB_EFFECT_ORDER.includes(effect)
);

const PADS: Record<number, ShaderEffect> = {};
[...KNOB_EFFECT_ORDER, ...TOGGLE_ONLY_EFFECTS].forEach((effect, index) => {
  const note = PAD_NOTES[index];
  if (note !== undefined) PADS[note] = effect;
});

interface NoteOnPayload {
  note: number;
  velocity: number;
}

interface ControlChangePayload {
  controller: number;
  value: number;
}

interface ConnectedPayload {
  name: string;
}

export function useMidi(config: MidiConfig) {
  const connected = ref(false);
  const deviceName = ref('');
  const activeBank = ref(0);

  const lastIntensityValue: Partial<Record<ShaderEffect, number>> = {};
  let unlisteners: UnlistenFn[] = [];

  function send(message: number[]) {
    if (!connected.value) return;
    void invoke('midi_send', { message });
  }

  function setPadLed(note: number, effect: ShaderEffect, active: boolean) {
    const color = active ? (PAD_COLORS[effect] ?? DEFAULT_PAD_COLOR) : 0;
    send([NOTE_ON_CHANNEL_1, note, color]);
  }

  function syncAllLeds() {
    const states = config.activeEffects?.value;
    for (const [note, effect] of Object.entries(PADS)) {
      setPadLed(Number(note), effect, !!states?.[effect]);
    }
  }

  function handleNoteOn(note: number) {
    const effect = PADS[note];
    if (effect) config.onEffectToggle(effect);
  }

  function handleControlChange(ccNumber: number, value: number) {
    if (ccNumber === SHIFT_CC) {
      if (value > 0) activeBank.value = (activeBank.value + 1) % KNOB_BANK_COUNT;
      return;
    }

    const knobIndex = ccNumber - FIRST_KNOB_CC;
    if (knobIndex < 0 || knobIndex >= KNOB_BANK_SIZE) return;
    const effect = KNOB_EFFECT_ORDER[activeBank.value * KNOB_BANK_SIZE + knobIndex];
    if (effect === undefined) return;

    const lastValue = lastIntensityValue[effect] ?? -1;
    if (value === lastValue) return;
    lastIntensityValue[effect] = value;

    let intensity = value / 127;
    if (value <= 2) intensity = 0;
    if (value >= 125) intensity = 1;
    intensity = Math.max(0, Math.min(1, intensity));
    config.onIntensityChange(effect, intensity);
  }

  async function initialize() {
    unlisteners = await Promise.all([
      listen<ConnectedPayload>('midi:connected', (event) => {
        connected.value = true;
        deviceName.value = event.payload.name;
        syncAllLeds();
        config.onMidiConnect?.();
      }),
      listen('midi:disconnected', () => {
        connected.value = false;
        deviceName.value = '';
      }),
      listen<NoteOnPayload>('midi:noteon', (event) => handleNoteOn(event.payload.note)),
      listen<ControlChangePayload>('midi:controlchange', (event) =>
        handleControlChange(event.payload.controller, event.payload.value)
      )
    ]);

    const current = await invoke<string | null>('midi_status');
    if (current && !connected.value) {
      connected.value = true;
      deviceName.value = current;
      syncAllLeds();
      config.onMidiConnect?.();
    }
  }

  if (config.activeEffects) {
    watch(config.activeEffects, () => syncAllLeds(), { deep: true });
  }

  function teardown() {
    unlisteners.forEach((unlisten) => unlisten());
    unlisteners = [];
    connected.value = false;
    deviceName.value = '';
  }

  onMounted(() => initialize());
  onUnmounted(() => teardown());

  return { connected, deviceName, activeBank };
}
