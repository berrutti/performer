import { ref, watch, onMounted } from 'vue';
import { settingsService } from '../services/settingsService';

export function useSettings() {
  const showHelp = ref(true);
  const isMuted = ref(false);
  const inputSource = ref('webcam');
  const bpm = ref<number>(120);
  let initialized = false;

  onMounted(() => {
    const saved = settingsService.loadSettings();
    if (saved.showHelp !== undefined) showHelp.value = saved.showHelp;
    if (saved.isMuted !== undefined) isMuted.value = saved.isMuted;
    if (saved.bpm !== undefined) bpm.value = saved.bpm;
    if (saved.inputSource !== undefined) inputSource.value = saved.inputSource;
    initialized = true;
  });

  watch(showHelp, (val) => {
    if (initialized) settingsService.saveShowHelp(val);
  });

  watch(isMuted, (val) => {
    if (initialized) settingsService.saveMuted(val);
  });

  watch(inputSource, (val) => {
    if (initialized) settingsService.saveInputSource(val);
  });

  watch(bpm, (val) => {
    if (initialized) settingsService.saveBpm(val);
  });

  return { showHelp, isMuted, inputSource, bpm };
}
