import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { withSetup } from '../test/utils';
import { useBpmTap } from './useBpmTap';

describe('useBpmTap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('should initialize with default BPM of 120', () => {
    const [result, cleanup] = withSetup(() => useBpmTap());
    expect(result.bpm.value).toBe(120);
    expect(result.isSettingBpm.value).toBe(false);
    cleanup();
  });

  it('should update BPM when spacebar is tapped multiple times', async () => {
    const [result, cleanup] = withSetup(() => useBpmTap());

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    await nextTick();

    expect(result.bpm.value).toBe(120);
    expect(result.isSettingBpm.value).toBe(true);
    cleanup();
  });

  it('should round BPM to nearest 5', async () => {
    const [result, cleanup] = withSetup(() => useBpmTap());

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(472);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(472);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    await nextTick();

    expect(result.bpm.value).toBe(125);
    cleanup();
  });

  it('should clamp BPM between 60 and 200', async () => {
    const [result, cleanup] = withSetup(() => useBpmTap());

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    await nextTick();

    expect(result.bpm.value).toBeLessThanOrEqual(200);
    cleanup();
  });

  it('should ignore repeated keydown events', async () => {
    const [result, cleanup] = withSetup(() => useBpmTap());
    const initialBpm = result.bpm.value;

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', repeat: true }));
    await nextTick();

    expect(result.bpm.value).toBe(initialBpm);
    cleanup();
  });

  it('should reset isSettingBpm after timeout', async () => {
    const [result, cleanup] = withSetup(() => useBpmTap());

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    vi.advanceTimersByTime(500);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    await nextTick();

    expect(result.isSettingBpm.value).toBe(true);

    vi.advanceTimersByTime(1500);
    await nextTick();

    expect(result.isSettingBpm.value).toBe(false);
    cleanup();
  });
});
