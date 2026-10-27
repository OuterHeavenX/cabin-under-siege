// Audio engine. Two layers:
//  1. Recorded samples: drop licensed files into /audio and list them in
//     audio/manifest.json — any listed sound replaces the generated one.
//  2. Physically-modelled synthesis (the default): layered gunshots, modal metal
//     and wood impacts, surface-aware footsteps, glass, creaking doors, birdsong,
//     crickets, wind and fire, all placed in stereo and sent through generated
//     outdoor/indoor reverbs. Music uses Karplus-Strong guitar, an additive piano
//     and acoustic-style drums rendered to buffers.
// Nothing plays until a user gesture starts the AudioContext (mobile rule).

let ctx = null;
let master, comp, sfxBus, musicBus, ambBus, outdoorVerb, roomVerb, hallVerb, outdoorSend, roomSend, musicSend;
let vol = { sfx: 0.8, music: 0.45 };
const lastPlayed = {};
const listener = { x: 0, y: 0, indoor: false, set: false };
let noise = {}; // white / pink / brown buffers
const samples = {}; // name -> [AudioBuffer]
let musicSamples = {};
let musicMode = 'off';
let ambMode = 'off';
let fireLevel = 0, firePan = 0;

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */
let offline = false;

function buildGraph() {
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
  master = ctx.createGain(); master.gain.value = 0.95;
  comp.connect(master); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(comp);
  musicBus = ctx.createGain(); musicBus.connect(comp);
  ambBus = ctx.createGain(); ambBus.connect(comp);
  makeNoise();
  // Reverbs from generated impulse responses.
  outdoorVerb = makeVerb(1.6, 0.25, 3200, [0.03, 0.07, 0.13]);
  roomVerb = makeVerb(0.55, 0.9, 5000, [0.008, 0.015, 0.022, 0.031]);
  hallVerb = makeVerb(2.4, 0.7, 4200, [0.02, 0.035]);
  outdoorSend = ctx.createGain(); outdoorSend.connect(outdoorVerb.input); outdoorVerb.out.connect(sfxBus);
  roomSend = ctx.createGain(); roomSend.connect(roomVerb.input); roomVerb.out.connect(sfxBus);
  musicSend = ctx.createGain(); musicSend.gain.value = 0.32; musicSend.connect(hallVerb.input); hallVerb.out.connect(musicBus);
  musicOut = null;
  listener.indoor = !listener.indoor; setIndoor(!listener.indoor);
  applyVolumes();
}

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { ctx = new AC(); } catch (e) { ctx = null; return; }
  buildGraph();
  startAmbienceBeds();
  for (const m of [72, 76, 79, 84, 88]) queueRender(() => pianoBuffer(m));
  for (const m of [60, 64, 67, 71, 72, 74, 76, 79]) queueRender(() => ksBuffer(m, { bright: 0.55, damp: 0.996 }));
  queueSongNotes(musicMode === 'off' ? 'day' : musicMode);
  loadManifest();
}

/**
 * Test helper: render something offline and measure it. `play(t)` triggers sounds
 * via sfx()/musicBar(). Returns peak and RMS of the rendered result.
 */
export async function renderOffline(play, seconds = 2, indoor = false, wantData = false) {
  const saved = { ctx, comp, master, sfxBus, musicBus, ambBus, outdoorVerb, roomVerb, hallVerb, outdoorSend, roomSend, musicSend, noise, musicOut, offline, lp: { ...lastPlayed }, set: listener.set, indoorL: listener.indoor };
  const cache = { ...instCache };
  for (const k of Object.keys(instCache)) delete instCache[k];
  ctx = new OfflineAudioContext(2, Math.floor(44100 * seconds), 44100);
  offline = true;
  listener.set = false;
  listener.indoor = !indoor;
  for (const k of Object.keys(lastPlayed)) delete lastPlayed[k];
  buildGraph();
  setIndoor(indoor);
  play();
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, n = 0;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; n++; }
  }
  ({ ctx, comp, master, sfxBus, musicBus, ambBus, outdoorVerb, roomVerb, hallVerb, outdoorSend, roomSend, musicSend, noise, musicOut, offline } = saved);
  Object.assign(lastPlayed, saved.lp);
  listener.set = saved.set; listener.indoor = saved.indoorL;
  for (const k of Object.keys(instCache)) delete instCache[k];
  Object.assign(instCache, cache);
  return { peak, rms: Math.sqrt(sum / n), data: wantData ? Array.from(buf.getChannelData(0)) : null };
}

/** Test helper: trigger one bird call at time 0. */
export function birdCall() { bird(0.05); }

/** Test helper: schedule one bar of a music theme at time 0. */
export function musicBar(mode) {
  const song = SONGS[mode];
  const prev = musicMode; musicMode = mode;
  const six = 60 / song.bpm / 4;
  for (let i = 0; i < 16; i++) scheduleStep(song, i, 0.05 + i * six);
  musicMode = prev;
}

export function setVolumes(sfxV, musicV) { vol.sfx = sfxV; vol.music = musicV; applyVolumes(); }
function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.value = vol.sfx;
  ambBus.gain.value = vol.sfx * 0.7;
  musicBus.gain.value = vol.music * 0.55;
}
export function suspendAudio() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); }
export function resumeAudio() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

/** Where the player (the microphone) is, and whether they're indoors. */
export function setListener(x, y, indoor) {
  listener.x = x; listener.y = y; listener.set = true;
  if (indoor !== listener.indoor) setIndoor(indoor);
}
function setIndoor(indoor) {
  listener.indoor = indoor;
  if (!ctx) return;
  const t = ctx.currentTime;
  outdoorSend.gain.setTargetAtTime(indoor ? 0.05 : 0.35, t, 0.15);
  roomSend.gain.setTargetAtTime(indoor ? 0.45 : 0.02, t, 0.15);
}

