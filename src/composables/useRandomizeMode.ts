import { ref, onUnmounted, type Ref } from 'vue';
import { ShaderEffect, shaderEffects } from '@/utils';
import type { VideoPlaylistItem } from '@/components/input/useVideoPlaylist';

const WAIT_BEATS = [16, 32] as const;
const KEEP_VIDEO_PROBABILITY = 0.2;
const LATE_THRESHOLD_BEATS = 1.5;
// The followed beat count only drops by more than this when the reference deck changes
// or jumps back (new track, cue), and waiting for it to catch up could take minutes.
const JUMP_BACK_THRESHOLD_BEATS = 1;

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
  [ShaderEffect.AURORA]: 0.4,
  [ShaderEffect.REACTION_DIFFUSION]: 0.2
};

export interface RandomizeSnapshot {
  videoIndex: number;
  seekFraction: number;
  effects: Record<ShaderEffect, boolean>;
  intensities: Record<ShaderEffect, number>;
}

const BEAT_POLL_MS = 50;
// The controls window extrapolates the phrase from its own clock, so smaller drifts of the
// followed deck aren't worth a re-broadcast.
const PHRASE_DRIFT_MS = 15;

export interface BeatSource {
  beat: number;
  bpm: number;
}

// Absolute (epoch ms) so the controls window can count the beats from its own clock instead
// of being sent each one late and unevenly.
export interface RandomizePhrase {
  startedAt: number;
  beatMs: number;
  total: number;
}

export function useRandomizeMode(
  bpm: Ref<number>,
  videoPlaylist: Ref<VideoPlaylistItem[]>,
  loadedVideoIndex: Ref<number>,
  onApply: (snapshot: RandomizeSnapshot) => void,
  onSchedule?: (snapshot: RandomizeSnapshot) => void,
  getBeat?: () => BeatSource | null
) {
  const isActive = ref(false);
  const phrase = ref<RandomizePhrase | null>(null);
  // The renderer phase-locks the shaders' beat pulses to this (performance.now() ms), so the
  // pulses, the counter and the switches share one beat grid.
  let beatGridOrigin = 0;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: RandomizeSnapshot | null = null;
  let intervalTotal = 0;
  let beatDriven = false;
  let intervalStartBeat = 0;
  let lastBeatNow = 0;

  // Local re-stamp of "beat 1", since Beatmatcher's beat grid can be mis-analyzed
  // or the user may simply want phrase switches to land on a different downbeat.
  let phraseOffset = 0;

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

    // The two noisiest are left out so a lone effect is a pleasant one.
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
      seekFraction: 0.05 + Math.random() * 0.85,
      ...buildEffects()
    };
  }

  function beatMs(): number {
    return (60 / bpm.value) * 1000;
  }

  function epochNow(): number {
    return performance.timeOrigin + performance.now();
  }

  // Every new object re-broadcasts the whole app state, so it only changes when the phrase
  // or its tempo really does.
  function setPhrase(startedAt: number, phraseBeatMs: number) {
    const current = phrase.value;
    if (
      current &&
      current.total === intervalTotal &&
      Math.abs(current.startedAt - startedAt) < PHRASE_DRIFT_MS &&
      Math.abs(current.beatMs - phraseBeatMs) < 0.5
    ) {
      return;
    }
    phrase.value = { startedAt, beatMs: phraseBeatMs, total: intervalTotal };
  }

  function syncPhraseToBeat(source: BeatSource) {
    const sourceBeatMs = 60000 / source.bpm;
    setPhrase(epochNow() - (source.beat - intervalStartBeat) * sourceBeatMs, sourceBeatMs);
  }

  function nextPhraseBoundary(beatNow: number, total: number): number {
    const cyclesPassed = Math.floor((beatNow - phraseOffset) / total);
    return phraseOffset + (cyclesPassed + 1) * total;
  }

  function queueNext() {
    intervalTotal = WAIT_BEATS[Math.floor(Math.random() * WAIT_BEATS.length)];
    pendingSnapshot = buildSnapshot();
    onSchedule?.(pendingSnapshot);
  }

  function applyPending() {
    if (pendingSnapshot) onApply(pendingSnapshot);
    queueNext();
  }

  function clearWallTimer() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  function anchorToBeat(fromBeat: number) {
    clearWallTimer();
    beatDriven = true;
    intervalStartBeat = nextPhraseBoundary(fromBeat, intervalTotal) - intervalTotal;
  }

  function anchorToWall(start: number) {
    clearWallTimer();
    beatDriven = false;
    beatGridOrigin = start;
    const ms = beatMs();
    const switchAt = start + intervalTotal * ms;
    setPhrase(performance.timeOrigin + start, ms);
    timeoutId = setTimeout(
      () => {
        timeoutId = null;
        if (!isActive.value) return;
        applyPending();
        // If the timer fired more than 1.5 beats late (fullscreen transition, app suspend,
        // etc.), re-anchor from now so subsequent switches resume correctly rather than
        // cascading at zero delay trying to catch up.
        const now = performance.now();
        anchorToWall(now - switchAt > LATE_THRESHOLD_BEATS * ms ? now : switchAt);
      },
      Math.max(0, switchAt - performance.now())
    );
  }

  function pollBeatClock() {
    const source = getBeat?.() ?? null;
    if (source === null) {
      // The beat clock dropped out (Beatmatcher quit, or no deck is playing), so the rest
      // of the phrase carries over to the manual BPM instead of switching stopping.
      if (beatDriven) {
        const beatsIn = Math.min(Math.max(0, lastBeatNow - intervalStartBeat), intervalTotal);
        anchorToWall(performance.now() - beatsIn * beatMs());
      }
      return;
    }

    const beatNow = source.beat;
    if (!beatDriven || beatNow < intervalStartBeat - JUMP_BACK_THRESHOLD_BEATS) {
      anchorToBeat(beatNow);
    }
    lastBeatNow = beatNow;

    const targetBeat = intervalStartBeat + intervalTotal;
    if (beatNow >= targetBeat) {
      applyPending();
      // If the poll picked this up more than 1.5 beats past the target (tab was
      // backgrounded, system slept, etc.), re-anchor from now instead of replaying
      // every missed phrase boundary in a rapid-fire catch-up burst.
      anchorToBeat(beatNow - targetBeat > LATE_THRESHOLD_BEATS ? beatNow : targetBeat);
    }
    syncPhraseToBeat(source);
  }

  function restartBeat() {
    if (!isActive.value) return;

    const source = getBeat?.() ?? null;
    if (source !== null) {
      phraseOffset = source.beat;
      lastBeatNow = source.beat;
      anchorToBeat(source.beat);
      syncPhraseToBeat(source);
    } else {
      anchorToWall(performance.now());
    }
  }

  function toggle() {
    if (isActive.value) {
      isActive.value = false;
      phrase.value = null;
      pendingSnapshot = null;
      clearWallTimer();
      if (pollId !== null) {
        clearInterval(pollId);
        pollId = null;
      }
    } else {
      isActive.value = true;
      onApply(buildSnapshot());
      queueNext();

      const source = getBeat?.() ?? null;
      if (source !== null) {
        lastBeatNow = source.beat;
        anchorToBeat(source.beat);
        syncPhraseToBeat(source);
      } else {
        anchorToWall(performance.now());
      }
      pollId = setInterval(pollBeatClock, BEAT_POLL_MS);
    }
  }

  onUnmounted(() => {
    clearWallTimer();
    if (pollId !== null) clearInterval(pollId);
  });

  return { isActive, phrase, toggle, restartBeat, getBeatGridOrigin: () => beatGridOrigin };
}
