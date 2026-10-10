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

  it('removes every can-play wait listener once one of them fires', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/test.mp4']);
    Object.defineProperty(videoElement, 'readyState', {
      writable: true,
      value: HTMLMediaElement.HAVE_NOTHING
    });
    const [result, cleanup] = setup();
    const add = vi.spyOn(videoElement, 'addEventListener');
    const remove = vi.spyOn(videoElement, 'removeEventListener');

    const playing = result.handleVideoPlay(0);
    videoElement.dispatchEvent(new Event('loadeddata'));
    await playing;

    for (const type of ['loadeddata', 'canplay', 'error']) {
      const listener = add.mock.calls.find(([t]) => t === type)?.[1];
      expect(listener).toBeDefined();
      expect(remove).toHaveBeenCalledWith(type, listener);
    }
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

  it('reloads on play even when the element already has that file, so a failed load is retried', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4']);
    videoElement.src = videoPlaylist.value[0].src;
    videoElement.load = vi.fn();
    const [result, cleanup] = setup();

    await result.handleVideoPlay(0);

    expect(videoElement.load).toHaveBeenCalledOnce();
    cleanup();
  });

  it('moves on to the next video when one ends, even though the browser reports pause first', async () => {
    inputSourceRef.value = 'video';
    videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
    const [result, cleanup] = setup();
    await result.handleVideoPlay(0);
    vi.mocked(videoElement.play).mockClear();

    videoElement.dispatchEvent(new Event('pause'));
    videoElement.dispatchEvent(new Event('ended'));
    await new Promise((r) => setTimeout(r, 0));

    expect(result.loadedVideoIndex.value).toBe(1);
    expect(videoElement.src).toContain('b.mp4');
    expect(videoElement.play).toHaveBeenCalledOnce();
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

  describe('randomize', () => {
    function makeStandby(state: 'ready' | 'missing' | 'undecodable' = 'ready'): HTMLVideoElement {
      const standby = document.createElement('video');
      standby.play = vi.fn().mockResolvedValue(undefined);
      standby.pause = vi.fn();
      Object.defineProperty(standby, 'paused', { writable: true, value: false });
      const readyState = {
        ready: HTMLMediaElement.HAVE_ENOUGH_DATA,
        missing: HTMLMediaElement.HAVE_NOTHING,
        undecodable: HTMLMediaElement.HAVE_METADATA
      }[state];
      Object.defineProperty(standby, 'readyState', { writable: true, value: readyState });
      Object.defineProperty(standby, 'videoWidth', { value: state === 'missing' ? 0 : 640 });
      if (state === 'missing') Object.defineProperty(standby, 'error', { value: { code: 4 } });
      return standby;
    }

    beforeEach(() => {
      inputSourceRef.value = 'video';
      videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4']);
      randomizeRef1.value = makeStandby();
      randomizeRef2.value = makeStandby();
    });

    it('pauses a playing main video while it runs and resumes it when it stops', async () => {
      Object.defineProperty(videoElement, 'paused', { writable: true, value: false });
      const [result, cleanup] = setup();

      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });
      await result.applyVideoSnapshot({ videoIndex: 0, seekFraction: 0.5 });
      expect(videoElement.pause).toHaveBeenCalledOnce();

      result.onRandomizeDeactivated();
      expect(videoElement.play).toHaveBeenCalledOnce();
      cleanup();
    });

    it('keeps the shown video when the next one fails, and never preloads over it', async () => {
      videoPlaylist.value = makeItems(['/a.mp4', '/b.mp4', '/c.mp4']);
      randomizeRef2.value = makeStandby('missing');
      const [result, cleanup] = setup();

      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });
      expect(result.rendererVideoRef.value).toBe(randomizeRef1.value);
      const shownSrc = randomizeRef1.value!.src;

      void result.applyVideoSnapshot({ videoIndex: 0, seekFraction: 0.5 });
      await new Promise((r) => setTimeout(r, 0));
      void result.preloadUpcomingVideo({ videoIndex: 2, seekFraction: 0.5 });
      await new Promise((r) => setTimeout(r, 0));

      expect(result.rendererVideoRef.value).toBe(randomizeRef1.value);
      expect(randomizeRef1.value!.src).toBe(shownSrc);
      expect(randomizeRef2.value!.src).toContain('c.mp4');
      cleanup();
    });

    it('keeps the shown video when the next one loads but never decodes a frame', async () => {
      randomizeRef2.value = makeStandby('undecodable');
      const [result, cleanup] = setup();

      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });
      const switching = result.applyVideoSnapshot({ videoIndex: 0, seekFraction: 0.5 });
      await new Promise((r) => setTimeout(r, 0));
      randomizeRef2.value!.dispatchEvent(new Event('seeked'));
      await switching;

      expect(result.rendererVideoRef.value).toBe(randomizeRef1.value);
      cleanup();
    });

    it('play/pause acts on the video on screen, not the hidden main one', async () => {
      const [result, cleanup] = setup();
      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });

      await result.handleVideoPlayPause();

      expect(randomizeRef1.value!.pause).toHaveBeenCalledOnce();
      expect(videoElement.pause).not.toHaveBeenCalled();
      cleanup();
    });

    it('ignores play-state events from the standby that is not on screen', async () => {
      const [result, cleanup] = setup();
      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });
      randomizeRef1.value!.dispatchEvent(new Event('play'));
      expect(result.isVideoPlaying.value).toBe(true);

      randomizeRef2.value!.dispatchEvent(new Event('emptied'));
      expect(result.isVideoPlaying.value).toBe(true);
      cleanup();
    });

    it('keeps the main video playing when the first randomize video fails', async () => {
      Object.defineProperty(videoElement, 'paused', { writable: true, value: false });
      randomizeRef1.value = makeStandby('missing');
      const [result, cleanup] = setup();

      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });

      expect(result.rendererVideoRef.value).toBe(videoElement);
      expect(videoElement.pause).not.toHaveBeenCalled();
      cleanup();
    });

    it('shows the new video before its playback has started', async () => {
      let finishPlay: () => void = () => {};
      randomizeRef1.value!.play = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishPlay = resolve;
          })
      );
      const [result, cleanup] = setup();

      const switching = result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });
      await vi.waitFor(() => expect(randomizeRef1.value!.play).toHaveBeenCalled());
      expect(result.rendererVideoRef.value).toBe(randomizeRef1.value);

      finishPlay();
      await switching;
      cleanup();
    });

    it('reloads a standby whose file failed before, in case its drive is back', async () => {
      randomizeRef2.value = makeStandby('missing');
      randomizeRef2.value.src = videoPlaylist.value[1].src;
      randomizeRef2.value.load = vi.fn();
      const [result, cleanup] = setup();

      await result.applyVideoSnapshot({ videoIndex: 0, seekFraction: 0.5 });
      await result.preloadUpcomingVideo({ videoIndex: 1, seekFraction: 0.5 });

      expect(randomizeRef2.value.load).toHaveBeenCalled();
      cleanup();
    });

    it('leaves a main video that was already paused paused when it stops', async () => {
      Object.defineProperty(videoElement, 'paused', { writable: true, value: true });
      const [result, cleanup] = setup();

      await result.applyVideoSnapshot({ videoIndex: 1, seekFraction: 0.5 });
      result.onRandomizeDeactivated();

      expect(videoElement.pause).not.toHaveBeenCalled();
      expect(videoElement.play).not.toHaveBeenCalled();
      cleanup();
    });
  });
});