function makeNoise() {
  const sr = ctx.sampleRate, n = sr * 4;
  const w = ctx.createBuffer(1, n, sr), p = ctx.createBuffer(1, n, sr), b = ctx.createBuffer(1, n, sr);
  const wd = w.getChannelData(0), pd = p.getChannelData(0), bd = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.random() * 2 - 1;
    wd[i] = r;
    b0 = 0.99886 * b0 + r * 0.0555179; b1 = 0.99332 * b1 + r * 0.0750759; b2 = 0.969 * b2 + r * 0.153852;
    b3 = 0.8665 * b3 + r * 0.3104856; b4 = 0.55 * b4 + r * 0.5329522; b5 = -0.7616 * b5 - r * 0.016898;
    pd[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + r * 0.5362) * 0.11; b6 = r * 0.115926;
    last = (last + 0.02 * r) / 1.02; bd[i] = last * 3.5;
  }
  noise = { white: w, pink: p, brown: b };
}

/** Synthetic impulse response: early reflections + damped diffuse tail. */
function makeVerb(seconds, density, damp, early) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.pow(1 - t / seconds, 2.2) * Math.exp(-t * (3 / seconds));
      const k = Math.exp(-2 * Math.PI * (damp * (1 - t / seconds * 0.8)) / sr);
      const r = (Math.random() < density ? Math.random() * 2 - 1 : 0);
      lp = lp * k + r * (1 - k);
      d[i] = lp * env * 2.2;
    }
    for (const e of early) {
      const i = Math.floor((e + (c ? 0.003 : 0)) * sr);
      if (i < n) d[i] += 0.5 * (1 - e * 4) * (Math.random() < 0.5 ? -1 : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  const out = ctx.createGain(); out.gain.value = 1;
  conv.connect(out);
  return { input: conv, out };
}

/* ------------------------------------------------------------------ */
/* Recorded sample support                                             */
/* ------------------------------------------------------------------ */
async function loadManifest() {
  let man;
  try {
    const r = await fetch('audio/manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    man = await r.json();
  } catch (e) { return; }
  const load = async (url) => {
    try {
      const r = await fetch('audio/' + url);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
    } catch (e) { return null; }
  };
  for (const [name, files] of Object.entries(man.sfx || {})) {
    const list = (await Promise.all((Array.isArray(files) ? files : [files]).map(load))).filter(Boolean);
    if (list.length) samples[name] = list;
  }
  for (const [name, file] of Object.entries(man.music || {})) {
    const b = await load(file);
    if (b) musicSamples[name] = b;
  }
  if (musicSamples[musicMode]) startMusicLoop(musicMode);
}

function playSample(name, out, t, rate = 1) {
  const list = samples[name];
  const src = ctx.createBufferSource();
  src.buffer = list[Math.floor(Math.random() * list.length)];
  src.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
  src.connect(out);
  src.start(t);
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */
/** Output chain for one sound: distance gain, air-absorption lowpass, pan, reverb send. */
function voiceOut(opts = {}) {
  const g = ctx.createGain();
  let v = opts.vol ?? 1;
  let pan = 0, lpf = 20000, verb = opts.verb ?? 1;
  if (opts.x !== undefined && listener.set) {
    const dx = opts.x - listener.x, dy = opts.y - listener.y;
    const d = Math.hypot(dx, dy);
    v *= Math.max(0.05, 1 / (1 + d / 220));
    lpf = Math.max(900, 18000 / (1 + d / 260));
    pan = Math.max(-0.85, Math.min(0.85, dx / 420));
    verb *= 1 + Math.min(1.5, d / 400); // distant sounds are mostly reverb
  }
  g.gain.value = v;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpf;
  g.connect(f);
  let last = f;
  if (ctx.createStereoPanner && pan) {
    const p = ctx.createStereoPanner(); p.pan.value = pan; f.connect(p); last = p;
  }
  last.connect(sfxBus);
  const s1 = ctx.createGain(); s1.gain.value = verb; last.connect(s1); s1.connect(outdoorSend); s1.connect(roomSend);
  return g;
}

function env(gain, t, a, peak, decay, hold = 0) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + a);
  if (hold) gain.gain.setValueAtTime(peak, t + a + hold);
  gain.gain.setTargetAtTime(0.0001, t + a + hold, decay / 4);
}

/** Filtered noise burst. */
function nz(out, t, { type = 'white', dur = 0.1, a = 0.001, peak = 1, hp = 0, lp = 0, bp = 0, q = 1, lpTo = 0, rate = 1 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise[type];
  src.playbackRate.value = rate;
  let node = src;
  const chain = (f) => { node.connect(f); node = f; };
  if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; chain(f); }
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lp, t); if (lpTo) f.frequency.exponentialRampToValueAtTime(lpTo, t + dur); chain(f); }
  if (bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q; chain(f); }
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  node.connect(g); g.connect(out);
  src.start(t, Math.random() * 3); src.stop(t + a + dur * 1.6 + 0.05);
}

/** Pitched oscillator with envelope (optionally sweeping). */
function osc(out, t, { type = 'sine', f = 440, fTo = 0, sweep = 0.1, dur = 0.2, a = 0.002, peak = 0.5, detune = 0 } = {}) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (fTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, fTo), t + sweep);
  o.detune.value = detune;
  const g = ctx.createGain(); env(g, t, a, peak, dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + a + dur * 1.6 + 0.05);
  return o;
}

/** Modal resonator: an impulse exciting a few high-Q bands — metal, wood, glass. */
function modal(out, t, freqs, { q = 30, peak = 1, dur = 0.08, exc = 0.004, spread = 0.04 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = noise.white;
  const eg = ctx.createGain(); env(eg, t, 0.0005, 1, exc);
  src.connect(eg);
  for (const [fr, amp] of freqs) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.value = fr * (1 + (Math.random() - 0.5) * spread); f.Q.value = q;
    const g = ctx.createGain(); env(g, t, 0.0005, peak * amp * q * 0.6 * Math.sqrt(2000 / fr), dur);
    eg.connect(f); f.connect(g); g.connect(out);
  }
  src.start(t, Math.random() * 3); src.stop(t + dur * 2 + 0.1);
}

