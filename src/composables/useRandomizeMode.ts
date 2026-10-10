import { ref, onUnmounted, type Ref } from 'vue';
import { ShaderEffect, shaderEffects, buildEffectRecord } from '@/utils';
import type { VideoPlaylistItem } from '@/components/input/useVideoPlaylist';

const WAIT_BEATS = [16, 32] as const;
const KEEP_VIDEO_PROBABILITY = 0.2;
const LATE_THRESHOLD_BEATS = 1.5;
const JUMP_BACK_THRESHOLD_BEATS = 1;
const BEAT_POLL_MS = 50;
const PHRASE_DRIFT_MS = 15;

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
const NOISY_EFFECTS = [ShaderEffect.REALITY_GLITCH, ShaderEffect.PALETTE_CYCLING];

export interface RandomizeSnapshot {
  videoIndex: number;
  seekFraction: number;
  effects: Record<ShaderEffect, boolean>;
  intensities: Record<ShaderEffect, number>;
}

export interface BeatSource {
  beat: number;
  bpm: number;
}

// Epoch ms because each window's performance.now() counts from its own origin.
export interface RandomizePhrase {
  startedAt: number;
  beatMs: number;
  total: number;
}

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export function beatInPhrase(phrase: RandomizePhrase, nowMs: number): number {
  const beat = Math.floor((nowMs - phrase.startedAt) / phrase.beatMs) + 1;
  return Math.min(Math.max(1, beat), phrase.total);
}

export function beatGridClock(timeSec: number, bpm: number, gridOriginMs: number) {
  return { time: timeSec - ((gridOriginMs / 1000) % (60 / bpm)), bpm };
}

function buildEffects(): Pick<RandomizeSnapshot, 'effects' | 'intensities'> {
  const selected = Object.values(ShaderEffect).filter((e) => Math.random() < EFFECT_WEIGHTS[e]);
  if (selected.length === 0) {
    const candidates = Object.values(ShaderEffect).filter((e) => !NOISY_EFFECTS.includes(e));
    selected.push(candidates[Math.floor(Math.random() * candidates.length)]);
  }

  const intensities = buildEffectRecord((e) => shaderEffects[e].intensity ?? 1.0);
  for (const e of selected) {
    if (shaderEffects[e].intensity !== undefined) intensities[e] = 0.3 + Math.random() * 0.7;
  }
  return { effects: buildEffectRecord((e) => selected.includes(e)), intensities };
}

function pickVideoIndex(playlistLength: number, loadedIndex: number): number {
  if (playlistLength <= 1) return 0;
  if (Math.random() < KEEP_VIDEO_PROBABILITY) return loadedIndex;
  const others = Array.from({ length: playlistLength }, (_, i) => i).filter(
    (i) => i !== loadedIndex
  );
  return others[Math.floor(Math.random() * others.length)];
}

function buildSnapshot(playlistLength: number, loadedIndex: number): RandomizeSnapshot {
  return {
    videoIndex: pickVideoIndex(playlistLength, loadedIndex),
    seekFraction: 0.05 + Math.random() * 0.85,
    ...buildEffects()
  };
}

function nextPhraseBoundary(beatNow: number, total: number, offset: number): number {
  return offset + (Math.floor((beatNow - offset) / total) + 1) * total;
}

function resumeFrom(target: number, now: number, maxLateness: number): number {
  return now - target > maxLateness ? now : target;
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
  let beatGridOrigin = 0;
  let pollId: ReturnType<typeof setInterval> | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingSnapshot: RandomizeSnapshot | null = null;
  let intervalTotal = 0;
  let beatDriven = false;
  let intervalStartBeat = 0;
  let lastBeatNow = 0;
  let phraseOffset = 0;

  function snapshot(): RandomizeSnapshot {
    return buildSnapshot(videoPlaylist.value.length, loadedVideoIndex.value);
  }

  function beatMs(): number {
    return (60 / bpm.value) * 1000;
  }

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

  function queueNext() {
    intervalTotal = WAIT_BEATS[Math.floor(Math.random() * WAIT_BEATS.length)];
    pendingSnapshot = snapshot();
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
    intervalStartBeat = nextPhraseBoundary(fromBeat, intervalTotal, phraseOffset) - intervalTotal;
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
        anchorToWall(resumeFrom(switchAt, performance.now(), LATE_THRESHOLD_BEATS * ms));
      },
      Math.max(0, switchAt - performance.now())
    );
  }

  function pollBeatClock() {
    const source = getBeat?.() ?? null;
    if (source === null) {
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
      anchorToBeat(resumeFrom(targetBeat, beatNow, LATE_THRESHOLD_BEATS));
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
      onApply(snapshot());
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
