// Procedural top-down renderer: pre-rendered ground layer, y-sorted entities,
// tree canopies, roofs that hide when you step inside, and night lighting.
import { G, isNight } from '../game/state.js';
import { TILE } from '../config.js';
import { GR, SO } from './map.js';
import { hash2, dist, clamp } from '../util.js';
import { activeLights, darkness, inFloodlight } from './lights.js';
import { derived } from '../game/progression.js';
import { jobProps } from '../game/jobs.js';

let lightCanvas = null, lctx = null;

/* ------------------------------------------------------------------ */
/* Ground pre-render                                                   */
/* ------------------------------------------------------------------ */
const GROUND_COLORS = {
  [GR.GRASS]: ['#4c7a38', '#517f3c', '#48743a', '#548340'],
  [GR.DIRT]: ['#86663f', '#8b6b44', '#80613b'],
  [GR.ROAD]: ['#3a3b3f', '#3d3e42', '#38393d'],
  [GR.FLOOR]: ['#8a6845', '#86643f'],
  [GR.PORCH]: ['#a3825a', '#9d7c54'],
  [GR.WATER]: ['#2d5e7e', '#2f6283'],
  [GR.GRAVEL]: ['#7c786f', '#807c73', '#76726a'],
  [GR.SIDEWALK]: ['#9d9c94', '#a2a199'],
  [GR.GARDEN]: ['#5d4430', '#594029'],
  [GR.TILEFLOOR]: ['#cfc6b0', '#bcb29a'],
};

export function buildGroundCanvas(m) {
  const c = document.createElement('canvas');
  c.width = m.w * TILE; c.height = m.h * TILE;
  const g = c.getContext('2d');
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      const gt = m.ground[m.idx(cx, cy)];
      const cols = GROUND_COLORS[gt] || GROUND_COLORS[GR.GRASS];
      const h = hash2(cx, cy);
      const x = cx * TILE, y = cy * TILE;
      g.fillStyle = gt === GR.TILEFLOOR ? cols[(cx + cy) & 1] : cols[Math.floor(h * cols.length)];
      g.fillRect(x, y, TILE, TILE);
      detailTile(g, m, gt, cx, cy, x, y, h);
    }
  }
  // Static solids
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      const s = m.solid[m.idx(cx, cy)];
      const x = cx * TILE, y = cy * TILE;
      if (s === SO.WALL) drawWall(g, m, cx, cy, x, y);
      else if (s === SO.ROCK && !m.decor.some((d) => d.kind === 'fountain' && cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h)) drawRock(g, x, y, hash2(cx, cy));
      else if (s === SO.FENCE) drawFence(g, m, cx, cy, x, y);
    }
  }
  for (const d of m.decor) drawDecor(g, d);
  return c;
}

function detailTile(g, m, gt, cx, cy, x, y, h) {
  if (gt === GR.GRASS) {
    g.strokeStyle = 'rgba(30,60,20,0.35)';
    g.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const hx = x + hash2(cx * 3 + i, cy) * 28 + 2, hy = y + hash2(cx, cy * 3 + i) * 28 + 2;
      g.beginPath(); g.moveTo(hx, hy + 3); g.lineTo(hx + 1, hy); g.moveTo(hx + 2, hy + 3); g.lineTo(hx + 3, hy - 1); g.stroke();
    }
    if (h > 0.93) { g.fillStyle = h > 0.97 ? '#e8d86a' : '#d6e2f0'; g.fillRect(x + 10 + h * 10, y + 12, 2, 2); }
  } else if (gt === GR.ROAD) {
    const up = m.inBounds(cx, cy - 1) && m.ground[m.idx(cx, cy - 1)] === GR.ROAD;
    const down = m.inBounds(cx, cy + 1) && m.ground[m.idx(cx, cy + 1)] === GR.ROAD;
    const left = m.inBounds(cx - 1, cy) && m.ground[m.idx(cx - 1, cy)] === GR.ROAD;
    const right = m.inBounds(cx + 1, cy) && m.ground[m.idx(cx + 1, cy)] === GR.ROAD;
    g.fillStyle = '#d9b84a';
    if (!up && down && (left || right) && cx % 2 === 0) g.fillRect(x + 4, y + TILE - 1, 18, 2);
    else if (!left && right && (up || down) && !(!up && down) && cy % 2 === 0) g.fillRect(x + TILE - 1, y + 4, 2, 18);
    g.fillStyle = 'rgba(255,255,255,0.03)';
    g.fillRect(x + h * 20, y + h * 25, 3, 2);
  } else if (gt === GR.FLOOR || gt === GR.PORCH) {
    g.strokeStyle = 'rgba(40,25,10,0.35)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(x, y + i * 8 + 0.5); g.lineTo(x + TILE, y + i * 8 + 0.5); g.stroke(); }
    g.beginPath(); g.moveTo(x + ((cx * 13 + cy * 7) % 4) * 8 + 0.5, y); g.lineTo(x + ((cx * 13 + cy * 7) % 4) * 8 + 0.5, y + 8); g.stroke();
  } else if (gt === GR.DIRT || gt === GR.GRAVEL) {
    g.fillStyle = gt === GR.DIRT ? 'rgba(60,40,20,0.35)' : 'rgba(40,40,40,0.3)';
    for (let i = 0; i < 5; i++) g.fillRect(x + hash2(cx * 5 + i, cy * 2) * 30, y + hash2(cx * 2, cy * 5 + i) * 30, 2, 2);
  } else if (gt === GR.WATER) {
    g.strokeStyle = 'rgba(180,220,255,0.18)';
    g.beginPath(); g.moveTo(x + 4 + h * 10, y + 12); g.quadraticCurveTo(x + 10 + h * 10, y + 9, x + 16 + h * 10, y + 12); g.stroke();
  } else if (gt === GR.SIDEWALK) {
    g.strokeStyle = 'rgba(60,60,60,0.25)';
    g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
  } else if (gt === GR.GARDEN) {
    g.fillStyle = '#6fae4c';
    for (let i = 0; i < 3; i++) { g.fillRect(x + 4 + i * 10, y + 8, 4, 4); g.fillRect(x + 4 + i * 10, y + 22, 4, 4); }
  }
}