const metalClick = (out, t, bright = 1, peak = 0.6, dur = 0.05) => modal(out, t, [[2400 * bright, 1], [3870 * bright, 0.7], [6100 * bright, 0.5], [8900 * bright, 0.3]], { q: 28, peak, dur });
const woodKnock = (out, t, low = 1, peak = 0.8, dur = 0.12) => modal(out, t, [[140 * low, 1], [310 * low, 0.8], [620 * low, 0.5], [1250 * low, 0.25]], { q: 9, peak, dur, exc: 0.006 });

/** Vocal-ish grunt through formants (for hurt sounds). */
function grunt(out, t, pitch = 120, peak = 0.35) {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(pitch * 1.15, t); o.frequency.exponentialRampToValueAtTime(pitch * 0.8, t + 0.22);
  const g = ctx.createGain(); env(g, t, 0.01, peak, 0.16, 0.05);
  const mix = ctx.createGain();
  for (const [fr, a, q] of [[650, 1, 6], [1100, 0.6, 8], [2500, 0.25, 10]]) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr; f.Q.value = q;
    const fg = ctx.createGain(); fg.gain.value = a;
    o.connect(f); f.connect(fg); fg.connect(mix);
  }
  mix.connect(g); g.connect(out);
  nz(out, t, { type: 'pink', dur: 0.12, peak: peak * 0.3, bp: 900, q: 1 });
  o.start(t); o.stop(t + 0.5);
}

/* ------------------------------------------------------------------ */
/* Gunfire                                                             */
/* ------------------------------------------------------------------ */
function gunshot(out, t, kind) {
  const P = {
    pistol: { crack: 2600, crackDur: 0.018, body: 1700, bodyDur: 0.11, thump: [140, 48], thumpDur: 0.12, tail: 0.45, peak: 1 },
    shotgun: { crack: 1500, crackDur: 0.03, body: 1300, bodyDur: 0.22, thump: [100, 34], thumpDur: 0.24, tail: 0.9, peak: 1.15 },
    rifle: { crack: 3600, crackDur: 0.012, body: 2200, bodyDur: 0.16, thump: [120, 40], thumpDur: 0.16, tail: 1.2, peak: 1.1 },
  }[kind];
  // supersonic crack / muzzle blast transient
  nz(out, t, { dur: P.crackDur, a: 0.0004, peak: P.peak * 1.2, hp: P.crack });
  // powder blast body
  nz(out, t, { type: 'pink', dur: P.bodyDur, a: 0.0008, peak: P.peak * 1.3, lp: P.body * 2, lpTo: 350 });
  // chest-thump low end
  osc(out, t, { f: P.thump[0], fTo: P.thump[1], sweep: P.thumpDur, dur: P.thumpDur, a: 0.001, peak: P.peak * 0.9 });
  // rolling outdoor tail
  nz(out, t + 0.02, { type: 'brown', dur: P.tail, a: 0.02, peak: P.peak * 0.35, lp: 700, lpTo: 180 });
  // mechanism
  if (kind === 'pistol') { metalClick(out, t + 0.055, 1.1, 0.25, 0.03); }
  if (kind === 'shotgun') { // pump: shuck back, clack forward
    nz(out, t + 0.36, { type: 'pink', dur: 0.07, peak: 0.35, bp: 1400, q: 1.5 }); metalClick(out, t + 0.42, 0.8, 0.55, 0.06);
    nz(out, t + 0.5, { type: 'pink', dur: 0.06, peak: 0.3, bp: 1100, q: 1.5 }); metalClick(out, t + 0.56, 0.9, 0.6, 0.07);
  }
  if (kind === 'rifle') { // bolt: up, back, forward, down
    metalClick(out, t + 0.5, 1.2, 0.35, 0.04); nz(out, t + 0.55, { dur: 0.09, peak: 0.2, bp: 2600, q: 2 });
    nz(out, t + 0.72, { dur: 0.07, peak: 0.2, bp: 2300, q: 2 }); metalClick(out, t + 0.8, 1.1, 0.45, 0.05);
  }
}

