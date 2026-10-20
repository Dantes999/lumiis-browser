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

const level = (): number => (enabled ? volume : 0);

export function initAudio(): void {
  if (context !== null) return;

  try {
    context = new AudioContext();
  } catch {
    context = null;
    return;
  }

  master = context.createGain();
  master.gain.value = level();
  master.connect(context.destination);
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
};

export const sfx = {
  swing(): void {
    tone({ frequency: 320, duration: 0.08, type: 'square', gain: 0.12, slideTo: 170 });
  },
  hit(): void {
    burst(0.12, 0.5, 1200);
  },
  kill(): void {
    tone({ frequency: 190, duration: 0.28, type: 'sawtooth', gain: 0.18, slideTo: 55 });
  },
  hurt(): void {
    tone({ frequency: 150, duration: 0.2, type: 'square', gain: 0.2, slideTo: 70 });
  },
  pickup(): void {
    tone({ frequency: 660, duration: 0.07, type: 'triangle', gain: 0.18, slideTo: 990 });
  },
  levelUp(): void {
    tone({ frequency: 440, duration: 0.12, type: 'triangle', gain: 0.2, slideTo: 880 });
    window.setTimeout(() => {
      tone({ frequency: 660, duration: 0.16, type: 'triangle', gain: 0.2, slideTo: 1320 });
    }, 110);
  },
};
