import { ref, shallowRef, watch, onMounted, onUnmounted, type Ref } from 'vue';
import type { InputSource } from '@/broadcast';
import type { VideoPlaylistItem, RemoveVideoResult } from './useVideoPlaylist';

const CANPLAY_TIMEOUT_MS = 8000;

export interface VideoSnapshot {
  videoIndex: number;
  seekFraction: number;
}

export function useVideoPlayer(
  videoRef: Ref<HTMLVideoElement | null>,
  randomizeRef1: Ref<HTMLVideoElement | null>,
  randomizeRef2: Ref<HTMLVideoElement | null>,
  videoPlaylist: Ref<VideoPlaylistItem[]>,
  selectedVideoIndex: Ref<number>,
  inputSource: Ref<InputSource>,
  isMuted: Ref<boolean>
) {
  const loadedVideoIndex = ref(0);
  const isVideoPlaying = ref(false);
  const videoPausedManually = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const isSeeking = ref(false);
  const rendererVideoRef = shallowRef<HTMLVideoElement | null>(null);
  const randomizeUseRef1 = ref(true);
  const randomizeActive = ref(false);

  watch(
    videoRef,
    (v) => {
      if (!randomizeActive.value) rendererVideoRef.value = v;
    },
    { immediate: true }
  );

  watch(
    () => isMuted.value,
    (muted) => {
      if (videoRef.value) videoRef.value.muted = muted;
      if (randomizeRef1.value) randomizeRef1.value.muted = muted;
      if (randomizeRef2.value) randomizeRef2.value.muted = muted;
    }
  );

  function waitForCanPlay(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, CANPLAY_TIMEOUT_MS);
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('canplay', done, { once: true });
      video.addEventListener('error', done, { once: true });
    });
  }

  function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
    return new Promise((resolve) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });
  }

  async function startPlayback(video: HTMLVideoElement): Promise<boolean> {
    try {
      await video.play();
      return true;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Video playback failed:', err);
      }
      return false;
    }
  }

  async function handleVideoPlay(index: number) {
    selectedVideoIndex.value = index;
    loadedVideoIndex.value = index;
    videoPausedManually.value = false;
    const video = videoRef.value;
    const item = videoPlaylist.value[index];
    if (!video || !item) return;
    // Always reload: if the previous attempt left an error state,
    // video.src still matches so a conditional check would skip the reload,
    // leaving the element stuck at readyState 0 with no events firing.
    video.src = item.src;
    video.load();
    await waitForCanPlay(video);
    await startPlayback(video);
  }

  async function handleVideoPlayPause() {
    const video = videoRef.value;
    if (!video || inputSource.value !== 'video') return;

    if (isVideoPlaying.value) {
      video.pause();
      videoPausedManually.value = true;
    } else if (videoPausedManually.value) {
      videoPausedManually.value = false;
      await startPlayback(video);
    } else {
      await handleVideoPlay(selectedVideoIndex.value);
    }
  }

  async function handleNextVideo() {
    if (videoPlaylist.value.length <= 1) return;
    const videoActive = isVideoPlaying.value || videoPausedManually.value;
    if (videoActive) {
      const wasPlaying = isVideoPlaying.value;
      const nextIndex = (loadedVideoIndex.value + 1) % videoPlaylist.value.length;
      loadedVideoIndex.value = nextIndex;
      selectedVideoIndex.value = nextIndex;
      const video = videoRef.value;
      const item = videoPlaylist.value[nextIndex];
      if (!video || !item) return;
      if (video.src !== item.src) {
        video.src = item.src;
        video.load();
      }
      await waitForCanPlay(video);
      if (wasPlaying) await startPlayback(video);
    } else {
      selectedVideoIndex.value = (selectedVideoIndex.value + 1) % videoPlaylist.value.length;
    }
  }

  async function handlePreviousVideo() {
    if (videoPlaylist.value.length <= 1) return;
    const videoActive = isVideoPlaying.value || videoPausedManually.value;
    if (videoActive) {
      const wasPlaying = isVideoPlaying.value;
      const prevIndex =
        loadedVideoIndex.value === 0 ? videoPlaylist.value.length - 1 : loadedVideoIndex.value - 1;
      loadedVideoIndex.value = prevIndex;
      selectedVideoIndex.value = prevIndex;
      const video = videoRef.value;
      const item = videoPlaylist.value[prevIndex];
      if (!video || !item) return;
      if (video.src !== item.src) {
        video.src = item.src;
        video.load();
      }
      await waitForCanPlay(video);
      if (wasPlaying) await startPlayback(video);
    } else {
      selectedVideoIndex.value =
        selectedVideoIndex.value === 0
          ? videoPlaylist.value.length - 1
          : selectedVideoIndex.value - 1;
    }
  }

  function handleVideoRemoved({ wasLoaded, newLoadedIndex }: RemoveVideoResult) {
    if (wasLoaded) {
      const video = videoRef.value;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
        // isVideoPlaying will be set false by the pause event
      }
    }
    loadedVideoIndex.value = newLoadedIndex;
  }

  function handleSeek(time: number) {
    const video = videoRef.value;
    if (video && inputSource.value === 'video') {
      video.currentTime = time;
      currentTime.value = time;
    }
  }

  function handleSeekStart() {
    isSeeking.value = true;
  }

  function handleSeekEnd() {
    isSeeking.value = false;
  }

  async function preloadUpcomingVideo(snapshot: VideoSnapshot) {
    const standby = randomizeUseRef1.value ? randomizeRef1.value : randomizeRef2.value;
    const item = videoPlaylist.value[snapshot.videoIndex];
    if (!standby || !item) return;
    if (standby.src !== item.src) {
      standby.src = item.src;
      standby.load();
    }
    // Seek to the exact play position so the browser buffers the right segment,
    // not from the beginning of a potentially large file.
    await waitForVideoMetadata(standby);
    if (standby.duration > 0) {
      standby.currentTime = snapshot.seekFraction * standby.duration;
    }
  }

  async function applyVideoSnapshot(snapshot: VideoSnapshot) {
    if (videoPlaylist.value.length === 0 || inputSource.value !== 'video') return;

    // Flip synchronously before any await so that the scheduleNext() call that
    // follows this (synchronously) preloads into the correct next-standby buffer.
    const standby = randomizeUseRef1.value ? randomizeRef1.value : randomizeRef2.value;
    randomizeUseRef1.value = !randomizeUseRef1.value;
    randomizeActive.value = true;

    if (!standby) return;

    const item = videoPlaylist.value[snapshot.videoIndex];
    if (!item) return;

    if (standby.src !== item.src) {
      standby.src = item.src;
      await waitForVideoMetadata(standby);
    } else if (standby.readyState < HTMLMediaElement.HAVE_METADATA) {
      await waitForVideoMetadata(standby);
    }

    if (standby.duration > 0) {
      standby.currentTime = snapshot.seekFraction * standby.duration;
    }

    standby.muted = isMuted.value;

    // Swap renderer before awaiting play so the seeked frame shows immediately.
    rendererVideoRef.value = standby;

    try {
      await standby.play();
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error('Video playback failed:', err);
      }
    }

    loadedVideoIndex.value = snapshot.videoIndex;
    selectedVideoIndex.value = snapshot.videoIndex;
    isVideoPlaying.value = true;
  }

  function onRandomizeDeactivated() {
    randomizeActive.value = false;
    rendererVideoRef.value = videoRef.value;
    for (const el of [randomizeRef1.value, randomizeRef2.value]) {
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load();
      }
    }
    randomizeUseRef1.value = true;
    isVideoPlaying.value = !(videoRef.value?.paused ?? true);
  }

  function onVideoPlay() {
    isVideoPlaying.value = true;
  }
  function onVideoPause() {
    isVideoPlaying.value = false;
  }
  function onVideoError() {
    isVideoPlaying.value = false;
  }
  function onVideoEmptied() {
    isVideoPlaying.value = false;
  }

  function onVideoEnded() {
    if (inputSource.value === 'video' && !videoPausedManually.value) {
      handleNextVideo();
    }
  }

  function onTimeUpdate() {
    const video = videoRef.value;
    if (video && !isSeeking.value) {
      currentTime.value = video.currentTime;
    }
  }

  function onLoadedMetadata() {
    const video = videoRef.value;
    if (video) {
      duration.value = video.duration;
      currentTime.value = 0;
    }
  }

  function onDurationChange() {
    const video = videoRef.value;
    if (video) duration.value = video.duration;
  }

  onMounted(() => {
    const video = videoRef.value;
    if (video) {
      video.addEventListener('play', onVideoPlay);
      video.addEventListener('pause', onVideoPause);
      video.addEventListener('emptied', onVideoEmptied);
      video.addEventListener('error', onVideoError);
      video.addEventListener('ended', onVideoEnded);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('durationchange', onDurationChange);
    }
  });

  onUnmounted(() => {
    const video = videoRef.value;
    if (!video) return;
    video.removeEventListener('play', onVideoPlay);
    video.removeEventListener('pause', onVideoPause);
    video.removeEventListener('emptied', onVideoEmptied);
    video.removeEventListener('error', onVideoError);
    video.removeEventListener('ended', onVideoEnded);
    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('durationchange', onDurationChange);
  });

  return {
    loadedVideoIndex,
    isVideoPlaying,
    videoPausedManually,
    currentTime,
    duration,
    isSeeking,
    rendererVideoRef,
    handleVideoPlay,
    handleVideoPlayPause,
    handleNextVideo,
    handlePreviousVideo,
    handleVideoRemoved,
    handleSeek,
    handleSeekStart,
    handleSeekEnd,
    preloadUpcomingVideo,
    applyVideoSnapshot,
    onRandomizeDeactivated
  };
}
