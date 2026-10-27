// Procedural Web Audio: sound effects, ambient beds and a simple generative
// music pad. Nothing is downloaded; the context starts after a user gesture.

let ctx = null;
let master, sfxGain, musicGain, ambGain;
let noiseBuf = null;
let musicMode = 'off';
let ambMode = 'off';
let ambTimer = 0;
let vol = { sfx: 0.8, music: 0.45 };
let lastPlayed = {};

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ctx = new AC();
  } catch (e) { ctx = null; return; }
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  sfxGain = ctx.createGain(); sfxGain.connect(master);
  musicGain = ctx.createGain(); musicGain.connect(master);
  ambGain = ctx.createGain(); ambGain.connect(master);
  applyVolumes();
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolumes(sfxV, musicV) { vol.sfx = sfxV; vol.music = musicV; applyVolumes(); }
function applyVolumes() {
  if (!ctx) return;
  sfxGain.gain.value = vol.sfx;
  ambGain.gain.value = vol.sfx * 0.6;
  musicGain.gain.value = vol.music * 0.5;
}

export function suspendAudio() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

function env(g, t, a, peak, dcy) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
}

function tone(type, f0, f1, dur, peak, dest = sfxGain, delay = 0) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, 0.005, peak, dur);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, peak, filterType, freq, q = 1, dest = sfxGain, delay = 0, attack = 0.002) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, attack, peak, dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + attack + 0.05);
}

