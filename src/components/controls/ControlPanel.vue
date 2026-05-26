<template>
  <div class="control-panel">
    <div class="app-header">
      <svg class="app-logo" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="gm" cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.9" />
            <stop offset="20%" stop-color="#ff55c0" stop-opacity="0.95" />
            <stop offset="60%" stop-color="#cc0077" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#880055" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="gc" cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.9" />
            <stop offset="20%" stop-color="#00ddff" stop-opacity="0.95" />
            <stop offset="60%" stop-color="#0099cc" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#005580" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="gy" cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#fff" stop-opacity="0.9" />
            <stop offset="20%" stop-color="#ffdd33" stop-opacity="0.95" />
            <stop offset="60%" stop-color="#cc9900" stop-opacity="0.8" />
            <stop offset="100%" stop-color="#886600" stop-opacity="0" />
          </radialGradient>
        </defs>
        <rect width="64" height="64" fill="#0d0b14" rx="12" />
        <g style="mix-blend-mode: screen">
          <circle cx="32" cy="22" r="16" fill="url(#gm)" />
          <circle cx="20" cy="43" r="16" fill="url(#gc)" />
          <circle cx="44" cy="43" r="16" fill="url(#gy)" />
        </g>
      </svg>
      <span class="app-title">performer</span>
    </div>

    <div class="panel-columns">
      <InputTab
        :input-source="inputSource"
        :is-muted="isMuted"
        :video-playlist="videoPlaylist"
        :selected-video-index="selectedVideoIndex"
        :loaded-video-index="loadedVideoIndex"
        :is-video-playing="isVideoPlaying"
        :current-time="currentTime"
        :duration="duration"
        @input-source-change="emit('input-source-change', $event)"
        @mute-toggle="emit('mute-toggle')"
        @video-select="emit('video-select', $event)"
        @video-play-pause="emit('video-play-pause')"
        @next-video="emit('next-video')"
        @previous-video="emit('previous-video')"
        @add-videos="emit('add-videos')"
        @remove-from-playlist="emit('remove-from-playlist', $event)"
        @seek="emit('seek', $event)"
        @seek-start="emit('seek-start')"
        @seek-end="emit('seek-end')"
      />

      <EffectsTab
        :active-effects="activeEffects"
        :effect-intensities="effectIntensities"
        :bpm-sync-enabled="bpmSyncEnabled"
        :show-help="showHelp"
        :midi-connected="midiConnected"
        :midi-device-name="midiDeviceName"
        :bpm="bpm"
        :is-setting-bpm="isSettingBpm"
        @toggle-effect="emit('toggle-effect', $event)"
        @intensity-change="(effect, intensity) => emit('intensity-change', effect, intensity)"
        @toggle-help="emit('toggle-help')"
        @bpm-change="emit('bpm-change', $event)"
        @bpm-sync-change="(effect, enabled) => emit('bpm-sync-change', effect, enabled)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ShaderEffect } from '../../utils';
import InputTab from '../input/InputTab.vue';
import EffectsTab from '../effects/EffectsTab.vue';

interface VideoPlaylistItem {
  id: string;
  name: string;
  src: string;
  path?: string;
}

const props = defineProps<{
  activeEffects: Record<ShaderEffect, boolean>;
  effectIntensities: Record<ShaderEffect, number>;
  bpmSyncEnabled: Record<ShaderEffect, boolean>;
  inputSource: string;
  isMuted: boolean;
  midiConnected: boolean;
  midiDeviceName: string;
  bpm: number;
  isSettingBpm: boolean;
  showHelp: boolean;
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
  'toggle-effect': [effect: ShaderEffect];
  'intensity-change': [effect: ShaderEffect, intensity: number];
  'bpm-sync-change': [effect: ShaderEffect, enabled: boolean];
  'toggle-help': [];
  'video-select': [index: number];
  'video-play-pause': [];
  'next-video': [];
  'previous-video': [];
  'add-videos': [];
  'remove-from-playlist': [id: string];
  seek: [time: number];
  'seek-start': [];
  'seek-end': [];
  'bpm-change': [bpm: number];
}>();

// suppress unused props warning
void props;
</script>
