<template>
  <div class="control-panel">
    <div class="panel-columns">
      <InputTab
        :input-source="inputSource"
        :is-muted="isMuted"
        :is-randomize-active="isRandomizeActive"
        :video-playlist="videoPlaylist"
        :selected-video-index="selectedVideoIndex"
        :loaded-video-index="loadedVideoIndex"
        :is-video-playing="isVideoPlaying"
        :current-time="currentTime"
        :duration="duration"
        @input-source-change="emit('input-source-change', $event)"
        @mute-toggle="emit('mute-toggle')"
        @toggle-randomize="emit('toggle-randomize')"
        @video-select="emit('video-select', $event)"
        @video-play="emit('video-play', $event)"
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
import type { VideoPlaylistItem } from '../input/useVideoPlaylist';

const props = defineProps<{
  activeEffects: Record<ShaderEffect, boolean>;
  effectIntensities: Record<ShaderEffect, number>;
  bpmSyncEnabled: Record<ShaderEffect, boolean>;
  inputSource: string;
  isMuted: boolean;
  isRandomizeActive: boolean;
  midiConnected: boolean;
  midiDeviceName: string;
  bpm: number;
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
  'bpm-change': [bpm: number];
}>();

// suppress unused props warning
void props;
</script>
