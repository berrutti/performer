import { watchEffect, onUnmounted, type Ref } from 'vue';
import type { VideoPlaylistItem } from './useVideoPlaylist';

export function useVideoSource(
  videoRef: Ref<HTMLVideoElement | null>,
  inputSource: Ref<string>,
  loadedVideoIndex: Ref<number>,
  videoPlaylist: Ref<VideoPlaylistItem[]>,
  isVideoPlaying: Ref<boolean>
) {
  let currentBlobUrl: string | null = null;

  function revokeBlobUrl() {
    if (currentBlobUrl) {
      URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = null;
    }
  }

  // watchEffect tracks videoRef.value so it re-runs when the template ref is set on mount
  watchEffect(() => {
    const video = videoRef.value;
    if (!video) return;

    const source = inputSource.value;
    // access these to track them as deps
    const idx = loadedVideoIndex.value;
    const playlist = videoPlaylist.value;

    revokeBlobUrl();

    video.crossOrigin = 'anonymous';
    if (video.srcObject) {
      const stream = video.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }

    if (source === 'webcam') {
      video.src = '';
      video.pause();
      isVideoPlaying.value = false;
      video.load();
      video.currentTime = 0;

      navigator.mediaDevices
        .getUserMedia({ video: true })
        .then((stream) => {
          video.srcObject = stream;
          return video.play();
        })
        .catch(console.error);
    } else if (source === 'video') {
      const loadedVideo = playlist[idx];
      if (loadedVideo) {
        let newSrc = '';
        if (loadedVideo.file) {
          const fileUrl = URL.createObjectURL(loadedVideo.file);
          currentBlobUrl = fileUrl;
          newSrc = fileUrl;
        } else if (loadedVideo.url) {
          newSrc = loadedVideo.url;
        }
        if (video.src !== newSrc) {
          video.src = newSrc;
          video.loop = false;
          video.load();
        }
      } else {
        video.src = '';
      }
    }
  });

  onUnmounted(() => {
    revokeBlobUrl();
  });
}
