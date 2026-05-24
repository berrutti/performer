<template>
  <ControlsView v-if="isControlsTab" />
  <MainView v-else />
</template>

<script setup lang="ts">
import MainView from './views/MainView.vue';
import ControlsView from './views/ControlsView.vue';

const isControlsTab = window.location.hash === '#controls';
</script>
