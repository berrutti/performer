import { watchEffect, type Ref } from 'vue';
import type { VideoPlaylistItem } from './useVideoPlaylist';
import type { InputSource } from '@/broadcast';

export function useVideoSource(
  videoRef: Ref<HTMLVideoElement | null>,
  inputSource: Ref<InputSource>,
  loadedVideoIndex: Ref<number>,
  videoPlaylist: Ref<VideoPlaylistItem[]>
) {
  // watchEffect tracks videoRef.value so it re-runs when the template ref is set on mount
  watchEffect((onCleanup) => {
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
      video.load();

      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      navigator.mediaDevices
        .getUserMedia({ video: true })
        .then((stream) => {
          if (cancelled) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }
          video.srcObject = stream;
          return video.play();
        })
        .catch(console.error);
    } else if (source === 'video' && !playlist[idx]) {
      video.src = '';
    }
  });
}
