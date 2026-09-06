/**
 * The audio unlock lifecycle.
 *
 * This is the part of the sound kit that had to be rewritten, and the part a
 * browser on this machine cannot honestly test: a desktop page usually already
 * has user activation, so its AudioContext starts running and every code path
 * that matters on a phone is skipped.
 *
 * So the platform is faked instead, with the two behaviours that actually
 * caused silence on Android and iOS:
 *
 *   - the context starts suspended, and `resume()` only succeeds once a
 *     gesture has happened;
 *   - the context is suspended again whenever the page is backgrounded, and
 *     does not come back on its own.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event?: unknown) => void;

class FakeParam {
  value = 0;
  setValueAtTime() {}
  setTargetAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = 'sine';
  buffer: unknown = null;
  onended: (() => void) | null = null;
  started = false;
  connect() {}
  disconnect() {}
  start() {
    this.started = true;
    started.push(this);
  }
  stop() {}
}

let started: FakeNode[] = [];
/** Flipped on by a "gesture"; until then resume() refuses, as a phone does. */
let activated = false;

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' | 'closed' = 'suspended';
  currentTime = 0;
  sampleRate = 48_000;
  destination = new FakeNode();
  resumeCalls = 0;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createGain() {
    return new FakeNode();
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

  addEventListener(type: string, listener: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  async resume() {
    this.resumeCalls++;
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

let sfx: typeof import('../src/lib/audio.js')['sfx'];

beforeEach(async () => {
  windowListeners.clear();
  documentListeners.clear();
  FakeAudioContext.instances = [];
  started = [];
  activated = false;

  const win = {
    ...makeTarget(windowListeners),
    AudioContext: FakeAudioContext,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    ...makeTarget(documentListeners),
    visibilityState: 'visible',
  });
  vi.stubGlobal('AudioContext', FakeAudioContext);

  // A fresh module per test: the kit is a singleton and holds the context.
  vi.resetModules();
  ({ sfx } = await import('../src/lib/audio.js'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
});

describe('coming back from the background', () => {
  async function unlock() {
    sfx.install();
    activated = true;
    fire(windowListeners, 'touchend');
    await Promise.resolve();
    await Promise.resolve();
    expect(sfx.state).toBe('running');
  }

  it('re-arms and recovers after the platform suspends the context', async () => {
    await unlock();
    const context = FakeAudioContext.instances[0];

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
    await unlock();
    FakeAudioContext.instances[0].backgrounded();

    activated = true;
    fire(windowListeners, 'click');
    await Promise.resolve();
    await Promise.resolve();
    expect(sfx.state).toBe('running');
  });
});

describe('preferences', () => {
  it('plays nothing while muted, and resumes when unmuted', async () => {
    sfx.install();
    activated = true;
    fire(windowListeners, 'touchend');
    await Promise.resolve();
    await Promise.resolve();

    sfx.configure(false, 0.5);
    started.length = 0;
    sfx.play('tap');
    expect(started).toHaveLength(0);

    sfx.configure(true, 0.5);
    sfx.play('tap');
    expect(started.length).toBeGreaterThan(0);
  });

  it('reports itself unsupported rather than throwing when there is no Web Audio', async () => {
    vi.stubGlobal('window', { ...makeTarget(windowListeners), matchMedia: () => ({ matches: false }) });
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
