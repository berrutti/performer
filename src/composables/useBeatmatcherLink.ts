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

// Positions and beat counts change in every 50ms snapshot and the controls never show
// them, so keeping them reactive would re-broadcast the whole app state 20 times a second.
export type BeatmatcherDeckStatus = Pick<BeatmatcherDeck, 'id' | 'isPlaying' | 'effectiveBpm'>;

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

export function useBeatmatcherLink() {
  const connected = ref(false);
  const decks = ref<BeatmatcherDeckStatus[]>([]);

  let latest: BeatmatcherStatePayload | null = null;
  let unlisteners: UnlistenFn[] = [];

  function isStale(): boolean {
    return !latest || Date.now() - latest.epochMs > STALE_THRESHOLD_MS;
  }

  // There's no master deck in the protocol, so we auto-follow whatever is
  // currently playing: tempo is the average across playing decks (in practice
  // beatmatched DJ decks already share close to the same tempo), and phase
  // locks to one reference deck's own beat grid, since phase can't be averaged
  // across decks with different downbeats.
  function playingDecks(): BeatmatcherDeck[] {
    if (isStale() || !latest) return [];
    return latest.decks.filter(
      (d) => d.isPlaying && d.effectiveBpm !== null && d.currentBeat !== null
    );
  }

  // Snapshots only arrive every 50ms, so the beat count is extrapolated from the last one
  // to stay accurate in between (see the phase extrapolation formula in the Beatmatcher
  // broadcast spec).
  function getBeat(): { beat: number; bpm: number } | null {
    const reference = playingDecks()[0];
    if (!reference || !latest) return null;

    const bpm = reference.effectiveBpm!;
    return {
      beat: reference.currentBeat! + ((Date.now() - latest.epochMs) / 1000) * (bpm / 60),
      bpm
    };
  }

  function getAverageBpm(): number | null {
    const playing = playingDecks();
    if (playing.length === 0) return null;
    return playing.reduce((sum, d) => sum + d.effectiveBpm!, 0) / playing.length;
  }

  // Fed into the beatPeriod/beatPhase shader math in place of the free-running clock,
  // this lands beat 0 exactly on the reference deck's real downbeat.
  function getBeatClock(): { time: number; bpm: number } | null {
    const beat = getBeat();
    const bpm = getAverageBpm();
    if (beat === null || bpm === null) return null;

    return { time: (beat.beat * 60) / bpm, bpm };
  }

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

  return { connected, decks, getBeatClock, getBeat, getAverageBpm };
}
