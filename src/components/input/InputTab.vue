<template>
  <div class="tab-content">
    <div class="control-group">
      <label for="inputSource" class="control-label">Input Source:</label>
      <select
        id="inputSource"
        class="control-select"
        :value="inputSource"
        @change="emit('input-source-change', ($event.target as HTMLSelectElement).value)"
      >
        <option value="webcam">Webcam</option>
        <option value="video">Video Playlist</option>
      </select>
    </div>

    <div v-if="inputSource === 'video'" class="video-player-container">
      <div v-if="currentVideo" class="current-video-display">
        <div class="video-title">{{ currentVideo.name }}</div>
        <div class="video-position">{{ loadedVideoIndex + 1 }} of {{ videoPlaylist.length }}</div>
      </div>

      <div class="video-controls-bar">
        <div class="transport-controls">
          <button
            class="control-btn"
            :disabled="videoPlaylist.length <= 1"
            title="Previous video"
            @click="emit('previous-video')"
          >
            ⏮
          </button>
          <button
            class="control-btn play-btn"
            :disabled="videoPlaylist.length === 0"
            :title="isVideoPlaying ? 'Pause' : 'Play'"
            @click="emit('video-play-pause')"
          >
            {{ isVideoPlaying ? '⏸' : '▶' }}
          </button>
          <button
            class="control-btn"
            :disabled="videoPlaylist.length <= 1"
            title="Next video"
            @click="emit('next-video')"
          >
            ⏭
          </button>
        </div>
        <div class="audio-controls">
          <button
            :class="['control-btn', isMuted ? 'muted' : '']"
            :title="isMuted ? 'Unmute' : 'Mute'"
            @click="emit('mute-toggle')"
          >
            {{ isMuted ? 'MUTE' : 'VOL' }}
          </button>
        </div>
      </div>

      <div class="timeline-container">
        <span class="time-display">{{ formatTime(currentTime) }}</span>
        <div
          class="timeline-track"
          @mousedown="onTimelineMouseDown"
          @mouseup="emit('seek-end')"
          @click="onTimelineClick"
        >
          <div class="timeline-background"></div>
          <div class="timeline-progress" :style="{ width: `${progressPercentage}%` }"></div>
          <div class="timeline-handle" :style="{ left: `${progressPercentage}%` }"></div>
        </div>
        <span class="time-display">{{ formatTime(duration) }}</span>
      </div>

      <div class="playlist-section">
        <div class="playlist-header">
          <span>Playlist ({{ videoPlaylist.length }})</span>
          <div
            :class="['add-videos-zone', dragOver ? 'drag-over' : '']"
            @dragover.prevent="dragOver = true"
            @dragleave.prevent="dragOver = false"
            @drop="onDrop"
            @click="fileInputRef?.click()"
          >
            <span>+ Add Videos</span>
            <input
              ref="fileInputRef"
              type="file"
              accept="video/*"
              multiple
              style="display: none"
              @change="onFileInput"
            />
          </div>
        </div>

        <div class="playlist-items">
          <div
            v-for="(video, index) in videoPlaylist"
            :key="video.id"
            :class="[
              'playlist-row',
              index === selectedVideoIndex ? 'selected' : '',
              index === loadedVideoIndex && isVideoPlaying ? 'playing' : ''
            ]"
            style="cursor: pointer"
            @click="emit('video-select', index)"
          >
            <div class="playlist-number">{{ index + 1 }}</div>
            <div class="playlist-info">
              <div class="playlist-name">{{ video.name }}</div>
              <div v-if="index === loadedVideoIndex" class="playlist-status">
                {{ isVideoPlaying ? 'Playing' : 'Loaded' }}
              </div>
              <div v-else-if="index === selectedVideoIndex" class="playlist-status">Selected</div>
            </div>
            <button
              v-if="!video.isDefault"
              class="remove-btn"
              title="Remove from playlist"
              @click.stop="emit('remove-from-playlist', video.id)"
            >
              ×
            </button>
          </div>
          <div v-if="videoPlaylist.length === 0" class="playlist-empty">No videos in playlist</div>
        </div>
      </div>
    </div>

    <div v-if="inputSource === 'webcam'" class="webcam-controls">
      <div class="control-group">
        <label class="control-label">Webcam Audio:</label>
        <button
          :class="['control-btn', isMuted ? 'muted' : '']"
          :title="isMuted ? 'Unmute' : 'Mute'"
          @click="emit('mute-toggle')"
        >
          {{ isMuted ? 'MUTED' : 'ENABLED' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface VideoPlaylistItem {
  id: string;
  name: string;
  url?: string;
  file?: File;
  isDefault?: boolean;
}

const props = defineProps<{
  inputSource: string;
  isMuted: boolean;
  videoPlaylist: VideoPlaylistItem[];
  selectedVideoIndex: number;
  loadedVideoIndex: number;
  isVideoPlaying: boolean;
  currentTime: number;
  duration: number;
}>();

const emit = defineEmits<{
  'input-source-change': [source: string];
  'mute-toggle': [];
  'video-select': [index: number];
  'video-play-pause': [];
  'next-video': [];
  'previous-video': [];
  'add-videos': [files: File[]];
  'remove-from-playlist': [id: string];
  seek: [time: number];
  'seek-start': [];
  'seek-end': [];
}>();

const dragOver = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);

const currentVideo = computed(() => props.videoPlaylist[props.loadedVideoIndex]);
const progressPercentage = computed(() =>
  props.duration > 0 ? (props.currentTime / props.duration) * 100 : 0
);

function formatTime(seconds: number) {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function onTimelineClick(e: MouseEvent) {
  if (props.duration > 0) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    emit('seek', pct * props.duration);
  }
}

function onTimelineMouseDown(e: MouseEvent) {
  e.preventDefault();
  emit('seek-start');

  const onMove = (ev: MouseEvent) => {
    const track = document.querySelector('.timeline-track');
    const rect = track?.getBoundingClientRect();
    if (rect && props.duration > 0) {
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      emit('seek', pct * props.duration);
    }
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    emit('seek-end');
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('video/'));
  if (files.length > 0) emit('add-videos', files);
}

function onFileInput(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? []).filter((f) =>
    f.type.startsWith('video/')
  );
  if (files.length > 0) emit('add-videos', files);
}
</script>