/* ------------------------------------------------------------------ */
/* Sound effects                                                       */
/* ------------------------------------------------------------------ */
/** Play a named effect. `opts.x/y` place it in the world; `opts.vol` scales it. */
export function sfx(name, opts = {}) {
  if (!ctx || (ctx.state !== 'running' && !offline)) return;
  const t = ctx.currentTime + 0.005;
  if (lastPlayed[name] && t - lastPlayed[name] < 0.025) return;
  lastPlayed[name] = t;
  const out = voiceOut(opts);
  if (samples[name]) { playSample(name, out, t); return; }
  const v = 1;
  switch (name) {
    case 'shot': gunshot(out, t, 'pistol'); break;
    case 'shotgun': gunshot(out, t, 'shotgun'); break;
    case 'rifleShot': gunshot(out, t, 'rifle'); break;
    case 'enemyShot': gunshot(out, t, 'pistol'); break;
    case 'rifle': gunshot(out, t, 'rifle'); break;
    case 'empty': metalClick(out, t, 0.7, 0.4, 0.025); break;
    case 'reload': // mag release, mag out, new mag seated
      metalClick(out, t, 1.3, 0.18, 0.03);
      nz(out, t + 0.08, { type: 'pink', dur: 0.06, peak: 0.14, bp: 1800, q: 2 });
      woodKnock(out, t + 0.5, 2.6, 0.2, 0.05); metalClick(out, t + 0.52, 0.9, 0.3, 0.05);
      break;
    case 'reloadDone': // slide release
      nz(out, t, { dur: 0.04, peak: 0.2, bp: 3000, q: 2 }); metalClick(out, t + 0.04, 1, 0.6, 0.06); break;
    case 'shell': nz(out, t, { type: 'pink', dur: 0.05, peak: 0.25, bp: 1600, q: 2 }); metalClick(out, t + 0.05, 0.75, 0.4, 0.04); break;
    case 'swap': nz(out, t, { type: 'pink', dur: 0.16, a: 0.03, peak: 0.25, bp: 2200, q: 0.8 }); metalClick(out, t + 0.18, 1, 0.3, 0.04); break;
    case 'hit': // bullet into body
      nz(out, t, { type: 'pink', dur: 0.06, peak: 0.6, lp: 900 }); nz(out, t, { dur: 0.015, peak: 0.25, hp: 2500 });
      osc(out, t, { f: 90, fTo: 50, sweep: 0.06, dur: 0.07, peak: 0.4 }); break;
    case 'hurt': grunt(out, t, 105, 0.45); nz(out, t, { type: 'pink', dur: 0.05, peak: 0.4, lp: 800 }); break;
    case 'thud': nz(out, t, { type: 'brown', dur: 0.12, peak: 0.9, lp: 500 }); woodKnock(out, t, 0.7, 0.6, 0.1); break;
    case 'swing': nz(out, t, { type: 'pink', dur: 0.16, a: 0.05, peak: 0.5, bp: 900, q: 0.9 }); break;
    case 'ricochet': {
      const o = osc(out, t, { type: 'sine', f: 3800, fTo: 1400, sweep: 0.35, dur: 0.25, peak: 0.12 });
      nz(out, t, { dur: 0.02, peak: 0.25, hp: 3000 }); metalClick(out, t, 1.6, 0.25, 0.04); void o; break;
    }
    case 'impact': nz(out, t, { dur: 0.03, peak: 0.45, bp: 1400, q: 1.2 }); nz(out, t, { type: 'pink', dur: 0.08, peak: 0.25, lp: 900 }); break;
    case 'glass': {
      nz(out, t, { dur: 0.08, peak: 0.6, hp: 2500 });
      for (let i = 0; i < 14; i++) {
        const tt = t + Math.random() * 0.35;
        modal(out, tt, [[2800 + Math.random() * 7000, 1], [5200 + Math.random() * 6000, 0.6]], { q: 40, peak: 0.25 * (1 - i / 16), dur: 0.08 + Math.random() * 0.2 });
      }
      break;
    }
    case 'wood': nz(out, t, { type: 'pink', dur: 0.12, peak: 0.6, lp: 1600, lpTo: 400 }); woodKnock(out, t, 0.9, 0.9, 0.15); break;
    case 'chop': woodKnock(out, t, 1.1, 1, 0.14); nz(out, t, { dur: 0.03, peak: 0.4, hp: 1500 }); break;
    case 'treefall': {
      for (let i = 0; i < 10; i++) woodKnock(out, t + i * 0.06 + Math.random() * 0.04, 1.4 + Math.random(), 0.16, 0.05);
      nz(out, t + 0.5, { type: 'pink', dur: 0.9, a: 0.25, peak: 0.6, lp: 3000, lpTo: 500 }); // leaves rush
      nz(out, t + 1.2, { type: 'brown', dur: 0.5, peak: 1, lp: 300 }); osc(out, t + 1.2, { f: 70, fTo: 35, sweep: 0.3, dur: 0.35, peak: 0.6 });
      break;
    }
    case 'door': { // hinge creak + latch
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const n = 24, curve = new Float32Array(n); let f = 90;
      for (let i = 0; i < n; i++) { f = Math.max(55, Math.min(170, f + (Math.random() - 0.45) * 30)); curve[i] = f; }
      o.frequency.setValueCurveAtTime(curve, t, 0.45);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3;
      const g = ctx.createGain(); env(g, t, 0.05, 0.12, 0.25, 0.2);
      o.connect(bp); bp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.8);
      woodKnock(out, t + 0.5, 1.3, 0.4, 0.06); metalClick(out, t + 0.52, 1, 0.3, 0.03);
      break;
    }
    case 'doorBreak':
      for (let i = 0; i < 5; i++) woodKnock(out, t + i * 0.035, 0.8 + Math.random() * 0.8, 0.8, 0.12);
      nz(out, t, { type: 'pink', dur: 0.4, peak: 0.9, lp: 2500, lpTo: 300 }); osc(out, t, { f: 80, fTo: 40, sweep: 0.2, dur: 0.25, peak: 0.6 });
      break;
    case 'hammer': metalClick(out, t, 0.9, 0.6, 0.06); woodKnock(out, t + 0.002, 1.6, 0.5, 0.05); break;
    case 'trap':
      metalClick(out, t, 0.7, 1, 0.12); metalClick(out, t + 0.01, 1.3, 0.6, 0.1);
      osc(out, t, { f: 420, dur: 0.4, peak: 0.08, type: 'triangle' }); nz(out, t, { type: 'pink', dur: 0.05, peak: 0.4, lp: 1200 });
      break;
    case 'molotov':
      for (let i = 0; i < 6; i++) modal(out, t + Math.random() * 0.12, [[3000 + Math.random() * 5000, 1]], { q: 35, peak: 0.25, dur: 0.12 });
      nz(out, t + 0.03, { type: 'brown', dur: 0.7, a: 0.08, peak: 1, lp: 600, lpTo: 200 }); // whoomp
      nz(out, t + 0.05, { type: 'pink', dur: 0.6, a: 0.1, peak: 0.4, bp: 900, q: 0.7 });
      break;
    case 'fire': for (let i = 0; i < 4; i++) nz(out, t + Math.random() * 0.25, { dur: 0.008, peak: 0.25 * (opts.vol ?? 1), hp: 1800 }); break;
    case 'step': stepSound(out, t, opts.surface || 'grass', opts.vol ?? 0.6); break;
    case 'dodge': nz(out, t, { type: 'pink', dur: 0.22, a: 0.04, peak: 0.35, bp: 700, q: 0.8 }); stepSound(out, t + 0.2, opts.surface || 'grass', 0.8); break;
    case 'pickup': nz(out, t, { type: 'pink', dur: 0.08, peak: 0.15, bp: 2500, q: 1 }); metalClick(out, t + 0.04, 1.4, 0.18, 0.03); break;
    case 'coin': modal(out, t, [[2700, 1], [6750, 0.6], [9100, 0.3]], { q: 60, peak: 0.25, dur: 0.25 }); modal(out, t + 0.07, [[3050, 1], [7600, 0.5]], { q: 60, peak: 0.2, dur: 0.3 }); break;
    case 'heal': for (let i = 0; i < 5; i++) nz(out, t + i * 0.05, { dur: 0.04, peak: 0.12, hp: 2500 }); break; // tape / wrap
    case 'eat': for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) nz(out, t + i * 0.18 + k * 0.012, { dur: 0.012, peak: 0.2, bp: 1500 + Math.random() * 1500, q: 2 }); break;
    case 'miss': woodKnock(out, t, 2, 0.25, 0.04); break;
    case 'car': carSound(out, t, 0.6); break;
    case 'phone': phoneRing(out, t); break;
    case 'alarm': for (let i = 0; i < 10; i++) modal(out, t + i * 0.07, [[1800, 1], [4860, 0.5], [9600, 0.2]], { q: 50, peak: 0.25, dur: 0.12 }); break;
    case 'warning': // cinematic low swell + distant engine
      strings(out, t, [40, 47], 2.4, 0.18); carSound(out, t + 0.2, 0.35); break;
    // UI and reward stings: musical, using the guitar / piano instruments.
    case 'ui': pianoNote(out, t, 84, 0.08, 0.6); break;
    case 'blip': pianoNote(out, t, 88, 0.08, 0.5); break;
    case 'chime': [72, 76, 79].forEach((m, i) => pianoNote(out, t + i * 0.09, m, 0.1, 1.4)); break;
    case 'jobDone': [67, 71, 74, 79].forEach((m, i) => guitarNote(out, t + i * 0.08, m, 0.11)); break;
    case 'levelup': [60, 64, 67, 72, 76].forEach((m, i) => guitarNote(out, t + i * 0.07, m, 0.11)); pianoNote(out, t + 0.4, 84, 0.12, 1.8); break;
    case 'victory': [55, 59, 62, 67].forEach((m, i) => guitarNote(out, t + i * 0.16, m, 0.14)); strings(out, t, [43, 55], 2, 0.06); break;
    case 'defeat': [57, 53, 50, 45].forEach((m, i) => pianoNote(out, t + i * 0.35, m, 0.14, 2.4)); break;
    default: break;
  }
}

