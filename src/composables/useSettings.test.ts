import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { withSetup } from '../test/utils';
import { useSettings } from './useSettings';
import { settingsService } from '../services/settingsService';

vi.mock('../services/settingsService', () => ({
  settingsService: {
    loadSettings: vi.fn(),
    saveShowHelp: vi.fn(),
    saveMuted: vi.fn(),
    saveInputSource: vi.fn(),
    saveBpm: vi.fn()
  }
}));

describe('useSettings', () => {
  beforeEach(() => {
    vi.mocked(settingsService.loadSettings).mockReturnValue({});
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

  it('should load settings from settingsService on mount', async () => {
    vi.mocked(settingsService.loadSettings).mockReturnValue({
      showHelp: false,
      isMuted: true,
      bpm: 140
    });

    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();

    expect(result.showHelp.value).toBe(false);
    expect(result.isMuted.value).toBe(true);
    expect(result.bpm.value).toBe(140);
    cleanup();
  });

  it('should save showHelp when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(settingsService.saveShowHelp).mockClear();

    result.showHelp.value = false;
    await nextTick();

    expect(settingsService.saveShowHelp).toHaveBeenCalledWith(false);
    cleanup();
  });

  it('should save isMuted when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(settingsService.saveMuted).mockClear();

    result.isMuted.value = true;
    await nextTick();

    expect(settingsService.saveMuted).toHaveBeenCalledWith(true);
    cleanup();
  });

  it('should save inputSource when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(settingsService.saveInputSource).mockClear();

    result.inputSource.value = 'video';
    await nextTick();

    expect(settingsService.saveInputSource).toHaveBeenCalledWith('video');
    cleanup();
  });

  it('should save bpm when changed', async () => {
    const [result, cleanup] = withSetup(() => useSettings());
    await nextTick();
    vi.mocked(settingsService.saveBpm).mockClear();

    result.bpm.value = 150;
    await nextTick();

    expect(settingsService.saveBpm).toHaveBeenCalledWith(150);
    cleanup();
  });

  it('should save loaded settings after initialization', async () => {
    vi.mocked(settingsService.loadSettings).mockReturnValue({
      showHelp: false,
      isMuted: true
    });
    vi.mocked(settingsService.saveShowHelp).mockClear();
    vi.mocked(settingsService.saveMuted).mockClear();

    const [, cleanup] = withSetup(() => useSettings());
    await nextTick();

    expect(settingsService.saveShowHelp).toHaveBeenCalledWith(false);
    expect(settingsService.saveMuted).toHaveBeenCalledWith(true);
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