function drawWall(g, m, cx, cy, x, y) {
  g.fillStyle = '#4b3424';
  g.fillRect(x, y, TILE, TILE);
  g.fillStyle = '#5e4330';
  for (let i = 0; i < 4; i++) g.fillRect(x + 1, y + i * 8 + 1, TILE - 2, 5);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(x, y + TILE - 3, TILE, 3);
}

function drawRock(g, x, y, h) {
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.beginPath(); g.ellipse(x + 17, y + 20, 14, 9, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#7b7d80';
  g.beginPath(); g.ellipse(x + 16, y + 16, 13 + h * 2, 11, h, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#9a9ca0';
  g.beginPath(); g.ellipse(x + 13, y + 12, 6, 4, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#4e5053'; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(x + 16, y + 16, 13 + h * 2, 11, h, 0, Math.PI * 2); g.stroke();
}

function drawFence(g, m, cx, cy, x, y) {
  const isF = (a, b) => m.inBounds(a, b) && m.solid[m.idx(a, b)] === SO.FENCE;
  g.fillStyle = '#7a5a36';
  g.strokeStyle = '#5a3f22';
  g.lineWidth = 3;
  g.beginPath();
  if (isF(cx - 1, cy) || isF(cx + 1, cy)) { g.moveTo(x, y + 12); g.lineTo(x + TILE, y + 12); g.moveTo(x, y + 20); g.lineTo(x + TILE, y + 20); }
  if (isF(cx, cy - 1) || isF(cx, cy + 1)) { g.moveTo(x + 12, y); g.lineTo(x + 12, y + TILE); g.moveTo(x + 20, y); g.lineTo(x + 20, y + TILE); }
  g.stroke();
  g.fillRect(x + 12, y + 12, 8, 8);
}

function drawDecor(g, d) {
  const x = d.x * TILE, y = d.y * TILE, w = d.w * TILE, h = d.h * TILE;
  switch (d.kind) {
    case 'bed':
      g.fillStyle = '#5b3a24'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = '#3f6e8c'; g.fillRect(x + 5, y + 14, w - 10, h - 18);
      g.fillStyle = '#e8e2d0'; g.fillRect(x + 6, y + 5, w - 12, 9);
      break;
    case 'stove':
      g.fillStyle = '#2b2b2b'; g.fillRect(x + 2, y + 3, 28, 26);
      g.fillStyle = '#b5551d'; g.fillRect(x + 8, y + 10, 14, 10);
      g.fillStyle = '#9a8b74'; g.fillRect(x + 34, y + 3, 28, 26);
      break;
    case 'table': case 'pews':
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 4, y + 6, w - 6, h - 6);
      g.fillStyle = d.kind === 'pews' ? '#6b4a2e' : '#7b5634'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.strokeStyle = '#4e321c'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      break;
    case 'workbench':
      g.fillStyle = '#6d5236'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = '#9aa0a6'; g.fillRect(x + 8, y + 8, 6, 14); g.fillRect(x + 6, y + 36, 16, 4);
      g.fillStyle = '#c0392b'; g.fillRect(x + 16, y + 20, 8, 6);
      break;
    case 'rug':
      g.fillStyle = '#7d2f2f'; g.fillRect(x + 4, y + 4, w - 8, h - 8);
      g.strokeStyle = '#c99a4a'; g.lineWidth = 2; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
      break;
    case 'phone':
      g.fillStyle = '#1f1f1f'; g.fillRect(x + 10, y + 2, 12, 9);
      break;
    case 'logs':
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
        const lx = x + i * TILE, ly = y + j * TILE;
        g.fillStyle = '#6b4a2b'; g.fillRect(lx + 1, ly + 3, TILE - 2, TILE - 6);
        for (let k = 0; k < 3; k++) { g.fillStyle = '#b08856'; g.beginPath(); g.arc(lx + 8 + k * 8, ly + 10 + (k % 2) * 10, 5, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#7a5a36'; g.lineWidth = 1; g.stroke(); }
      }
      break;
    case 'pole':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 18, y + 20, 8, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5a4128'; g.beginPath(); g.arc(x + 16, y + 16, 7, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3d2c1a'; g.fillRect(x + 2, y + 14, 28, 4);
      break;
    case 'mailbox':
      g.fillStyle = '#4b4b4b'; g.fillRect(x + 14, y + 14, 4, 14);
      g.fillStyle = '#2f5d8a'; g.fillRect(x + 8, y + 6, 16, 10);
      g.fillStyle = '#c0392b'; g.fillRect(x + 22, y + 4, 3, 6);
      break;
    case 'crops':
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
        g.fillStyle = (i + j) % 3 === 0 ? '#d64f3a' : '#3f8f3a';
        g.beginPath(); g.arc(x + i * TILE + 16, y + j * TILE + 16, 6, 0, Math.PI * 2); g.fill();
      }
      break;
    case 'counter':
      g.fillStyle = '#6b4a2e'; g.fillRect(x, y + 4, w, h - 8);
      g.fillStyle = '#d9cbb0'; g.fillRect(x, y + 4, w, 6);
      break;
    case 'shelf':
      g.fillStyle = '#5d4630'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      for (let i = 0; i < d.w * 4; i++) for (let j = 0; j < d.h * 3; j++) {
        g.fillStyle = ['#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#ecf0f1'][(i * 7 + j * 3) % 5];
        g.fillRect(x + 4 + i * 7, y + 4 + j * 9, 5, 6);
      }
      break;
    case 'fountain':
      g.fillStyle = '#8f8f8f'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w / 2 - 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3d7fa6'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w / 2 - 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9f9f9f'; g.beginPath(); g.arc(x + w / 2, y + h / 2, 8, 0, Math.PI * 2); g.fill();
      break;
    case 'board':
      g.fillStyle = '#5a4128'; g.fillRect(x + 4, y + 18, 4, 12); g.fillRect(x + 24, y + 18, 4, 12);
      g.fillStyle = '#8b6b44'; g.fillRect(x + 1, y + 2, 30, 18);
      g.fillStyle = '#efe6cf'; g.fillRect(x + 4, y + 5, 8, 6); g.fillRect(x + 14, y + 4, 8, 7); g.fillRect(x + 22, y + 6, 6, 8);
      break;
    case 'crate':
      g.fillStyle = '#9b7b4a'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.strokeStyle = '#6b4f2a'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + w - 2, y + h - 2); g.stroke();
      break;
    default: break;
  }
}

export function buildRoofCanvas(b) {
  const c = document.createElement('canvas');
  c.width = b.w * TILE + 8; c.height = b.h * TILE + 8;
  const g = c.getContext('2d');
  const w = b.w * TILE, h = b.h * TILE;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(6, 8, w, h);
  g.fillStyle = b.roof;
  g.fillRect(0, 0, w, h);
  // shingles
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 1;
  for (let y = 6; y < h; y += 8) {
    g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
    for (let x = ((y / 8) % 2) * 6; x < w; x += 12) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y - 8); g.stroke(); }
  }
  // ridge
  g.fillStyle = 'rgba(255,255,255,0.12)';
  if (w >= h) g.fillRect(0, h / 2 - 3, w, 6); else g.fillRect(w / 2 - 3, 0, 6, h);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  if (w >= h) g.fillRect(0, h / 2, w, h / 2); else g.fillRect(w / 2, 0, w / 2, h);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2);
  if (b.isHome) { // chimney
    g.fillStyle = '#6e6e6e'; g.fillRect(w - 50, 10, 16, 16); g.fillStyle = '#2b2b2b'; g.fillRect(w - 47, 13, 10, 10);
  }
  if (b.name && !b.isHome) {
    const label = b.name.toUpperCase();
    g.font = 'bold 13px system-ui, sans-serif';
    const tw = g.measureText(label).width;
    if (tw < w - 8) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(w / 2 - tw / 2 - 6, h - 26, tw + 12, 18);
      g.fillStyle = '#f5ecd6';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, w / 2, h - 17);
    }
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */
function drawPerson(ctx, e, o) {
  const { x, y } = e;
  const a = o.angle;
  const r = o.r || 10;
  const bob = Math.sin(o.walk || 0) * 2;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 2, y + 4, r + 2, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  // feet
  ctx.fillStyle = '#1e1e1e';
  ctx.beginPath(); ctx.ellipse(bob * 1.5, -r * 0.45, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(-bob * 1.5, r * 0.45, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  // weapon
  if (o.weapon === 'pistol') { ctx.fillStyle = '#222'; ctx.fillRect(r - 2, -2.5, 12, 5); ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(r - 1, 0, 3.4, 0, Math.PI * 2); ctx.fill(); }
  else if (o.weapon === 'rifle') { ctx.fillStyle = '#3b2a1a'; ctx.fillRect(r - 6, -2.5, 24, 5); ctx.fillStyle = '#222'; ctx.fillRect(r + 10, -1.5, 10, 3); }
  else if (o.weapon === 'bat') {
    const swing = o.swing ? -0.9 * o.swing : 0;
    ctx.save(); ctx.rotate(0.6 + swing); ctx.fillStyle = '#8a6a3d'; ctx.fillRect(r - 4, -3, 22, 6); ctx.restore();
  } else if (o.weapon === 'axe') {
    ctx.save(); ctx.rotate(o.swing ? -1.2 * o.swing + 0.5 : 0.3); ctx.fillStyle = '#7a5a36'; ctx.fillRect(r - 2, -2, 18, 4); ctx.fillStyle = '#bfc5cc'; ctx.fillRect(r + 12, -6, 6, 9); ctx.restore();
  }
  // body
  ctx.fillStyle = o.body;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.75, r * 1.05, 0, 0, Math.PI * 2); ctx.fill();
  if (o.trim) { ctx.fillStyle = o.trim; ctx.fillRect(-3, -r * 1.0, 6, 4); }
  // head
  ctx.fillStyle = o.skin;
  ctx.beginPath(); ctx.arc(1, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = o.hair;
  ctx.beginPath(); ctx.arc(-1, 0, r * 0.5, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
  if (o.hat) { ctx.fillStyle = o.hat; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  // team ring (shape + colour, not colour alone)
  if (o.ring) {
    ctx.strokeStyle = o.ring;
    ctx.lineWidth = o.ringW || 2;
    if (o.dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (o.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${o.flash * 4})`;
    ctx.beginPath(); ctx.arc(x, y, r + 1, 0, Math.PI * 2); ctx.fill();
  }
}

const ENEMY_LOOK = {
  scout: { hair: '#2a2a2a', skin: '#d8a888', hat: '#3d3d46' },
  enforcer: { hair: '#1a1a1a', skin: '#caa07e', hat: null },
  gunman: { hair: '#1a1a1a', skin: '#e0b494', hat: '#1f2328' },
};

/* ------------------------------------------------------------------ */
/* Main render                                                         */
/* ------------------------------------------------------------------ */
export function render(ctx) {
  const m = G.map;
  const cam = G.camera;
  const { w, h, dpr } = G.view;
  const z = cam.zoom;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d2a18';
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  if (!m || !G.player) return;
  const ox = w / 2 - cam.x * z + cam.shakeX, oy = h / 2 - cam.y * z + cam.shakeY;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
  ctx.imageSmoothingEnabled = false;

  const vx0 = cam.x - w / 2 / z - TILE, vy0 = cam.y - h / 2 / z - TILE;
  const vx1 = cam.x + w / 2 / z + TILE, vy1 = cam.y + h / 2 / z + TILE;
  const inView = (x, y, pad = 40) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

  // Ground
  const sx = Math.max(0, Math.floor(vx0)), sy = Math.max(0, Math.floor(vy0));
  const sw = Math.min(m.groundCanvas.width - sx, Math.ceil(vx1 - vx0)), sh = Math.min(m.groundCanvas.height - sy, Math.ceil(vy1 - vy0));
  if (sw > 0 && sh > 0) ctx.drawImage(m.groundCanvas, sx, sy, sw, sh, sx, sy, sw, sh);

  const t = G.time;
  const cx0 = Math.max(0, Math.floor(vx0 / TILE)), cy0 = Math.max(0, Math.floor(vy0 / TILE));
  const cx1 = Math.min(m.w - 1, Math.ceil(vx1 / TILE)), cy1 = Math.min(m.h - 1, Math.ceil(vy1 / TILE));

  // Sign props on the ground (footprints)
  for (const pr of m.props) {
    if (pr.kind === 'footprints' && inView(pr.x, pr.y)) {
      ctx.fillStyle = 'rgba(40,28,18,0.75)';
      for (let i = 0; i < 6; i++) {
        const fx = pr.x - 40 + i * 14, fy = pr.y + (i % 2 ? 5 : -5);
        ctx.beginPath(); ctx.ellipse(fx, fy, 5, 3, 0.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Trees: trunks / stumps
  const canopies = [];
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
    const tr = m.trees.get(cy * m.w + cx);
    if (!tr) continue;
    const x = cx * TILE + 16, y = cy * TILE + 16;
    if (tr.chopped) {
      ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b08856'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x + 6, y + 8, 18, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#5a3d24'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    canopies.push(tr);
  }

  // Cars & props with bodies
  for (const pr of m.props) {
    if (pr.kind === 'car' && inView(pr.x, pr.y)) drawCar(ctx, pr.x - 0, pr.y, '#8c2f2f', true);
    if (pr.kind === 'strange_car' && inView(pr.x, pr.y)) drawCar(ctx, pr.x, pr.y, '#16181c', false, true);
  }
  // Job props
  for (const pr of jobProps(m.id)) {
    if (!inView(pr.x, pr.y)) continue;
    if (pr.kind === 'job_repair') {
      ctx.save(); ctx.translate(pr.x, pr.y);
      ctx.strokeStyle = '#8b6b44'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(-14, -4); ctx.lineTo(-2, 2); ctx.moveTo(4, -6); ctx.lineTo(14, 4); ctx.stroke();
      ctx.restore();
    }
    if (pr.kind === 'job_supply') { ctx.fillStyle = '#9b7b4a'; ctx.fillRect(pr.x - 10, pr.y - 10, 20, 20); }
  }

  // Placed cover
  for (const b of m.blockers.values()) {
    if (b.kind !== 'cover') continue;
    const x = b.cx * TILE, y = b.cy * TILE;
    if (!inView(x, y)) continue;
    drawCover(ctx, b, x, y);
  }

  // Pickups
  for (const pk of G.pickups) {
    if (!inView(pk.x, pk.y)) continue;
    const bob = Math.sin(t * 5 + pk.x) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(pk.x, pk.y + 6, 6, 3, 0, 0, Math.PI * 2); ctx.fill();
    if (pk.kind === 'cash') { ctx.fillStyle = '#3fae5a'; ctx.fillRect(pk.x - 7, pk.y - 5 + bob, 14, 8); ctx.fillStyle = '#c9f2d0'; ctx.fillRect(pk.x - 2, pk.y - 3 + bob, 4, 4); }
    else if (pk.kind === 'ammo') { ctx.fillStyle = '#c9a43a'; ctx.fillRect(pk.x - 6, pk.y - 5 + bob, 12, 9); ctx.fillStyle = '#5a4a1a'; ctx.fillRect(pk.x - 6, pk.y - 5 + bob, 12, 3); }
    else if (pk.kind === 'bandage') { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(pk.x - 6, pk.y - 6 + bob, 12, 12); ctx.fillStyle = '#d63b3b'; ctx.fillRect(pk.x - 1.5, pk.y - 4 + bob, 3, 8); ctx.fillRect(pk.x - 4, pk.y - 1.5 + bob, 8, 3); }
    else if (pk.kind === 'note') { ctx.fillStyle = '#f6eed8'; ctx.fillRect(pk.x - 6, pk.y - 8 + bob, 12, 14); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, 13 + Math.sin(t * 6) * 2, 0, Math.PI * 2); ctx.stroke(); }
  }

  // Entities (y-sorted)
  const ents = [];
  for (const n of G.npcs) if (n.present && inView(n.x, n.y)) ents.push(n);
  for (const e of G.enemies) if (!e.gone && inView(e.x, e.y)) ents.push(e);
  ents.push(G.player);
  ents.sort((a, b) => a.y - b.y);
  const p = G.player;
  for (const e of ents) {
    if (e === p) {
      if (p.dead) continue;
      const blink = p.invuln > 0 && p.dodgeT <= 0 && Math.floor(t * 20) % 2 === 0;
      if (blink) ctx.globalAlpha = 0.55;
      drawPerson(ctx, p, {
        angle: p.angle, r: 10, walk: p.walkPhase, body: '#3a6b52', skin: '#e0b18e', hair: '#3b2a1e',
        weapon: p.chopAnim > 0 ? 'axe' : 'pistol', swing: p.chopAnim > 0 ? p.chopAnim * 4 : 0, ring: '#ffffff', ringW: 2.5,
      });
      ctx.globalAlpha = 1;
      if (p.muzzle > 0) muzzleFlash(ctx, p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24, p.angle);
      if (p.meleeAnim > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(p.x, p.y, 34, p.angle - 0.9, p.angle + 0.9); ctx.stroke();
      }
    } else if (e.def && e.def.weapon) {
      drawEnemy(ctx, e, t);
    } else {
      // NPC
      const d = e.def;
      drawPerson(ctx, e, { angle: e.angle, r: 10, walk: e.walkPhase, body: d.body, skin: d.skin, hair: d.hair, ring: e.stranger ? '#b9a4e0' : '#5bc0de', dashed: !e.named });
    }
  }

  // Enemy telegraphs (aim lines)
  for (const e of G.enemies) {
    if (e.dead || e.gone || !(e.aimT > 0)) continue;
    const prog = 1 - e.aimT / e.def.telegraph;
    if (e.def.weapon === 'bat') {
      ctx.strokeStyle = `rgba(255,80,60,${0.4 + prog * 0.5})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.x, e.y, 30, e.aimAngle - 1, e.aimAngle + 1); ctx.stroke();
    } else {
      ctx.strokeStyle = `rgba(255,60,40,${0.25 + prog * 0.6})`;
      ctx.lineWidth = 1.5 + prog * 1.5;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y);
      const len = Math.min(e.def.range, dist(e.x, e.y, p.x, p.y) + 40);
      ctx.lineTo(e.x + Math.cos(e.aimAngle) * len, e.y + Math.sin(e.aimAngle) * len); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Bullets as tracers
  for (const b of G.bullets) {
    ctx.strokeStyle = b.owner === 'player' ? '#fff3b0' : '#ff8a65';
    ctx.lineWidth = b.owner === 'player' ? 2 : 2.5;
    ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  // Particles
  for (const pt of G.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  // Canopies (fade if something is underneath)
  for (const tr of canopies) {
    const x = tr.cx * TILE + 16, y = tr.cy * TILE + 16;
    const sh = tr.shake > 0 ? Math.sin(t * 60) * 2 : 0;
    if (tr.shake > 0) tr.shake -= 1 / 60;
    let under = dist(x, y, p.x, p.y) < 26;
    if (!under) for (const e of G.enemies) if (!e.dead && dist(x, y, e.x, e.y) < 24) { under = true; break; }
    ctx.globalAlpha = under ? 0.45 : 1;
    const hsh = hash2(tr.cx, tr.cy);
    if (tr.kind === 'pine') {
      ctx.fillStyle = '#21452a';
      ctx.beginPath(); ctx.arc(x + sh, y - 2, 16 + hsh * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2c5a35';
      ctx.beginPath(); ctx.arc(x + sh - 1, y - 4, 11 + hsh * 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3a6e42';
      ctx.beginPath(); ctx.arc(x + sh - 2, y - 6, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#2f5a26';
      ctx.beginPath(); ctx.arc(x + sh - 6, y - 2, 12, 0, Math.PI * 2); ctx.arc(x + sh + 7, y - 4, 12, 0, Math.PI * 2); ctx.arc(x + sh, y - 11, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#3f7332';
      ctx.beginPath(); ctx.arc(x + sh - 3, y - 7, 8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Roofs
  const inside = m.buildingAt(p.x, p.y);
  for (const b of m.buildings) {
    if (inside === b) continue;
    const bx = b.x * TILE, by = b.y * TILE;
    if (!inView(bx + b.w * 16, by + b.h * 16, b.w * 32)) continue;
    let alpha = 1;
    if (G.enemies.some((e) => !e.dead && m.buildingAt(e.x, e.y) === b) || G.npcs.some((n) => n.present && n.named && m.buildingAt(n.x, n.y) === b && dist(n.x, n.y, p.x, p.y) < 90)) alpha = 0.5;
    ctx.globalAlpha = alpha;
    ctx.drawImage(b.roofCanvas, bx, by);
    ctx.globalAlpha = 1;
  }

  // Doors and windows (on walls, above roofs so they're always readable)
  for (const b of m.blockers.values()) {
    if (b.kind === 'cover') continue;
    const x = b.cx * TILE, y = b.cy * TILE;
    if (!inView(x, y)) continue;
    if (b.kind === 'door') drawDoor(ctx, b, x, y);
    else drawWindow(ctx, b, x, y);
  }

  // Lighting
  const dk = darkness();
  if (dk > 0.02) drawLighting(ctx, dk, ox, oy, z);
  // Dusk tint
  const min = G.s.time.minute;
  if (min > 17.5 * 60 && min < 21 * 60) {
    const f = 1 - Math.abs(min - 19.5 * 60) / 90;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(255,120,40,${0.08 * clamp(f, 0, 1)})`;
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
  }

  // Overlays (drawn over darkness so they're always readable)
  drawOverlays(ctx, dk, inView);

  // Screen-space effects
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScreenFx(ctx, ox, oy, z);
}

function drawCar(ctx, x, y, color, vertical, lights) {
  ctx.save();
  ctx.translate(x, y);
  if (!vertical) ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-28, -44, 60, 94);
  ctx.fillStyle = color; roundRect(ctx, -26, -46, 52, 92, 10); ctx.fill();
  ctx.fillStyle = 'rgba(160,200,230,0.75)'; roundRect(ctx, -20, -28, 40, 18, 4); ctx.fill();
  ctx.fillStyle = 'rgba(120,160,190,0.6)'; roundRect(ctx, -20, 18, 40, 14, 4); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(-18, -8, 36, 24);
  ctx.fillStyle = lights ? '#fff6c4' : '#f4e6a1'; ctx.fillRect(-22, -46, 10, 4); ctx.fillRect(12, -46, 10, 4);
  ctx.fillStyle = '#b52a2a'; ctx.fillRect(-22, 42, 10, 4); ctx.fillRect(12, 42, 10, 4);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawCover(ctx, b, x, y) {
  const shakeX = b.hitT > 0 ? (Math.random() - 0.5) * 3 : 0;
  ctx.save(); ctx.translate(x + shakeX, y);
  if (b.rec.type === 'sandbags') {
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(2, 8, 30, 24);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) {
      ctx.fillStyle = (i + j) % 2 ? '#b8a578' : '#a8955f';
      roundRect(ctx, 1 + i * 15 - (j % 2) * 3, 2 + j * 9, 16, 10, 4); ctx.fill();
      ctx.strokeStyle = '#7a6a40'; ctx.lineWidth = 1; ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#7a5a36'; ctx.fillRect(2, 6, 28, 6); ctx.fillRect(2, 20, 28, 6);
    ctx.fillStyle = '#5a3f22'; ctx.fillRect(5, 2, 5, 28); ctx.fillRect(22, 2, 5, 28);
  }
  ctx.restore();
  if (b.condition < 0.99) bar(ctx, x + 2, y - 5, 28, 3, b.condition, '#e0a542');
}

function drawDoor(ctx, b, x, y) {
  const sh = b.hitT > 0 ? (Math.random() - 0.5) * 3 : 0;
  ctx.save(); ctx.translate(x + sh, y);
  if (b.broken) {
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(2, 2, 6, 28); ctx.fillRect(24, 4, 6, 24);
    ctx.fillStyle = '#6b4a2b'; ctx.save(); ctx.translate(16, 16); ctx.rotate(0.6); ctx.fillRect(-10, -2, 20, 4); ctx.restore();
  } else if (b.rec.open) {
    ctx.fillStyle = '#3a2a1c'; ctx.fillRect(0, 0, 4, TILE); ctx.fillRect(TILE - 4, 0, 4, TILE);
    ctx.fillStyle = '#7b5532'; ctx.fillRect(4, 0, 5, TILE);
  } else {
    ctx.fillStyle = b.rec.reinforced ? '#5d4a3a' : '#7b5532';
    ctx.fillRect(1, 1, TILE - 2, TILE - 2);
    ctx.strokeStyle = '#3e2a18'; ctx.lineWidth = 2; ctx.strokeRect(2, 2, TILE - 4, TILE - 4);
    ctx.fillStyle = '#d9b84a'; ctx.fillRect(TILE - 9, TILE / 2 - 2, 4, 4);
    if (b.rec.reinforced) { ctx.fillStyle = '#9aa0a6'; ctx.fillRect(3, 6, TILE - 6, 4); ctx.fillRect(3, TILE - 10, TILE - 6, 4); }
    // crack marks show damage (not colour alone)
    if (b.condition < 0.66) { ctx.strokeStyle = '#1a1009'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(12, 14); ctx.lineTo(8, 22); ctx.stroke(); }
    if (b.condition < 0.33) { ctx.beginPath(); ctx.moveTo(26, 6); ctx.lineTo(18, 16); ctx.lineTo(24, 28); ctx.stroke(); }
  }
  ctx.restore();
  if (!b.rec.npc && (b.condition < 0.99)) bar(ctx, x + 2, y - 6, 28, 4, b.condition, b.condition < 0.35 ? '#e74c3c' : '#e0a542');
}

function drawWindow(ctx, b, x, y) {
  const sh = b.hitT > 0 ? (Math.random() - 0.5) * 3 : 0;
  ctx.save(); ctx.translate(x + sh, y);
  ctx.fillStyle = '#4b3424'; ctx.fillRect(0, 0, TILE, TILE);
  const night = isNight();
  if (b.rec.glass > 0) {
    ctx.fillStyle = night ? 'rgba(255,214,120,0.85)' : 'rgba(150,200,230,0.9)';
    if (b.vertical) ctx.fillRect(10, 2, 12, TILE - 4); else ctx.fillRect(2, 10, TILE - 4, 12);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); if (b.vertical) { ctx.moveTo(16, 2); ctx.lineTo(16, TILE - 2); } else { ctx.moveTo(16, 10); ctx.lineTo(16, 22); } ctx.stroke();
  } else {
    ctx.fillStyle = '#141414';
    if (b.vertical) ctx.fillRect(10, 2, 12, TILE - 4); else ctx.fillRect(2, 10, TILE - 4, 12);
    ctx.fillStyle = 'rgba(200,230,255,0.6)';
    if (b.vertical) { ctx.beginPath(); ctx.moveTo(10, 2); ctx.lineTo(16, 8); ctx.lineTo(10, 12); ctx.fill(); } else { ctx.beginPath(); ctx.moveTo(2, 10); ctx.lineTo(8, 16); ctx.lineTo(12, 10); ctx.fill(); }
  }
  if (b.boarded) {
    ctx.fillStyle = '#9b7a4c'; ctx.strokeStyle = '#5a3f22'; ctx.lineWidth = 1;
    const n = Math.max(1, Math.ceil((b.rec.boardHp / b.boardMax) * 3));
    for (let i = 0; i < n; i++) {
      ctx.save(); ctx.translate(16, 16); ctx.rotate((b.vertical ? Math.PI / 2 : 0) + (i - 1) * 0.35);
      ctx.fillRect(-15, -3 + (i - 1) * 2, 30, 6); ctx.strokeRect(-15, -3 + (i - 1) * 2, 30, 6);
      ctx.restore();
    }
  }
  ctx.restore();
  if (!b.rec.npc && b.condition < 0.99) bar(ctx, x + 2, y - 6, 28, 4, b.condition, b.condition < 0.35 ? '#e74c3c' : '#e0a542');
}

function bar(ctx, x, y, w, h, frac, color) {
  ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}

function muzzleFlash(ctx, x, y, a) {
  ctx.fillStyle = 'rgba(255,230,120,0.95)';
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,170,60,0.7)';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a - 0.3) * 14, y + Math.sin(a - 0.3) * 14); ctx.lineTo(x + Math.cos(a + 0.3) * 14, y + Math.sin(a + 0.3) * 14); ctx.fill();
}

function drawEnemy(ctx, e, t) {
  const look = ENEMY_LOOK[e.type];
  if (e.dead) {
    ctx.globalAlpha = Math.max(0, 1 - e.deadT / 25);
    ctx.fillStyle = 'rgba(90,20,20,0.5)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 3, e.radius + 6, e.radius, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle + Math.PI / 2);
    ctx.fillStyle = e.def.color; ctx.beginPath(); ctx.ellipse(0, 0, e.radius * 0.8, e.radius * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(0, -e.radius, e.radius * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
    return;
  }
  drawPerson(ctx, e, {
    angle: e.angle, r: e.radius, walk: e.walkPhase, body: e.def.color, trim: e.def.trim, skin: look.skin, hair: look.hair, hat: look.hat,
    weapon: e.def.weapon, swing: e.aimT > 0 && e.def.weapon === 'bat' ? 1 - e.aimT / e.def.telegraph : 0,
    ring: e.retreating ? '#f0c040' : '#ff3b30', ringW: 2.5, dashed: e.retreating, flash: e.hitT > 0 ? e.hitT : 0,
  });
  if (e.muzzle > 0) muzzleFlash(ctx, e.x + Math.cos(e.angle) * (e.def.weapon === 'rifle' ? 34 : 24), e.y + Math.sin(e.angle) * (e.def.weapon === 'rifle' ? 34 : 24), e.angle);
}

function drawLighting(ctx, dk, ox, oy, z) {
  const { w, h, dpr } = G.view;
  const scale = 0.5;
  const lw = Math.ceil(w * scale), lh = Math.ceil(h * scale);
  if (!lightCanvas) { lightCanvas = document.createElement('canvas'); lctx = lightCanvas.getContext('2d'); }
  if (lightCanvas.width !== lw || lightCanvas.height !== lh) { lightCanvas.width = lw; lightCanvas.height = lh; }
  const l = lctx;
  l.globalCompositeOperation = 'source-over';
  l.clearRect(0, 0, lw, lh);
  l.fillStyle = `rgba(6,10,28,${0.8 * dk})`;
  l.fillRect(0, 0, lw, lh);
  l.globalCompositeOperation = 'destination-out';
  const toS = (x, y) => [(x * z + ox) * scale, (y * z + oy) * scale];
  const hole = (x, y, r, strength = 1) => {
    const [sx, sy] = toS(x, y);
    const rr = r * z * scale;
    if (sx < -rr || sy < -rr || sx > lw + rr || sy > lh + rr) return;
    const g = l.createRadialGradient(sx, sy, rr * 0.15, sx, sy, rr);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = g;
    l.beginPath(); l.arc(sx, sy, rr, 0, Math.PI * 2); l.fill();
  };
  const p = G.player;
  const m = G.map;
  const inside = m.buildingAt(p.x, p.y);
  for (const li of activeLights()) {
    if (li.building) {
      const b = m.buildings.find((bb) => bb.id === li.building);
      if (inside === b) hole(li.x, li.y, li.r * 1.4, 1);
      else hole(li.x, li.y, li.r * 0.6, 0.45);
    } else hole(li.x, li.y, li.r, li.street ? 0.85 : 1);
  }
  const d = derived();
  hole(p.x, p.y, d.seeRadius * 0.85, 0.9);
  if (p.muzzle > 0) hole(p.x, p.y, 150, 1);
  for (const e of G.enemies) if (!e.dead && e.muzzle > 0) hole(e.x, e.y, 120, 0.9);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(lightCanvas, 0, 0, lw, lh, 0, 0, w * dpr, h * dpr);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
}

function drawOverlays(ctx, dk, inView) {
  const p = G.player;
  const t = G.time;
  const d = derived();
  // Enemy markers and health bars
  for (const e of G.enemies) {
    if (e.dead || e.gone) continue;
    const pd = dist(e.x, e.y, p.x, p.y);
    const visible = dk < 0.4 || pd < d.seeRadius || e.spotted > 0 || inFloodlight(e.x, e.y) || litByStatic(e.x, e.y);
    if (!visible) continue;
    if (dk >= 0.4) {
      // Re-draw a crisp outline above the darkness so attackers stay readable.
      ctx.strokeStyle = e.retreating ? '#f0c040' : '#ff3b30';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 4, 0, Math.PI * 2); ctx.stroke();
    }
    // chevron above head (shape cue)
    const hy = e.y - e.radius - 14 + Math.sin(t * 6) * 1.5;
    ctx.fillStyle = e.retreating ? '#f0c040' : '#ff3b30';
    ctx.beginPath(); ctx.moveTo(e.x - 6, hy - 5); ctx.lineTo(e.x + 6, hy - 5); ctx.lineTo(e.x, hy + 2); ctx.closePath(); ctx.fill();
    if (e.aimT > 0) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('!', e.x, hy - 8);
    }
    if (e.hp < e.maxHp) bar(ctx, e.x - 14, e.y + e.radius + 6, 28, 4, e.hp / e.maxHp, '#e74c3c');
    if (e.name !== e.def.name || pd < 140) {
      ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const label = e.name;
      const tw = ctx.measureText(label).width;
      ctx.fillRect(e.x - tw / 2 - 3, e.y + e.radius + 11, tw + 6, 11);
      ctx.fillStyle = '#ffd2c8'; ctx.fillText(label, e.x, e.y + e.radius + 20);
    }
  }
  // NPC name tags when close
  for (const n of G.npcs) {
    if (!n.present || dist(n.x, n.y, p.x, p.y) > 110) continue;
    if (G.map.buildingAt(n.x, n.y) && G.map.buildingAt(n.x, n.y) !== G.map.buildingAt(p.x, p.y)) continue;
    ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center';
    const label = n.def.name;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(n.x - tw / 2 - 4, n.y - 32, tw + 8, 14);
    ctx.fillStyle = '#d6f3ff'; ctx.fillText(label, n.x, n.y - 21);
  }
  // Interaction highlight
  const tg = G.interactTarget;
  if (tg && !G.modal) {
    const pulse = 0.6 + Math.sin(t * 6) * 0.3;
    ctx.strokeStyle = `rgba(255,255,255,${pulse})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(tg.x, tg.y, 19, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Sign markers (Keen Eye highlights them)
  for (const pr of G.map.props) {
    if (!pr.sign) continue;
    if (!G.s.skills.includes('keen_eye') && dist(pr.x, pr.y, p.x, p.y) > 160) continue;
    ctx.strokeStyle = '#b9a4e0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(pr.x, pr.y, 22 + Math.sin(t * 4) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#b9a4e0'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', pr.x, pr.y - 28);
  }
  // Repair progress
  const r = G.repairHold;
  if (r) {
    bar(ctx, p.x - 20, p.y - 30, 40, 6, r.t / r.time, '#5bc0de');
    ctx.fillStyle = '#fff'; ctx.font = '600 9px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Repairing…', p.x, p.y - 34);
  }
  // Floaters
  for (const f of G.floaters) {
    ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
    ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
  // Waypoint marker (on-screen)
  const wp = G.waypoint;
  if (wp && inView(wp.x, wp.y, -20)) {
    const by = wp.y - 34 + Math.sin(t * 3) * 4;
    ctx.fillStyle = '#ffd166';
    ctx.beginPath(); ctx.moveTo(wp.x, by + 10); ctx.lineTo(wp.x - 8, by); ctx.lineTo(wp.x, by - 10); ctx.lineTo(wp.x + 8, by); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a4210'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

function litByStatic(x, y) {
  if (darkness() < 0.4) return true;
  for (const l of activeLights()) {
    if (l.building) continue;
    if ((x - l.x) ** 2 + (y - l.y) ** 2 < (l.r * 0.75) ** 2) return true;
  }
  return false;
}

function drawScreenFx(ctx, ox, oy, z) {
  const { w, h } = G.view;
  const p = G.player;
  const t = G.time;
  const d = derived();
  const toScreen = (x, y) => [x * z + ox, y * z + oy];
  const edgeArrow = (wx, wy, color, label) => {
    const [sx, sy] = toScreen(wx, wy);
    const m = 34;
    if (sx > m && sx < w - m && sy > 70 && sy < h - m) return false;
    const cx = w / 2, cy = h / 2;
    const a = Math.atan2(sy - cy, sx - cx);
    const ex = clamp(sx, m, w - m), ey = clamp(sy, 70, h - m);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
    ctx.fillStyle = color; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-4, 0); ctx.lineTo(-8, 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    if (label) {
      ctx.font = '600 11px system-ui'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      const lx = clamp(ex - Math.cos(a) * 26, 40, w - 40), ly = clamp(ey - Math.sin(a) * 22, 80, h - 20);
      ctx.strokeText(label, lx, ly); ctx.fillStyle = color; ctx.fillText(label, lx, ly);
    }
    return true;
  };
  // Off-screen threats (known attackers)
  for (const e of G.enemies) {
    if (e.dead || e.gone) continue;
    const pd = dist(e.x, e.y, p.x, p.y);
    const known = e.alerted || e.spotted > 0 || pd < d.seeRadius * 1.6 || (G.siege && G.siege.t < 25 && d.showDirections);
    if (known) edgeArrow(e.x, e.y, '#ff4d3a', null);
  }
  // Waypoint arrow
  const wp = G.waypoint;
  if (wp) edgeArrow(wp.x, wp.y, '#ffd166', wp.label);

  // Damage feedback: red vignette + directional wedge + pattern (not colour alone)
  if (G.hitFlash > 0) {
    const a = G.hitFlash;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    g.addColorStop(0, 'rgba(180,0,0,0)');
    g.addColorStop(1, `rgba(200,10,10,${a * 1.2})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  if (G.hurtDir && G.hurtDir.t > 0) {
    const a = G.hurtDir.angle;
    const al = Math.min(1, G.hurtDir.t);
    const [px, py] = toScreen(p.x, p.y);
    ctx.save(); ctx.translate(px, py); ctx.rotate(a);
    ctx.fillStyle = `rgba(255,70,50,${0.8 * al})`;
    ctx.beginPath(); ctx.moveTo(64, 0); ctx.lineTo(44, -14); ctx.lineTo(48, 0); ctx.lineTo(44, 14); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.8 * al})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
  }
  // Low health pulse + text cue
  if (p.hp / d.maxHp < 0.3 && !p.dead) {
    const pulse = (Math.sin(t * 5) + 1) / 2;
    ctx.strokeStyle = `rgba(220,30,30,${0.35 + pulse * 0.35})`;
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
  }
  // Sleeping / transitions
  if (G.sleeping) {
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e8e2d0'; ctx.font = '600 22px system-ui'; ctx.textAlign = 'center';
    ctx.fillText('Z z z …', w / 2, h / 2 - 10);
    ctx.font = '16px system-ui';
    ctx.fillText(G.clockText || '', w / 2, h / 2 + 18);
  }
  if (G.transition && G.transition.fade !== undefined) {
    ctx.fillStyle = `rgba(0,0,0,${G.transition.fade})`; ctx.fillRect(0, 0, w, h);
    if (G.transition.text && G.transition.fade > 0.6) {
      ctx.fillStyle = '#e8e2d0'; ctx.font = '600 20px system-ui'; ctx.textAlign = 'center'; ctx.fillText(G.transition.text, w / 2, h / 2);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Minimap (menu)                                                      */
/* ------------------------------------------------------------------ */
export function drawMinimap(canvas) {
  const m = G.map;
  const parentW = canvas.parentElement ? canvas.parentElement.clientWidth : 500;
  const W = Math.min(640, parentW - 4);
  const s = W / (m.w * TILE);
  canvas.width = W; canvas.height = Math.round(m.h * TILE * s);
  const g = canvas.getContext('2d');
  g.drawImage(m.groundCanvas, 0, 0, canvas.width, canvas.height);
  for (const tr of m.trees.values()) {
    if (tr.chopped) continue;
    g.fillStyle = '#244a2a';
    g.beginPath(); g.arc((tr.cx * TILE + 16) * s, (tr.cy * TILE + 16) * s, Math.max(1.5, 14 * s), 0, Math.PI * 2); g.fill();
  }
  for (const b of m.buildings) {
    g.fillStyle = '#9b7b55'; g.fillRect(b.x * TILE * s, b.y * TILE * s, b.w * TILE * s, b.h * TILE * s);
    g.strokeStyle = '#2a1d10'; g.strokeRect(b.x * TILE * s, b.y * TILE * s, b.w * TILE * s, b.h * TILE * s);
    if (b.name) { g.fillStyle = '#fff'; g.font = '600 10px system-ui'; g.textAlign = 'center'; g.fillText(b.name, (b.x + b.w / 2) * TILE * s, (b.y + b.h / 2) * TILE * s + 3); }
  }
  const dot = (x, y, c, r = 4) => { g.fillStyle = c; g.beginPath(); g.arc(x * s, y * s, r, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke(); };
  for (const n of G.npcs) if (n.present) dot(n.x, n.y, '#5bc0de', 3.5);
  for (const e of G.enemies) if (!e.dead && !e.gone) dot(e.x, e.y, '#e74c3c', 3.5);
  for (const pr of m.props) if (pr.kind === 'car') dot(pr.x, pr.y, '#c0392b', 4);
  if (G.waypoint) dot(G.waypoint.x, G.waypoint.y, '#ffd166', 5);
  dot(G.player.x, G.player.y, '#ffffff', 5);
}
