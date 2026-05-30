<template>
  <div v-if="state" style="width: 100vw; height: 100vh; overflow: hidden">
    <ControlPanel
      :active-effects="state.activeEffects"
      :effect-intensities="state.effectIntensities"
      :input-source="state.inputSource"
      :is-muted="state.isMuted"
      :is-randomize-active="state.isRandomizeActive"
      :midi-connected="state.midiConnected"
      :midi-device-name="state.midiDeviceName"
      :bpm="state.bpm"
      :bpm-sync-enabled="state.bpmSyncEnabled"
      :show-help="state.showHelp"
      :video-playlist="state.videoPlaylist"
      :selected-video-index="state.selectedVideoIndex"
      :loaded-video-index="state.loadedVideoIndex"
      :is-video-playing="state.isVideoPlaying"
      :current-time="state.currentTime"
      :duration="state.duration"
      @input-source-change="send({ type: 'input-source-change', source: $event })"
      @mute-toggle="send({ type: 'mute-toggle' })"
      @toggle-effect="send({ type: 'toggle-effect', effect: $event })"
      @intensity-change="
        (effect, intensity) => send({ type: 'intensity-change', effect, intensity })
      "
      @toggle-help="send({ type: 'toggle-help' })"
      @toggle-randomize="send({ type: 'toggle-randomize' })"
      @bpm-change="send({ type: 'bpm-change', bpm: $event })"
      @bpm-sync-change="(effect, enabled) => send({ type: 'bpm-sync-change', effect, enabled })"
      @video-select="send({ type: 'video-select', index: $event })"
      @video-play="send({ type: 'video-play', index: $event })"
      @video-play-pause="send({ type: 'video-play-pause' })"
      @next-video="send({ type: 'next-video' })"
      @previous-video="send({ type: 'previous-video' })"
      @add-videos="onAddVideos"
      @remove-from-playlist="send({ type: 'remove-from-playlist', id: $event })"
      @seek="send({ type: 'seek', time: $event })"
      @seek-start="send({ type: 'seek-start' })"
      @seek-end="send({ type: 'seek-end' })"
    />
  </div>
  <div v-else class="waiting">Waiting for main window...</div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { open } from '@tauri-apps/plugin-dialog';
import { CHANNEL_NAME, type AppState, type FromMain, type FromControls } from '../broadcast';
import ControlPanel from '../components/controls/ControlPanel.vue';

const state = ref<AppState | null>(null);
let channel: BroadcastChannel | null = null;

function send(msg: FromControls) {
  channel?.postMessage(msg);
}

async function onAddVideos() {
  const selected = await open({
    multiple: true,
    filters: [{ name: 'Video', extensions: ['mp4', 'm4v', 'mov', 'webm'] }]
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  send({ type: 'add-videos', paths });
}

onMounted(() => {
  channel = new BroadcastChannel(CHANNEL_NAME);
  channel.onmessage = (e: MessageEvent<FromMain>) => {
    if (e.data.type === 'state' || e.data.type === 'state-response') {
      state.value = e.data.payload;
    }
  };
  send({ type: 'request-state' });
});

onUnmounted(() => {
  channel?.close();
});
</script>

<style scoped>
.waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: var(--color-muted);
  font-family: var(--font);
  font-size: 14px;
}
</style>
