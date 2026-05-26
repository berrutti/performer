<template>
  <div
    style="
      position: relative;
      width: 100vw;
      height: 100vh;
      background-color: black;
      overflow: hidden;
    "
    @contextmenu.prevent="openControls"
  >
    <div v-if="showSplash" id="splash">
      <svg id="splash-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
        <defs>
          <radialGradient id="sgm" cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
            <stop offset="18%" stop-color="#ff55c0" stop-opacity="0.95" />
            <stop offset="58%" stop-color="#cc0077" stop-opacity="0.85" />
            <stop offset="100%" stop-color="#880055" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="sgc" cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
            <stop offset="18%" stop-color="#00ddff" stop-opacity="0.95" />
            <stop offset="58%" stop-color="#0099cc" stop-opacity="0.85" />
            <stop offset="100%" stop-color="#005580" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="sgy" cx="36%" cy="28%" r="70%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
            <stop offset="18%" stop-color="#ffdd33" stop-opacity="0.95" />
            <stop offset="58%" stop-color="#cc9900" stop-opacity="0.85" />
            <stop offset="100%" stop-color="#886600" stop-opacity="0" />
          </radialGradient>
        </defs>
        <g style="mix-blend-mode: screen">
          <circle cx="512" cy="340" r="260" fill="url(#sgm)" />
          <circle cx="318" cy="686" r="260" fill="url(#sgc)" />
          <circle cx="706" cy="686" r="260" fill="url(#sgy)" />
        </g>
      </svg>
      <div id="splash-name">performer</div>
    </div>
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
import { ref, computed, watch, watchEffect, onMounted, onUnmounted, toRaw } from 'vue';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ShaderEffect, shaderEffects } from '../utils';
import { useBpmTap } from '../composables/useBpmTap';
import { useSettings } from '../composables/useSettings';
import { useEffectTransitions } from '../components/effects/useEffectTransitions';
import { useVideoPlaylist } from '../components/input/useVideoPlaylist';
import { useVideoSource } from '../components/input/useVideoSource';
import { useMidi } from '../composables/useMidi';
import { useWebGLRenderer } from '../composables/useWebGLRenderer';
import { CHANNEL_NAME, type FromControls, type FromMain } from '../broadcast';
import packageJson from '../../package.json';

const VERSION = packageJson.version;
const MIDI_NOTIFICATION_DURATION_MS = 5000;

const canvasRef = ref<HTMLCanvasElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);

const fps = ref(0);
const frameTime = ref(0);
const showMidiSyncNotification = ref(false);
const showSplash = ref(true);

setTimeout(() => {
  showSplash.value = false;
}, 1200);

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

const initialBpmSync = Object.values(ShaderEffect).reduce(
  (acc, effect) => ({ ...acc, [effect]: shaderEffects[effect].bpmSync ? true : false }),
  {} as Record<ShaderEffect, boolean>
);

const bpmSyncEnabled = ref(initialBpmSync);

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
  bpmSyncEnabled: computed(() => bpmSyncEnabled.value),
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

const appState = computed(() => ({
  activeEffects: { ...effectTransitions.activeEffects.value },
  effectIntensities: { ...effectTransitions.effectIntensities.value },
  bpmSyncEnabled: { ...bpmSyncEnabled.value },
  inputSource: settings.inputSource.value,
  isMuted: settings.isMuted.value,
  midiConnected: midi.connected.value,
  midiDeviceName: midi.deviceName.value,
  bpm: bpm.value,
  isSettingBpm: isSettingBpm.value,
  showHelp: settings.showHelp.value,
  videoPlaylist: toRaw(playlist.videoPlaylist.value).map((item) => ({ ...toRaw(item) })),
  selectedVideoIndex: playlist.selectedVideoIndex.value,
  loadedVideoIndex: playlist.loadedVideoIndex.value,
  isVideoPlaying: playlist.isVideoPlaying.value,
  currentTime: playlist.currentTime.value,
  duration: playlist.duration.value
}));

let channel: BroadcastChannel | null = null;

function handleAction(msg: FromControls) {
  switch (msg.type) {
    case 'request-state':
      channel?.postMessage({ type: 'state-response', payload: appState.value } satisfies FromMain);
      break;
    case 'toggle-effect':
      effectTransitions.handleToggleEffect(msg.effect);
      break;
    case 'intensity-change':
      effectTransitions.handleIntensityChange(msg.effect, msg.intensity);
      break;
    case 'input-source-change':
      settings.inputSource.value = msg.source;
      break;
    case 'mute-toggle':
      settings.isMuted.value = !settings.isMuted.value;
      break;
    case 'toggle-help':
      settings.showHelp.value = !settings.showHelp.value;
      break;
    case 'bpm-change':
      bpm.value = msg.bpm;
      break;
    case 'bpm-sync-change':
      bpmSyncEnabled.value = { ...bpmSyncEnabled.value, [msg.effect]: msg.enabled };
      break;
    case 'video-select':
      playlist.selectedVideoIndex.value = msg.index;
      break;
    case 'video-play-pause':
      playlist.handleVideoPlayPause();
      break;
    case 'next-video':
      playlist.handleNextVideo();
      break;
    case 'previous-video':
      playlist.handlePreviousVideo();
      break;
    case 'add-videos':
      playlist.handleAddVideosToPlaylist(msg.paths);
      break;
    case 'remove-from-playlist':
      playlist.handleRemoveFromPlaylist(msg.id);
      break;
    case 'seek':
      playlist.handleSeek(msg.time);
      break;
    case 'seek-start':
      playlist.handleSeekStart();
      break;
    case 'seek-end':
      playlist.handleSeekEnd();
      break;
  }
}

onMounted(() => {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent<FromControls>) => handleAction(e.data);
});

watchEffect(() => {
  const state = appState.value; // always read so Vue tracks deps even when channel is null
  if (channel) {
    channel.postMessage({ type: 'state', payload: state } satisfies FromMain);
  }
});

onUnmounted(() => {
  channel?.close();
});

async function openControls() {
  const existing = await WebviewWindow.getByLabel('controls');
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  new WebviewWindow('controls', {
    url: window.location.href.split('#')[0] + '#controls',
    title: 'performer',
    width: 900,
    height: 700,
    resizable: true
  });
}
</script>

<style scoped>
#splash {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #0a0a0a;
  font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  gap: 14px;
  pointer-events: none;
  z-index: 10;
}

#splash-name {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #e8e8e8;
}

#splash-logo {
  width: 72px;
  height: 72px;
  animation: splash-icon 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes splash-icon {
  from {
    transform: scale(1.5);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
