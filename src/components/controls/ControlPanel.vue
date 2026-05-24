<template>
  <div class="control-panel">
    <div class="tab-header">
      <button
        :class="['tab-button', activeTab === 'input' ? 'active' : '']"
        @click="activeTab = 'input'"
      >
        Input
      </button>
      <button
        :class="['tab-button', activeTab === 'effects' ? 'active' : '']"
        @click="activeTab = 'effects'"
      >
        Effects
      </button>
    </div>

    <InputTab
      v-if="activeTab === 'input'"
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
      @add-videos="emit('add-videos', $event)"
      @remove-from-playlist="emit('remove-from-playlist', $event)"
      @seek="emit('seek', $event)"
      @seek-start="emit('seek-start')"
      @seek-end="emit('seek-end')"
    />

    <EffectsTab
      v-if="activeTab === 'effects'"
      :active-effects="activeEffects"
      :effect-intensities="effectIntensities"
      :show-help="showHelp"
      :midi-connected="midiConnected"
      :midi-device-name="midiDeviceName"
      :bpm="bpm"
      :is-setting-bpm="isSettingBpm"
      @toggle-effect="emit('toggle-effect', $event)"
      @intensity-change="(effect, intensity) => emit('intensity-change', effect, intensity)"
      @toggle-help="emit('toggle-help')"
      @bpm-change="emit('bpm-change', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ShaderEffect } from '../../utils';
import InputTab from '../input/InputTab.vue';
import EffectsTab from '../effects/EffectsTab.vue';

interface VideoPlaylistItem {
  id: string;
  name: string;
  url?: string;
  file?: File;
  isDefault?: boolean;
}

const props = defineProps<{
  activeEffects: Record<ShaderEffect, boolean>;
  effectIntensities: Record<ShaderEffect, number>;
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
  'toggle-help': [];
  'video-select': [index: number];
  'video-play-pause': [];
  'next-video': [];
  'previous-video': [];
  'add-videos': [files: File[]];
  'remove-from-playlist': [id: string];
  seek: [time: number];
  'seek-start': [];
  'seek-end': [];
  'bpm-change': [bpm: number];
}>();

// suppress unused props warning
void props;

const activeTab = ref<'input' | 'effects'>('input');
</script>