/** Play a named effect. `opts.vol` scales loudness (e.g. distance falloff). */
export function sfx(name, opts = {}) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  // Light rate limiting so overlapping identical sounds don't clip.
  if (lastPlayed[name] && now - lastPlayed[name] < 0.03) return;
  lastPlayed[name] = now;
  const v = opts.vol ?? 1;
  switch (name) {
    case 'shot':
      noise(0.12, 0.7 * v, 'lowpass', 2600, 0.7);
      tone('square', 160, 50, 0.1, 0.35 * v);
      break;
    case 'enemyShot':
      noise(0.14, 0.45 * v, 'lowpass', 1500, 0.7);
      tone('square', 120, 40, 0.12, 0.25 * v);
      break;
    case 'rifle':
      noise(0.2, 0.55 * v, 'lowpass', 1900, 0.6);
      tone('sawtooth', 110, 35, 0.18, 0.3 * v);
      break;
    case 'shotgun':
      noise(0.28, 0.9 * v, 'lowpass', 1800, 0.6);
      tone('square', 110, 35, 0.2, 0.45 * v);
      noise(0.08, 0.3, 'bandpass', 900, 1.5, sfxGain, 0.35); // pump
      break;
    case 'rifleShot':
      noise(0.35, 0.8 * v, 'lowpass', 3200, 0.5);
      tone('sawtooth', 180, 40, 0.3, 0.35 * v);
      tone('sine', 900, 600, 0.05, 0.1, sfxGain, 0.6); // bolt
      break;
    case 'shell': tone('square', 500, 420, 0.04, 0.15); noise(0.04, 0.2, 'bandpass', 2500, 2, sfxGain, 0.05); break;
    case 'swap': tone('square', 300, 260, 0.04, 0.12); tone('square', 600, 600, 0.03, 0.1, sfxGain, 0.08); break;
    case 'molotov': noise(0.5, 0.6, 'lowpass', 1200, 0.6); tone('triangle', 2400, 800, 0.15, 0.12); break;
    case 'fire': noise(0.6, 0.15 * v, 'bandpass', 600, 0.6, sfxGain, 0, 0.1); break;
    case 'trap': tone('square', 900, 200, 0.08, 0.3); noise(0.12, 0.6, 'highpass', 2000); break;
    case 'empty': tone('square', 900, 900, 0.03, 0.15); break;
    case 'reload':
      tone('square', 420, 380, 0.04, 0.18); tone('square', 700, 650, 0.04, 0.15, sfxGain, 0.18);
      noise(0.05, 0.2, 'highpass', 3000, 1, sfxGain, 0.3);
      break;
    case 'reloadDone': tone('square', 900, 1100, 0.05, 0.16); break;
    case 'hit': noise(0.08, 0.5 * v, 'bandpass', 900, 2); tone('sine', 200, 80, 0.08, 0.3 * v); break;
    case 'hurt': tone('sawtooth', 220, 90, 0.22, 0.35); noise(0.15, 0.3, 'lowpass', 600); break;
    case 'thud': noise(0.12, 0.5 * v, 'lowpass', 400, 1); tone('sine', 90, 50, 0.15, 0.4 * v); break;
    case 'swing': noise(0.12, 0.3, 'bandpass', 1600, 0.8, sfxGain, 0, 0.04); break;
    case 'ricochet': tone('sine', 2400, 900, 0.12, 0.12 * v); break;
    case 'glass': for (let i = 0; i < 4; i++) tone('triangle', 2000 + Math.random() * 3000, 1500, 0.15, 0.1 * v, sfxGain, i * 0.03); noise(0.2, 0.3 * v, 'highpass', 4000); break;
    case 'wood': noise(0.18, 0.5 * v, 'bandpass', 500, 1.2); tone('triangle', 140, 70, 0.12, 0.3 * v); break;
    case 'chop': noise(0.1, 0.55, 'bandpass', 700, 1.5); tone('triangle', 180, 90, 0.1, 0.3); break;
    case 'treefall': noise(0.7, 0.5, 'lowpass', 500, 0.8, sfxGain, 0, 0.1); tone('sine', 70, 40, 0.6, 0.4, sfxGain, 0.3); break;
    case 'door': tone('triangle', 300, 180, 0.18, 0.2); noise(0.1, 0.2, 'bandpass', 800, 1); break;
    case 'doorBreak': noise(0.4, 0.7, 'lowpass', 900, 0.7); tone('sawtooth', 90, 40, 0.4, 0.4); break;
    case 'blip': tone('sine', 660, 880, 0.06, 0.18); break;
    case 'ui': tone('sine', 520, 520, 0.04, 0.12); break;
    case 'coin': tone('square', 988, 988, 0.06, 0.12); tone('square', 1319, 1319, 0.12, 0.12, sfxGain, 0.06); break;
    case 'chime': [523, 659, 784].forEach((f, i) => tone('sine', f, f, 0.3, 0.15, sfxGain, i * 0.08)); break;
    case 'jobDone': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.25, 0.2, sfxGain, i * 0.09)); break;
    case 'levelup': [392, 523, 659, 784, 1047].forEach((f, i) => tone('square', f, f, 0.18, 0.12, sfxGain, i * 0.08)); tone('triangle', 1047, 1047, 0.6, 0.15, sfxGain, 0.4); break;
    case 'warning':
      for (let i = 0; i < 3; i++) { tone('sawtooth', 440, 440, 0.18, 0.18, sfxGain, i * 0.4); tone('sawtooth', 330, 330, 0.18, 0.18, sfxGain, i * 0.4 + 0.2); }
      break;
    case 'alarm': for (let i = 0; i < 6; i++) tone('square', i % 2 ? 1200 : 900, i % 2 ? 1200 : 900, 0.12, 0.13, sfxGain, i * 0.14); break;
    case 'victory': [392, 494, 587, 784].forEach((f, i) => tone('triangle', f, f, 0.4, 0.2, sfxGain, i * 0.14)); break;
    case 'defeat': [392, 330, 262, 196].forEach((f, i) => tone('triangle', f, f, 0.5, 0.2, sfxGain, i * 0.25)); break;
    case 'heal': tone('sine', 440, 880, 0.25, 0.15); break;
    case 'eat': noise(0.08, 0.2, 'bandpass', 1200, 2); noise(0.08, 0.2, 'bandpass', 1000, 2, sfxGain, 0.12); break;
    case 'hammer': tone('square', 300, 200, 0.05, 0.2); noise(0.06, 0.4, 'bandpass', 2000, 2); break;
    case 'miss': tone('sine', 200, 150, 0.12, 0.15); break;
    case 'phone': for (let i = 0; i < 2; i++) { for (let k = 0; k < 8; k++) tone('sine', k % 2 ? 480 : 440, k % 2 ? 480 : 440, 0.05, 0.12, sfxGain, i * 0.9 + k * 0.05); } break;
    case 'car': noise(1.2, 0.25, 'lowpass', 220, 1, sfxGain, 0, 0.2); tone('sawtooth', 50, 70, 1.0, 0.12); break;
    case 'step': noise(0.04, 0.08 * v, 'lowpass', 500); break;
    case 'dodge': noise(0.18, 0.25, 'bandpass', 600, 0.8, sfxGain, 0, 0.03); break;
    case 'pickup': tone('sine', 780, 1170, 0.08, 0.15); break;
    default: break;
  }
}

/* ---------------- ambient + music ---------------- */
export function setAmbient(mode) { ambMode = mode; }
export function setMusic(mode) {
  if (mode === musicMode) return;
  musicMode = mode;
  seqStep = 0;
  seqNext = ctx ? ctx.currentTime + 0.15 : 0;
}

/* ---- Step-sequenced music: three looping themes built from synth voices ---- */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
let seqStep = 0, seqNext = 0;

function voice(type, freq, t, dur, peak, filterFreq, attack = 0.005) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  f.type = 'lowpass'; f.frequency.setValueAtTime(filterFreq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(120, filterFreq * 0.35), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f); f.connect(g); g.connect(musicGain);
  o.start(t); o.stop(t + dur + 0.05);
  return o;
}
const pluck = (t, m, v = 0.09) => voice('triangle', mtof(m), t, 0.45, v, 2600);
const keys = (t, m, v = 0.08, d = 1.4) => { voice('sine', mtof(m), t, d, v, 3000, 0.01); voice('triangle', mtof(m + 12), t, d * 0.6, v * 0.25, 2000); };
const bass = (t, m, v = 0.12, d = 0.4) => voice('triangle', mtof(m), t, d, v, 600);
const flute = (t, m, v = 0.05, d = 0.5) => {
  const o = voice('sine', mtof(m), t, d, v, 4000, 0.06);
  const lfo = ctx.createOscillator(); const lg = ctx.createGain();
  lfo.frequency.value = 5.5; lg.gain.value = mtof(m) * 0.006;
  lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + d);
};
function kick(t) {
  const o = ctx.createOscillator(); const g = ctx.createGain();
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 0.25);
}
const drum = (t, filt, freq, dur, v) => noise(dur, v, filt, freq, 1, musicGain, Math.max(0, t - ctx.currentTime));

