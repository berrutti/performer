import { ref, watch, onMounted, type Ref } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import { load as loadStore } from '@tauri-apps/plugin-store';
import type { InputSource } from '@/broadcast';

const STORE_FILE = 'performer.json';
const STORE_KEY_PLAYLIST = 'playlist';

export interface VideoPlaylistItem {
  id: string;
  name: string;
  src: string;
  path?: string;
}

export interface RemoveVideoResult {
  wasLoaded: boolean;
  newLoadedIndex: number;
}

export function useVideoPlaylist(inputSource: Ref<InputSource>) {
  const videoPlaylist = ref<VideoPlaylistItem[]>([]);
  const selectedVideoIndex = ref(0);

  let store: Awaited<ReturnType<typeof loadStore>> | null = null;

  watch(videoPlaylist, async (newList) => {
    if (!store) return;
    const userPaths = newList.filter((v) => v.path).map((v) => v.path!);
    await store.set(STORE_KEY_PLAYLIST, userPaths);
    await store.save();
  });

  onMounted(async () => {
    store = await loadStore(STORE_FILE);
    const savedPaths = (await store.get<string[]>(STORE_KEY_PLAYLIST)) ?? [];
    if (savedPaths.length > 0) {
      handleAddVideosToPlaylist(savedPaths);
    }
  });

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

  // Returns whether the currently loaded video was removed and what the new
  // loaded index should be, so the caller (useVideoPlayer) can stop the DOM.
  function removeVideoFromList(videoId: string, currentLoadedIndex: number): RemoveVideoResult {
    const removedIndex = videoPlaylist.value.findIndex((v) => v.id === videoId);
    const newPlaylist = videoPlaylist.value.filter((v) => v.id !== videoId);

    if (selectedVideoIndex.value >= newPlaylist.length) {
      selectedVideoIndex.value = Math.max(0, newPlaylist.length - 1);
    }

    videoPlaylist.value = newPlaylist;

    return {
      wasLoaded: removedIndex === currentLoadedIndex,
      newLoadedIndex:
        currentLoadedIndex >= newPlaylist.length
          ? Math.max(0, newPlaylist.length - 1)
          : currentLoadedIndex
    };
  }

  return {
    videoPlaylist,
    selectedVideoIndex,
    handleAddVideosToPlaylist,
    removeVideoFromList
  };
}
