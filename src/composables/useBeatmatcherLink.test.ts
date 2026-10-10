import { describe, it, expect, vi } from 'vitest';
import { withSetup } from '@/test/utils';
import { useBeatmatcherLink, type BeatmatcherDeck } from './useBeatmatcherLink';

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (event: { payload: unknown }) => void>()
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: unknown }) => void) => {
    handlers.set(name, handler);
    return Promise.resolve(() => handlers.delete(name));
  }
}));

function deck(overrides: Partial<BeatmatcherDeck>): BeatmatcherDeck {
  return {
    id: 'A',
    isPlaying: true,
    bpm: 128,
    beatOffsetSec: 0,
    positionSec: 0,
    playbackRate: 1,
    effectiveBpm: 128,
    currentBeat: 0,
    ...overrides
  };
}

function emitState(decks: BeatmatcherDeck[]) {
  handlers.get('beatmatcher:state')?.({
    payload: { schemaVersion: 1, epochMs: Date.now(), sampleRate: 44100, decks }
  });
}

describe('useBeatmatcherLink', () => {
  it('only replaces deck status when what the controls show changes', () => {
    const [result, cleanup] = withSetup(() => useBeatmatcherLink());

    emitState([deck({ positionSec: 1, currentBeat: 2 })]);
    const first = result.decks.value;

    emitState([deck({ positionSec: 1.05, currentBeat: 2.1 })]);
    expect(result.decks.value).toBe(first);

    emitState([deck({ positionSec: 1.1, currentBeat: 2.2, effectiveBpm: 130 })]);
    expect(result.decks.value).toEqual([{ id: 'A', isPlaying: true, effectiveBpm: 130 }]);

    cleanup();
  });

  it('keeps the beat clock on the latest snapshot while deck status is unchanged', () => {
    const [result, cleanup] = withSetup(() => useBeatmatcherLink());

    emitState([deck({ currentBeat: 2 })]);
    emitState([deck({ currentBeat: 2.5 })]);

    expect(result.getBeat()?.beat).toBeCloseTo(2.5, 1);
    expect(result.getBeat()?.bpm).toBe(128);
    cleanup();
  });

  it('keeps the shader phase on the reference deck even though the shaders get the average bpm', () => {
    vi.useFakeTimers();
    const [result, cleanup] = withSetup(() => useBeatmatcherLink());

    emitState([
      deck({ id: 'A', effectiveBpm: 128, currentBeat: 10.25 }),
      deck({ id: 'B', effectiveBpm: 124, currentBeat: 3.6 })
    ]);
    const clock = result.getBeatClock()!;

    expect(clock.bpm).toBe(126);
    expect((clock.time * clock.bpm) / 60).toBeCloseTo(10.25, 9);
    cleanup();
    vi.useRealTimers();
  });
});
