import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick, type Ref } from 'vue';
import { withSetup } from '@/test/utils';
import { useVideoPlayer } from './useVideoPlayer';
import type { VideoPlaylistItem } from './useVideoPlaylist';
import type { InputSource } from '@/broadcast';

describe('useVideoPlayer', () => {
  let videoElement: HTMLVideoElement;
  let videoRef: Ref<HTMLVideoElement | null>;
  let randomizeRef1: Ref<HTMLVideoElement | null>;
  let randomizeRef2: Ref<HTMLVideoElement | null>;
  let videoPlaylist: Ref<VideoPlaylistItem[]>;
  let selectedVideoIndex: Ref<number>;
  let inputSourceRef: Ref<InputSource>;
  let isMutedRef: Ref<boolean>;

  function setup() {
    return withSetup(() =>
      useVideoPlayer({
        videoRef,
        randomizeRef1,
        randomizeRef2,
        videoPlaylist,
        selectedVideoIndex,
        inputSource: inputSourceRef,
        isMuted: isMutedRef
      })
    );
  }

  function makeItems(paths: string[]): VideoPlaylistItem[] {
    return paths.map((p, i) => ({
      id: `video-${i}`,
      name: p.split('/').pop() ?? p,
      src: `asset://localhost${p}`,
      path: p
    }));
  }

  beforeEach(() => {
    videoElement = document.createElement('video');
    videoElement.play = vi.fn().mockImplementation(() => {
      videoElement.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    videoElement.pause = vi.fn().mockImplementation(() => {
      videoElement.dispatchEvent(new Event('pause'));
    });
    Object.defineProperty(videoElement, 'readyState', {
      writable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA
    });
    Object.defineProperty(videoElement, 'currentTime', { writable: true, value: 0 });
    Object.defineProperty(videoElement, 'duration', { writable: true, value: 100 });

    videoRef = ref<HTMLVideoElement | null>(videoElement);
    randomizeRef1 = ref<HTMLVideoElement | null>(null);
    randomizeRef2 = ref<HTMLVideoElement | null>(null);
    videoPlaylist = ref<VideoPlaylistItem[]>([]);
    selectedVideoIndex = ref(0);
    inputSourceRef = ref<InputSource>('webcam');
    isMutedRef = ref(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should play video when inputSource is video', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/test.mp4']);
    const [result, cleanup] = setup();

    await result.handleVideoPlayPause();
    await new Promise((r) => setTimeout(r, 0));

    expect(videoElement.play).toHaveBeenCalled();
    cleanup();
  });

  it('should pause video when playing', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = setup();

    result.isVideoPlaying.value = true;
    result.handleVideoPlayPause();
    await nextTick();

    expect(videoElement.pause).toHaveBeenCalled();
    expect(result.isVideoPlaying.value).toBe(false);
    expect(result.videoPausedManually.value).toBe(true);
    cleanup();
  });

  it('should not play/pause when inputSource is not video', async () => {
    const [result, cleanup] = setup();

    result.handleVideoPlayPause();
    await nextTick();

    expect(videoElement.play).not.toHaveBeenCalled();
    expect(videoElement.pause).not.toHaveBeenCalled();
    cleanup();
  });

  it('should navigate to next video when playing', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 0;
    result.handleNextVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(1);
    expect(selectedVideoIndex.value).toBe(1);
    cleanup();
  });

  it('should wrap around to first video when at end', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 1;
    result.handleNextVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should navigate to previous video when playing', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 1;
    result.handlePreviousVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(0);
    cleanup();
  });

  it('should wrap around to last video when at beginning', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    result.isVideoPlaying.value = true;
    result.loadedVideoIndex.value = 0;
    result.handlePreviousVideo();
    await new Promise((r) => setTimeout(r, 150));

    expect(result.loadedVideoIndex.value).toBe(1);
    cleanup();
  });

  it('should handle seeking', async () => {
    inputSourceRef.value = 'video';
    const [result, cleanup] = setup();

    result.handleSeek(50);
    await nextTick();

    expect(videoElement.currentTime).toBe(50);
    expect(result.currentTime.value).toBe(50);
    cleanup();
  });

  it('should handle seek start and end', async () => {
    const [result, cleanup] = setup();

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
    videoPlaylist.value = makeItems(['/only.mp4']);
    const [result, cleanup] = setup();

    const initialIndex = selectedVideoIndex.value;
    result.handleNextVideo();
    await nextTick();
    expect(selectedVideoIndex.value).toBe(initialIndex);

    result.handlePreviousVideo();
    await nextTick();
    expect(selectedVideoIndex.value).toBe(initialIndex);
    cleanup();
  });

  it('handleNextVideo loads next video when paused without calling play', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    result.videoPausedManually.value = true;
    result.loadedVideoIndex.value = 0;
    await result.handleNextVideo();

    expect(result.loadedVideoIndex.value).toBe(1);
    expect(videoElement.play).not.toHaveBeenCalled();
    cleanup();
  });

  it('handlePreviousVideo loads previous video when paused without calling play', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    result.videoPausedManually.value = true;
    result.loadedVideoIndex.value = 1;
    await result.handlePreviousVideo();

    expect(result.loadedVideoIndex.value).toBe(0);
    expect(videoElement.play).not.toHaveBeenCalled();
    cleanup();
  });

  it('handleVideoRemoved stops playback when the loaded video is removed', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();

    videoElement.dispatchEvent(new Event('play'));
    expect(result.isVideoPlaying.value).toBe(true);

    result.handleVideoRemoved({ wasLoaded: true, newLoadedIndex: 0 });
    await nextTick();

    expect(videoElement.pause).toHaveBeenCalled();
    expect(result.isVideoPlaying.value).toBe(false);
    cleanup();
  });

  it('isVideoPlaying resets to false when emptied event fires', async () => {
    const [result, cleanup] = setup();

    videoElement.dispatchEvent(new Event('play'));
    expect(result.isVideoPlaying.value).toBe(true);

    videoElement.dispatchEvent(new Event('emptied'));
    expect(result.isVideoPlaying.value).toBe(false);
    cleanup();
  });
});
