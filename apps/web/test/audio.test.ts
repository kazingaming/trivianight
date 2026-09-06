/**
 * The sound kit, against a platform that behaves like a phone.
 *
 * An earlier version of this file faked an AudioContext whose `currentTime`
 * never moved and which had no audio thread. Against that, "scheduled" and
 * "audible" were the same thing, so it happily passed while every cue on a
 * real phone was silent. The fake below therefore models the two properties
 * that actually decide whether a note is heard:
 *
 *   - a clock that advances, and
 *   - `baseLatency`: the audio already committed to the output buffer, which
 *     is ~5ms on a desktop and 40-100ms on a phone.
 *
 * An automation event scheduled inside that committed window is applied
 * immediately rather than played, so an envelope written entirely in the past
 * collapses to its final value — silence. That is the failure this file exists
 * to catch, and it fails against the old five-millisecond lookahead.
 *
 * It also covers the unlock lifecycle: a context that starts suspended,
 * refuses to resume without a gesture, and is suspended again on backgrounding.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event?: unknown) => void;

interface Automation {
  t: number;
  v: number;
}

class FakeParam {
  value = 0;
  readonly events: Automation[] = [];

  setValueAtTime(v: number, t: number) {
    this.events.push({ t, v });
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push({ t, v });
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push({ t, v });
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  connect() {}
  disconnect() {}
  start(when = 0) {
    this.startedAt = when;
    started.push({ node: this, when });
  }
  stop() {}
}

let started: Array<{ node: FakeNode; when: number }> = [];
/** Every gain node handed out, so envelopes can be inspected. */
let gainNodes: FakeNode[] = [];
/** Flipped on by a "gesture"; until then resume() refuses, as a phone does. */
let activated = false;

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static baseLatency = 0.005;

  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48_000;
  baseLatency = FakeAudioContext.baseLatency;
  outputLatency = FakeAudioContext.baseLatency * 3;
  destination = new FakeNode();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  /** Everything the audio thread has already rendered and cannot change. */
  get committedUntil(): number {
    return this.currentTime + this.baseLatency;
  }

  createGain() {
    const node = new FakeNode();
    gainNodes.push(node);
    return node;
  }
  createOscillator() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBuffer() {
    return {};
  }

  /**
   * Reports back whatever the loudest scheduled envelope asked for, which is
   * the stand-in for "these samples reached the output device".
   */
  createAnalyser() {
    const node = new FakeNode() as FakeNode & {
      fftSize: number;
      getFloatTimeDomainData: (buffer: Float32Array) => void;
    };
    node.fftSize = 2048;
    node.getFloatTimeDomainData = (buffer: Float32Array) => {
      let loudest = 0;
      for (const gain of gainNodes) {
        for (const event of gain.gain.events) loudest = Math.max(loudest, event.v);
      }
      buffer.fill(loudest);
    };
    return node;
  }

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  async resume() {
    if (!activated) throw new Error('not allowed to start AudioContext');
    this.setState('running');
  }

  /** What a mobile browser does when the page goes into the background. */
  backgrounded() {
    activated = false;
    this.setState('suspended');
  }

  private setState(next: 'suspended' | 'running') {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners.get('statechange') ?? []) listener();
  }
}

/**
 * Would this envelope actually be heard?
 *
 * Only if it reaches an audible level at a moment the audio thread has not
 * already rendered. A peak scheduled inside the committed window is applied
 * instantly, and the decay that follows it — also in the past — wins.
 */
function isAudible(gain: FakeNode, committedUntil: number): boolean {
  const peak = gain.gain.events.find((event) => event.v > 0.01);
  return Boolean(peak && peak.t > committedUntil);
}

/* --- A window that records what is listening ------------------------- */

const windowListeners = new Map<string, Set<Listener>>();
const documentListeners = new Map<string, Set<Listener>>();

function makeTarget(store: Map<string, Set<Listener>>) {
  return {
    addEventListener(type: string, listener: Listener) {
      const set = store.get(type) ?? new Set();
      set.add(listener);
      store.set(type, set);
    },
    removeEventListener(type: string, listener: Listener) {
      store.get(type)?.delete(listener);
    },
  };
}

function fire(store: Map<string, Set<Listener>>, type: string) {
  for (const listener of [...(store.get(type) ?? [])]) listener();
}

function listenerCount(): number {
  let total = 0;
  for (const set of windowListeners.values()) total += set.size;
  return total;
}

let sfx: (typeof import('../src/lib/audio.js'))['sfx'];

