import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, type Ref } from 'vue';
import { withSetup } from '@/test/utils';
import { useVideoPlaylist } from './useVideoPlaylist';
import type { InputSource } from '@/broadcast';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined)
  })
}));

describe('useVideoPlaylist', () => {
  let inputSourceRef: Ref<InputSource>;

  beforeEach(() => {
    inputSourceRef = ref<InputSource>('webcam');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with empty video playlist', () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));
    expect(result.videoPlaylist.value).toHaveLength(0);
    expect(result.selectedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should select a video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));
    result.selectedVideoIndex.value = 0;
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should add videos to playlist', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/videos/test.mp4']);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(1);
    expect(result.videoPlaylist.value[0].name).toBe('test.mp4');
    expect(result.videoPlaylist.value[0].src).toBe('asset://localhost/videos/test.mp4');
    expect(inputSourceRef.value).toBe('video');
    cleanup();
  });

  it('should remove video from playlist', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/video.mp4']);
    await nextTick();
    const id = result.videoPlaylist.value[0].id;

    result.removeVideoFromList(id, 0);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(0);
    cleanup();
  });

  it('should adjust selected index when removing video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/v1.mp4', '/v2.mp4']);
    await nextTick();
    expect(result.videoPlaylist.value).toHaveLength(2);

    result.selectedVideoIndex.value = 1;
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(1);

    const videoToRemove = result.videoPlaylist.value[1];
    result.removeVideoFromList(videoToRemove.id, 0);
    await nextTick();

    expect(result.selectedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('removeVideoFromList returns wasLoaded=true when loaded video is removed', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4']);
    await nextTick();

    const id = result.videoPlaylist.value[0].id;
    const { wasLoaded, newLoadedIndex } = result.removeVideoFromList(id, 0);

    expect(wasLoaded).toBe(true);
    expect(newLoadedIndex).toBe(0);
    cleanup();
  });

  it('shifts loaded and selected indices down when an earlier video is removed', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4', '/c.mp4']);
    await nextTick();
    result.selectedVideoIndex.value = 2;

    const id = result.videoPlaylist.value[0].id;
    const { wasLoaded, newLoadedIndex } = result.removeVideoFromList(id, 2);

    expect(wasLoaded).toBe(false);
    expect(newLoadedIndex).toBe(1);
    expect(result.selectedVideoIndex.value).toBe(1);
    expect(result.videoPlaylist.value[1].name).toBe('c.mp4');
    cleanup();
  });

  it('keeps indices unchanged when a later video is removed', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4', '/c.mp4']);
    await nextTick();
    result.selectedVideoIndex.value = 1;

    const id = result.videoPlaylist.value[2].id;
    const { wasLoaded, newLoadedIndex } = result.removeVideoFromList(id, 1);

    expect(wasLoaded).toBe(false);
    expect(newLoadedIndex).toBe(1);
    expect(result.selectedVideoIndex.value).toBe(1);
    cleanup();
  });

  it('removeVideoFromList returns wasLoaded=false when a different video is removed', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4']);
    await nextTick();

    const id = result.videoPlaylist.value[1].id;
    const { wasLoaded } = result.removeVideoFromList(id, 0);

    expect(wasLoaded).toBe(false);
    cleanup();
  });

  it('should expose reactive refs', () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(inputSourceRef));
    expect(typeof result.videoPlaylist).toBe('object');
    expect(typeof result.selectedVideoIndex).toBe('object');
    cleanup();
  });
});
