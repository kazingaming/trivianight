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

/**
 * How far ahead of the clock a cue has to be scheduled to be heard.
 *
 * `baseLatency` is how much audio the platform has already committed to its
 * output buffer: about 5ms on a desktop, and commonly 40-100ms on a phone.
 * Anything scheduled inside that window lands in a block the audio thread has
 * already rendered, and is simply never heard.
 *
 * So the lookahead is measured from the device rather than assumed. A UI cue
 * that arrives 60ms late still feels instant; one that never arrives does not.
 */
function lookahead(context: AudioContext): number {
  const base = Number.isFinite(context.baseLatency) ? context.baseLatency : 0;
  return Math.min(0.25, Math.max(0.04, base * 2 + 0.02));
}

/**
 * Headroom multiplier applied on top of the player's volume.
 *
 * The cue gains were tuned on desktop speakers, where 0.12 of full scale is a
 * clear blip. Through a phone speaker the same signal is barely present. At
 * most two notes of a cue overlap, so there is room to lift the whole kit
 * without approaching clipping.
 */
const MASTER_TRIM = 2.4;

/** How stale a held-over cue may be before it is dropped instead of played. */
const PENDING_MAX_AGE_MS = 400;

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
  /**
   * One cue held over while the context is still waking up.
   *
   * The first tap of a session both unlocks audio and asks for a sound, and
   * the resume has usually not resolved by the time the click handler runs —
   * so the first cue would be dropped and the game would seem silent at the
   * exact moment someone is deciding whether it works. Exactly one cue is
   * held, and only briefly: a backlog firing at once on wake is what dropping
   * cues was protecting against in the first place.
   */
  private pending: { name: SoundName; at: number } | null = null;

  private get outputGain(): number {
    return Math.min(1, this.volume * MASTER_TRIM);
  }

  configure(enabled: boolean, volume: number): void {
    this.enabled = enabled;
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.context) {
      // setTargetAtTime needs a running clock; fall back to a direct set.
      try {
        this.master.gain.setTargetAtTime(this.outputGain, this.context.currentTime, 0.02);
      } catch {
        this.master.gain.value = this.outputGain;
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
    if (!context) {
      // Nothing to wait for on a browser with no Web Audio at all.
      if (this.unsupported) this.stopListening();
      return;
    }

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

  /**
   * Play the held cue, if it is still worth playing.
   *
   * A cue that has been waiting longer than this is no longer a response to
   * anything the player did, and arriving late is worse than not arriving.
   */
  private flushPending(): void {
    const held = this.pending;
    this.pending = null;
    if (!held || Date.now() - held.at > PENDING_MAX_AGE_MS) return;
    this.play(held.name);
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
      // every queued cue fires at once when the context wakes. Hold just this
      // one, ask for a resume, and let the rest go.
      this.pending = { name, at: Date.now() };
      this.listen();
      this.unlock(false);
      return;
    }

    const start = context.currentTime + lookahead(context);
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

    /*
     * Never schedule into the past.
     *
     * An automation event whose time has already gone by is applied
     * immediately, so an envelope written entirely in the past collapses: the
     * attack has "finished", and the ramp back to silence is the last thing
     * the parameter saw. The note then runs at zero gain — not a quiet note, a
     * missing one. That is what made the whole game silent on phones, where
     * the audio thread runs tens of milliseconds ahead of the clock.
     */
    const at = Math.max(start + note.at, context.currentTime + 0.005);
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

      /*
       * iOS puts Web Audio in the "ambient" session, which the hardware ringer
       * switch mutes — so a phone on silent plays nothing at all, however
       * correctly everything else is set up. Declaring playback makes it media,
       * the way a video is. Safari 16.4+; harmlessly absent everywhere else.
       */
      try {
        const session = (navigator as { audioSession?: { type?: string } }).audioSession;
        if (session && session.type !== 'playback') session.type = 'playback';
      } catch {
        // Read-only or unavailable. Nothing else depends on it.
      }

      const master = context.createGain();
      master.gain.value = this.outputGain;
      master.connect(context.destination);
      this.context = context;
      this.master = master;

      // The context can be suspended by the platform at any time. When that
      // happens, start listening for a gesture again.
      context.addEventListener?.('statechange', () => {
        if (context.state === 'running') {
          this.stopListening();
          this.flushPending();
        } else {
          this.listen();
        }
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

  /**
   * What this device is actually doing.
   *
   * A browser cannot be asked "did the player hear that", so the next best
   * thing is to report the numbers that decide it. Surfaced on the settings
   * screen, because a phone is the one place none of this can be inspected
   * from a developer's machine.
   */
  diagnostics(): AudioDiagnostics {
    const context = this.context;
    const ms = (value: number | undefined) =>
      typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : null;
    return {
      state: this.state,
      sampleRate: context?.sampleRate ?? null,
      baseLatencyMs: ms(context?.baseLatency),
      outputLatencyMs: ms(context?.outputLatency),
      lookaheadMs: context ? Math.round(lookahead(context) * 1000) : null,
      enabled: this.enabled,
      volume: this.volume,
      listening: this.listening,
    };
  }

  /**
   * Play a deliberately long, loud tone and measure what comes out of it.
   *
   * This is the one question that matters and the one a browser will not
   * answer: is a signal actually reaching the speaker? An analyser tapped onto
   * the master bus can answer it, because it reads the same samples the output
   * device is being handed.
   *
   * That separates the two failures which are otherwise identical from inside
   * the page — audio that never started, and audio that is playing perfectly
   * into a device whose media volume is down. Phones keep media volume
   * separate from the ringer, so the second is common and completely silent.
   *
   * Resolves with the peak amplitude observed, 0 to 1.
   */
  async measureOutput(): Promise<number> {
    this.unlock(true);
    // The resume may still be in flight from the tap that got us here.
    for (let i = 0; i < 20 && this.context?.state !== 'running'; i++) {
      await new Promise((done) => setTimeout(done, 25));
    }

    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== 'running') return 0;

    let analyser: AnalyserNode;
    try {
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      master.connect(analyser);
    } catch {
      return 0;
    }

    this.testTone();

    const samples = new Float32Array(analyser.fftSize);
    let peak = 0;
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      analyser.getFloatTimeDomainData(samples);
      for (const sample of samples) {
        const level = Math.abs(sample);
        if (level > peak) peak = level;
      }
      await new Promise((done) => setTimeout(done, 20));
    }

    try {
      master.disconnect(analyser);
    } catch {
      // Already torn down.
    }
    return peak;
  }

  /**
   * A deliberately long, loud tone.
   *
   * Nothing in the game sounds like this. It exists so a player can tell
   * "audio never started" apart from "audio is running and the media volume is
   * down", which are indistinguishable from inside the page.
   */
  testTone(): void {
    this.unlock(true);
    const context = this.context;
    const master = this.master;
    if (!context || !master || context.state !== 'running') return;

    const base = context.currentTime + lookahead(context);
    [440, 660, 880].forEach((freq, index) => {
      const at = base + index * 0.25;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(at);
      oscillator.stop(at + 0.26);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  }
}

export interface AudioDiagnostics {
  state: string;
  sampleRate: number | null;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  lookaheadMs: number | null;
  enabled: boolean;
  volume: number;
  listening: boolean;
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
