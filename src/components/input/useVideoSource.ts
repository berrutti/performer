import { watchEffect, type Ref } from 'vue';
import type { VideoPlaylistItem } from './useVideoPlaylist';

export function useVideoSource(
  videoRef: Ref<HTMLVideoElement | null>,
  inputSource: Ref<string>,
  loadedVideoIndex: Ref<number>,
  videoPlaylist: Ref<VideoPlaylistItem[]>,
  isVideoPlaying: Ref<boolean>
) {
  // watchEffect tracks videoRef.value so it re-runs when the template ref is set on mount
  watchEffect(() => {
    const video = videoRef.value;
    if (!video) return;

    const source = inputSource.value;
    // access these to track them as deps
    const idx = loadedVideoIndex.value;
    const playlist = videoPlaylist.value;

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
        if (video.src !== loadedVideo.src) {
          video.src = loadedVideo.src;
          video.loop = false;
          video.load();
        }
      } else {
        video.src = '';
      }
    }
  });
}