function stepSound(out, t, surface, v) {
  switch (surface) {
    case 'wood': woodKnock(out, t, 0.9, 0.35 * v, 0.06); nz(out, t, { type: 'pink', dur: 0.03, peak: 0.08 * v, bp: 2000 }); break;
    case 'gravel': for (let i = 0; i < 6; i++) nz(out, t + i * 0.008 + Math.random() * 0.02, { dur: 0.012, peak: 0.16 * v, bp: 2500 + Math.random() * 3000, q: 3 }); break;
    case 'hard': nz(out, t, { dur: 0.02, peak: 0.18 * v, bp: 1800, q: 1.5 }); osc(out, t, { f: 120, fTo: 70, sweep: 0.04, dur: 0.04, peak: 0.12 * v }); break;
    case 'dirt': nz(out, t, { type: 'brown', dur: 0.06, peak: 0.35 * v, lp: 700 }); nz(out, t, { dur: 0.03, peak: 0.05 * v, hp: 2500 }); break;
    default: // grass: soft crush + blade rustle
      nz(out, t, { type: 'pink', dur: 0.08, a: 0.01, peak: 0.2 * v, bp: 3200, q: 0.8 });
      nz(out, t, { type: 'brown', dur: 0.05, peak: 0.2 * v, lp: 400 });
  }
}

function carSound(out, t, v = 1) {
  const o = ctx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(32, t); o.frequency.linearRampToValueAtTime(58, t + 1.2); o.frequency.linearRampToValueAtTime(44, t + 2);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(250, t); f.frequency.linearRampToValueAtTime(700, t + 1.2); f.frequency.linearRampToValueAtTime(400, t + 2);
  const g = ctx.createGain(); env(g, t, 0.3, 0.22 * v, 0.6, 1.2);
  o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 3);
  nz(out, t, { type: 'brown', dur: 1.6, a: 0.3, peak: 0.3 * v, lp: 300 });
  if (v >= 0.5) { woodKnock(out, t, 0.6, 0.15, 0.08); metalClick(out, t + 0.01, 0.6, 0.08, 0.05); } // door slam
}

function phoneRing(out, t) {
  // Two electromechanical bells struck ~20 times a second, ring twice.
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 18; i++) {
      const tt = t + r * 1.2 + i * 0.05;
      modal(out, tt, i % 2 ? [[1180, 1], [3240, 0.45], [6100, 0.2]] : [[1320, 1], [3610, 0.45], [6900, 0.2]], { q: 45, peak: 0.16, dur: 0.12 });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Instruments (rendered to buffers and cached)                        */
/* ------------------------------------------------------------------ */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const instCache = {};

/** Karplus-Strong plucked string, tuned with a first-order allpass. */
function ksBuffer(midi, { dur = 2.2, damp = 0.996, bright = 0.5, body = true } = {}) {
  const key = `ks${midi}_${damp}_${bright}_${dur}`;
  if (instCache[key]) return instCache[key];
  const sr = ctx.sampleRate, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const period = sr / mtof(midi);
  const N = Math.max(2, Math.floor(period - 0.5));
  const frac = period - 0.5 - N;
  const C = (1 - frac) / (1 + frac);
  const line = new Float32Array(N);
  let lp = 0;
  for (let i = 0; i < N; i++) { const r = Math.random() * 2 - 1; lp += bright * (r - lp); line[i] = lp; }
  let idx = 0, apX = 0, apY = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const nxt = (idx + 1) % N;
    const avg = damp * 0.5 * (cur + line[nxt]);
    const y = C * avg + apX - C * apY;
    apX = avg; apY = y;
    line[idx] = y;
    d[i] = cur;
    idx = nxt;
  }
  if (body) { // gentle wooden body resonance around 110 Hz
    let y1 = 0, y2 = 0;
    const w = 2 * Math.PI * 110 / sr, r = 0.995, c1 = 2 * r * Math.cos(w), c2 = r * r;
    for (let i = 0; i < n; i++) { const y = d[i] * 0.02 + c1 * y1 - c2 * y2; y2 = y1; y1 = y; d[i] = d[i] * 0.9 + y * 0.5; }
  }
  normalise(d);
  instCache[key] = buf;
  return buf;
}

