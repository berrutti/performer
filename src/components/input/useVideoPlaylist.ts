import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

const CANPLAY_TIMEOUT_MS = 8000;
const STORE_FILE = 'performer.json';
const STORE_KEY_PLAYLIST = 'playlist';

export interface VideoPlaylistItem {
  id: string;
  name: string;
  src: string;
  path?: string;
}

export function useVideoPlaylist(videoRef: Ref<HTMLVideoElement | null>, inputSource: Ref<string>) {
  const videoPlaylist = ref<VideoPlaylistItem[]>([]);
  const selectedVideoIndex = ref(0);
  const loadedVideoIndex = ref(0);
  const isVideoPlaying = ref(false);
  const videoPausedManually = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const isSeeking = ref(false);

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

  function handleVideoSelect(index: number) {
    selectedVideoIndex.value = index;
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
    } else {
      videoPausedManually.value = false;
      await startPlayback(video);
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

  function handleAddVideosToPlaylist(paths: string[]) {
    const newItems = paths.map((p) => ({
      id: `video-${Date.now()}-${Math.random()}`,
      name: p.split('/').pop() ?? p,
      src: convertFileSrc(p),
      path: p
    }));
    videoPlaylist.value = [...videoPlaylist.value, ...newItems];
    if (newItems.length > 0 && inputSource.value !== 'video') {
      inputSource.value = 'video';
    }
  }

  async function handleOpenFileDialog() {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm'] }]
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    handleAddVideosToPlaylist(paths);
  }

  function handleRemoveFromPlaylist(videoId: string) {
    const removedIndex = videoPlaylist.value.findIndex((video) => video.id === videoId);
    const newPlaylist = videoPlaylist.value.filter((video) => video.id !== videoId);

    if (removedIndex === loadedVideoIndex.value) {
      const video = videoRef.value;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      // isVideoPlaying will be set false by the pause event
    }

    if (selectedVideoIndex.value >= newPlaylist.length) {
      selectedVideoIndex.value = Math.max(0, newPlaylist.length - 1);
    }
    if (loadedVideoIndex.value >= newPlaylist.length) {
      loadedVideoIndex.value = Math.max(0, newPlaylist.length - 1);
    }
    videoPlaylist.value = newPlaylist;
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

  onMounted(async () => {
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

    const store = await load(STORE_FILE);
    const savedPaths = (await store.get<string[]>(STORE_KEY_PLAYLIST)) ?? [];
    if (savedPaths.length > 0) {
      handleAddVideosToPlaylist(savedPaths);
    }

    watch(videoPlaylist, async (newList) => {
      const userPaths = newList.filter((v) => v.path).map((v) => v.path!);
      await store.set(STORE_KEY_PLAYLIST, userPaths);
      await store.save();
    });
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
    videoPlaylist,
    selectedVideoIndex,
    loadedVideoIndex,
    isVideoPlaying,
    videoPausedManually,
    currentTime,
    duration,
    isSeeking,
    handleVideoSelect,
    handleVideoPlay,
    handleVideoPlayPause,
    handleNextVideo,
    handlePreviousVideo,
    handleAddVideosToPlaylist,
    handleOpenFileDialog,
    handleRemoveFromPlaylist,
    handleSeek,
    handleSeekStart,
    handleSeekEnd
  };
}
