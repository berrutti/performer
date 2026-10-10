import { onMounted, onUnmounted, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface BeatmatcherDeck {
  id: string;
  isPlaying: boolean;
  bpm: number | null;
  beatOffsetSec: number;
  positionSec: number;
  playbackRate: number;
  effectiveBpm: number | null;
  currentBeat: number | null;
}

interface BeatmatcherStatePayload {
  schemaVersion: number;
  epochMs: number;
  sampleRate: number;
  decks: BeatmatcherDeck[];
}

export type BeatmatcherDeckStatus = Pick<BeatmatcherDeck, 'id' | 'isPlaying' | 'effectiveBpm'>;

type PlayingDeck = BeatmatcherDeck & { effectiveBpm: number; currentBeat: number };

const STALE_THRESHOLD_MS = 500;

function sameDeckStatus(a: BeatmatcherDeckStatus[], b: BeatmatcherDeckStatus[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (deck, i) =>
        deck.id === b[i].id &&
        deck.isPlaying === b[i].isPlaying &&
        deck.effectiveBpm === b[i].effectiveBpm
    )
  );
}

function isPlayingDeck(deck: BeatmatcherDeck): deck is PlayingDeck {
  return deck.isPlaying && deck.effectiveBpm !== null && deck.currentBeat !== null;
}

function playingDecks(state: BeatmatcherStatePayload | null, nowMs: number): PlayingDeck[] {
  if (!state || nowMs - state.epochMs > STALE_THRESHOLD_MS) return [];
  return state.decks.filter(isPlayingDeck);
}

function beatAt(
  state: BeatmatcherStatePayload | null,
  nowMs: number
): { beat: number; bpm: number } | null {
  const reference = playingDecks(state, nowMs)[0];
  if (!reference || !state) return null;
  const elapsedSec = (nowMs - state.epochMs) / 1000;
  return {
    beat: reference.currentBeat + elapsedSec * (reference.effectiveBpm / 60),
    bpm: reference.effectiveBpm
  };
}

function averageBpm(state: BeatmatcherStatePayload | null, nowMs: number): number | null {
  const playing = playingDecks(state, nowMs);
  if (playing.length === 0) return null;
  return playing.reduce((sum, deck) => sum + deck.effectiveBpm, 0) / playing.length;
}

// No master deck in the protocol: tempo averages the playing decks, while phase follows one
// deck, since downbeats can't be averaged.
function beatClock(
  state: BeatmatcherStatePayload | null,
  nowMs: number
): { time: number; bpm: number } | null {
  const beat = beatAt(state, nowMs);
  const bpm = averageBpm(state, nowMs);
  if (beat === null || bpm === null) return null;
  return { time: (beat.beat * 60) / bpm, bpm };
}

export function useBeatmatcherLink() {
  const connected = ref(false);
  const decks = ref<BeatmatcherDeckStatus[]>([]);

  let latest: BeatmatcherStatePayload | null = null;
  let unlisteners: UnlistenFn[] = [];

  onMounted(async () => {
    unlisteners = await Promise.all([
      listen<BeatmatcherStatePayload>('beatmatcher:state', (event) => {
        latest = event.payload;
        const status = event.payload.decks.map(({ id, isPlaying, effectiveBpm }) => ({
          id,
          isPlaying,
          effectiveBpm
        }));
        if (!sameDeckStatus(decks.value, status)) decks.value = status;
        connected.value = true;
      }),
      listen('beatmatcher:disconnected', () => {
        latest = null;
        decks.value = [];
        connected.value = false;
      })
    ]);
  });

  onUnmounted(() => {
    unlisteners.forEach((unlisten) => unlisten());
    unlisteners = [];
  });

  return {
    connected,
    decks,
    getBeatClock: () => beatClock(latest, Date.now()),
    getBeat: () => beatAt(latest, Date.now()),
    getAverageBpm: () => averageBpm(latest, Date.now())
  };
}
