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
          <button
            class="randomize-btn"
            :class="{ 'randomize-btn--on': isRandomizeActive }"
            title="Start / stop random sequence"
            @click="emit('toggle-randomize')"
          >
            rand
          </button>
        </div>
        <div class="audio-controls">
          <button
            :class="['control-btn', isMuted ? 'muted' : '']"
            :title="isMuted ? 'Unmute' : 'Mute'"
            @click="emit('mute-toggle')"
          >
            vol
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
          <button class="add-videos-btn" @click="emit('add-videos')">+ add videos</button>
        </div>

        <div class="playlist-items">
          <div
            v-for="(video, index) in videoPlaylist"
            :key="video.id"
            :class="[
              'playlist-row',
              index === selectedVideoIndex ? 'selected' : '',
              index === loadedVideoIndex ? 'loaded' : '',
              index === loadedVideoIndex && isVideoPlaying ? 'playing' : ''
            ]"
            style="cursor: pointer"
            @click="emit('video-select', index)"
            @dblclick="emit('video-play', index)"
          >
            <div class="playlist-number">{{ index + 1 }}</div>
            <div class="playlist-info">
              <div class="playlist-name">{{ video.name }}</div>
              <div v-if="index === loadedVideoIndex" class="playlist-status">
                <span style="display: inline-block; width: 1em; text-align: center">{{
                  isVideoPlaying ? '▶' : '·'
                }}</span>
              </div>
            </div>
            <button
              v-if="video.path"
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
          vol
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { VideoPlaylistItem } from './useVideoPlaylist';

const props = defineProps<{
  inputSource: string;
  isMuted: boolean;
  isRandomizeActive: boolean;
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
  'toggle-randomize': [];
  'video-select': [index: number];
  'video-play': [index: number];
  'video-play-pause': [];
  'next-video': [];
  'previous-video': [];
  'add-videos': [];
  'remove-from-playlist': [id: string];
  seek: [time: number];
  'seek-start': [];
  'seek-end': [];
}>();

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
  const trackEl = e.currentTarget as HTMLElement;

  function onMove(ev: MouseEvent) {
    if (props.duration > 0) {
      const rect = trackEl.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      emit('seek', pct * props.duration);
    }
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    emit('seek-end');
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (props.inputSource !== 'video' || props.videoPlaylist.length === 0) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    const video = props.videoPlaylist[props.selectedVideoIndex];
    if (video) emit('video-play', props.selectedVideoIndex);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    emit('video-select', Math.min(props.selectedVideoIndex + 1, props.videoPlaylist.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    emit('video-select', Math.max(props.selectedVideoIndex - 1, 0));
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    const video = props.videoPlaylist[props.selectedVideoIndex];
    if (!video?.path) return;
    e.preventDefault();
    emit('remove-from-playlist', video.id);
  }
}

onMounted(() => document.addEventListener('keydown', onKeyDown));
onUnmounted(() => document.removeEventListener('keydown', onKeyDown));
</script>
