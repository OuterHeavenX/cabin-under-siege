// The world going on around Frank: grass moving in the wind, cloud shadows
// sliding over the land, birds that scatter when you get close, rabbits and
// squirrels, butterflies, ducks on the water, and traffic on town roads.
// All of it is decoration — it never blocks movement, sight or bullets — and
// it thins out on the low graphics setting.
import { G } from '../game/state.js';
import { TILE } from '../config.js';
import { GR, SO } from './map.js';
import { hash2, dist } from '../util.js';
import { darkness } from './lights.js';
import { seasonId } from '../game/season-core.js';
import { lowQuality } from '../game/difficulty.js';

const day = () => darkness() < 0.45;
const quietTime = () => !G.siegeActive && !G.assault && !(G.ksNight && G.ksNight.alarm);
/** One wind for everything: a slow direction change and gusts that roll across the map. */
export function wind(t = G.time) {
  const a = 0.35 + Math.sin(t * 0.021) * 0.5;
  return { dx: Math.cos(a), dy: Math.sin(a) * 0.4, gust: 0.6 + 0.4 * Math.sin(t * 0.17) };
}

/* ---------------- grass and flowers in the wind ---------------- */
const TUFT = {
  spring: ['#5a9238', '#6aa440', '#4c8430'], summer: ['#64923a', '#74a042', '#577f32'],
  autumn: ['#7a823a', '#8a8240', '#667234'], winter: null,
};
const FLOWERS = { spring: ['#f4f0f8', '#f4d84a', '#c88ad8', '#f29ab8'], summer: ['#f4d84a', '#ffffff', '#e86a4a'], autumn: ['#c88a3a'], winter: null };
export function drawGrass(ctx, m, cx0, cy0, cx1, cy1, t) {
  const sid = seasonId();
  const cols = TUFT[sid];
  if (!cols) return;
  const lq = lowQuality();
  const w = wind(t);
  ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const i = m.idx(cx, cy);
    if (m.ground[i] !== GR.GRASS || m.solid[i] !== SO.NONE) continue;
    const h = hash2(cx * 7 + 3, cy * 11 + 5);
    if (h > (lq ? 0.16 : 0.45)) continue;
    const x = cx * TILE + 4 + hash2(cx, cy * 3) * 24, y = cy * TILE + 6 + hash2(cx * 3, cy) * 22;
    // A gust is a wave travelling with the wind; each tuft leans as it passes.
    const phase = (x * w.dx + y * w.dy) * 0.012 - t * 1.6;
    const lean = (Math.sin(phase) * 0.6 + 0.4) * w.gust * 4.5;
    ctx.strokeStyle = cols[Math.floor(h * 97) % cols.length];
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const bx = x + (k - 1.5) * 2.2, len = 4.5 + hash2(cx + k, cy - k) * 4;
      ctx.moveTo(bx, y);
      ctx.quadraticCurveTo(bx + lean * 0.4 * w.dx, y - len * 0.6, bx + lean * w.dx + (k - 1.5) * 1.2, y - len + Math.abs(lean) * 0.2);
    }
    ctx.stroke();
    const fl = FLOWERS[sid];
    if (fl && h < 0.07) { ctx.fillStyle = fl[Math.floor(h * 1000) % fl.length]; ctx.beginPath(); ctx.arc(x + lean * w.dx, y - 9, 1.8, 0, Math.PI * 2); ctx.fill(); }
  }
}