function normalise(d) {
  let mx = 0;
  for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > mx) mx = v; }
  if (mx > 0) { const k = 1 / mx; for (let i = 0; i < d.length; i++) d[i] *= k; }
}

/** Additive piano tone: inharmonic partials, two-stage decay, detuned unison, hammer thump. */
function pianoBuffer(midi, dur = 2.6) {
  const key = `pn${midi}_${dur}`;
  if (instCache[key]) return instCache[key];
  const sr = ctx.sampleRate, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const f = mtof(midi), B = 0.00035;
  for (let k = 1; k <= 12; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > sr / 2.2) break;
    const amp = Math.pow(k, -1.15) * (k === 1 ? 1 : 0.8);
    const dec = 1.2 + k * 0.9 + midi / 30;
    const rFast = Math.exp(-dec / sr), rSlow = Math.exp(-dec * 0.25 / sr);
    // sine recurrences for two slightly detuned strings
    const w1 = 2 * Math.PI * fk / sr, w2 = 2 * Math.PI * fk * 1.0007 / sr;
    const c1 = 2 * Math.cos(w1), c2 = 2 * Math.cos(w2);
    let a1 = 0, b1 = Math.sin(-w1), a2 = 0, b2 = Math.sin(-w2);
    let eF = 0.7, eS = 0.3;
    for (let i = 0; i < n; i++) {
      const s1 = c1 * a1 - b1; b1 = a1; a1 = s1;
      const s2 = c2 * a2 - b2; b2 = a2; a2 = s2;
      d[i] += amp * (eF + eS) * (s1 + 0.6 * s2);
      eF *= rFast; eS *= rSlow;
    }
  }
  const hl = Math.floor(sr * 0.01);
  for (let i = 0; i < Math.min(n, hl); i++) d[i] += (Math.random() * 2 - 1) * 0.3 * (1 - i / hl);
  normalise(d);
  const fade = Math.floor(sr * 0.05);
  for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  instCache[key] = buf;
  return buf;
}

// Notes are rendered ahead of time, a couple per frame, so nothing hitches.
const renderQueue = [];
function queueRender(fn) { renderQueue.push(fn); }
function queueSongNotes(mode) {
  const song = SONGS[mode];
  if (!song) return;
  const notes = new Set();
  for (const [root, chord] of song.bars) { notes.add(root); notes.add(root + 12); for (const m of chord) { notes.add(m); notes.add(m + 12); } }
  for (const [, m] of song.melody) notes.add(m);
  for (const m of notes) {
    if (mode === 'night' || mode === 'tense') queueRender(() => pianoBuffer(m));
    queueRender(() => ksBuffer(m, { bright: 0.55, damp: 0.996 }));
    queueRender(() => ksBuffer(m, { bright: 0.25, damp: 0.997, dur: 2.5 }));
  }
}

