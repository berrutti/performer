import { ref, shallowRef, watch, onMounted, onUnmounted, type Ref } from 'vue';
import type { InputSource } from '@/broadcast';
import type { VideoPlaylistItem, RemoveVideoResult } from './useVideoPlaylist';

const CANPLAY_TIMEOUT_MS = 1000;
const CANPLAY_EVENTS = ['loadeddata', 'canplay', 'seeked', 'error'] as const;
// Generous so a sleeping external drive can spin up before a switch gives up on it.
const METADATA_TIMEOUT_MS = 5000;

export interface VideoSnapshot {
  videoIndex: number;
  seekFraction: number;
}

export interface UseVideoPlayerOptions {
  videoRef: Ref<HTMLVideoElement | null>;
  randomizeRef1: Ref<HTMLVideoElement | null>;
  randomizeRef2: Ref<HTMLVideoElement | null>;
  videoPlaylist: Ref<VideoPlaylistItem[]>;
  selectedVideoIndex: Ref<number>;
  inputSource: Ref<InputSource>;
  isMuted: Ref<boolean>;
}

function waitForCanPlay(video: HTMLVideoElement): Promise<boolean> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      for (const type of CANPLAY_EVENTS) video.removeEventListener(type, done);
      resolve(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
    };
    const timer = setTimeout(done, CANPLAY_TIMEOUT_MS);
    for (const type of CANPLAY_EVENTS) video.addEventListener(type, done);
  });
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<boolean> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve(true);
  if (video.error) return Promise.resolve(false);
  return new Promise((resolve) => {
    const settle = (loaded: boolean) => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onFailed);
      resolve(loaded);
    };
    const onLoaded = () => settle(true);
    const onFailed = () => settle(false);
    const timer = setTimeout(onFailed, METADATA_TIMEOUT_MS);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onFailed);
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

