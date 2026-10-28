// Game feel: hit-stop, slow motion, camera kick and zoom punch, shockwave rings,
// screen flashes, and the extra particles for impacts, glass, splinters and
// blood. Systems emit events; this module turns them into juice. The Low
// graphics setting keeps the cheap essentials.
import { G } from '../game/state.js';
import { TILE } from '../config.js';
import { spawnParticles } from '../game/combat.js';
import { lowQuality } from '../game/difficulty.js';
import { sfx } from '../audio.js';
import { derived } from '../game/progression.js';

const MAX_RINGS = 24;

export function initFxState() {
  G.fx = { stop: 0, slow: 0, slowScale: 1, punch: 0, kickX: 0, kickY: 0, flash: 0, flashColor: '255,255,255', rings: [], heartT: 0 };
}

/** Freeze the action for a moment so a hit lands. */
export function hitStop(s) { G.fx.stop = Math.max(G.fx.stop, s); }
/** Slow everything down for a beat (the last kill of the night). */
export function slowMo(s, scale = 0.3) { G.fx.slow = Math.max(G.fx.slow, s); G.fx.slowScale = scale; }
/** Push the camera in briefly. */
export function punch(a) { G.fx.punch = Math.max(G.fx.punch, a); }
/** Knock the camera back along an angle (recoil). */
export function kick(angle, amt) { G.fx.kickX -= Math.cos(angle) * amt; G.fx.kickY -= Math.sin(angle) * amt; }
export function flash(a, color = '255,255,255') { G.fx.flash = Math.max(G.fx.flash, a); G.fx.flashColor = color; }
export function ring(x, y, { r = 90, life = 0.45, color = '255,210,140', width = 4 } = {}) {
  if (G.fx.rings.length >= MAX_RINGS) G.fx.rings.shift();
  G.fx.rings.push({ x, y, r, life, max: life, color, width });
}

/** Particles that fly in a direction (blood spray, splinters). */
function spray(x, y, angle, color, n, speed, spread = 0.7, life = 0.45, size = 2.5) {
  for (let i = 0; i < n; i++) {
    const a = angle + (Math.random() - 0.5) * spread * 2, s = speed * (0.4 + Math.random() * 0.8);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.6 + Math.random() * 0.6), max: life, color, size: size * (0.6 + Math.random() * 0.8) });
  }
  if (G.particles.length > 420) G.particles.splice(0, G.particles.length - 420);
}

/** Real-time step for the effects; returns the time scale for the game this frame. */
export function updateFx(dt) {
  const f = G.fx;
  if (!f) return 1;
  f.punch = Math.max(0, f.punch - dt * 1.8);
  f.kickX *= Math.pow(0.0005, dt); f.kickY *= Math.pow(0.0005, dt);
  f.flash = Math.max(0, f.flash - dt * 3.2);
  for (const r of f.rings) r.life -= dt;
  f.rings = f.rings.filter((r) => r.life > 0);
  // Low health: a heartbeat you can feel.
  const p = G.player;
  if (p && !p.dead && G.running && !G.modal) {
    const frac = p.hp / derived().maxHp;
    if (frac < 0.3) {
      f.heartT -= dt;
      if (f.heartT <= 0) { sfx('heartbeat', { vol: 0.9 - frac }); f.heartT = 0.55 + frac * 1.6; }
    }
  }
  if (f.stop > 0) { f.stop -= dt; return 0.04; }
  if (f.slow > 0) { f.slow -= dt; return f.slowScale; }
  return 1;
}

export function drawWorldFx(ctx) {
  const f = G.fx;
  if (!f) return;
  for (const r of f.rings) {
    const k = 1 - r.life / r.max;
    ctx.strokeStyle = `rgba(${r.color},${(1 - k) * 0.85})`;
    ctx.lineWidth = r.width * (1 - k * 0.7);
    ctx.beginPath(); ctx.arc(r.x, r.y, 6 + r.r * (1 - Math.pow(1 - k, 3)), 0, Math.PI * 2); ctx.stroke();
  }
}

export function drawScreenFlash(ctx) {
  const f = G.fx;
  if (!f || f.flash <= 0) return;
  const { w, h } = G.view;
  ctx.fillStyle = `rgba(${f.flashColor},${Math.min(0.75, f.flash)})`;
  ctx.fillRect(0, 0, w, h);
}

