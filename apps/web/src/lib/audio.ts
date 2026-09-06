/**
 * Sound.
 *
 * Everything is synthesised with the Web Audio API — no asset downloads, no
 * licensing questions, and the whole kit weighs a couple of kilobytes.
 *
 * Most of the code below is not about making noise; it is about the two things
 * mobile browsers do that desktop ones do not:
 *
 *   1. An AudioContext starts suspended and may only be resumed from a user
 *      gesture. WebKit grants that activation on `touchend`/`click`, *not* on
 *      `pointerdown`, and wants a node actually started inside the gesture —
 *      so a silent one-sample buffer is played to satisfy it.
 *   2. The context is suspended again whenever the page is backgrounded. It
 *      does not come back on its own, so a player who switches apps mid-match
 *      returns to permanent silence unless something resumes it.
 *
 * The unlock listeners therefore stay attached until the context is genuinely
 * running, and re-arm whenever it stops being so. Nothing here ever throws into
 * the game: if audio cannot work, the game is silent and otherwise unaffected.
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

/**
 * Every event that might carry a user gesture.
 *
 * `touchend` and `click` are the ones WebKit actually counts; `pointerdown`
 * gets Chrome playing a beat earlier. Listening for all of them costs nothing,
 * because unlocking is idempotent.
 */
const GESTURES = ['pointerdown', 'touchend', 'mouseup', 'click', 'keydown'] as const;

type Ctor = typeof AudioContext;

class SoundKit {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled = true;
  private volume = 0.55;
  /** Set only when this browser has no Web Audio at all. Never a latch on a
   *  transient failure — a single bad resume must not silence the session. */
  private unsupported = false;
  private listening = false;
  private installed = false;

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.context) {
      // setTargetAtTime needs a running clock; fall back to a direct set.
      try {
        this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
      } catch {
        this.master.gain.value = this.volume;
      }
    }
    if (enabled) this.install();
  }

  /**
   * Begin listening for the gesture that will unlock playback.
   *
   * Safe to call at any time, including before the first render. The listeners
   * detach themselves once the context is running and come back if it is ever
   * suspended again.
   */
  install(): void {
    if (this.installed || this.unsupported || typeof window === 'undefined') return;
    this.installed = true;
    this.listen();

    // Backgrounding a tab suspends the context on mobile. Returning to it does
    // not resume the context, so without this the game goes quiet for good.
    const wake = () => {
      if (document.visibilityState === 'visible') this.unlock(false);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
  }

  private listen(): void {
    if (this.listening || this.unsupported) return;
    this.listening = true;
    for (const type of GESTURES) {
      window.addEventListener(type, this.onGesture, { passive: true, capture: true });
    }
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    for (const type of GESTURES) {
      window.removeEventListener(type, this.onGesture, { capture: true });
    }
  }

  private readonly onGesture = (): void => {
    this.unlock(true);
  };

  /**
   * Try to bring the context up.
   *
   * `fromGesture` matters for two reasons. Constructing an AudioContext
   * outside a user gesture is allowed but earns a console warning on every
   * load, so the context is only ever built from a real one. And the silent
   * priming node only means anything inside a gesture — outside one it is
   * just a wasted node.
   *
   * Idempotent, cheap when already running, and never throws.
   */
  unlock(fromGesture = true): void {
    // On a page wake there may be nothing to resume yet; that is fine.
    const context = fromGesture ? this.ensure() : this.context;
    if (!context) return;

    if (context.state === 'running') {
      this.stopListening();
      return;
    }

    // A node started inside the gesture is what WebKit is actually looking for.
    if (fromGesture) this.pokeSilently(context);

    try {
      const resumed = context.resume();
      // Older implementations return undefined rather than a promise.
      void Promise.resolve(resumed)
        .then(() => {
          if (context.state === 'running') this.stopListening();
        })
        .catch(() => {
          // No activation yet. The listeners are still attached, so the next
          // gesture tries again.
        });
    } catch {
      // Same story: leave the listeners in place and wait for another gesture.
    }
  }

  /** A one-sample silent buffer. The cheapest legal "we played something". */
  private pokeSilently(context: AudioContext): void {
    try {
      const buffer = context.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
    } catch {
      // Non-fatal: the resume below may still be enough.
    }
  }

  play(name: SoundName): void {
    if (!this.enabled || this.unsupported) return;

    // Never build the context here: playing is not a gesture, and the first
    // cue of a round would otherwise construct one the browser then refuses.
    const context = this.context;
    if (!context || !this.master) {
      this.listen();
      return;
    }

    if (context.state !== 'running') {
      // Scheduling into a suspended context does not play now — it queues, and
      // every queued cue fires at once when the context wakes. Ask for a resume
      // and drop this one instead.
      this.listen();
      this.unlock(false);
      return;
    }

    const start = context.currentTime + 0.005;
    for (const note of CUES[name] ?? []) {
      try {
        this.schedule(context, note, start);
      } catch {
        // One bad note must not take the rest of the cue down with it.
      }
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
    if (this.unsupported || typeof window === 'undefined') return null;

    const Ctor: Ctor | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctor) {
      this.unsupported = true;
      return null;
    }

    try {
      // Exactly one context, ever: browsers cap how many a page may create.
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = this.volume;
      master.connect(context.destination);
      this.context = context;
      this.master = master;

      // The context can be suspended by the platform at any time. When that
      // happens, start listening for a gesture again.
      context.addEventListener?.('statechange', () => {
        if (context.state === 'running') this.stopListening();
        else this.listen();
      });

      return context;
    } catch {
      // Construction can fail transiently (too many contexts, a policy blip).
      // Leave `unsupported` alone so a later attempt can still succeed.
      return null;
    }
  }

  /** Exposed for diagnostics and tests; not used by the game itself. */
  get state(): 'unsupported' | 'idle' | AudioContextState {
    if (this.unsupported) return 'unsupported';
    return this.context?.state ?? 'idle';
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
