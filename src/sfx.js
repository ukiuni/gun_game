// Tiny WebAudio synth (no audio files). Unlocked on first user gesture (required on iOS).
let ctx = null;
let muted = false;
let lastShot = 0;

export function setMuted(m) { muted = !!m; }
export function isMuted() { return muted; }

export function unlockAudio() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { ctx = null; }
}

function tone({ freq = 440, end = freq, dur = 0.1, type = 'square', vol = 0.08, noise = false }) {
  if (muted || !ctx || ctx.state !== 'running') return;
  const t0 = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  gain.connect(ctx.destination);
  let src;
  if (noise) {
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    src.connect(f); f.connect(gain);
  } else {
    src = ctx.createOscillator();
    src.type = type;
    src.frequency.setValueAtTime(freq, t0);
    src.frequency.exponentialRampToValueAtTime(Math.max(20, end), t0 + dur);
    src.connect(gain);
  }
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

export const sfx = {
  click: () => tone({ freq: 880, end: 660, dur: 0.06, vol: 0.05 }),
  place: () => tone({ freq: 330, end: 520, dur: 0.08, vol: 0.06 }),
  merge: () => { tone({ freq: 520, end: 1040, dur: 0.18, vol: 0.07 }); setTimeout(() => tone({ freq: 780, end: 1560, dur: 0.2, vol: 0.06 }), 90); },
  shot: () => {
    const now = performance.now();
    if (now - lastShot < 45) return; // avoid audio spam
    lastShot = now;
    tone({ freq: 1800, dur: 0.07, vol: 0.05, noise: true });
  },
  boom: () => tone({ freq: 600, dur: 0.6, vol: 0.18, noise: true }),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.18, vol: 0.06, type: 'triangle' }), i * 110)),
  lose: () => [392, 330, 262].forEach((f, i) => setTimeout(() => tone({ freq: f, dur: 0.25, vol: 0.06, type: 'triangle' }), i * 160)),
  error: () => tone({ freq: 160, end: 120, dur: 0.15, vol: 0.06 }),
};
