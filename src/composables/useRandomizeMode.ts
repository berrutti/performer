import { ref, onUnmounted, type Ref } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import type { VideoPlaylistItem } from '@/components/input/useVideoPlaylist';

const WAIT_BEATS = [8, 16, 32] as const;
const KEEP_VIDEO_PROBABILITY = 0.35;

// Per-effect probability of appearing in a random snapshot.
// Sum ~5.3 across 14 effects → ~4-5 active on average.
// REALITY_GLITCH and PALETTE_CYCLING are kept rare so they feel special.
const EFFECT_WEIGHTS: Record<ShaderEffect, number> = {
  [ShaderEffect.INVERT]: 0.35,
  [ShaderEffect.GRAYSCALE]: 0.35,
  [ShaderEffect.REALITY_GLITCH]: 0.1,
  [ShaderEffect.KALEIDOSCOPE]: 0.5,
  [ShaderEffect.DISPLACE]: 0.45,
  [ShaderEffect.SWIRL]: 0.45,
  [ShaderEffect.CHROMA]: 0.5,
  [ShaderEffect.PIXELATE]: 0.4,
  [ShaderEffect.VORONOI]: 0.5,
  [ShaderEffect.RIPPLE]: 0.45,
  [ShaderEffect.FEEDBACK_ECHO]: 0.4,
  [ShaderEffect.PALETTE_CYCLING]: 0.15,
  [ShaderEffect.CONTOUR]: 0.45,
  [ShaderEffect.AURORA]: 0.4
};

export interface RandomizeSnapshot {
  videoIndex: number;
  seekFraction: number;
  effects: Record<ShaderEffect, boolean>;
  intensities: Record<ShaderEffect, number>;
}

export function useRandomizeMode(
  bpm: Ref<number>,
  videoPlaylist: Ref<VideoPlaylistItem[]>,
  loadedVideoIndex: Ref<number>,
  onApply: (snapshot: RandomizeSnapshot) => void,
  onSchedule?: (snapshot: RandomizeSnapshot) => void
) {
  const isActive = ref(false);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  function buildEffects(): {
    effects: Record<ShaderEffect, boolean>;
    intensities: Record<ShaderEffect, number>;
  } {
    const effects = Object.values(ShaderEffect).reduce(
      (acc, e) => ({ ...acc, [e]: false }),
      {} as Record<ShaderEffect, boolean>
    );
    const intensities = Object.values(ShaderEffect).reduce(
      (acc, e) => ({ ...acc, [e]: shaderEffects[e].intensity ?? 1.0 }),
      {} as Record<ShaderEffect, number>
    );

    const selected: ShaderEffect[] = [];
    for (const e of Object.values(ShaderEffect)) {
      if (Math.random() < EFFECT_WEIGHTS[e]) {
        selected.push(e);
      }
    }

    // Guarantee at least one effect, excluding the two noisiest so a solo appearance is pleasant
    if (selected.length === 0) {
      const candidates = Object.values(ShaderEffect).filter(
        (e) => e !== ShaderEffect.REALITY_GLITCH && e !== ShaderEffect.PALETTE_CYCLING
      );
      selected.push(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    for (const e of selected) {
      effects[e] = true;
      if (shaderEffects[e].intensity !== undefined) {
        intensities[e] = 0.3 + Math.random() * 0.7;
      }
    }

    return { effects, intensities };
  }

  function pickVideoIndex(): number {
    const playlist = videoPlaylist.value;
    if (playlist.length <= 1) return 0;

    if (Math.random() < KEEP_VIDEO_PROBABILITY) {
      return loadedVideoIndex.value;
    }

    const otherIndices = playlist.map((_, i) => i).filter((i) => i !== loadedVideoIndex.value);
    return otherIndices[Math.floor(Math.random() * otherIndices.length)];
  }

  function buildSnapshot(): RandomizeSnapshot {
    return {
      videoIndex: pickVideoIndex(),
      // Avoid the very beginning and end of clips
      seekFraction: 0.05 + Math.random() * 0.85,
      ...buildEffects()
    };
  }

  function scheduleNext() {
    const beats = WAIT_BEATS[Math.floor(Math.random() * WAIT_BEATS.length)];
    const beatMs = (60 / bpm.value) * 1000;
    const nextSnapshot = buildSnapshot();
    onSchedule?.(nextSnapshot);

    timeoutId = setTimeout(() => {
      if (!isActive.value) return;
      onApply(nextSnapshot);
      scheduleNext();
    }, beats * beatMs);
  }

  function toggle() {
    if (isActive.value) {
      isActive.value = false;
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    } else {
      isActive.value = true;
      const firstSnapshot = buildSnapshot();
      onApply(firstSnapshot);
      scheduleNext();
    }
  }

  onUnmounted(() => {
    if (timeoutId !== null) clearTimeout(timeoutId);
  });

  return { isActive, toggle };
}
