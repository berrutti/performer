import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { withSetup } from '../../test/utils';
import { useVideoPlaylist } from './useVideoPlaylist';

describe('useVideoPlaylist', () => {
  let videoElement: HTMLVideoElement;
  let videoRef: ReturnType<typeof ref<HTMLVideoElement>>;
  let inputSourceRef: ReturnType<typeof ref<string>>;

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

    videoRef = ref(videoElement);
    inputSourceRef = ref('webcam');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default video playlist', () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    expect(result.videoPlaylist.value).toHaveLength(1);
    expect(result.videoPlaylist.value[0].name).toBe('Big Buck Bunny');
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
    const mockFile = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    result.handleAddVideosToPlaylist([mockFile]);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(2);
    expect(result.videoPlaylist.value[1].name).toBe('test.mp4');
    expect(inputSourceRef.value).toBe('video');
    cleanup();
  });

  it('should filter non-video files when adding to playlist', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    const videoFile = new File(['video'], 'test.mp4', { type: 'video/mp4' });
    const textFile = new File(['text'], 'test.txt', { type: 'text/plain' });

    result.handleAddVideosToPlaylist([videoFile, textFile]);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(2);
    expect(result.videoPlaylist.value[1].name).toBe('test.mp4');
    cleanup();
  });

  it('should remove video from playlist', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    const id = result.videoPlaylist.value[0].id;

    result.handleRemoveFromPlaylist(id);
    await nextTick();

    expect(result.videoPlaylist.value).toHaveLength(0);
    cleanup();
  });

  it('should adjust selected index when removing video', async () => {
    const [result, cleanup] = withSetup(() => useVideoPlaylist(videoRef, inputSourceRef));
    const file1 = new File(['v1'], 'test1.mp4', { type: 'video/mp4' });
    const file2 = new File(['v2'], 'test2.mp4', { type: 'video/mp4' });

    result.handleAddVideosToPlaylist([file1, file2]);
    await nextTick();
    expect(result.videoPlaylist.value).toHaveLength(3);

    result.handleVideoSelect(2);
    await nextTick();
    expect(result.selectedVideoIndex.value).toBe(2);

    const videoToRemove = result.videoPlaylist.value[2];
    result.handleRemoveFromPlaylist(videoToRemove.id);
    await nextTick();

    expect(result.selectedVideoIndex.value).toBe(1);
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
    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    result.handleAddVideosToPlaylist([file]);
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
    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    result.handleAddVideosToPlaylist([file]);
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
    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    result.handleAddVideosToPlaylist([file]);
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
    const file = new File(['video'], 'test.mp4', { type: 'video/mp4' });

    result.handleAddVideosToPlaylist([file]);
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
