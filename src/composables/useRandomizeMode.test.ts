import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { withSetup } from '@/test/utils';
import { useRandomizeMode, beatInPhrase, beatGridClock } from './useRandomizeMode';
import { ShaderEffect } from '@/utils';
import type { VideoPlaylistItem } from '@/components/input/useVideoPlaylist';

function makePlaylist(n: number): VideoPlaylistItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `video-${i}`,
    name: `video${i}.mp4`,
    src: `asset://localhost/video${i}.mp4`,
    path: `/video${i}.mp4`
  }));
}

function beatAt(beat: number | null) {
  return beat === null ? null : { beat, bpm: 120 };
}

describe('useRandomizeMode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('calls onApply immediately when toggled on', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply)
    );
    result.toggle();
    expect(onApply).toHaveBeenCalledOnce();
    cleanup();
  });

  it('calls onApply again after the beat interval', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(60), ref(makePlaylist(2)), ref(0), onApply)
    );
    result.toggle();
    onApply.mockClear();
    const longestPhraseMs = 32 * 1000;
    vi.advanceTimersByTime(longestPhraseMs + 1000);
    expect(onApply).toHaveBeenCalled();
    cleanup();
  });

  it('re-anchors from now instead of rapid-firing catch-up switches after a long gap in a beat-driven clock', () => {
    const onApply = vi.fn();
    let beatNow = 0;
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply, undefined, () =>
        beatAt(beatNow)
      )
    );
    result.toggle();
    onApply.mockClear();

    beatNow = 10000;
    vi.advanceTimersByTime(50);
    expect(onApply).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50);
    expect(onApply).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('switches on phrase boundaries of the beat clock rather than counting from when it was turned on', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const onApply = vi.fn();
    let beatNow = 5;
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply, undefined, () =>
        beatAt(beatNow)
      )
    );
    result.toggle();
    onApply.mockClear();

    beatNow = 15.9;
    vi.advanceTimersByTime(50);
    expect(onApply).not.toHaveBeenCalled();
    beatNow = 16.1;
    vi.advanceTimersByTime(50);
    expect(onApply).toHaveBeenCalledOnce();
    cleanup();
  });

  it('keeps switching on the manual BPM when the beat clock drops out mid-phrase', () => {
    const onApply = vi.fn();
    const onSchedule = vi.fn();
    let beatNow: number | null = 0;
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply, onSchedule, () =>
        beatAt(beatNow)
      )
    );
    result.toggle();
    onApply.mockClear();

    beatNow = 4;
    vi.advanceTimersByTime(50);
    beatNow = null;
    vi.advanceTimersByTime(50);
    expect(onSchedule).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(onApply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10000);
    expect(onApply).toHaveBeenCalled();
    cleanup();
  });

  it('re-anchors when the followed beat count jumps back instead of waiting to catch up', () => {
    const onApply = vi.fn();
    let beatNow = 300;
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply, undefined, () =>
        beatAt(beatNow)
      )
    );
    result.toggle();
    onApply.mockClear();

    beatNow = 10;
    vi.advanceTimersByTime(50);
    beatNow = 33;
    vi.advanceTimersByTime(50);

    expect(onApply).toHaveBeenCalledOnce();
    cleanup();
  });

  it('locks onto the beat clock once it becomes available', () => {
    const onApply = vi.fn();
    let beatNow: number | null = null;
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(60), ref(makePlaylist(2)), ref(0), onApply, undefined, () =>
        beatAt(beatNow)
      )
    );
    result.toggle();
    onApply.mockClear();

    beatNow = 0.5;
    vi.advanceTimersByTime(50);
    beatNow = 32.1;
    vi.advanceTimersByTime(50);
    expect(onApply).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(40000);
    expect(onApply).toHaveBeenCalledOnce();
    cleanup();
  });

  it('publishes the phrase timing once per phrase rather than every beat', () => {
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), vi.fn())
    );
    result.toggle();
    const first = result.phrase.value!;
    expect(first.beatMs).toBe(500);
    expect(first.startedAt).toBeCloseTo(performance.timeOrigin + performance.now(), 0);

    vi.advanceTimersByTime(3000);
    expect(result.phrase.value).toBe(first);

    vi.advanceTimersByTime(first.total * 500);
    expect(result.phrase.value).not.toBe(first);
    expect(result.phrase.value!.startedAt).toBeCloseTo(first.startedAt + first.total * 500, 0);
    cleanup();
  });

  it('times the phrase from the followed beat clock', () => {
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(90), ref(makePlaylist(2)), ref(0), vi.fn(), undefined, () => beatAt(2))
    );
    result.toggle();
    expect(result.phrase.value!.beatMs).toBe(500);
    expect(result.phrase.value!.startedAt).toBeCloseTo(
      performance.timeOrigin + performance.now() - 1000,
      0
    );
    cleanup();
  });

  it('moves the beat grid origin to where the phrase restarts', () => {
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), vi.fn())
    );
    vi.advanceTimersByTime(1234);
    result.toggle();
    expect(result.getBeatGridOrigin()).toBe(performance.now());

    vi.advanceTimersByTime(700);
    result.restartBeat();
    expect(result.getBeatGridOrigin()).toBe(performance.now());
    cleanup();
  });

  it('calls onSchedule when the next snapshot is queued', () => {
    const onApply = vi.fn();
    const onSchedule = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(60), ref(makePlaylist(2)), ref(0), onApply, onSchedule)
    );
    result.toggle();
    expect(onSchedule).toHaveBeenCalled();
    cleanup();
  });

  it('stops firing after being toggled off', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(60), ref(makePlaylist(2)), ref(0), onApply)
    );
    result.toggle();
    result.toggle();
    onApply.mockClear();
    vi.advanceTimersByTime(60000);
    expect(onApply).not.toHaveBeenCalled();
    cleanup();
  });

  it('isActive reflects toggle state', () => {
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), vi.fn())
    );
    expect(result.isActive.value).toBe(false);
    result.toggle();
    expect(result.isActive.value).toBe(true);
    result.toggle();
    expect(result.isActive.value).toBe(false);
    cleanup();
  });

  it('snapshot always has at least one effect active', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply)
    );
    for (let i = 0; i < 30; i++) {
      result.toggle();
      result.toggle();
    }
    for (const [snapshot] of onApply.mock.calls) {
      expect(Object.values(snapshot.effects).some(Boolean)).toBe(true);
    }
    cleanup();
  });

  it('turns on five to six effects per scene on average', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply)
    );
    for (let i = 0; i < 1000; i++) {
      result.toggle();
      result.toggle();
    }
    const counts = onApply.mock.calls.map(
      ([snapshot]) => Object.values(snapshot.effects).filter(Boolean).length
    );
    const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
    expect(average).toBeGreaterThan(5);
    expect(average).toBeLessThan(6);
    cleanup();
  });

  it('seekFraction stays within the safe 0.05–0.90 range', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply)
    );
    for (let i = 0; i < 30; i++) {
      result.toggle();
      result.toggle();
    }
    for (const [snapshot] of onApply.mock.calls) {
      expect(snapshot.seekFraction).toBeGreaterThanOrEqual(0.05);
      expect(snapshot.seekFraction).toBeLessThanOrEqual(0.9);
    }
    cleanup();
  });

  it('snapshot intensities are in the 0.3–1.0 range', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(2)), ref(0), onApply)
    );
    for (let i = 0; i < 30; i++) {
      result.toggle();
      result.toggle();
    }
    for (const [snapshot] of onApply.mock.calls) {
      for (const effect of Object.values(ShaderEffect)) {
        if (snapshot.effects[effect]) {
          expect(snapshot.intensities[effect]).toBeGreaterThanOrEqual(0.3);
          expect(snapshot.intensities[effect]).toBeLessThanOrEqual(1.0);
        }
      }
    }
    cleanup();
  });

  it('picks a different video index at least some of the time with multiple videos', () => {
    const onApply = vi.fn();
    const [result, cleanup] = withSetup(() =>
      useRandomizeMode(ref(120), ref(makePlaylist(5)), ref(0), onApply)
    );
    for (let i = 0; i < 50; i++) {
      result.toggle();
      result.toggle();
    }
    const indices = onApply.mock.calls.map(([s]) => s.videoIndex);
    const unique = new Set(indices);
    expect(unique.size).toBeGreaterThan(1);
    cleanup();
  });
});

describe('beatInPhrase', () => {
  const phrase = { startedAt: 10000, beatMs: 500, total: 16 };

  it('counts beats from 1 at the phrase start', () => {
    expect(beatInPhrase(phrase, 10000)).toBe(1);
    expect(beatInPhrase(phrase, 10499)).toBe(1);
    expect(beatInPhrase(phrase, 10500)).toBe(2);
  });

  it('stays within the phrase when the clock is outside it', () => {
    expect(beatInPhrase(phrase, 9000)).toBe(1);
    expect(beatInPhrase(phrase, 99999)).toBe(16);
  });
});

describe('beatGridClock', () => {
  it('lands the shader beats on the randomize beat grid', () => {
    const gridOriginMs = 1234;
    const clock = beatGridClock(gridOriginMs / 1000 + 3 * 0.5, 120, gridOriginMs);
    const beats = (clock.time * clock.bpm) / 60;
    expect(Math.abs(beats - Math.round(beats))).toBeLessThan(1e-9);
  });
});