export function initFxEvents() {
  initFxState();
  const ev = G.events;
  ev.on('shot', () => {
    const p = G.player; if (!p) return;
    const amt = p.weapon === 'shotgun' ? 7 : p.weapon === 'rifle' ? 6 : 2.5;
    kick(p.angle, amt);
  });
  ev.on('enemyHit', (e, src) => {
    const p = G.player;
    const a = p ? Math.atan2(e.y - p.y, e.x - p.x) : 0;
    if (!e.def.vehicle) spray(e.x, e.y, a, '#a3201c', lowQuality() ? 4 : 9, 170, 0.5, 0.35, 2.6);
    if (src === 'melee') hitStop(0.05);
  });
  ev.on('enemyKilled', (e) => {
    if (e.def.vehicle) {
      ring(e.x, e.y, { r: 150, life: 0.6, color: '255,190,90', width: 7 });
      ring(e.x, e.y, { r: 90, life: 0.35, color: '255,255,220', width: 4 });
      flash(0.35, '255,220,160'); hitStop(0.08); punch(0.06);
      spawnParticles(e.x, e.y, '#3a3a3a', lowQuality() ? 6 : 16, 120, 1.2, 4); // smoke and debris
      return;
    }
    const p = G.player;
    const a = p ? Math.atan2(e.y - p.y, e.x - p.x) : 0;
    spray(e.x, e.y, a, '#8f1512', lowQuality() ? 6 : 16, 210, 0.6, 0.55, 3);
    ring(e.x, e.y, { r: 26, life: 0.25, color: '255,90,70', width: 2 });
    hitStop(e.def.boss ? 0.14 : 0.045);
    // Last one standing tonight: slow motion.
    const sg = G.siege;
    const alive = G.enemies.some((o) => !o.dead && !o.gone && o !== e);
    if (G.siegeActive && sg && sg.waveIdx >= sg.plan.waves.length && !alive) { slowMo(0.9, 0.28); punch(0.08); sfx('whoosh'); }
    else if (e.def.boss) { slowMo(0.5, 0.35); punch(0.06); }
  });
  ev.on('takedown', (e) => { hitStop(0.12); punch(0.07); ring(e.x, e.y, { r: 34, life: 0.3, color: '200,214,255', width: 3 }); sfx('whoosh'); });
  ev.on('bulletWall', (x, y) => {
    spawnParticles(x, y, '#ffe08a', lowQuality() ? 2 : 5, 220, 0.16, 1.6); // sparks
    if (!lowQuality()) spawnParticles(x, y, 'rgba(150,140,120,0.8)', 4, 40, 0.6, 4); // dust
  });
  ev.on('glass_break', (b) => {
    const x = b.cx * TILE + 16, y = b.cy * TILE + 16;
    for (let i = 0; i < (lowQuality() ? 6 : 16); i++) spray(x, y, Math.random() * Math.PI * 2, i % 3 ? '#cfe8f5' : '#ffffff', 1, 160, 1, 0.7, 2.2);
    ring(x, y, { r: 30, life: 0.25, color: '210,235,255', width: 2 });
  });
  const splinters = (b) => {
    const x = b.cx * TILE + 16, y = b.cy * TILE + 16;
    spawnParticles(x, y, '#8a6238', lowQuality() ? 6 : 14, 190, 0.6, 3);
    G.camera.shake = Math.max(G.camera.shake, 3);
  };
  ev.on('door_broken', splinters);
  ev.on('boards_broken', splinters);
  ev.on('cover_destroyed', splinters);
  ev.on('levelup', () => { const p = G.player; if (!p) return; ring(p.x, p.y, { r: 70, life: 0.7, color: '255,209,102', width: 4 }); ring(p.x, p.y, { r: 40, life: 0.5, color: '255,255,255', width: 2 }); spawnParticles(p.x, p.y, '#ffd166', 16, 140, 0.8, 3); });
  ev.on('playerHurt', (x, y, amount) => {
    const p = G.player; if (!p) return;
    kick(Math.atan2(p.y - y, p.x - x) + Math.PI, Math.min(8, 2 + amount / 6));
    if (amount >= 25) flash(0.18, '160,0,0');
  });
}

export const fxZoom = () => (G.fx ? 1 + G.fx.punch : 1);
