// Noir atmosphere: weather (rain, fog), colour grading (cold nights, red during
// attacks), film grain, and damage that stays where it happened — bullet holes,
// blood, broken glass and scorch marks — until it's repaired or fades.
import { G } from '../game/state.js';
import { TILE } from '../config.js';
import { weather } from '../game/weather.js';
import { lowQuality } from '../game/difficulty.js';
import { setRain } from '../audio.js';

/* ---------------- lasting damage (decals) ---------------- */
const MAX_DECALS = 180;
const LIFE_DAYS = { hole: 12, blood: 3, glass: 99, scorch: 6 };

function decalList(mapId = G.map && G.map.id) {
  const w = G.s.world;
  if (!w.decals) w.decals = {};
  return w.decals[mapId] || (w.decals[mapId] = []);
}

export function addDecal(k, x, y, s = 1) {
  if (!G.s || !G.map) return;
  const list = decalList();
  // Don't stack identical marks on the same spot.
  if (list.some((d) => d.k === k && Math.abs(d.x - x) < 6 && Math.abs(d.y - y) < 6)) return;
  list.push({ k, x: Math.round(x), y: Math.round(y), r: Math.round(Math.random() * 628) / 100, s: Math.round(s * 100) / 100, d: G.s.time.day });
  if (list.length > MAX_DECALS) list.splice(0, list.length - MAX_DECALS);
}

/** Repairs clean up the mess around what was fixed. */
export function clearDecalsNear(x, y, r = 44) {
  const list = decalList();
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i];
    if ((d.k === 'glass' || d.k === 'hole') && (d.x - x) ** 2 + (d.y - y) ** 2 < r * r) list.splice(i, 1);
  }
}

export function initAtmosphere() {
  G.events.on('enemyKilled', (e) => { if (!e.def.vehicle) addDecal('blood', e.x, e.y + 2, 1 + Math.random() * 0.5); else addDecal('scorch', e.x, e.y, 2); });
  G.events.on('playerHurt', (x, y) => { if (Math.random() < 0.5) addDecal('blood', x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, 0.5); });
  G.events.on('bulletWall', (x, y) => addDecal('hole', x, y, 1));
  G.events.on('glass_break', (b) => { for (let i = 0; i < 3; i++) addDecal('glass', b.cx * TILE + 16 + (Math.random() - 0.5) * 30, b.cy * TILE + 16 + (Math.random() - 0.5) * 30, 0.8 + Math.random() * 0.4); });
  G.events.on('repaired', (t) => { if (t && t.cx != null) clearDecalsNear(t.cx * TILE + 16, t.cy * TILE + 16); });
  G.events.on('newDay', () => {
    if (!G.s.world.decals) return;
    for (const list of Object.values(G.s.world.decals)) {
      for (let i = list.length - 1; i >= 0; i--) if (G.s.time.day - list[i].d > (LIFE_DAYS[list[i].k] || 5)) list.splice(i, 1);
    }
  });
}

export function updateAtmosphere(dt) {
  // Fires leave scorch marks.
  for (const f of G.fires || []) if (!f.scorched && f.life < 2) { f.scorched = true; addDecal('scorch', f.x, f.y, 1.2); }
  const wk = G.s ? weather().kind : 'clear';
  const target = wk === 'rain' ? 1 : 0;
  G.rainLevel = (G.rainLevel || 0) + (target - (G.rainLevel || 0)) * Math.min(1, dt * 0.4);
  const fogT = wk === 'fog' ? 1 : 0;
  G.fogLevel = (G.fogLevel || 0) + (fogT - (G.fogLevel || 0)) * Math.min(1, dt * 0.3);
  const indoor = !!(G.player && G.map && G.map.buildingAt(G.player.x, G.player.y));
  setRain(G.paused ? 0 : G.rainLevel, indoor);
}

