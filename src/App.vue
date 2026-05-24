<template>
  <div
    style="
      position: relative;
      width: 100vw;
      height: 100vh;
      background-color: black;
      overflow: hidden;
    "
    @contextmenu.prevent="openPopupWindow"
  >
    <canvas ref="canvasRef" style="width: 100%; height: 100%; display: block" />
    <video ref="videoRef" style="display: none" crossorigin="anonymous" />

    <div
      v-if="settings.showHelp.value"
      style="
        position: absolute;
        bottom: 20px;
        width: 100%;
        text-align: center;
        color: white;
        pointer-events: none;
      "
    >
      <div>Right click to open controls | Spacebar to tap BPM</div>
      <div style="font-size: 12px; margin-top: 5px; opacity: 0.8">
        Version: {{ VERSION }} | GPU FPS: {{ fps }} | Frame Time: {{ frameTime.toFixed(2) }}ms
        <span v-if="midi.connected.value" style="color: #22c55e; margin-left: 10px">
          MIDI: {{ midi.deviceName.value }}
        </span>
        <span v-else style="color: #ef4444; margin-left: 10px">MIDI: Not connected</span>
      </div>
      <div
        v-if="showMidiSyncNotification"
        style="
          font-size: 14px;
          margin-top: 10px;
          color: #ffff00;
          background-color: rgba(0, 0, 0, 0.8);
          padding: 10px 20px;
          border-radius: 4px;
          display: inline-block;
          pointer-events: none;
        "
      >
        MIDI Connected! Move each knob slightly to sync with current positions
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ShaderEffect, shaderEffects } from './utils';
import { useBpmTap } from './composables/useBpmTap';
import { useSettings } from './composables/useSettings';
import { useEffectTransitions } from './components/effects/useEffectTransitions';
import { useVideoPlaylist } from './components/input/useVideoPlaylist';
import { useVideoSource } from './components/input/useVideoSource';
import { useMidi } from './composables/useMidi';
import { useWebGLRenderer } from './composables/useWebGLRenderer';
import { usePopupWindow } from './components/controls/usePopupWindow';
import ControlPanel from './components/controls/ControlPanel.vue';
import packageJson from '../package.json';

const VERSION = packageJson.version;
const MIDI_NOTIFICATION_DURATION_MS = 5000;

const canvasRef = ref<HTMLCanvasElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);

const fps = ref(0);
const frameTime = ref(0);
const showMidiSyncNotification = ref(false);

const initialActiveEffects = Object.values(ShaderEffect).reduce(
  (acc, effect) => ({ ...acc, [effect]: false }),
  {} as Record<ShaderEffect, boolean>
);

const initialIntensities = Object.values(ShaderEffect).reduce(
  (acc, effect) => {
    const def = shaderEffects[effect];
    if (def.intensity !== undefined) acc[effect] = def.intensity;
    return acc;
  },
  {} as Record<ShaderEffect, number>
);

const { bpm, isSettingBpm } = useBpmTap();
const settings = useSettings();
const effectTransitions = useEffectTransitions(initialActiveEffects, initialIntensities);
const playlist = useVideoPlaylist(videoRef, settings.inputSource);

useVideoSource(
  videoRef,
  settings.inputSource,
  playlist.loadedVideoIndex,
  playlist.videoPlaylist,
  playlist.isVideoPlaying
);

watch(bpm, (val) => {
  settings.bpm.value = val;
});

watch(
  () => settings.isMuted.value,
  (muted) => {
    if (videoRef.value) videoRef.value.muted = muted;
  }
);

function handleRenderPerformance(renderFps: number, renderFrameTime: number) {
  fps.value = renderFps;
  frameTime.value = renderFrameTime;
}

useWebGLRenderer({
  canvasRef,
  videoRef,
  activeEffects: effectTransitions.renderingEffects,
  effectIntensities: effectTransitions.renderingIntensities,
  inputSource: settings.inputSource,
  bpm,
  onRenderPerformance: handleRenderPerformance
});

const midi = useMidi({
  onEffectToggle: (effect: ShaderEffect) => effectTransitions.handleToggleEffect(effect),
  onIntensityChange: (effect: ShaderEffect, intensity: number) => {
    effectTransitions.setEffectIntensities({
      ...effectTransitions.effectIntensities.value,
      [effect]: intensity
    });
  },
  onMidiConnect: () => {
    showMidiSyncNotification.value = true;
    setTimeout(() => {
      showMidiSyncNotification.value = false;
    }, MIDI_NOTIFICATION_DURATION_MS);
  }
});

const popupProps = computed(() => ({
  activeEffects: effectTransitions.activeEffects.value,
  effectIntensities: effectTransitions.effectIntensities.value,
  inputSource: settings.inputSource.value,
  isMuted: settings.isMuted.value,
  midiConnected: midi.connected.value,
  midiDeviceName: midi.deviceName.value,
  bpm: bpm.value,
  isSettingBpm: isSettingBpm.value,
  showHelp: settings.showHelp.value,
  videoPlaylist: playlist.videoPlaylist.value,
  selectedVideoIndex: playlist.selectedVideoIndex.value,
  loadedVideoIndex: playlist.loadedVideoIndex.value,
  isVideoPlaying: playlist.isVideoPlaying.value,
  currentTime: playlist.currentTime.value,
  duration: playlist.duration.value,
  onInputSourceChange: (s: string) => {
    settings.inputSource.value = s;
  },
  onMuteToggle: () => {
    settings.isMuted.value = !settings.isMuted.value;
  },
  onToggleEffect: (effect: ShaderEffect) => effectTransitions.handleToggleEffect(effect),
  onIntensityChange: (effect: ShaderEffect, intensity: number) =>
    effectTransitions.handleIntensityChange(effect, intensity),
  onToggleHelp: () => {
    settings.showHelp.value = !settings.showHelp.value;
  },
  onBpmChange: (val: number) => {
    bpm.value = val;
  },
  onVideoSelect: (index: number) => {
    playlist.selectedVideoIndex.value = index;
  },
  onVideoPlayPause: () => playlist.handleVideoPlayPause(),
  onNextVideo: () => playlist.handleNextVideo(),
  onPreviousVideo: () => playlist.handlePreviousVideo(),
  onAddVideos: (files: File[]) => playlist.handleAddVideosToPlaylist(files),
  onRemoveFromPlaylist: (id: string) => playlist.handleRemoveFromPlaylist(id),
  onSeek: (time: number) => playlist.handleSeek(time),
  onSeekStart: () => playlist.handleSeekStart(),
  onSeekEnd: () => playlist.handleSeekEnd()
}));

const { openPopupWindow } = usePopupWindow(ControlPanel, () => popupProps.value);
</script>
