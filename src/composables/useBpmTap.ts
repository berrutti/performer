import { ref, onMounted, onUnmounted } from 'vue';

const BPM_TAP_WINDOW_MS = 10000;
const BPM_TAP_MAX_COUNT = 8;
const BPM_MIN = 60;
const BPM_MAX = 200;
const BPM_ROUNDING = 5;
export const DEFAULT_BPM = 138;

export function useBpmTap() {
  const bpm = ref<number>(DEFAULT_BPM);
  const isSettingBpm = ref<boolean>(false);
  const tapTimes: number[] = [];

  function calculateBpmFromTaps(times: number[]): number {
    if (times.length < 2) return DEFAULT_BPM;
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) {
      intervals.push(times[i] - times[i - 1]);
    }
    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
    const rawBpm = 60000 / avgInterval;
    return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(rawBpm / BPM_ROUNDING) * BPM_ROUNDING));
  }

  function handleBpmTap() {
    const now = performance.now();
    tapTimes.push(now);

    const cutoffTime = now - BPM_TAP_WINDOW_MS;
    const recentTimes = tapTimes.filter((t) => t > cutoffTime).slice(-BPM_TAP_MAX_COUNT);
    tapTimes.length = 0;
    tapTimes.push(...recentTimes);

    if (recentTimes.length >= 2) {
      const newBpm = calculateBpmFromTaps(recentTimes);
      bpm.value = newBpm;
      isSettingBpm.value = true;

      const expectedInterval = 60000 / newBpm;
      setTimeout(
        () => {
          isSettingBpm.value = false;
          tapTimes.length = 0;
        },
        expectedInterval * 2 + 500
      );
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.repeat) return;
    if (event.code === 'Space') {
      event.preventDefault();
      handleBpmTap();
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown));

  return { bpm, isSettingBpm };
}