async function loadKit(baseLatency = 0.005) {
  windowListeners.clear();
  documentListeners.clear();
  FakeAudioContext.instances = [];
  FakeAudioContext.baseLatency = baseLatency;
  started = [];
  gainNodes = [];
  activated = false;

  vi.stubGlobal('window', {
    ...makeTarget(windowListeners),
    AudioContext: FakeAudioContext,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  vi.stubGlobal('document', { ...makeTarget(documentListeners), visibilityState: 'visible' });
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('AudioContext', FakeAudioContext);

  // A fresh module per test: the kit is a singleton and holds the context.
  vi.resetModules();
  ({ sfx } = await import('../src/lib/audio.js'));
}

/** Bring the kit up the way a first tap does. */
async function unlock() {
  sfx.install();
  activated = true;
  fire(windowListeners, 'touchend');
  await Promise.resolve();
  await Promise.resolve();
  expect(sfx.state).toBe('running');
  return FakeAudioContext.instances[0];
}

beforeEach(async () => {
  await loadKit();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */

describe('a cue actually reaching the speaker', () => {
  it('is audible on a desktop, where the output buffer is small', async () => {
    const context = await unlock();
    context.currentTime = 12.5;
    gainNodes.length = 0;

    sfx.play('lock');
    expect(gainNodes.length).toBeGreaterThan(0);
    for (const gain of gainNodes) {
      expect(isAudible(gain, context.committedUntil), 'desktop cue').toBe(true);
    }
  });

  it('is audible on a phone, where it is not', async () => {
    // 40ms is an ordinary Android output buffer. The old fixed five-millisecond
    // lookahead put the whole envelope inside it, and the game went silent.
    await loadKit(0.04);
    const context = await unlock();
    context.currentTime = 30;
    gainNodes.length = 0;

    sfx.play('lock');
    expect(gainNodes.length).toBeGreaterThan(0);
    for (const gain of gainNodes) {
      expect(isAudible(gain, context.committedUntil), 'phone cue').toBe(true);
    }
  });

  it('is audible on a slow phone with a very deep buffer', async () => {
    await loadKit(0.1);
    const context = await unlock();
    context.currentTime = 7;
    gainNodes.length = 0;

    for (const cue of ['tap', 'tick', 'reveal', 'victory'] as const) {
      gainNodes.length = 0;
      sfx.play(cue);
      expect(gainNodes.length, cue).toBeGreaterThan(0);
      for (const gain of gainNodes) {
        expect(isAudible(gain, context.committedUntil), `${cue} on a slow phone`).toBe(true);
      }
    }
  });

  it('schedules further ahead the deeper the output buffer is', async () => {
    const lookaheadFor = async (latency: number) => {
      await loadKit(latency);
      const context = await unlock();
      context.currentTime = 5;
      started = [];
      sfx.play('tap');
      return started[0].when - context.currentTime;
    };

    const desktop = await lookaheadFor(0.005);
    const phone = await lookaheadFor(0.04);
    const slow = await lookaheadFor(0.12);

    expect(phone).toBeGreaterThan(desktop);
    expect(slow).toBeGreaterThan(phone);
    // Still fast enough to feel like a response to the tap.
    expect(slow).toBeLessThanOrEqual(0.25);
  });

  it('never writes an event into the past, however stale the clock is', async () => {
    const context = await unlock();
    context.currentTime = 100;
    gainNodes.length = 0;
    started = [];

    sfx.play('victory');
    for (const { when } of started) expect(when).toBeGreaterThan(context.currentTime);
    for (const gain of gainNodes) {
      for (const event of gain.gain.events) {
        expect(event.t).toBeGreaterThan(context.currentTime);
      }
    }
  });

  it('leaves headroom rather than clipping', async () => {
    const context = await unlock();
    context.currentTime = 3;
    // The master node is the first gain created, and carries the trim.
    const master = gainNodes[0];
    expect(master.gain.value).toBeGreaterThan(0);
    expect(master.gain.value).toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */

describe('unlocking on a device that refuses to start audio', () => {
  it('creates no context and throws nothing before any gesture', () => {
    sfx.install();
    expect(() => sfx.play('tap')).not.toThrow();
    expect(sfx.state).toBe('idle');
  });

  it('keeps listening until a gesture actually succeeds', async () => {
    sfx.install();
    const armed = listenerCount();
    expect(armed).toBeGreaterThan(0);

    // A gesture the platform rejects: the listeners must stay.
    fire(windowListeners, 'pointerdown');
    await Promise.resolve();
    await Promise.resolve();
    expect(sfx.state).toBe('suspended');
    expect(listenerCount()).toBe(armed);

    // The one that works.
    activated = true;
    fire(windowListeners, 'touchend');
    await Promise.resolve();
    await Promise.resolve();
    expect(sfx.state).toBe('running');
  });

  it('listens for touchend and click, which is what WebKit counts', () => {
    sfx.install();
    expect([...windowListeners.keys()]).toEqual(
      expect.arrayContaining(['pointerdown', 'touchend', 'click']),
    );
  });

  it('starts a silent node inside the gesture, as iOS requires', () => {
    sfx.install();
    fire(windowListeners, 'touchend');
    expect(started.length).toBeGreaterThan(0);
  });

  it('only ever builds one context, however many gestures arrive', async () => {
    sfx.install();
    for (let i = 0; i < 12; i++) fire(windowListeners, 'pointerdown');
    await Promise.resolve();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('does not queue cues into a suspended context', () => {
    sfx.install();
    fire(windowListeners, 'pointerdown');
    started.length = 0;
    // Every one of these would otherwise be scheduled, then fire together the
    // moment the context woke up.
    for (let i = 0; i < 5; i++) sfx.play('score');
    expect(started).toHaveLength(0);
  });

  it('plays the first cue once the context wakes, rather than losing it', async () => {
    // The first tap both unlocks audio and asks for a sound, and the resume
    // has not resolved by the time the click handler runs.
    sfx.install();
    fire(windowListeners, 'pointerdown');
    sfx.play('lock');
    gainNodes.length = 0;

    activated = true;
    fire(windowListeners, 'touchend');
    await Promise.resolve();
    await Promise.resolve();

    expect(sfx.state).toBe('running');
    expect(gainNodes.length, 'the held cue played').toBeGreaterThan(0);
  });

  it('holds exactly one cue, not a backlog', async () => {
    sfx.install();
    fire(windowListeners, 'pointerdown');
    for (let i = 0; i < 6; i++) sfx.play('score');
    gainNodes.length = 0;

    activated = true;
    fire(windowListeners, 'touchend');
    await Promise.resolve();
    await Promise.resolve();

    // 'score' is two notes, so one cue and no more.
    expect(gainNodes).toHaveLength(2);
  });
});

describe('coming back from the background', () => {
  it('re-arms and recovers after the platform suspends the context', async () => {
    const context = await unlock();

    // The tab goes away; the platform suspends audio and it stays suspended.
    context.backgrounded();
    expect(sfx.state).toBe('suspended');

    // Coming back should ask for a resume rather than staying silent forever.
    activated = true;
    fire(documentListeners, 'visibilitychange');
    await Promise.resolve();
    await Promise.resolve();
    expect(sfx.state).toBe('running');
  });

  it('recovers on the next tap even if the page-wake event never fires', async () => {
    const context = await unlock();
    context.backgrounded();

    activated = true;
    fire(windowListeners, 'click');
    await Promise.resolve();
    await Promise.resolve();
    expect(sfx.state).toBe('running');
  });
});

describe('preferences and diagnostics', () => {
  it('plays nothing while muted, and resumes when unmuted', async () => {
    await unlock();
    sfx.configure(false, 0.5);
    started.length = 0;
    sfx.play('tap');
    expect(started).toHaveLength(0);

    sfx.configure(true, 0.5);
    sfx.play('tap');
    expect(started.length).toBeGreaterThan(0);
  });

  it('reports what the device is doing, for a screen a developer cannot reach', async () => {
    await loadKit(0.04);
    const before = sfx.diagnostics();
    expect(before.state).toBe('idle');
    expect(before.lookaheadMs).toBeNull();

    await unlock();
    const after = sfx.diagnostics();
    expect(after.state).toBe('running');
    expect(after.sampleRate).toBe(48_000);
    expect(after.baseLatencyMs).toBe(40);
    expect(after.lookaheadMs).toBeGreaterThanOrEqual(40);
    expect(after.enabled).toBe(true);
  });

  it('plays a test tone loud enough to settle whether the speaker is the problem', async () => {
    const context = await unlock();
    context.currentTime = 2;
    gainNodes.length = 0;

    sfx.testTone();
    expect(gainNodes.length).toBeGreaterThan(0);
    const peaks = gainNodes.flatMap((gain) => gain.gain.events.map((event) => event.v));
    expect(Math.max(...peaks)).toBeGreaterThanOrEqual(0.5);
    for (const gain of gainNodes) {
      expect(isAudible(gain, context.committedUntil)).toBe(true);
    }
  });

  it('measures its own output, so a phone can answer what a browser will not', async () => {
    await unlock();
    const peak = await sfx.measureOutput();
    // The test tone is deliberately loud; anything above the noise floor means
    // samples are genuinely reaching the destination.
    expect(peak).toBeGreaterThan(0.01);
  }, 20_000);

  it('reports no output rather than throwing when audio never started', async () => {
    sfx.install();
    // No gesture is ever granted, so the context cannot run.
    const peak = await sfx.measureOutput();
    expect(peak).toBe(0);
  }, 20_000);

  it('reports itself unsupported rather than throwing when there is no Web Audio', async () => {
    vi.stubGlobal('window', {
      ...makeTarget(windowListeners),
      matchMedia: () => ({ matches: false }),
    });
    vi.resetModules();
    const kit = (await import('../src/lib/audio.js')).sfx;
    kit.install();

    // Nothing has been attempted yet, so nothing is known yet.
    expect(() => kit.play('tap')).not.toThrow();
    expect(kit.state).toBe('idle');

    // The first gesture is where it finds out, and it must not throw there
    // either — a browser without Web Audio still has a game to play.
    expect(() => fire(windowListeners, 'touchend')).not.toThrow();
    expect(kit.state).toBe('unsupported');
    expect(() => kit.play('victory')).not.toThrow();
  });
});
