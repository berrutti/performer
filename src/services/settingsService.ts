import { ShaderEffect } from '../utils';

const STORAGE_KEYS = {
  SHOW_HELP: 'performer-showHelp',
  MUTED: 'performer-muted',
  INPUT_SOURCE: 'performer-inputSource',
  ACTIVE_EFFECTS: 'performer-activeEffects',
  BPM: 'performer-bpm'
} as const;

export interface AppSettings {
  showHelp: boolean;
  isMuted: boolean;
  inputSource: string;
  activeEffects: Record<ShaderEffect, boolean>;
  bpm: number;
}

export const settingsService = {
  // Load all settings from localStorage (only called on mount)
  loadSettings(): Partial<AppSettings> {
    try {
      const settings: Partial<AppSettings> = {};

      const showHelp = localStorage.getItem(STORAGE_KEYS.SHOW_HELP);
      if (showHelp) settings.showHelp = JSON.parse(showHelp);

      const isMuted = localStorage.getItem(STORAGE_KEYS.MUTED);
      if (isMuted) settings.isMuted = JSON.parse(isMuted);

      const inputSource = localStorage.getItem(STORAGE_KEYS.INPUT_SOURCE);
      if (inputSource) {
        settings.inputSource = inputSource;
      } else {
        settings.inputSource = 'webcam'; // Default to webcam for immediate feedback
      }

      const activeEffects = localStorage.getItem(STORAGE_KEYS.ACTIVE_EFFECTS);
      if (activeEffects) settings.activeEffects = JSON.parse(activeEffects);

      const bpm = localStorage.getItem(STORAGE_KEYS.BPM);
      if (bpm) settings.bpm = JSON.parse(bpm);

      return settings;
    } catch (error) {
      console.warn('Failed to load settings from localStorage:', error);
      return {};
    }
  },

  // Save individual settings (only called when settings change)
  saveShowHelp(value: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SHOW_HELP, JSON.stringify(value));
    } catch (error) {
      console.warn('Failed to save showHelp setting:', error);
    }
  },

  saveMuted(value: boolean): void {
    try {
      localStorage.setItem(STORAGE_KEYS.MUTED, JSON.stringify(value));
    } catch (error) {
      console.warn('Failed to save muted setting:', error);
    }
  },

  saveInputSource(value: string): void {
    try {
      localStorage.setItem(STORAGE_KEYS.INPUT_SOURCE, value);
    } catch (error) {
      console.warn('Failed to save inputSource setting:', error);
    }
  },

  saveActiveEffects(value: Record<ShaderEffect, boolean>): void {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_EFFECTS, JSON.stringify(value));
    } catch (error) {
      console.warn('Failed to save activeEffects setting:', error);
    }
  },

  saveBpm(value: number): void {
    try {
      localStorage.setItem(STORAGE_KEYS.BPM, JSON.stringify(value));
    } catch (error) {
      console.warn('Failed to save BPM setting:', error);
    }
  },

  // Clear all settings
  clearAllSettings(): void {
    try {
      Object.values(STORAGE_KEYS).forEach((key) => {
        localStorage.removeItem(key);
      });
    } catch (error) {
      console.warn('Failed to clear settings:', error);
    }
  }
};
