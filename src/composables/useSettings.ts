import { ref, watch, onMounted } from 'vue';

const KEYS = {
  showHelp: 'performer-showHelp',
  isMuted: 'performer-muted',
  inputSource: 'performer-inputSource',
  bpm: 'performer-bpm'
} as const;

function load<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage errors
  }
}

export function useSettings() {
  const showHelp = ref(true);
  const isMuted = ref(false);
  const inputSource = ref('webcam');
  const bpm = ref(120);

  onMounted(() => {
    const savedShowHelp = load<boolean>(KEYS.showHelp);
    if (savedShowHelp !== undefined) showHelp.value = savedShowHelp;

    const savedMuted = load<boolean>(KEYS.isMuted);
    if (savedMuted !== undefined) isMuted.value = savedMuted;

    const savedInputSource = load<string>(KEYS.inputSource);
    if (savedInputSource !== undefined) inputSource.value = savedInputSource;

    const savedBpm = load<number>(KEYS.bpm);
    if (savedBpm !== undefined) bpm.value = savedBpm;
  });

  watch(showHelp, (val) => save(KEYS.showHelp, val));
  watch(isMuted, (val) => save(KEYS.isMuted, val));
  watch(inputSource, (val) => save(KEYS.inputSource, val));
  watch(bpm, (val) => save(KEYS.bpm, val));

  return { showHelp, isMuted, inputSource, bpm };
}