// Chord progressions as [bassMidi, [chord tones]]
const SONGS = {
  day: { bpm: 96, bars: [[43, [55, 59, 62, 67]], [40, [52, 55, 59, 64]], [48, [55, 60, 64, 67]], [50, [54, 57, 62, 66]]],
    melody: [[0, 74], [3, 71], [4, 72], [6, 74], [8, 76], [12, 74], [16, 71], [19, 67], [20, 69], [24, 71], [28, 67], [32, 72], [35, 71], [36, 69], [40, 67], [44, 64], [48, 66], [52, 69], [56, 67], [60, 62]] },
  night: { bpm: 68, bars: [[45, [57, 60, 64, 69]], [41, [57, 60, 65, 69]], [48, [55, 60, 64, 67]], [43, [55, 59, 62, 67]]],
    melody: [[0, 76], [6, 72], [8, 74], [16, 72], [22, 69], [24, 71], [32, 67], [38, 69], [40, 72], [48, 74], [54, 71], [56, 67]] },
  tense: { bpm: 128, bars: [[40, [52, 55, 59]], [40, [52, 55, 59]], [36, [48, 52, 55]], [38, [50, 54, 57]]], melody: [] },
};
SONGS.town = SONGS.day;

function scheduleStep(song, step, t) {
  const bar = Math.floor(step / 16) % song.bars.length;
  const s16 = step % 16;
  const [root, chord] = song.bars[bar];
  const sixteenth = 60 / song.bpm / 4;
  if (musicMode === 'tense') {
    const pat = [0, 0, 12, 0, 3, 0, 7, 0, 0, 0, 12, 0, 5, 0, 7, 3];
    bass(t, root + pat[s16], 0.11, sixteenth * 1.6);
    if (s16 === 0 || s16 === 8 || s16 === 10) kick(t);
    if (s16 === 4 || s16 === 12) { drum(t, 'bandpass', 1800, 0.14, 0.22); }
    if (s16 % 2 === 0) drum(t, 'highpass', 7000, 0.03, 0.06);
    if (s16 === 0 && bar % 2 === 1) for (const n of chord) voice('sawtooth', mtof(n), t, 0.35, 0.03, 1400);
    return;
  }
  if (s16 === 0 || s16 === 8) bass(t, root, 0.11, sixteenth * 7);
  if (musicMode === 'night') {
    const arp = { 0: 0, 3: 1, 6: 2, 8: 3, 11: 2, 14: 1 };
    if (arp[s16] !== undefined) keys(t, chord[arp[s16]], 0.06, 1.6);
  } else {
    if (s16 % 2 === 0) pluck(t, chord[[0, 1, 2, 3, 2, 1, 2, 1][s16 / 2]], 0.07);
  }
  const loopStep = step % (song.bars.length * 16);
  for (const [at, m] of song.melody) if (at * 1 === loopStep) (musicMode === 'night' ? keys(t, m, 0.05, 2) : flute(t, m, 0.045, sixteenth * 4));
}

/** Called every frame with dt; schedules music and ambient sounds. */
export function updateAudio(dt) {
  if (!ctx || ctx.state !== 'running') return;
  const song = SONGS[musicMode];
  if (song) {
    if (seqNext < ctx.currentTime) seqNext = ctx.currentTime + 0.05;
    const sixteenth = 60 / song.bpm / 4;
    while (seqNext < ctx.currentTime + 0.2) {
      scheduleStep(song, seqStep, seqNext);
      seqStep++;
      seqNext += sixteenth;
    }
  }
  ambTimer -= dt;
  if (ambTimer <= 0) {
    if (ambMode === 'day') {
      // birdsong chirps
      const base = 2200 + Math.random() * 1600;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) tone('sine', base, base * (0.8 + Math.random() * 0.5), 0.07, 0.05, ambGain, i * 0.1);
      ambTimer = 1.5 + Math.random() * 3;
    } else if (ambMode === 'night') {
      // crickets
      const f = 4200 + Math.random() * 400;
      for (let i = 0; i < 6; i++) tone('sine', f, f, 0.02, 0.03, ambGain, i * 0.045);
      if (Math.random() < 0.15) noise(1.5, 0.05, 'lowpass', 300, 0.5, ambGain, 0, 0.6); // wind
      ambTimer = 0.6 + Math.random() * 0.9;
    } else if (ambMode === 'town') {
      if (Math.random() < 0.5) noise(0.6, 0.03, 'lowpass', 400, 0.5, ambGain, 0, 0.3);
      else { const b = 1800 + Math.random() * 1200; tone('sine', b, b * 1.1, 0.06, 0.035, ambGain); }
      ambTimer = 2 + Math.random() * 3;
    } else ambTimer = 1;
  }
}
