import { create } from 'zustand';
import { sfx } from '../lib/audio.js';
import {
  DEFAULT_SETTINGS,
  loadIdentity,
  loadSettings,
  saveIdentity,
  saveSettings,
  type Identity,
  type MotionPreference,
  type Settings,
} from '../lib/storage.js';

interface SettingsState {
  settings: Settings;
  identity: Identity;
  /** True when the OS asks for reduced motion; folded into the effective value. */
  systemReducedMotion: boolean;
  update: (patch: Partial<Settings>) => void;
  reset: () => void;
  setIdentity: (patch: Partial<Identity>) => void;
  setSystemReducedMotion: (reduced: boolean) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: loadSettings(),
  identity: loadIdentity(),
  systemReducedMotion: false,

  update: (patch) => {
    const next = { ...get().settings, ...patch };
    saveSettings(next);
    set({ settings: next });
    applySideEffects(next);
  },

  reset: () => {
    saveSettings(DEFAULT_SETTINGS);
    set({ settings: DEFAULT_SETTINGS });
    applySideEffects(DEFAULT_SETTINGS);
  },

  setIdentity: (patch) => {
    const next = { ...get().identity, ...patch };
    saveIdentity(next);
    set({ identity: next });
  },

  setSystemReducedMotion: (reduced) => set({ systemReducedMotion: reduced }),
}));

function applySideEffects(settings: Settings): void {
  sfx.configure(settings.sound, settings.volume);
  applyMotionAttribute();
}

/**
 * The effective motion level is the *stricter* of the OS preference and the
 * in-game setting — respecting the system without taking away the toggle.
 */
export function effectiveMotion(): MotionPreference {
  const { settings, systemReducedMotion } = useSettings.getState();
  if (settings.motion === 'off') return 'off';
  if (systemReducedMotion) return settings.motion === 'full' ? 'reduced' : settings.motion;
  return settings.motion;
}

export function applyMotionAttribute(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = effectiveMotion();
}

/** Should elaborate scenes play at all? */
export function useReactionsEnabled(): boolean {
  const reactions = useSettings((state) => state.settings.reactions);
  const motion = useSettings((state) => state.settings.motion);
  const system = useSettings((state) => state.systemReducedMotion);
  // Scenes stay on under a reduced-motion preference — they just play faster.
  // Only an explicit "off" removes them entirely.
  if (!reactions) return false;
  if (motion === 'off') return false;
  void system;
  return true;
}

/** Playback speed multiplier for reaction scenes. */
export function useSceneSpeed(): number {
  const motion = useSettings((state) => state.settings.motion);
  const system = useSettings((state) => state.systemReducedMotion);
  if (motion === 'reduced' || (system && motion === 'full')) return 1.7;
  return 1;
}

export const play = (name: Parameters<typeof sfx.play>[0]): void => {
  sfx.play(name);
};
