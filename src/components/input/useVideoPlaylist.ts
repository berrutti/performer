import { ref, watch, onMounted, onUnmounted, type Ref } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';

const VIDEO_LOAD_DELAY_MS = 100;
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

  function handleVideoSelect(index: number) {
    selectedVideoIndex.value = index;
  }

  function handleVideoPlayPause() {
    const video = videoRef.value;
    if (!video || inputSource.value !== 'video') return;

    if (isVideoPlaying.value) {
      video.pause();
      isVideoPlaying.value = false;
      videoPausedManually.value = true;
    } else {
      if (selectedVideoIndex.value !== loadedVideoIndex.value) {
        loadedVideoIndex.value = selectedVideoIndex.value;
        videoPausedManually.value = false;
        setTimeout(() => {
          const v = videoRef.value;
          if (v && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            v.play()
              .then(() => {
                isVideoPlaying.value = true;
              })
              .catch((err) => {
                if (err.name !== 'AbortError') console.error('Error playing video:', err);
              });
          }
        }, VIDEO_LOAD_DELAY_MS);
      } else {
        video
          .play()
          .then(() => {
            isVideoPlaying.value = true;
            videoPausedManually.value = false;
          })
          .catch((err) => {
            if (err.name !== 'AbortError') console.error('Error playing video:', err);
          });
      }
    }
  }

  function handleNextVideo() {
    if (videoPlaylist.value.length <= 1) return;
    if (isVideoPlaying.value) {
      const nextIndex = (loadedVideoIndex.value + 1) % videoPlaylist.value.length;
      loadedVideoIndex.value = nextIndex;
      selectedVideoIndex.value = nextIndex;
      setTimeout(() => {
        videoRef.value
          ?.play()
          .then(() => {
            isVideoPlaying.value = true;
          })
          .catch(console.error);
      }, VIDEO_LOAD_DELAY_MS);
    } else {
      selectedVideoIndex.value = (selectedVideoIndex.value + 1) % videoPlaylist.value.length;
    }
  }

  function handlePreviousVideo() {
    if (videoPlaylist.value.length <= 1) return;
    if (isVideoPlaying.value) {
      const prevIndex =
        loadedVideoIndex.value === 0 ? videoPlaylist.value.length - 1 : loadedVideoIndex.value - 1;
      loadedVideoIndex.value = prevIndex;
      selectedVideoIndex.value = prevIndex;
      setTimeout(() => {
        videoRef.value
          ?.play()
          .then(() => {
            isVideoPlaying.value = true;
          })
          .catch(console.error);
      }, VIDEO_LOAD_DELAY_MS);
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
      filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'] }]
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    handleAddVideosToPlaylist(paths);
  }

  function handleRemoveFromPlaylist(videoId: string) {
    const newPlaylist = videoPlaylist.value.filter((v) => v.id !== videoId);
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