/** Ground layer: draw after the ground canvas, before characters. */
export function drawDecals(ctx, inView) {
  const list = (G.s.world.decals || {})[G.map.id];
  if (!list || !list.length) return;
  for (const d of list) {
    if (!inView(d.x, d.y)) continue;
    const age = Math.max(0, G.s.time.day - d.d);
    ctx.save();
    ctx.translate(d.x, d.y); ctx.rotate(d.r); ctx.scale(d.s, d.s);
    if (d.k === 'blood') {
      ctx.globalAlpha = Math.max(0.25, 0.75 - age * 0.15);
      ctx.fillStyle = age > 0 ? '#3d0a0a' : '#5e0b0b';
      ctx.beginPath(); ctx.ellipse(0, 0, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(8, 3, 3.5, 2.5, 0.4, 0, Math.PI * 2); ctx.ellipse(-7, -5, 2.5, 2, 0, 0, Math.PI * 2); ctx.ellipse(3, -8, 1.8, 1.5, 0, 0, Math.PI * 2); ctx.fill();
    } else if (d.k === 'hole') {
      ctx.fillStyle = 'rgba(15,10,8,0.85)'; ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(230,220,200,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let i = 0; i < 4; i++) { const a = i * 1.6; ctx.moveTo(Math.cos(a) * 2.5, Math.sin(a) * 2.5); ctx.lineTo(Math.cos(a) * 5, Math.sin(a) * 5); }
      ctx.stroke();
    } else if (d.k === 'glass') {
      ctx.fillStyle = 'rgba(190,225,240,0.75)';
      for (let i = 0; i < 6; i++) { const a = i * 1.1, r = 4 + (i * 7) % 9; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r); ctx.lineTo(Math.cos(a) * r + 2.5, Math.sin(a) * r + 1); ctx.lineTo(Math.cos(a) * r + 0.5, Math.sin(a) * r + 2.5); ctx.closePath(); ctx.fill(); }
    } else if (d.k === 'scorch') {
      ctx.globalAlpha = Math.max(0.2, 0.6 - age * 0.08);
      const g = ctx.createRadialGradient(0, 0, 2, 0, 0, 20);
      g.addColorStop(0, 'rgba(10,8,6,0.9)'); g.addColorStop(1, 'rgba(10,8,6,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

/* ---------------- screen-space weather + grading ---------------- */
let drops = null, splashes = [], grain = null, fogBanks = null;

function makeGrain() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** World-space weather (splashes, fog banks): call with the world transform set. */
export function drawWorldWeather(ctx, vx0, vy0, vx1, vy1, dt) {
  const rain = G.rainLevel || 0, fog = G.fogLevel || 0;
  if (rain > 0.05 && !lowQuality()) {
    const n = Math.round(rain * 6);
    for (let i = 0; i < n; i++) splashes.push({ x: vx0 + Math.random() * (vx1 - vx0), y: vy0 + Math.random() * (vy1 - vy0), t: 0 });
    ctx.strokeStyle = 'rgba(200,220,240,0.45)'; ctx.lineWidth = 0.8;
    for (const s of splashes) {
      s.t += dt;
      if (G.map.buildingAt(s.x, s.y)) { s.t = 9; continue; }
      const r = 1 + s.t * 14;
      ctx.globalAlpha = Math.max(0, 0.6 - s.t * 2);
      ctx.beginPath(); ctx.ellipse(s.x, s.y, r, r * 0.5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    splashes = splashes.filter((s) => s.t < 0.3);
  } else splashes.length = 0;
  if (fog > 0.03) {
    if (!fogBanks) fogBanks = Array.from({ length: 9 }, (_, i) => ({ ox: Math.random() * 2000, oy: Math.random() * 1400, r: 160 + Math.random() * 200, sp: 6 + Math.random() * 8, i }));
    const t = G.time;
    for (const b of fogBanks) {
      const w = vx1 - vx0 + 600, h = vy1 - vy0 + 600;
      const x = vx0 - 300 + ((b.ox + t * b.sp) % w + w) % w;
      const y = vy0 - 300 + ((b.oy + Math.sin(t * 0.05 + b.i) * 40) % h + h) % h;
      const g = ctx.createRadialGradient(x, y, 10, x, y, b.r);
      g.addColorStop(0, `rgba(170,175,180,${0.22 * fog})`); g.addColorStop(1, 'rgba(170,175,180,0)');
      ctx.fillStyle = g; ctx.fillRect(x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
  }
}

/** Screen-space grading, rain streaks, grain. Call with ctx in CSS-pixel space. */
export function drawScreenAtmosphere(ctx, w, h, dk, dt) {
  const lq = lowQuality();
  const rain = G.rainLevel || 0, fog = G.fogLevel || 0;
  const siege = !!G.siegeActive;
  const indoor = !!(G.player && G.map.buildingAt(G.player.x, G.player.y));
  // Cold night, overcast rain, grey fog.
  if (dk > 0.05) { ctx.fillStyle = `rgba(20,35,80,${0.12 * dk})`; ctx.fillRect(0, 0, w, h); }
  if (rain > 0.02) { ctx.fillStyle = `rgba(30,40,55,${0.16 * rain})`; ctx.fillRect(0, 0, w, h); }
  if (fog > 0.02) { ctx.fillStyle = `rgba(150,155,160,${(dk > 0.5 ? 0.08 : 0.16) * fog})`; ctx.fillRect(0, 0, w, h); }
  // Attacks run red.
  if (siege) {
    const pulse = 0.5 + 0.5 * Math.sin(G.time * 1.6);
    ctx.fillStyle = `rgba(120,0,0,${0.07 + pulse * 0.03})`; ctx.fillRect(0, 0, w, h);
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(60,0,0,0.45)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }
  // Rain streaks.
  if (rain > 0.03 && !indoor) {
    const n = Math.round((lq ? 70 : 220) * rain);
    if (!drops) drops = [];
    while (drops.length < n) drops.push({ x: Math.random() * w, y: Math.random() * h, v: 700 + Math.random() * 400, l: 10 + Math.random() * 12 });
    drops.length = Math.min(drops.length, n);
    ctx.strokeStyle = `rgba(190,210,230,${0.35 * rain})`; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const d of drops) {
      d.y += d.v * dt; d.x -= d.v * 0.18 * dt;
      if (d.y > h) { d.y = -20; d.x = Math.random() * (w + 100); }
      if (d.x < -20) d.x = w + 20;
      ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.18, d.y - d.l);
    }
    ctx.stroke();
  }
  // Film grain: always faint, stronger in attacks and cutscenes.
  if (!lq) {
    if (!grain) grain = makeGrain();
    const a = G.cutscene ? 0.09 : siege ? 0.07 : 0.035;
    ctx.save();
    ctx.globalAlpha = a; ctx.globalCompositeOperation = 'overlay';
    const ox = -Math.random() * 128, oy = -Math.random() * 128;
    for (let y = oy; y < h; y += 128) for (let x = ox; x < w; x += 128) ctx.drawImage(grain, x, y);
    ctx.restore();
  }
}
