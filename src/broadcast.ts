import type { ShaderEffect } from './utils';
import type { VideoPlaylistItem } from './components/input/useVideoPlaylist';

export const CHANNEL_NAME = 'performer-controls';

export interface AppState {
  activeEffects: Record<ShaderEffect, boolean>;
  bpm: number;
  bpmSyncEnabled: Record<ShaderEffect, boolean>;
  currentTime: number;
  duration: number;
  effectIntensities: Record<ShaderEffect, number>;
  inputSource: string;
  isMuted: boolean;
  isRandomizeActive: boolean;
  isVideoPlaying: boolean;
  loadedVideoIndex: number;
  midiConnected: boolean;
  midiDeviceName: string;
  selectedVideoIndex: number;
  showHelp: boolean;
  videoPlaylist: VideoPlaylistItem[];
}

export type FromMain =
  | { type: 'state'; payload: AppState }
  | { type: 'state-response'; payload: AppState };

export type FromControls =
  | { type: 'add-videos'; paths: string[] }
  | { type: 'bpm-change'; bpm: number }
  | { type: 'bpm-sync-change'; effect: ShaderEffect; enabled: boolean }
  | { type: 'input-source-change'; source: string }
  | { type: 'intensity-change'; effect: ShaderEffect; intensity: number }
  | { type: 'mute-toggle' }
  | { type: 'next-video' }
  | { type: 'previous-video' }
  | { type: 'remove-from-playlist'; id: string }
  | { type: 'request-state' }
  | { type: 'seek-end' }
  | { type: 'toggle-randomize' }
  | { type: 'seek-start' }
  | { type: 'seek'; time: number }
  | { type: 'toggle-effect'; effect: ShaderEffect }
  | { type: 'toggle-help' }
  | { type: 'video-play'; index: number }
  | { type: 'video-play-pause' }
  | { type: 'video-select'; index: number };