function playBuf(out, t, buf, peak, { rate = 1, lp = 0, len = 0 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const g = ctx.createGain(); g.gain.value = peak;
  let node = src;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  node.connect(g); g.connect(out);
  if (len) { g.gain.setValueAtTime(peak, t + len); g.gain.setTargetAtTime(0.0001, t + len, 0.08); }
  src.start(t);
}
const guitarNote = (out, t, m, v = 0.3, len = 0) => playBuf(out, t, ksBuffer(m, { bright: 0.55, damp: 0.996 }), v, { lp: 5000, len });
const bassNote = (out, t, m, v = 0.4, len = 0) => playBuf(out, t, ksBuffer(m, { bright: 0.25, damp: 0.997, dur: 2.5 }), v, { lp: 900, len });
const pianoNote = (out, t, m, v = 0.25, len = 0) => playBuf(out, t, pianoBuffer(m), v, { len });

/** Bowed-string ensemble pad (detuned saws, slow attack, vibrato). */
function strings(out, t, notes, dur, peak) {
  for (const m of notes) for (const det of [-7, 0, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5 + Math.random(); const lg = ctx.createGain(); lg.gain.value = 3;
    lfo.connect(lg); lg.connect(o.detune);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
    const g = ctx.createGain(); env(g, t, dur * 0.35, peak / 3, dur * 0.5, dur * 0.2);
    o.connect(f); f.connect(g); g.connect(out);
    o.start(t); lfo.start(t); o.stop(t + dur * 1.6); lfo.stop(t + dur * 1.6);
  }
}

function kick(out, t, v = 0.9) {
  osc(out, t, { f: 130, fTo: 42, sweep: 0.09, dur: 0.28, peak: v, a: 0.001 });
  nz(out, t, { dur: 0.01, peak: v * 0.4, lp: 3000 });
}
function snare(out, t, v = 0.5) {
  modal(out, t, [[185, 1], [330, 0.6]], { q: 6, peak: v * 1.4, dur: 0.08, exc: 0.005 });
  nz(out, t, { dur: 0.18, peak: v, hp: 1800, bp: 0 });
}
function hat(out, t, v = 0.12, open = false) {
  nz(out, t, { dur: open ? 0.18 : 0.035, peak: v, hp: 7500 });
  modal(out, t, [[8300, 1], [10400, 0.7]], { q: 20, peak: v * 0.5, dur: open ? 0.15 : 0.03 });
}
function brush(out, t, v = 0.08) { nz(out, t, { type: 'pink', dur: 0.12, a: 0.03, peak: v, bp: 4000, q: 0.6 }); }

/* ------------------------------------------------------------------ */
/* Music: step sequencer playing the instruments above                 */
/* ------------------------------------------------------------------ */
let seqStep = 0, seqNext = 0;
let musicOut = null, musicLoop = null;

function getMusicOut() {
  if (!musicOut) { musicOut = ctx.createGain(); musicOut.gain.value = 1; musicOut.connect(musicBus); musicOut.connect(musicSend); }
  return musicOut;
}

const SONGS = {
  // Fingerpicked folk guitar with upright bass (G - Em - C - D)
  day: { bpm: 92, bars: [[43, [55, 59, 62, 67, 71]], [40, [52, 55, 59, 64, 67]], [48, [55, 60, 64, 67, 72]], [50, [54, 57, 62, 66, 69]]],
    melody: [[0, 74], [3, 71], [4, 72], [6, 74], [8, 76], [12, 74], [16, 71], [19, 67], [20, 69], [24, 71], [28, 67], [32, 72], [35, 71], [36, 69], [40, 67], [44, 64], [48, 66], [52, 69], [56, 67], [60, 62]] },
  // Sparse piano with soft strings (Am - F - C - G)
  night: { bpm: 66, bars: [[45, [57, 60, 64, 69]], [41, [57, 60, 65, 69]], [48, [55, 60, 64, 67]], [43, [55, 59, 62, 67]]],
    melody: [[0, 76], [6, 72], [8, 74], [16, 72], [22, 69], [24, 71], [32, 67], [38, 69], [40, 72], [48, 74], [54, 71], [56, 67]] },
  // Driving drums, picked bass ostinato, low strings and piano stabs (Em)
  tense: { bpm: 126, bars: [[40, [52, 55, 59]], [40, [52, 55, 59]], [36, [48, 52, 55]], [38, [50, 54, 57]]], melody: [] },
};
SONGS.town = SONGS.day;

export function setMusic(mode) {
  if (mode === musicMode) return;
  musicMode = mode;
  seqStep = 0;
  if (!ctx) return;
  seqNext = ctx.currentTime + 0.2;
  queueSongNotes(mode);
  if (musicLoop) { const l = musicLoop; l.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); setTimeout(() => { try { l.src.stop(); } catch (e) { /* stopped */ } }, 2000); musicLoop = null; }
  if (musicSamples[mode]) startMusicLoop(mode);
}

function startMusicLoop(mode) {
  const src = ctx.createBufferSource(); src.buffer = musicSamples[mode]; src.loop = true;
  const g = ctx.createGain(); g.gain.value = 0.0001; g.gain.setTargetAtTime(0.8, ctx.currentTime, 0.6);
  src.connect(g); g.connect(musicBus); src.start();
  musicLoop = { src, g };
}

function scheduleStep(song, step, t) {
  const out = getMusicOut();
  const bars = song.bars.length;
  const bar = Math.floor(step / 16) % bars;
  const s16 = step % 16;
  const [root, chord] = song.bars[bar];
  const six = 60 / song.bpm / 4;
  const loopStep = step % (bars * 16);
  const human = () => (Math.random() - 0.5) * 0.012; // slight timing humanisation
  if (musicMode === 'tense') {
    const pat = [0, 0, 12, 0, 3, 0, 7, 0, 0, 0, 12, 0, 5, 0, 7, 3];
    if (s16 % 2 === 0) bassNote(out, t, root + pat[s16], 0.45, six * 1.8);
    if (s16 === 0 || s16 === 7 || s16 === 10) kick(out, t, 0.8);
    if (s16 === 4 || s16 === 12) snare(out, t + human(), 0.45);
    if (s16 % 2 === 0) hat(out, t + human(), s16 % 4 === 2 ? 0.1 : 0.06, s16 === 14);
    if (s16 === 0 && bar % 2 === 0) strings(out, t, [root + 12, root + 19], six * 30, 0.07);
    if (s16 === 0 && bar % 2 === 1) for (const m of chord) pianoNote(out, t, m + 12, 0.09, six * 3);
    return;
  }
  if (musicMode === 'night') {
    if (s16 === 0) { bassNote(out, t, root, 0.28); if (bar % 2 === 0) strings(out, t, [root + 12, chord[1] + 12], six * 30, 0.04); }
    const arp = { 0: 0, 3: 1, 6: 2, 8: 3, 11: 2, 14: 1 };
    if (arp[s16] !== undefined) pianoNote(out, t + human(), chord[arp[s16]], 0.26);
    for (const [at, m] of song.melody) if (at === loopStep) pianoNote(out, t + human(), m, 0.32);
    return;
  }
  // day / town: Travis-style fingerpicking
  if (s16 === 0 || s16 === 8) bassNote(out, t, root, 0.4);
  if (s16 === 4 || s16 === 12) guitarNote(out, t + human(), chord[0], 0.18);
  const pick = { 2: 2, 6: 3, 10: 2, 14: 4 };
  if (pick[s16] !== undefined) guitarNote(out, t + human(), chord[pick[s16]], 0.16);
  if (s16 % 4 === 0) brush(out, t, 0.03);
  for (const [at, m] of song.melody) if (at === loopStep) guitarNote(out, t + human(), m, 0.24);
}

/* ------------------------------------------------------------------ */
/* Ambience: continuous wind bed + scheduled events                    */
/* ------------------------------------------------------------------ */
let wind = null, rustle = null, crickets = null, traffic = null, fireBed = null;
let ambT = 0, birdT = 2, owlT = 20;

function loopNoise(type, filterType, freq, q) {
  const src = ctx.createBufferSource(); src.buffer = noise[type]; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); g.gain.value = 0;
  src.connect(f); f.connect(g); g.connect(ambBus);
  src.start(0, Math.random() * 3);
  return { src, f, g };
}