export function useVideoPlayer(options: UseVideoPlayerOptions) {
  const {
    videoRef,
    randomizeRef1,
    randomizeRef2,
    videoPlaylist,
    selectedVideoIndex,
    inputSource,
    isMuted
  } = options;
  const loadedVideoIndex = ref(0);
  const isVideoPlaying = ref(false);
  const videoPausedManually = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const isSeeking = ref(false);
  const rendererVideoRef = shallowRef<HTMLVideoElement | null>(null);
  const randomizeActive = ref(false);
  let resumeMainAfterRandomize = false;
  let applying: Promise<void> = Promise.resolve();

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

  async function handleVideoPlay(index: number) {
    selectedVideoIndex.value = index;
    loadedVideoIndex.value = index;
    videoPausedManually.value = false;
    const video = videoRef.value;
    const item = videoPlaylist.value[index];
    if (!video || !item) return;
    video.src = item.src;
    video.load();
    await waitForCanPlay(video);
    await startPlayback(video);
  }

  async function handleVideoPlayPause() {
    if (inputSource.value !== 'video') return;
    const shown = rendererVideoRef.value;
    if (randomizeActive.value && shown && shown !== videoRef.value) {
      if (shown.paused) await startPlayback(shown);
      else shown.pause();
      return;
    }

    const video = videoRef.value;
    if (!video) return;

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

  async function stepVideo(direction: 1 | -1) {
    const count = videoPlaylist.value.length;
    if (count <= 1) return;
    const videoActive = isVideoPlaying.value || videoPausedManually.value;
    if (videoActive) {
      const wasPlaying = isVideoPlaying.value;
      const nextIndex = (loadedVideoIndex.value + direction + count) % count;
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
      selectedVideoIndex.value = (selectedVideoIndex.value + direction + count) % count;
    }
  }

  function handleNextVideo() {
    return stepVideo(1);
  }

  function handlePreviousVideo() {
    return stepVideo(-1);
  }

  function handleVideoRemoved({ wasLoaded, newLoadedIndex }: RemoveVideoResult) {
    if (wasLoaded) {
      const video = videoRef.value;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
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

  function idleStandby(): HTMLVideoElement | null {
    return rendererVideoRef.value === randomizeRef1.value
      ? randomizeRef2.value
      : randomizeRef1.value;
  }

  async function preloadUpcomingVideo(snapshot: VideoSnapshot) {
    await applying;
    const standby = idleStandby();
    const item = videoPlaylist.value[snapshot.videoIndex];
    if (!randomizeActive.value || !standby || !item) return;
    if (standby.src !== item.src || standby.error) {
      standby.src = item.src;
      standby.load();
    }
    if (!(await waitForVideoMetadata(standby))) return;
    if (standby.duration > 0) {
      standby.currentTime = snapshot.seekFraction * standby.duration;
    }
  }

  function applyVideoSnapshot(snapshot: VideoSnapshot): Promise<void> {
    if (videoPlaylist.value.length === 0 || inputSource.value !== 'video') {
      return Promise.resolve();
    }
    randomizeActive.value = true;
    applying = applying.then(() => showSnapshot(snapshot));
    return applying;
  }

  async function showSnapshot(snapshot: VideoSnapshot) {
    const standby = idleStandby();
    const item = videoPlaylist.value[snapshot.videoIndex];
    if (!standby || !item) return;

    if (standby.src !== item.src || standby.error) standby.src = item.src;
    const hasVideo = (await waitForVideoMetadata(standby)) && standby.videoWidth > 0;
    if (!hasVideo || !randomizeActive.value) return;

    if (standby.duration > 0) {
      standby.currentTime = snapshot.seekFraction * standby.duration;
    }
    if (!(await waitForCanPlay(standby)) || !randomizeActive.value) return;

    standby.muted = isMuted.value;

    const main = videoRef.value;
    if (rendererVideoRef.value === main && main && !main.paused) {
      main.pause();
      resumeMainAfterRandomize = true;
    }

    rendererVideoRef.value = standby;
    await startPlayback(standby);

    loadedVideoIndex.value = snapshot.videoIndex;
    selectedVideoIndex.value = snapshot.videoIndex;
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
    if (resumeMainAfterRandomize && !videoPausedManually.value && videoRef.value) {
      void startPlayback(videoRef.value);
    }
    resumeMainAfterRandomize = false;
    isVideoPlaying.value = !(videoRef.value?.paused ?? true);
  }

  function setPlayingFrom(event: Event, playing: boolean) {
    if (event.target === rendererVideoRef.value) isVideoPlaying.value = playing;
  }
  function onVideoPlay(event: Event) {
    setPlayingFrom(event, true);
  }
  function onVideoPause(event: Event) {
    setPlayingFrom(event, false);
  }
  function onVideoError(event: Event) {
    setPlayingFrom(event, false);
  }
  function onVideoEmptied(event: Event) {
    setPlayingFrom(event, false);
  }

  watch(rendererVideoRef, (video) => {
    isVideoPlaying.value = !!video && !video.paused;
  });

  function onVideoEnded() {
    if (inputSource.value !== 'video' || videoPausedManually.value) return;
    const count = videoPlaylist.value.length;
    if (count > 1) void handleVideoPlay((loadedVideoIndex.value + 1) % count);
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

  function attachPlaybackListeners(el: HTMLVideoElement) {
    el.addEventListener('play', onVideoPlay);
    el.addEventListener('pause', onVideoPause);
    el.addEventListener('emptied', onVideoEmptied);
    el.addEventListener('error', onVideoError);
  }

  function detachPlaybackListeners(el: HTMLVideoElement) {
    el.removeEventListener('play', onVideoPlay);
    el.removeEventListener('pause', onVideoPause);
    el.removeEventListener('emptied', onVideoEmptied);
    el.removeEventListener('error', onVideoError);
  }

  onMounted(() => {
    const video = videoRef.value;
    if (video) {
      attachPlaybackListeners(video);
      video.addEventListener('ended', onVideoEnded);
      video.addEventListener('timeupdate', onTimeUpdate);
      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('durationchange', onDurationChange);
    }
    if (randomizeRef1.value) attachPlaybackListeners(randomizeRef1.value);
    if (randomizeRef2.value) attachPlaybackListeners(randomizeRef2.value);
  });

  onUnmounted(() => {
    const video = videoRef.value;
    if (video) {
      detachPlaybackListeners(video);
      video.removeEventListener('ended', onVideoEnded);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('durationchange', onDurationChange);
    }
    if (randomizeRef1.value) detachPlaybackListeners(randomizeRef1.value);
    if (randomizeRef2.value) detachPlaybackListeners(randomizeRef2.value);
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
