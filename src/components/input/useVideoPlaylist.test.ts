import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, type Ref } from 'vue';
import { withSetup } from '../../test/utils';
import { useVideoPlaylist } from './useVideoPlaylist';

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://localhost${path}`
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn()
}));

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(undefined),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined)
  })
}));

describe('useVideoPlaylist', () => {
  let videoElement: HTMLVideoElement;
  let videoRef: Ref<HTMLVideoElement | null>;
  let inputSourceRef: Ref<string>;

  beforeEach(() => {
    videoElement = document.createElement('video');
    videoElement.play = vi.fn().mockResolvedValue(undefined);
    videoElement.pause = vi.fn();
    Object.defineProperty(videoElement, 'readyState', {
      writable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA
    });
    Object.defineProperty(videoElement, 'currentTime', { writable: true, value: 0 });
    Object.defineProperty(videoElement, 'duration', { writable: true, value: 100 });

    videoRef = ref<HTMLVideoElement | null>(videoElement);
    inputSourceRef = ref('webcam');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with empty video playlist', () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    expect(result.videoPlaylist.value).toHaveLength(0);
    expect(result.selectedVideoIndex.value).toBe(0);
    expect(result.loadedVideoIndex.value).toBe(0);
    expect(result.isVideoPlaying.value).toBe(false);
    cleanup();
  });

  it('should select a video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    result.handleVideoSelect(0);
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should add videos to playlist', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/videos/test.mp4']);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(1);
    expect(result.videoPlaylist.value[0].name).toBe('test.mp4');
    expect(result.videoPlaylist.value[0].src).toBe('asset://localhost/videos/test.mp4');
    expect(inputSourceRef.value).toBe('video');
    cleanup();
  });

  it('should remove video from playlist', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/video.mp4']);
    await nextTick();
    const id = result.videoPlaylist.value[0].id;

    result.handleRemoveFromPlaylist(id);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(0);
    cleanup();
  });

  it('should adjust selected index when removing video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/v1.mp4', '/v2.mp4']);
    await nextTick();
    expect(result.videoPlaylist.value).toHaveLength(2);

    result.handleVideoSelect(1);
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(1);

    const videoToRemove = result.videoPlaylist.value[1];
    result.handleRemoveFromPlaylist(videoToRemove.id);
    await nextTick();

    expect(result.selectedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should play video when inputSource is video', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleVideoPlayPause();
    await new Promise((r) => setTimeout(r, 0));

    expect(videoElement.play).toHaveBeenCalled();
    cleanup();
  });

  it('should pause video when playing', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.isVideoPlaying.value = true;
    result.handleVideoPlayPause();
    await nextTick();

    expect(videoElement.pause).toHaveBeenCalled();
    expect(result.isVideoPlaying.value).toBe(false);
    expect(result.videoPausedManually.value).toBe(true);
    cleanup();
  });

  it('should not play/pause when inputSource is not video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    result.handleVideoPlayPause();
    await nextTick();

    expect(videoElement.play).not.toHaveBeenCalled();
    expect(videoElement.pause).not.toHaveBeenCalled();
    cleanup();
  });

  it('should navigate to next video when playing', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4']);
    await nextTick();
    expect(result.videoPlaylist.value).toHaveLength(2);

    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 0;
    result.handleNextVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(1);
    expect(result.selectedVideoIndex.value).toBe(1);
    cleanup();
  });

  it('should wrap around to first video when at end', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4']);
    await nextTick();
    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 1;
    result.handleNextVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should navigate to previous video when playing', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4']);
    await nextTick();
    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 1;
    result.handlePreviousVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should wrap around to last video when at beginning', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/a.mp4', '/b.mp4']);
    await nextTick();
    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 0;
    result.handlePreviousVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(1);
    cleanup();
  });

  it('should handle seeking', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleSeek(50);
    await nextTick();

    expect(videoElement.currentTime).toBe(50);
    expect(result.currentTime.value).toBe(50);
    cleanup();
  });

  it('should handle seek start and end', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    expect(result.isSeeking.value).toBe(false);

    result.handleSeekStart();
    await nextTick();
    expect(result.isSeeking.value).toBe(true);

    result.handleSeekEnd();
    await nextTick();
    expect(result.isSeeking.value).toBe(false);
    cleanup();
  });

  it('should not navigate when playlist has only one video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));

    result.handleAddVideosToPlaylist(['/only.mp4']);
    await nextTick();
    expect(result.videoPlaylist.value).toHaveLength(1);
    const initialIndex = result.selectedVideoIndex.value;

    result.handleNextVideo();
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(initialIndex);

    result.handlePreviousVideo();
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(initialIndex);
    cleanup();
  });

  it('should expose reactive refs', () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    expect(typeof result.videoPlaylist).toBe('object');
    expect(typeof result.selectedVideoIndex).toBe('object');
    expect(typeof result.loadedVideoIndex).toBe('object');
    expect(typeof result.isVideoPlaying).toBe('object');
    cleanup();
  });
});