/* ---------------- critters ---------------- */
// kinds: bird (perched, pecks, flies off), rabbit, squirrel, duck, butterfly
let critters = [], spawnT = 0, mapId = null;
const near = (c, r) => G.player && dist(c.x, c.y, G.player.x, G.player.y) < r;
function openCell(m, kind) {
  const p = G.player;
  for (let tries = 0; tries < 30; tries++) {
    const a = Math.random() * Math.PI * 2, r = (6 + Math.random() * 12) * TILE;
    const x = p.x + Math.cos(a) * r, y = p.y + Math.sin(a) * r;
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    if (!m.inBounds(cx, cy)) continue;
    const i = m.idx(cx, cy), gt = m.ground[i], so = m.solid[i];
    if (kind === 'duck') { if (so === SO.WATER && seasonId() !== 'winter') return { x, y }; continue; }
    if (so !== SO.NONE || m.buildingAt(x, y)) continue;
    if (kind === 'squirrel') { let tree = false; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (m.trees.has(m.idx(cx + ox, cy + oy))) tree = true; if (!tree) continue; }
    if (gt === GR.GRASS || gt === GR.DIRT || (kind === 'bird' && (gt === GR.SIDEWALK || gt === GR.GRAVEL))) return { x, y };
  }
  return null;
}
function spawnCritter(m) {
  const sid = seasonId();
  const town = m.trees.size < 25;
  const want = [];
  if (day()) {
    want.push('bird', 'bird');
    if (!town && sid !== 'winter') want.push('rabbit', 'squirrel');
    if (sid === 'spring' || sid === 'summer') want.push('butterfly', 'butterfly');
    want.push('duck'); // only spawns if there's open water nearby
  }
  if (!want.length) return;
  const kind = want[Math.floor(Math.random() * want.length)];
  if (critters.filter((c) => c.kind === kind).length >= ({ bird: 5, rabbit: 2, squirrel: 2, butterfly: 4, duck: 3 })[kind]) return;
  const at = openCell(m, kind);
  if (!at) return;
  const n = kind === 'bird' ? 1 + Math.floor(Math.random() * 3) : kind === 'duck' ? 1 + Math.floor(Math.random() * 2) : 1;
  for (let k = 0; k < n; k++) critters.push({ kind, x: at.x + k * 9, y: at.y + (k % 2) * 7, a: Math.random() * Math.PI * 2, t: Math.random() * 3, state: 'idle', vx: 0, vy: 0, life: 0, s: Math.random() * 10, fly: 0 });
}
export function updateCritters(dt) {
  const m = G.map;
  if (!m || G.endless) { critters = []; return; }
  if (m.id !== mapId) { critters = []; mapId = m.id; }
  spawnT -= dt;
  if (spawnT <= 0 && quietTime()) { spawnT = lowQuality() ? 6 : 2.5; spawnCritter(m); }
  const scare = !quietTime();
  for (const c of critters) {
    c.t -= dt; c.life += dt;
    if (c.kind === 'bird') {
      if (c.state !== 'fly' && (near(c, 110) || scare)) { c.state = 'fly'; const a = Math.atan2(c.y - G.player.y, c.x - G.player.x) + (Math.random() - 0.5); c.vx = Math.cos(a) * 170; c.vy = Math.sin(a) * 170 - 60; }
      if (c.state === 'fly') { c.x += c.vx * dt; c.y += c.vy * dt; c.fly += dt; c.gone = c.fly > 4; }
      else if (c.t <= 0) { c.t = 0.6 + Math.random() * 1.8; if (Math.random() < 0.5) { c.a += (Math.random() - 0.5) * 2; c.x += Math.cos(c.a) * 6; c.y += Math.sin(c.a) * 6; } c.peck = 0.3; }
      c.peck = Math.max(0, (c.peck || 0) - dt);
    } else if (c.kind === 'rabbit' || c.kind === 'squirrel') {
      if (c.state !== 'flee' && (near(c, c.kind === 'rabbit' ? 150 : 110) || scare)) { c.state = 'flee'; c.a = Math.atan2(c.y - G.player.y, c.x - G.player.x); }
      const sp = c.state === 'flee' ? (c.kind === 'rabbit' ? 190 : 150) : 0;
      if (c.state === 'flee') { c.x += Math.cos(c.a) * sp * dt; c.y += Math.sin(c.a) * sp * dt; c.hop = (c.hop || 0) + dt * 14; c.gone = !near(c, 700); }
      else if (c.t <= 0) { c.t = 1 + Math.random() * 3; c.a += (Math.random() - 0.5) * 2.5; c.step = 0.25; }
      if (c.step > 0) { c.step -= dt; c.x += Math.cos(c.a) * 40 * dt; c.y += Math.sin(c.a) * 40 * dt; c.hop = (c.hop || 0) + dt * 14; }
      const cx = Math.floor(c.x / TILE), cy = Math.floor(c.y / TILE);
      if (!m.inBounds(cx, cy) || (m.solid[m.idx(cx, cy)] !== SO.NONE && c.state !== 'flee')) { c.a += Math.PI; c.step = 0; }
    } else if (c.kind === 'butterfly') {
      c.a += (Math.random() - 0.5) * 4 * dt;
      c.x += Math.cos(c.a) * 28 * dt; c.y += Math.sin(c.a) * 28 * dt;
      c.gone = c.life > 40 || !near(c, 900);
    } else if (c.kind === 'duck') {
      if (c.t <= 0) { c.t = 2 + Math.random() * 4; c.a += (Math.random() - 0.5) * 1.6; }
      const nx = c.x + Math.cos(c.a) * 12 * dt, ny = c.y + Math.sin(c.a) * 12 * dt;
      const cx = Math.floor(nx / TILE), cy = Math.floor(ny / TILE);
      if (m.inBounds(cx, cy) && m.solid[m.idx(cx, cy)] === SO.WATER) { c.x = nx; c.y = ny; } else c.a += Math.PI * 0.7;
      if (near(c, 90) && !c.fled) { c.fled = true; c.a = Math.atan2(c.y - G.player.y, c.x - G.player.x); c.t = 3; }
      if (seasonId() === 'winter') c.gone = true;
    }
    if (!near(c, 1100)) c.gone = true;
  }
  critters = critters.filter((c) => !c.gone);
}
/** Ground-level critters (before trees and people). */
export function drawCritters(ctx, inView, t) {
  for (const c of critters) {
    if (!inView(c.x, c.y) || c.kind === 'butterfly' || (c.kind === 'bird' && c.state === 'fly')) continue;
    ctx.save(); ctx.translate(c.x, c.y);
    if (c.kind === 'bird') {
      ctx.rotate(c.a);
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(1, 2, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a2622'; ctx.beginPath(); ctx.ellipse(0, 0, 4, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(c.peck > 0 ? 4.5 : 3.5, 0, 1.7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d8a030'; ctx.fillRect(c.peck > 0 ? 6 : 5, -0.5, 1.6, 1);
    } else if (c.kind === 'rabbit' || c.kind === 'squirrel') {
      const hop = Math.abs(Math.sin(c.hop || 0)) * 2.5;
      ctx.rotate(c.a);
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(0, 2, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.translate(0, -hop);
      if (c.kind === 'rabbit') {
        ctx.fillStyle = '#8a7058'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(5.5, 0, 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#a88a70'; ctx.fillRect(5, -3.6, 4, 1.4); ctx.fillRect(5, 2.2, 4, 1.4);
        ctx.fillStyle = '#f0ece4'; ctx.beginPath(); ctx.arc(-6, 0, 1.6, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#7a6a5e'; ctx.beginPath(); ctx.ellipse(0, 0, 4.5, 2.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(4, 0, 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#8a7a6c'; ctx.beginPath(); ctx.ellipse(-6, Math.sin(t * 6 + c.s) * 1.5, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else if (c.kind === 'duck') {
      ctx.rotate(c.a);
      ctx.strokeStyle = 'rgba(220,240,250,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-14, -6); ctx.moveTo(-6, 3); ctx.lineTo(-14, 6); ctx.stroke();
      ctx.fillStyle = '#6a5a3e'; ctx.beginPath(); ctx.ellipse(0, 0, 6, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = (c.s | 0) % 2 ? '#2f6a3a' : '#7a6a4e'; ctx.beginPath(); ctx.arc(4.5, 0, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e0a830'; ctx.fillRect(6.5, -0.7, 2.4, 1.4);
    }
    ctx.restore();
  }
}
/** Things in the air (after roofs): birds taking off, flocks overhead, butterflies. */
let flock = null, flockT = 8;
export function drawAir(ctx, inView, t, vx0, vy0, vx1, vy1) {
  const dt = G.frameDt || 1 / 60;
  const flap = (x, y, s, ph, col) => { const w = Math.sin(ph) * 3 * s; ctx.strokeStyle = col; ctx.lineWidth = 1.6 * s; ctx.beginPath(); ctx.moveTo(x - 6 * s, y - w); ctx.quadraticCurveTo(x - 2 * s, y - 2 * s, x, y); ctx.quadraticCurveTo(x + 2 * s, y - 2 * s, x + 6 * s, y - w); ctx.stroke(); };
  for (const c of critters) {
    if (!inView(c.x, c.y, 80)) continue;
    if (c.kind === 'bird' && c.state === 'fly') {
      const lift = Math.min(1, c.fly);
      ctx.globalAlpha = 0.25 * (1 - lift * 0.6); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(c.x + lift * 25, c.y + lift * 35, 3, 1.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; flap(c.x, c.y, 0.8 + lift * 0.4, t * 22 + c.s, '#2a2622');
    }
    if (c.kind === 'butterfly') {
      const w = Math.abs(Math.sin(t * 14 + c.s)) * 3.5;
      ctx.fillStyle = ['#f4f0d8', '#f4c84a', '#e8885a', '#a8c8f0'][Math.floor(c.s) % 4];
      ctx.beginPath(); ctx.ellipse(c.x - 2, c.y, w, 2.6, 0, 0, Math.PI * 2); ctx.ellipse(c.x + 2, c.y, w, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // A flock crossing high overhead now and then, with its shadow far below.
  if (!flock && day() && !G.endless) { flockT -= dt; if (flockT <= 0) { flockT = 25 + Math.random() * 40; const fromLeft = Math.random() < 0.5; flock = { x: fromLeft ? vx0 - 80 : vx1 + 80, y: vy0 + (vy1 - vy0) * (0.15 + Math.random() * 0.6), vx: (fromLeft ? 1 : -1) * (120 + Math.random() * 40), vy: (Math.random() - 0.5) * 30, n: 4 + Math.floor(Math.random() * 5), s: Math.random() * 9 }; } }
  if (flock) {
    flock.x += flock.vx * dt; flock.y += flock.vy * dt;
    for (let k = 0; k < flock.n; k++) {
      const off = (k % 2 ? 1 : -1) * Math.ceil(k / 2), bx = flock.x - Math.sign(flock.vx) * Math.abs(off) * 16, by = flock.y + off * 12;
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.beginPath(); ctx.ellipse(bx + 70, by + 110, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
      flap(bx, by, 1.1, t * 9 + k + flock.s, 'rgba(30,26,22,0.85)');
    }
    if (flock.x < vx0 - 400 || flock.x > vx1 + 400) flock = null;
  }
}

/* ---------------- cloud shadows ---------------- */
let cloudSprite = null, clouds = null;
function makeCloud() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let k = 0; k < 9; k++) {
    const x = 70 + Math.random() * 116, y = 80 + Math.random() * 96, r = 40 + Math.random() * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(10,20,40,0.55)'); gr.addColorStop(0.6, 'rgba(10,20,40,0.3)'); gr.addColorStop(1, 'rgba(10,20,40,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return c;
}
export function drawCloudShadows(ctx, m, t) {
  if (lowQuality() || !day() || (G.rainLevel || 0) > 0.3 || (G.fogLevel || 0) > 0.3 || (G.snowLevel || 0) > 0.3) return;
  if (!cloudSprite) cloudSprite = makeCloud();
  const W = m.w * TILE, H = m.h * TILE;
  if (!clouds || clouds.map !== m.id) clouds = { map: m.id, list: Array.from({ length: Math.max(4, Math.round((W * H) / 1.1e6)) }, (_, i) => ({ x: hash2(i, 7) * W, y: hash2(7, i) * H, s: 2.4 + hash2(i, i + 3) * 2.2, a: 0.32 + hash2(i + 9, 2) * 0.14 })) };
  const w = wind(t);
  const fade = 1 - darkness() / 0.45;
  for (const c of clouds.list) {
    const size = 256 * c.s;
    const x = ((c.x + t * 14 * w.dx) % (W + size) + (W + size)) % (W + size) - size / 2;
    const y = ((c.y + t * 14 * w.dy) % (H + size) + (H + size)) % (H + size) - size / 2;
    ctx.globalAlpha = c.a * fade;
    ctx.drawImage(cloudSprite, x - size / 2, y - size / 2, size, size);
  }
  ctx.globalAlpha = 1;
}

/* ---------------- traffic on town roads ---------------- */
let cars = [], carT = 4, lanes = null;
const CAR_COLS = ['#8c2f2f', '#2f4a8c', '#d8d4c8', '#3a3a3e', '#4a6a3a', '#b8a050', '#6a2a5a'];
function findLanes(m) {
  const out = [];
  for (let cy = 0; cy < m.h; cy++) {
    let run = 0;
    for (let cx = 0; cx < m.w; cx++) run = m.ground[m.idx(cx, cy)] === GR.ROAD ? run + 1 : 0;
    if (run >= Math.min(30, m.w - 4)) out.push(cy);
  }
  // Group rows into roads; use the top row of each road eastbound and the bottom row westbound.
  const roads = [];
  for (const r of out) { const last = roads[roads.length - 1]; if (last && r === last[1] + 1) last[1] = r; else roads.push([r, r]); }
  return roads.filter(([a, b]) => b - a >= 1).map(([a, b]) => ({ east: (a + 0.9) * TILE, west: (b + 0.1) * TILE }));
}
export function updateTraffic(dt) {
  const m = G.map;
  if (!m || G.endless || G.prequel || !quietTime()) { cars = []; return; }
  if (!lanes || lanes.map !== m.id) { lanes = { map: m.id, list: findLanes(m) }; cars = []; }
  if (!lanes.list.length) return;
  const h = G.s.time.minute / 60;
  carT -= dt;
  if (carT <= 0 && h >= 6 && h < 23) {
    carT = 9 + Math.random() * 16;
    const road = lanes.list[Math.floor(Math.random() * lanes.list.length)], east = Math.random() < 0.5;
    const W = m.w * TILE;
    cars.push({ x: east ? -80 : W + 80, y: east ? road.east : road.west, dir: east ? 1 : -1, sp: 95 + Math.random() * 50, col: CAR_COLS[Math.floor(Math.random() * CAR_COLS.length)], model: ['sedan', 'sedan', 'suv', 'pickup', 'hatch', 'muscle'][Math.floor(Math.random() * 6)] });
  }
  const p = G.player;
  for (const c of cars) {
    // Don't run anybody over: wait for whoever's standing in the lane ahead.
    const ahead = [p, ...G.npcs].some((e) => e && Math.abs(e.y - c.y) < 34 && (e.x - c.x) * c.dir > 0 && (e.x - c.x) * c.dir < 90);
    const blocked = ahead || cars.some((o) => o !== c && o.dir === c.dir && Math.abs(o.y - c.y) < 4 && (o.x - c.x) * c.dir > 0 && (o.x - c.x) * c.dir < 110);
    c.v = Math.max(0, Math.min(c.sp, (c.v ?? c.sp) + (blocked ? -400 : 120) * dt));
    c.x += c.v * c.dir * dt;
  }
  cars = cars.filter((c) => c.x > -200 && c.x < m.w * TILE + 200);
}
export function drawTraffic(ctx, inView, drawCar) {
  const lights = darkness() > 0.4;
  for (const c of cars) {
    if (!inView(c.x, c.y, 120)) continue;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.dir > 0 ? 0 : Math.PI);
    drawCar(ctx, 0, 0, c.col, false, lights, c.model);
    ctx.restore();
    if (lights) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gx = c.x + c.dir * 70, g = ctx.createRadialGradient(gx, c.y, 4, gx, c.y, 70); g.addColorStop(0, 'rgba(255,240,190,0.35)'); g.addColorStop(1, 'rgba(255,240,190,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, c.y, 70, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  }
}

export function updateAmbient(dt) { updateCritters(dt); updateTraffic(dt); }
/** For the automated test. */
export const ambientState = () => ({ critters: critters.map((c) => ({ kind: c.kind, state: c.state })), cars: cars.length, lanes: lanes ? lanes.list.length : 0, flock: !!flock });

/** For the 3D view. */
export const critterList = () => critters;
export const trafficList = () => cars;
