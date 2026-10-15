// Beeps, whistles and vibration. Sounds are synthesised with Web Audio, so there are
// no audio files to load and they play instantly.

let ctx = null;
let out = null;

// Call from a tap (e.g. the start button): browsers only allow audio after a user gesture.
export function unlockAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!ctx) {
    // iOS: play through the speaker even when the silent switch is on.
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    ctx = new AudioCtx();
    // A compressor lets the cues be loud without clipping.
    out = ctx.createDynamicsCompressor();
    out.connect(ctx.destination);
    // Older iOS only unlocks audio once a sound has started inside the gesture.
    const silence = ctx.createBufferSource();
    silence.buffer = ctx.createBuffer(1, 1, 22050);
    silence.connect(ctx.destination);
    silence.start();
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

function tone(freq, at, dur, { type = 'square', volume = 0.35 } = {}) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.01);
  gain.gain.setValueAtTime(volume, t + dur - 0.02);
  gain.gain.linearRampToValueAtTime(0, t + dur);
  osc.connect(gain).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  return osc;
}

// Referee-style whistle: a high tone with a fast trill. Phone speakers are loudest up here.
function whistle(at, dur) {
  const osc = tone(2800, at, dur, { type: 'sine', volume: 0.7 });
  const trill = ctx.createOscillator();
  const depth = ctx.createGain();
  trill.frequency.value = 35;
  depth.gain.value = 180;
  trill.connect(depth).connect(osc.frequency);
  const t = ctx.currentTime + at;
  trill.start(t);
  trill.stop(t + dur + 0.05);
}

const SOUNDS = {
  count: () => tone(880, 0, 0.15),
  warning: () => [0, 0.18, 0.36].forEach((at) => tone(1320, at, 0.12)),
  work: () => whistle(0, 0.7),
  rest: () => {
    tone(520, 0, 0.25);
    tone(390, 0.32, 0.4);
  },
  done: () => {
    whistle(0, 0.35);
    whistle(0.5, 0.35);
    whistle(1, 1);
  },
};

const VIBRATIONS = {
  count: 60,
  warning: [100, 80, 100, 80, 100],
  work: 500,
  rest: [200, 100, 200],
  done: [400, 150, 400, 150, 800],
};

export function cue(name, settings) {
  if (settings.vibrate && navigator.vibrate) navigator.vibrate(VIBRATIONS[name]);
  if (!settings.sound || !ctx) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  SOUNDS[name]();
}
