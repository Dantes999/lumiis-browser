// Sound without files: every noise is generated with the Web Audio API.
//
// Nothing to download, nothing to license. The browser only allows audio after a
// user gesture, so the context is created on the first click (the login button).

type Voice = {
  frequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  /** Pitch at the end of the sound; the same as `frequency` keeps it flat. */
  slideTo?: number;
};

let context: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let volume = 0.5;
/** How many sounds were started; useful when nothing is audible. */
let played = 0;

const level = (): number => (enabled ? volume : 0);

export function initAudio(): void {
  if (context !== null) return;

  try {
    context = new AudioContext();
  } catch (error) {
    context = null;
    console.warn('sound is not available:', error);
    return;
  }

  master = context.createGain();
  master.gain.value = level();
  master.connect(context.destination);
}

/** What the browser thinks of us; handy when a sound does not arrive. */
export const audioState = (): { state: string; played: number; volume: number } => ({
  state: context?.state ?? 'none',
  played,
  volume: level(),
});

/** A first click or key press anywhere is enough to unlock sound. */
export function unlockAudioOnFirstGesture(): void {
  const unlock = (): void => {
    initAudio();
    resumeAudio();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };

  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function resumeAudio(): void {
  void context?.resume();
}

/** Called from the settings panel. */
export function setAudioSettings(on: boolean, newVolume: number): void {
  enabled = on;
  volume = Math.min(1, Math.max(0, newVolume));
  if (master !== null) master.gain.value = level();
}

const tone = ({ frequency, duration, type, gain, slideTo }: Voice): void => {
  if (context === null || master === null || level() === 0) return;

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const envelope = context.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  if (slideTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(slideTo, now + duration);

  envelope.gain.setValueAtTime(gain, now);
  envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);

  oscillator.connect(envelope);
  envelope.connect(master);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
  played += 1;
};

/** A short burst of noise, used for hits. */
const burst = (duration: number, gain: number, frequency: number): void => {
  if (context === null || master === null || level() === 0) return;

  const frames = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / frames);
  }

  const source = context.createBufferSource();
  source.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;

  const envelope = context.createGain();
  envelope.gain.value = gain;

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.start();
  played += 1;
};

/** A band of noise sweeping downwards: the air a blade pushes aside. */
const whoosh = (duration: number, gain: number, from: number, to: number): void => {
  if (context === null || master === null || level() === 0) return;

  const now = context.currentTime;
  const frames = Math.floor(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frames; index += 1) data[index] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  source.buffer = buffer;

  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.1;
  filter.frequency.setValueAtTime(from, now);
  filter.frequency.exponentialRampToValueAtTime(to, now + duration);

  const envelope = context.createGain();
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.linearRampToValueAtTime(gain, now + duration * 0.25);
  envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);

  source.connect(filter);
  filter.connect(envelope);
  envelope.connect(master);
  source.start(now);
  played += 1;
};

export const sfx = {
  swing(): void {
    whoosh(0.22, 0.55, 1500, 300);
    tone({ frequency: 320, duration: 0.09, type: 'square', gain: 0.12, slideTo: 160 });
  },
  hit(): void {
    burst(0.14, 0.9, 1100);
    tone({ frequency: 120, duration: 0.09, type: 'triangle', gain: 0.3, slideTo: 70 });
  },
  kill(): void {
    tone({ frequency: 190, duration: 0.3, type: 'sawtooth', gain: 0.35, slideTo: 55 });
  },
  hurt(): void {
    tone({ frequency: 150, duration: 0.22, type: 'square', gain: 0.4, slideTo: 70 });
  },
  pickup(): void {
    tone({ frequency: 660, duration: 0.08, type: 'triangle', gain: 0.35, slideTo: 990 });
  },
  levelUp(): void {
    tone({ frequency: 440, duration: 0.12, type: 'triangle', gain: 0.4, slideTo: 880 });
    window.setTimeout(() => {
      tone({ frequency: 660, duration: 0.18, type: 'triangle', gain: 0.4, slideTo: 1320 });
    }, 110);
  },
};
