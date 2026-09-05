/**
 * Sound.
 *
 * Everything is synthesised with the Web Audio API — no asset downloads, no
 * licensing questions, and the whole kit weighs a couple of kilobytes. The
 * context is created lazily on the first gesture so autoplay policies never
 * produce a console error.
 */

type Voice = 'sine' | 'triangle' | 'square' | 'sawtooth';

export type SoundName =
  | 'tap'
  | 'lock'
  | 'tick'
  | 'warning'
  | 'reveal'
  | 'score'
  | 'perfect'
  | 'miss'
  | 'advance'
  | 'victory'
  | 'join';

interface Note {
  freq: number;
  /** Seconds from the start of the cue. */
  at: number;
  duration: number;
  gain?: number;
  voice?: Voice;
  /** Slide to this frequency over the note. */
  glideTo?: number;
}

/**
 * Short, dry and tuned to a pentatonic scale so repeated cues never clash.
 * Nothing here lasts longer than a second.
 */
const CUES: Record<SoundName, Note[]> = {
  tap: [{ freq: 880, at: 0, duration: 0.045, gain: 0.12, voice: 'triangle' }],
  join: [
    { freq: 587.33, at: 0, duration: 0.09, gain: 0.16 },
    { freq: 880, at: 0.07, duration: 0.12, gain: 0.14 },
  ],
  lock: [
    { freq: 392, at: 0, duration: 0.07, gain: 0.2, voice: 'triangle' },
    { freq: 587.33, at: 0.05, duration: 0.14, gain: 0.18, voice: 'triangle' },
  ],
  tick: [{ freq: 1320, at: 0, duration: 0.03, gain: 0.07, voice: 'square' }],
  warning: [
    { freq: 330, at: 0, duration: 0.1, gain: 0.16, voice: 'square' },
    { freq: 294, at: 0.12, duration: 0.12, gain: 0.14, voice: 'square' },
  ],
  reveal: [
    { freq: 196, at: 0, duration: 0.5, gain: 0.16, voice: 'sawtooth', glideTo: 392 },
    { freq: 587.33, at: 0.24, duration: 0.4, gain: 0.12, voice: 'triangle' },
  ],
  score: [
    { freq: 659.25, at: 0, duration: 0.08, gain: 0.13 },
    { freq: 987.77, at: 0.06, duration: 0.14, gain: 0.11 },
  ],
  perfect: [
    { freq: 523.25, at: 0, duration: 0.12, gain: 0.16 },
    { freq: 659.25, at: 0.09, duration: 0.12, gain: 0.16 },
    { freq: 783.99, at: 0.18, duration: 0.14, gain: 0.16 },
    { freq: 1046.5, at: 0.27, duration: 0.34, gain: 0.18 },
  ],
  miss: [
    { freq: 220, at: 0, duration: 0.16, gain: 0.18, voice: 'sawtooth', glideTo: 110 },
    { freq: 138.59, at: 0.14, duration: 0.28, gain: 0.14, voice: 'triangle' },
  ],
  advance: [{ freq: 659.25, at: 0, duration: 0.08, gain: 0.1, voice: 'triangle' }],
  victory: [
    { freq: 523.25, at: 0, duration: 0.13, gain: 0.16 },
    { freq: 659.25, at: 0.12, duration: 0.13, gain: 0.16 },
    { freq: 783.99, at: 0.24, duration: 0.13, gain: 0.16 },
    { freq: 1046.5, at: 0.36, duration: 0.16, gain: 0.18 },
    { freq: 1318.51, at: 0.5, duration: 0.42, gain: 0.16 },
  ],
};

class SoundKit {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.55;
  private failed = false;

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
    }
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (this.failed) return;
    try {
      const ensured = this.ensure();
      if (ensured && ensured.state === 'suspended') void ensured.resume();
    } catch {
      this.failed = true;
    }
  }

  play(name: SoundName): void {
    if (!this.enabled || this.failed) return;
    const context = this.ensure();
    if (!context || !this.master) return;
    if (context.state === 'suspended') void context.resume();

    const start = context.currentTime + 0.005;
    for (const note of CUES[name] ?? []) {
      this.schedule(context, note, start);
    }
  }

  private schedule(context: AudioContext, note: Note, start: number): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = note.voice ?? 'sine';

    const at = start + note.at;
    const end = at + note.duration;
    oscillator.frequency.setValueAtTime(note.freq, at);
    if (note.glideTo) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, note.glideTo), end);
    }

    // Fast attack, exponential decay: percussive rather than droning.
    const peak = Math.max(0.0001, note.gain ?? 0.15);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(this.master!);
    oscillator.start(at);
    oscillator.stop(end + 0.02);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }

  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    if (this.failed) return null;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return null;
      }
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      return this.context;
    } catch {
      this.failed = true;
      return null;
    }
  }
}

export const sfx = new SoundKit();

/** Pick a cue that matches how well the player did. */
export function bandSound(band: string): SoundName {
  switch (band) {
    case 'perfect':
      return 'perfect';
    case 'great':
    case 'good':
      return 'score';
    case 'disaster':
      return 'miss';
    default:
      return 'reveal';
  }
}
