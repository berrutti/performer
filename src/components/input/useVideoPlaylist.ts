import { ref, onMounted, onUnmounted, type Ref } from 'vue';

const VIDEO_LOAD_DELAY_MS = 100;

export interface VideoPlaylistItem {
  id: string;
  name: string;
  url?: string;
  file?: File;
  isDefault?: boolean;
}

export function useVideoPlaylist(videoRef: Ref<HTMLVideoElement | null>, inputSource: Ref<string>) {
  const videoPlaylist = ref<VideoPlaylistItem[]>([
    {
      id: 'big-buck-bunny',
      name: 'Big Buck Bunny',
      url: `${import.meta.env.BASE_URL}big_buck_bunny.mp4`,
      isDefault: true
    }
  ]);
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

  function handleAddVideosToPlaylist(files: File[]) {
    const videoFiles = files.filter((f) => f.type.startsWith('video/'));
    const newVideos = videoFiles.map((f) => ({
      id: `video-${Date.now()}-${Math.random()}`,
      name: f.name,
      file: f
    }));
    videoPlaylist.value = [...videoPlaylist.value, ...newVideos];
    if (newVideos.length > 0 && inputSource.value !== 'video') {
      inputSource.value = 'video';
    }
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

  onMounted(() => {
    const video = videoRef.value;
    if (!video) return;
    video.addEventListener('ended', onVideoEnded);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('durationchange', onDurationChange);
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
    handleRemoveFromPlaylist,
    handleSeek,
    handleSeekStart,
    handleSeekEnd
  };
}