function cricketBuffer() {
  const sr = ctx.sampleRate, n = sr * 6;
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const crickets2 = [{ f: 4600, per: 0.85, off: 0.1 }, { f: 4250, per: 1.1, off: 0.5 }, { f: 4950, per: 0.7, off: 0.3 }];
    for (const k of crickets2) {
      const gain = c === (k.f > 4500 ? 0 : 1) ? 1 : 0.45;
      for (let start = k.off; start < 6 - 0.2; start += k.per * (0.9 + Math.random() * 0.2)) {
        for (let p = 0; p < 3; p++) {
          const s0 = Math.floor((start + p * 0.045) * sr), len = Math.floor(0.022 * sr);
          for (let i = 0; i < len && s0 + i < n; i++) {
            const e = Math.sin(Math.PI * i / len);
            d[s0 + i] += Math.sin(2 * Math.PI * k.f * (s0 + i) / sr) * e * 0.18 * gain * (1 + 0.3 * Math.sin(2 * Math.PI * 120 * i / sr));
          }
        }
      }
    }
  }
  return buf;
}

function startAmbienceBeds() {
  wind = loopNoise('brown', 'bandpass', 380, 0.6);
  rustle = loopNoise('pink', 'highpass', 3500, 0.5);
  traffic = loopNoise('brown', 'lowpass', 220, 0.7);
  fireBed = loopNoise('pink', 'bandpass', 700, 0.6);
  const src = ctx.createBufferSource(); src.buffer = cricketBuffer(); src.loop = true;
  const g = ctx.createGain(); g.gain.value = 0; src.connect(g); g.connect(ambBus); src.start();
  crickets = { src, g };
}

export function setAmbient(mode) { ambMode = mode; }
/** Intensity (0..1) and stereo position of nearby fire, for the crackle bed. */
export function setFireLevel(level, pan = 0) { fireLevel = level; firePan = pan; }

function bird(t) {
  const out = voiceOut({ vol: 0.5, verb: 1.6 });
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  let dest = out;
  if (pan) { pan.pan.value = (Math.random() - 0.5) * 1.6; pan.connect(out); dest = pan; }
  const sp = Math.floor(Math.random() * 3);
  const chirp = (tt, f0, f1, dur, peak) => {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, tt); o.frequency.exponentialRampToValueAtTime(f1, tt + dur);
    const h = ctx.createOscillator(); h.type = 'sine'; h.frequency.setValueAtTime(f0 * 2, tt); h.frequency.exponentialRampToValueAtTime(f1 * 2, tt + dur);
    const g = ctx.createGain(); env(g, tt, dur * 0.2, peak, dur * 0.8);
    const hg = ctx.createGain(); hg.gain.value = 0.15;
    o.connect(g); h.connect(hg); hg.connect(g); g.connect(dest);
    o.start(tt); h.start(tt); o.stop(tt + dur * 2); h.stop(tt + dur * 2);
  };
  if (sp === 0) { // warbler: a run of quick varied notes
    let tt = t; const n = 4 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) { const f = 2600 + Math.random() * 1800; chirp(tt, f, f * (0.8 + Math.random() * 0.5), 0.05 + Math.random() * 0.05, 0.05); tt += 0.07 + Math.random() * 0.05; }
  } else if (sp === 1) { // "fee-bee" whistle
    chirp(t, 4100, 4000, 0.32, 0.045); chirp(t + 0.42, 3500, 3420, 0.3, 0.04);
  } else { // sparrow trill
    for (let i = 0; i < 9; i++) chirp(t + i * 0.045, 5200, 4300, 0.03, 0.03);
  }
}

function owl(t) {
  const out = voiceOut({ vol: 0.35, verb: 2 });
  for (const [dt, f, d] of [[0, 410, 0.18], [0.5, 400, 0.12], [0.7, 395, 0.5]]) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f * 1.05, t + dt); o.frequency.exponentialRampToValueAtTime(f * 0.95, t + dt + d);
    const g = ctx.createGain(); env(g, t + dt, 0.06, 0.12, d * 0.7, d * 0.3);
    o.connect(g); g.connect(out); o.start(t + dt); o.stop(t + dt + d * 2);
  }
}

/** Called every frame; schedules music, ambience and the wind's slow gusting. */
export function updateAudio(dt) {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  // Pre-render a few instrument notes per frame
  for (let i = 0; i < 2 && renderQueue.length; i++) renderQueue.shift()();
  // Music
  const song = SONGS[musicMode];
  if (song && !musicSamples[musicMode]) {
    if (seqNext < now) seqNext = now + 0.05;
    const six = 60 / song.bpm / 4;
    while (seqNext < now + 0.25) { scheduleStep(song, seqStep, seqNext); seqStep++; seqNext += six; }
  }
  if (!wind) return;
  // Ambience beds (target levels per mode, with slow gusts)
  ambT += dt;
  const gust = 0.6 + 0.4 * Math.sin(ambT * 0.23) * Math.sin(ambT * 0.071 + 1.3);
  const night = ambMode === 'night', town = ambMode === 'town', off = ambMode === 'off';
  const tc = 0.6;
  wind.g.gain.setTargetAtTime(off ? 0 : (night ? 0.1 : 0.14) * gust, now, tc);
  wind.f.frequency.setTargetAtTime(250 + 350 * gust, now, tc);
  rustle.g.gain.setTargetAtTime(off || town ? 0.004 : 0.03 * gust * gust, now, tc);
  traffic.g.gain.setTargetAtTime(town ? 0.08 : 0, now, tc);
  crickets.g.gain.setTargetAtTime(night ? 0.22 : 0, now, 1.2);
  fireBed.g.gain.setTargetAtTime(0.25 * fireLevel, now, 0.3);
  if (fireLevel > 0.02 && Math.random() < fireLevel * 0.5) sfx('fire', { vol: fireLevel, verb: 0.5 });
  void firePan;
  // Scheduled wildlife
  birdT -= dt;
  if (birdT <= 0) {
    if (ambMode === 'day' || ambMode === 'town') bird(now + 0.05);
    birdT = ambMode === 'town' ? 4 + Math.random() * 7 : 1.5 + Math.random() * 4;
  }
  owlT -= dt;
  if (owlT <= 0) { if (night) owl(now + 0.05); owlT = 25 + Math.random() * 40; }
}

/** Debug/test helper: peak level of the master bus over the last frame. */
export function audioDebug() {
  return ctx ? { state: ctx.state, cached: Object.keys(instCache).length, samples: Object.keys(samples).length } : null;
}
