import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { withSetup } from '../test/utils';
import { useSettings } from './useSettings';

describe('useSettings', () => {
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => store[key] ?? null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key, value) => {
      store[key] = value;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default values', () => {
    const [result, cleanup] = withSetup(() => useSettings());
    expect(result.showHelp.value).toBe(true);
    expect(result.isMuted.value).toBe(false);
    expect(result.inputSource.value).toBe('webcam');
    expect(result.bpm.value).toBe(120);
    cleanup();
  });

  it('should load settings from localStorage on mount', async () => {
    store['performer-showHelp'] = 'false';
    store['performer-muted'] = 'true';
    store['performer-bpm'] = '140';

    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();

    expect(result.showHelp.value).toBe(false);
    expect(result.isMuted.value).toBe(true);
    expect(result.bpm.value).toBe(140);
    cleanup();
  });

  it('should save showHelp to localStorage when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(Storage.prototype.setItem).mockClear();

    result.showHelp.value = false;
    await nextTick();

    expect(Storage.prototype.setItem).toHaveBeenCalledWith('performer-showHelp', 'false');
    cleanup();
  });

  it('should save isMuted to localStorage when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(Storage.prototype.setItem).mockClear();

    result.isMuted.value = true;
    await nextTick();

    expect(Storage.prototype.setItem).toHaveBeenCalledWith('performer-muted', 'true');
    cleanup();
  });

  it('should save inputSource to localStorage when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(Storage.prototype.setItem).mockClear();

    result.inputSource.value = 'video';
    await nextTick();

    expect(Storage.prototype.setItem).toHaveBeenCalledWith('performer-inputSource', '"video"');
    cleanup();
  });

  it('should save bpm to localStorage when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(Storage.prototype.setItem).mockClear();

    result.bpm.value = 150;
    await nextTick();

    expect(Storage.prototype.setItem).toHaveBeenCalledWith('performer-bpm', '150');
    cleanup();
  });

  it('should expose reactive refs', () => {
    const [result, cleanup] = withSetup(() => useSettings());
    expect(typeof result.showHelp).toBe('object');
    expect(typeof result.isMuted).toBe('object');
    expect(typeof result.inputSource).toBe('object');
    expect(typeof result.bpm).toBe('object');
    cleanup();
  });
});
