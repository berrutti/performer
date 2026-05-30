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
    <video ref="randomizeRef1" style="display: none" preload="auto" crossorigin="anonymous" />
    <video ref="randomizeRef2" style="display: none" preload="auto" crossorigin="anonymous" />

    <div
      v-if="showNoVideoMessage"
      style="
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: rgba(255, 255, 255, 0.3);
        font-family: var(--font, monospace);
        font-size: 13px;
        pointer-events: none;
      "
    >
      {{
        playlist.videoPlaylist.value.length === 0
          ? 'right click to open controls and add videos'
          : 'double-click a video in the playlist to start'
      }}
    </div>

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
      <div>Right click to open controls | Spacebar to play / pause</div>
      <div style="font-size: 12px; margin-top: 5px; opacity: 0.8">
        Version: {{ VERSION }} | GPU FPS: {{ fps }} | Frame Time: {{ frameTime.toFixed(2) }}ms
        <span v-if="midi.connected.value" style="color: #a855f7; margin-left: 10px">
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
import { ShaderEffect, shaderEffects, buildEffectRecord } from '@/utils';
import { useSettings } from '@/composables/useSettings';
import { useEffectTransitions } from '@/components/effects/useEffectTransitions';
import { useVideoPlaylist } from '@/components/input/useVideoPlaylist';
import { useVideoPlayer } from '@/components/input/useVideoPlayer';
import { useVideoSource } from '@/components/input/useVideoSource';
import { useMidi } from '@/composables/useMidi';
import { useWebGLRenderer } from '@/composables/useWebGLRenderer';
import { useRandomizeMode } from '@/composables/useRandomizeMode';
import { CHANNEL_NAME, type FromControls, type FromMain } from '@/broadcast';
import packageJson from '../../package.json';

const VERSION = packageJson.version;
const MIDI_NOTIFICATION_DURATION_MS = 5000;

const canvasRef = ref<HTMLCanvasElement | null>(null);
const videoRef = ref<HTMLVideoElement | null>(null);
const randomizeRef1 = ref<HTMLVideoElement | null>(null);
const randomizeRef2 = ref<HTMLVideoElement | null>(null);

const fps = ref(0);
const frameTime = ref(0);
const showMidiSyncNotification = ref(false);
const showSplash = ref(true);

const initialActiveEffects = buildEffectRecord(() => false);
const initialIntensities = buildEffectRecord((e) => shaderEffects[e].intensity ?? 0);

const settings = useSettings();
const bpm = settings.bpm;
const effectTransitions = useEffectTransitions(initialActiveEffects, initialIntensities);
const playlist = useVideoPlaylist(settings.inputSource);
const player = useVideoPlayer(
  videoRef,
  randomizeRef1,
  randomizeRef2,
  playlist.videoPlaylist,
  playlist.selectedVideoIndex,
  settings.inputSource,
  settings.isMuted
);

useVideoSource(videoRef, settings.inputSource, player.loadedVideoIndex, playlist.videoPlaylist);

const randomize = useRandomizeMode(
  bpm,
  playlist.videoPlaylist,
  player.loadedVideoIndex,
  (snapshot) => {
    effectTransitions.setActiveEffects(snapshot.effects);
    effectTransitions.setEffectIntensities(snapshot.intensities);
    player.applyVideoSnapshot(snapshot);
  },
  player.preloadUpcomingVideo
);

watch(
  () => randomize.isActive.value,
  (active) => {
    if (!active) player.onRandomizeDeactivated();
  }
);

function handleRenderPerformance(renderFps: number, renderFrameTime: number) {
  fps.value = renderFps;
  frameTime.value = renderFrameTime;
}

useWebGLRenderer({
  canvasRef,
  videoRef: player.rendererVideoRef,
  activeEffects: effectTransitions.renderingEffects,
  effectIntensities: effectTransitions.renderingIntensities,
  bpmSyncEnabled: computed(() => effectTransitions.bpmSyncEnabled.value),
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

// Show hint when in video mode and nothing has ever started playing this session.
// isVideoPlaying and videoPausedManually are reactive (event-driven), so this
// correctly recomputes when the source or playback state changes.
const showNoVideoMessage = computed(
  () =>
    settings.inputSource.value === 'video' &&
    !player.isVideoPlaying.value &&
    !player.videoPausedManually.value
);

// currentTime fires ~4Hz during playback. Throttle it so the full appState
// isn't serialised and posted cross-tab on every timeupdate event.
const throttledCurrentTime = ref(0);
let throttleTimer: number | null = null;
watch(
  () => player.currentTime.value,
  (t) => {
    if (throttleTimer !== null) return;
    throttleTimer = window.setTimeout(() => {
      throttledCurrentTime.value = t;
      throttleTimer = null;
    }, 100);
  }
);

const appState = computed(() => ({
  activeEffects: { ...effectTransitions.activeEffects.value },
  effectIntensities: { ...effectTransitions.effectIntensities.value },
  bpmSyncEnabled: { ...effectTransitions.bpmSyncEnabled.value },
  inputSource: settings.inputSource.value,
  isMuted: settings.isMuted.value,
  isRandomizeActive: randomize.isActive.value,
  midiConnected: midi.connected.value,
  midiDeviceName: midi.deviceName.value,
  bpm: bpm.value,
  showHelp: settings.showHelp.value,
  videoPlaylist: toRaw(playlist.videoPlaylist.value).map((item) => ({ ...toRaw(item) })),
  selectedVideoIndex: playlist.selectedVideoIndex.value,
  loadedVideoIndex: player.loadedVideoIndex.value,
  isVideoPlaying: player.isVideoPlaying.value,
  currentTime: throttledCurrentTime.value,
  duration: player.duration.value
}));

let channel: BroadcastChannel | null = null;

function handleAction(msg: FromControls) {
  switch (msg.type) {
    case 'request-state':
      channel?.postMessage({ type: 'state', payload: appState.value } satisfies FromMain);
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
      effectTransitions.setBpmSyncEnabled(msg.effect, msg.enabled);
      break;
    case 'video-select':
      playlist.selectedVideoIndex.value = msg.index;
      break;
    case 'video-play':
      player.handleVideoPlay(msg.index);
      break;
    case 'video-play-pause':
      player.handleVideoPlayPause();
      break;
    case 'next-video':
      player.handleNextVideo();
      break;
    case 'previous-video':
      player.handlePreviousVideo();
      break;
    case 'add-videos':
      playlist.handleAddVideosToPlaylist(msg.paths);
      break;
    case 'remove-from-playlist':
      player.handleVideoRemoved(
        playlist.removeVideoFromList(msg.id, player.loadedVideoIndex.value)
      );
      break;
    case 'seek':
      player.handleSeek(msg.time);
      break;
    case 'seek-start':
      player.handleSeekStart();
      break;
    case 'seek-end':
      player.handleSeekEnd();
      break;
    case 'toggle-randomize':
      randomize.toggle();
      break;
  }
}

function onSpacebar(e: KeyboardEvent) {
  if (e.repeat) return;
  if (e.code !== 'Space') return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (settings.inputSource.value !== 'video') return;
  e.preventDefault();
  player.handleVideoPlayPause();
}

onMounted(() => {
  showSplash.value = false;
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent<FromControls>) => handleAction(e.data);
  window.addEventListener('keydown', onSpacebar);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onSpacebar);
  channel?.close();
});

watchEffect(() => {
  const state = appState.value; // always read so Vue tracks deps even when channel is null
  if (channel) {
    channel.postMessage({ type: 'state', payload: state } satisfies FromMain);
  }
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
