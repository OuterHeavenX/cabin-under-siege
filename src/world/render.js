// Procedural top-down renderer: pre-rendered ground layer, y-sorted entities,
// tree canopies, roofs that hide when you step inside, and night lighting.
import { G, isNight } from '../game/state.js';
import { TILE } from '../config.js';
import { GR, SO } from './map.js';
import { lowQuality } from '../game/difficulty.js';
import { hash2, dist, clamp } from '../util.js';
import { activeLights, darkness, inFloodlight } from './lights.js';
import { derived } from '../game/progression.js';
import { jobProps } from '../game/jobs.js';
import { questProps } from '../game/quests.js';
import { homeMapId } from '../game/chapters.js';

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

function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const sm = (t) => t * t * (3 - 2 * t);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = sm(xf), v = sm(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = ((pa >> 16) & 255) + (((pb >> 16) & 255) - ((pa >> 16) & 255)) * t;
  const gg = ((pa >> 8) & 255) + (((pb >> 8) & 255) - ((pa >> 8) & 255)) * t;
  const bb = (pa & 255) + ((pb & 255) - (pa & 255)) * t;
  return `rgb(${r | 0},${gg | 0},${bb | 0})`;
}

const NATURAL = new Set([GR.GRASS, GR.DIRT, GR.GRAVEL, GR.GARDEN]);
const BLEND_PRIO = { [GR.GRASS]: 4, [GR.DIRT]: 3, [GR.GARDEN]: 2, [GR.GRAVEL]: 1 };

export function buildGroundCanvas(m) {
  const c = document.createElement('canvas');
  c.width = m.w * TILE; c.height = m.h * TILE;
  const g = c.getContext('2d');
  const grassAt = (cx, cy) => {
    const n = vnoise(cx / 6, cy / 6) * 0.65 + vnoise(cx / 2.3 + 40, cy / 2.3) * 0.35;
    return mixHex('#436d2e', '#679443', Math.min(1, Math.max(0, n * 1.15 - 0.05)));
  };
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      const gt = m.ground[m.idx(cx, cy)];
      const cols = GROUND_COLORS[gt] || GROUND_COLORS[GR.GRASS];
      const h = hash2(cx, cy);
      const x = cx * TILE, y = cy * TILE;
      g.fillStyle = gt === GR.GRASS ? grassAt(cx, cy) : gt === GR.TILEFLOOR ? cols[(cx + cy) & 1] : cols[Math.floor(h * cols.length)];
      g.fillRect(x, y, TILE, TILE);
      detailTile(g, m, gt, cx, cy, x, y, h);
    }
  }
  // Soft edges between natural ground types (grass spills over dirt, dirt over gravel...).
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      const gt = m.ground[m.idx(cx, cy)];
      const x = cx * TILE, y = cy * TILE;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, ny = cy + oy;
        if (!m.inBounds(nx, ny)) continue;
        const nt = m.ground[m.idx(nx, ny)];
        if (nt === gt) continue;
        if (NATURAL.has(gt) && NATURAL.has(nt) && BLEND_PRIO[nt] > BLEND_PRIO[gt]) {
          g.fillStyle = nt === GR.GRASS ? grassAt(nx, ny) : (GROUND_COLORS[nt] || GROUND_COLORS[GR.GRASS])[0];
          for (let k = 0; k < 6; k++) {
            const t = hash2(cx * 7 + k, cy * 13 + ox * 3 + oy * 5);
            const r = 3 + hash2(cx + k, cy - k) * 5;
            const px = ox ? (ox > 0 ? x + TILE - r * 0.6 : x + r * 0.6) : x + t * TILE;
            const py = oy ? (oy > 0 ? y + TILE - r * 0.6 : y + r * 0.6) : y + t * TILE;
            g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
          }
        } else if ((gt === GR.ROAD || gt === GR.SIDEWALK) && NATURAL.has(nt)) {
          // curb shadow along paved edges
          g.fillStyle = 'rgba(0,0,0,0.22)';
          if (ox === 1) g.fillRect(x + TILE - 2, y, 2, TILE); if (ox === -1) g.fillRect(x, y, 2, TILE);
          if (oy === 1) g.fillRect(x, y + TILE - 2, TILE, 2); if (oy === -1) g.fillRect(x, y, TILE, 2);
        } else if (gt === GR.WATER && nt !== GR.WATER) {
          g.fillStyle = 'rgba(214,200,150,0.55)';
          if (ox === 1) g.fillRect(x + TILE - 4, y, 4, TILE); if (ox === -1) g.fillRect(x, y, 4, TILE);
          if (oy === 1) g.fillRect(x, y + TILE - 4, TILE, 4); if (oy === -1) g.fillRect(x, y, TILE, 4);
        } else if ((gt === GR.FLOOR || gt === GR.TILEFLOOR) && m.getSolid(nx, ny) === SO.WALL) {
          // ambient occlusion inside buildings
          const grd = ox ? g.createLinearGradient(ox > 0 ? x + TILE : x, 0, ox > 0 ? x + TILE - 10 : x + 10, 0) : g.createLinearGradient(0, oy > 0 ? y + TILE : y, 0, oy > 0 ? y + TILE - 10 : y + 10);
          grd.addColorStop(0, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(x, y, TILE, TILE);
        }
      }
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

function roundRectG(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
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
    case 'hay':
      for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
        const hx = x + i * TILE, hy = y + j * TILE;
        g.fillStyle = '#c9a44a'; g.fillRect(hx + 2, hy + 3, TILE - 4, TILE - 6);
        g.strokeStyle = '#8a6a2a'; g.lineWidth = 1;
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(hx + 4, hy + 7 + k * 6); g.lineTo(hx + TILE - 4, hy + 6 + k * 6); g.stroke(); }
        g.fillStyle = '#6b4a2b'; g.fillRect(hx + 9, hy + 3, 2, TILE - 6); g.fillRect(hx + 21, hy + 3, 2, TILE - 6);
      }
      break;
    case 'silo':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + w / 2 + 5, y + h / 2 + 6, w / 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#9aa3a8'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w / 2 - 1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#6d7378'; g.lineWidth = 1.5;
      for (let r2 = 8; r2 < w / 2; r2 += 7) { g.beginPath(); g.arc(x + w / 2, y + h / 2, r2, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#c9cdd2'; g.beginPath(); g.arc(x + w / 2 - 6, y + h / 2 - 6, 6, 0, Math.PI * 2); g.fill();
      break;
    case 'tractor':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 6, y + 8, w - 6, h - 6);
      g.fillStyle = '#1f1f1f'; g.fillRect(x + 2, y + 4, 14, 22); g.fillRect(x + w - 16, y + 8, 12, 16);
      g.fillStyle = '#2f7a3a'; g.fillRect(x + 12, y + 10, w - 22, h - 20);
      g.fillStyle = '#d9b84a'; g.fillRect(x + w - 22, y + 18, 8, 4);
      g.fillStyle = '#c9e2f0'; g.fillRect(x + 18, y + 16, 12, 10);
      break;
    case 'windmill':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 20, y + 22, 10, 6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8a8f94'; g.lineWidth = 2;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; g.beginPath(); g.moveTo(x + 16, y + 16); g.lineTo(x + 16 + Math.cos(a) * 15, y + 16 + Math.sin(a) * 15); g.stroke(); }
      g.fillStyle = '#b5523a'; g.beginPath(); g.arc(x + 16, y + 16, 4, 0, Math.PI * 2); g.fill();
      break;
    case 'cows':
      for (const [cx, cy] of [[0, 1], [1, 4], [0, 7]]) {
        const ox = x + cx * TILE + 16, oy = y + cy * TILE + 16;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(ox + 3, oy + 4, 16, 9, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f2efe6'; g.beginPath(); g.ellipse(ox, oy, 15, 9, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#2a2a2a'; g.beginPath(); g.ellipse(ox - 4, oy - 2, 5, 4, 0.4, 0, Math.PI * 2); g.ellipse(ox + 6, oy + 3, 4, 3, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#f2efe6'; g.beginPath(); g.arc(ox + 15, oy - 1, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#e8a0a0'; g.beginPath(); g.arc(ox + 18, oy - 1, 2.5, 0, Math.PI * 2); g.fill();
      }
      break;
    case 'camper':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 6, y + 8, w - 4, h - 4);
      g.fillStyle = '#e8e2d0'; roundRectG(g, x + 2, y + 2, w - 4, h - 4, 8); g.fill();
      g.fillStyle = '#4f7a9a'; g.fillRect(x + 8, y + 10, 18, 12); g.fillRect(x + w - 28, y + 10, 18, 12);
      g.fillStyle = '#b5523a'; g.fillRect(x + 2, y + h / 2 + 6, w - 4, 4);
      g.fillStyle = '#7a5a36'; g.fillRect(x + w / 2 - 6, y + h - 8, 12, 6);
      break;
    case 'gazebo':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(x + w / 2 + 4, y + h / 2 + 5, w / 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e2d0'; g.beginPath();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; const px = x + w / 2 + Math.cos(a) * w / 2, py = y + h / 2 + Math.sin(a) * h / 2; k ? g.lineTo(px, py) : g.moveTo(px, py); }
      g.closePath(); g.fill();
      g.strokeStyle = '#8a7a5a'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#b5523a'; g.beginPath(); g.arc(x + w / 2, y + h / 2, w / 4, 0, Math.PI * 2); g.fill();
      break;
    case 'antenna':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 14, y + 18, 6, 14);
      g.fillStyle = '#9aa0a6'; g.fillRect(x + 13, y + 2, 4, 28);
      g.strokeStyle = '#c9cdd2'; g.lineWidth = 2; g.beginPath(); g.moveTo(x + 3, y + 8); g.lineTo(x + 27, y + 8); g.moveTo(x + 6, y + 14); g.lineTo(x + 24, y + 14); g.stroke();
      break;
    case 'crate':
      g.fillStyle = '#9b7b4a'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.strokeStyle = '#6b4f2a'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
      g.beginPath(); g.moveTo(x + 2, y + 2); g.lineTo(x + w - 2, y + h - 2); g.stroke();
      break;
    default: break;
  }
}

const treeSprites = {};
function treeSprite(kind, v) {
  const key = kind + v;
  if (treeSprites[key]) return treeSprites[key];
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const cx = 32, cy = 30;
  if (kind === 'pine') {
    const layers = [[20, '#1c3d24'], [16, '#25502d'], [11.5, '#2f6337'], [7, '#3d7a45']];
    layers.forEach(([r, col], i) => {
      g.fillStyle = col;
      g.beginPath();
      const pts = 9;
      for (let k = 0; k <= pts * 2; k++) {
        const a = (k / (pts * 2)) * Math.PI * 2 + v * 0.4 + i * 0.3;
        const rr = k % 2 ? r * 0.72 : r;
        const px = cx - i * 1.2 + Math.cos(a) * rr, py = cy - i * 1.6 + Math.sin(a) * rr;
        k ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath(); g.fill();
    });
    g.fillStyle = 'rgba(255,255,220,0.18)'; g.beginPath(); g.arc(cx - 6, cy - 8, 4, 0, Math.PI * 2); g.fill();
  } else {
    const blobs = [[-8, 2, 13], [8, 0, 13], [0, -9, 13], [-2, 6, 11], [5, -4, 10]];
    for (const [ox, oy, r] of blobs) {
      const grd = g.createRadialGradient(cx + ox - 5, cy + oy - 6, 2, cx + ox, cy + oy, r);
      grd.addColorStop(0, v % 2 ? '#6aa04c' : '#62984a'); grd.addColorStop(0.7, '#3c6e30'); grd.addColorStop(1, '#2a5224');
      g.fillStyle = grd; g.beginPath(); g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,210,0.22)';
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(cx - 8 + hash2(v, k) * 12, cy - 12 + hash2(k, v) * 10, 2, 0, Math.PI * 2); g.fill(); }
    if (v === 2) { g.fillStyle = '#c94a3a'; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(cx - 10 + k * 6, cy + (k % 2) * 6 - 4, 1.8, 0, Math.PI * 2); g.fill(); } }
  }
  treeSprites[key] = c;
  return c;
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
  // sun-lit slope / shaded slope
  const grd = w >= h ? g.createLinearGradient(0, 0, 0, h) : g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(0.48, 'rgba(255,255,255,0.02)');
  grd.addColorStop(0.52, 'rgba(0,0,0,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0.26)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.16)';
  if (w >= h) g.fillRect(0, h / 2 - 2, w, 3); else g.fillRect(w / 2 - 2, 0, 3, h);
  // eaves
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 4, w, 4);
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
      g.fillRect(w / 2 - tw / 2 - 6, h / 2 - 9, tw + 12, 18);
      g.fillStyle = '#f5ecd6';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, w / 2, h / 2);
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
  else if (o.weapon === 'molotov') { ctx.fillStyle = '#4a7a3a'; ctx.fillRect(r - 2, -3, 8, 6); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(r + 8, 0, 2.5 + Math.random(), 0, Math.PI * 2); ctx.fill(); }
  else if (o.weapon === 'shotgun' || o.weapon === 'eshotgun') { ctx.fillStyle = '#4a3220'; ctx.fillRect(r - 6, -3, 14, 6); ctx.fillStyle = '#2a2a2a'; ctx.fillRect(r + 6, -2.5, 12, 5); ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(r + 4, 2, 3, 0, Math.PI * 2); ctx.fill(); }
  else if (o.weapon === 'rifle') { ctx.fillStyle = '#3b2a1a'; ctx.fillRect(r - 6, -2.5, 24, 5); ctx.fillStyle = '#222'; ctx.fillRect(r + 10, -1.5, 10, 3); }
  else if (o.weapon === 'bat') {
    const swing = o.swing ? -0.9 * o.swing : 0;
    ctx.save(); ctx.rotate(0.6 + swing); ctx.fillStyle = '#8a6a3d'; ctx.fillRect(r - 4, -3, 22, 6); ctx.restore();
  } else if (o.weapon === 'axe') {
    ctx.save(); ctx.rotate(o.swing ? -1.2 * o.swing + 0.5 : 0.3); ctx.fillStyle = '#7a5a36'; ctx.fillRect(r - 2, -2, 18, 4); ctx.fillStyle = '#bfc5cc'; ctx.fillRect(r + 12, -6, 6, 9); ctx.restore();
  }
  // body
  const bg = ctx.createRadialGradient(-r * 0.25, -r * 0.35, 1, 0, 0, r * 1.1);
  bg.addColorStop(0, shade(o.body, 1.35)); bg.addColorStop(1, shade(o.body, 0.8));
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.75, r * 1.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
  if (o.trim) { ctx.fillStyle = o.trim; ctx.fillRect(-3, -r * 1.0, 6, 4); }
  // head
  ctx.fillStyle = o.skin;
  ctx.beginPath(); ctx.arc(1, 0, r * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
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

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const ENEMY_LOOK = {
  arsonist: { hair: '#3a2a1a', skin: '#d8a888', hat: '#7a4a1a' },
  lieutenant: { hair: '#111', skin: '#d0a07e', hat: '#0e0e12' },
  scout: { hair: '#2a2a2a', skin: '#d8a888', hat: '#3d3d46' },
  enforcer: { hair: '#1a1a1a', skin: '#caa07e', hat: null },
  gunman: { hair: '#1a1a1a', skin: '#e0b494', hat: '#1f2328' },
  sniper: { hair: '#2a2a1a', skin: '#d8a888', hat: '#3d4a2f' },
  truck: { hair: '#000', skin: '#000', hat: null },
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

  // Crops: ripe plants stand tall; picked rows are bare soil until they regrow.
  if (m.cropsPickable) {
    const picked = (G.s.world.picked || {})[m.id] || {};
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (m.ground[m.idx(cx, cy)] !== GR.GARDEN) continue;
      const x = cx * TILE, y = cy * TILE;
      const pd = picked[m.idx(cx, cy)];
      if (pd != null && G.s.time.day - pd < 3) { ctx.fillStyle = '#4e3826'; ctx.fillRect(x + 2, y + 4, TILE - 4, TILE - 8); continue; }
      const hue = (cx * 7 + cy * 13) % 3;
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        const px = x + 6 + i * 10, py = y + 10 + j * 14;
        ctx.fillStyle = '#3f8a3a'; ctx.beginPath(); ctx.ellipse(px, py - 2, 4, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hue === 0 ? '#e67e22' : hue === 1 ? '#c0392b' : '#f1c40f'; ctx.beginPath(); ctx.arc(px + 1, py + 3, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Water shimmer
  ctx.strokeStyle = 'rgba(200,235,255,0.22)';
  ctx.lineWidth = 1.2;
  for (let cy = Math.max(0, Math.floor(vy0 / TILE)); cy <= Math.min(m.h - 1, Math.ceil(vy1 / TILE)); cy++) {
    for (let cx = Math.max(0, Math.floor(vx0 / TILE)); cx <= Math.min(m.w - 1, Math.ceil(vx1 / TILE)); cx++) {
      if (m.ground[cy * m.w + cx] !== GR.WATER) continue;
      const ph = t * 1.5 + hash2(cx, cy) * 6;
      const wx = cx * TILE + 6 + Math.sin(ph) * 4, wy = cy * TILE + 10 + hash2(cy, cx) * 12;
      ctx.beginPath(); ctx.moveTo(wx, wy); ctx.quadraticCurveTo(wx + 6, wy - 3, wx + 12, wy); ctx.stroke();
    }
  }
  // Traps on your property
  if (G.s.home.traps && G.map.id === homeMapId()) {
    for (const tp of G.s.home.traps) {
      const x = tp.cx * TILE + 16, y = tp.cy * TILE + 16;
      if (!inView(x, y)) continue;
      ctx.strokeStyle = '#6d7378'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#9aa0a6';
      const open = tp.armed ? 1 : 0.35;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; ctx.fillRect(x + Math.cos(a) * 9 * open - 1, y + Math.sin(a) * 9 * open - 1, 3, 3); }
      ctx.fillStyle = tp.armed ? '#c0392b' : '#555'; ctx.fillRect(x - 2, y - 2, 4, 4);
    }
  }
  // Spent casings
  for (const c of G.casings || []) {
    if (!inView(c.x, c.y)) continue;
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot);
    ctx.globalAlpha = Math.min(1, (12 - c.t) / 3);
    ctx.fillStyle = c.color; ctx.fillRect(-2, -1, 4, 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

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

  // Favor props
  for (const pr of questProps(m.id)) {
    if (!inView(pr.x, pr.y)) continue;
    if (pr.kind === 'quest_find' && pr.dog) drawDog(ctx, pr.x, pr.y, t);
    if (pr.kind === 'quest_find' && pr.animal === 'calf') drawCalf(ctx, pr.x, pr.y, t);
    else if (pr.kind === 'quest_find') {
      const tw = (Math.sin(t * 5) + 1) / 2;
      ctx.fillStyle = `rgba(255,240,180,${0.5 + tw * 0.5})`;
      ctx.beginPath(); ctx.moveTo(pr.x, pr.y - 7); ctx.lineTo(pr.x + 2, pr.y - 2); ctx.lineTo(pr.x + 7, pr.y); ctx.lineTo(pr.x + 2, pr.y + 2); ctx.lineTo(pr.x, pr.y + 7); ctx.lineTo(pr.x - 2, pr.y + 2); ctx.lineTo(pr.x - 7, pr.y); ctx.lineTo(pr.x - 2, pr.y - 2); ctx.closePath(); ctx.fill();
    } else if (pr.kind === 'quest_chop') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(pr.x - 44, pr.y - 2, 92, 14);
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(pr.x - 46, pr.y - 7, 92, 14);
      ctx.fillStyle = '#b08856'; ctx.beginPath(); ctx.arc(pr.x + 46, pr.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2f5a26'; ctx.beginPath(); ctx.arc(pr.x - 46, pr.y, 16, 0, Math.PI * 2); ctx.fill();
    } else if (pr.kind === 'quest_repair') {
      ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(pr.x - 4, pr.y - 30); ctx.lineTo(pr.x + 10, pr.y - 12); ctx.stroke();
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 14px system-ui'; ctx.textAlign = 'center'; ctx.fillText('⚡', pr.x + 12, pr.y - 30);
    }
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
    else if (pk.kind === 'note' || pk.kind === 'burner' || pk.kind === 'ledger') { ctx.fillStyle = pk.kind === 'burner' ? '#222' : pk.kind === 'ledger' ? '#6b3e1f' : '#f6eed8'; ctx.fillRect(pk.x - 6, pk.y - 8 + bob, 12, 14); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, 13 + Math.sin(t * 6) * 2, 0, Math.PI * 2); ctx.stroke(); }
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
        weapon: p.chopAnim > 0 ? 'axe' : p.weapon === 'rifle' ? 'rifle' : p.weapon === 'shotgun' ? 'shotgun' : 'pistol', swing: p.chopAnim > 0 ? p.chopAnim * 4 : 0, ring: '#ffffff', ringW: 2.5,
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
      if (e.ally && e.downed) ctx.globalAlpha = 0.55;
      drawPerson(ctx, e, { angle: e.downed ? e.angle + 1.4 : e.angle, r: 10, walk: e.downed ? 0 : e.walkPhase, body: d.body, skin: d.skin, hair: d.hair,
        ring: e.ally ? '#6fdc7a' : e.stranger ? '#b9a4e0' : e.deputy ? '#d4af37' : '#5bc0de', ringW: e.ally ? 3 : 2, dashed: !e.named, weapon: e.ally ? 'shotgun' : null, flash: e.hitT > 0 ? e.hitT : 0 });
      ctx.globalAlpha = 1;
      if (e.ally) {
        if (e.muzzle > 0) { e.muzzle -= 1 / 60; muzzleFlash(ctx, e.x + Math.cos(e.angle) * 24, e.y + Math.sin(e.angle) * 24, e.angle); }
        bar(ctx, e.x - 14, e.y + 16, 28, 4, e.hp / 140, '#6fdc7a');
        ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = e.downed ? '#ffb3a7' : '#c9f5cd';
        ctx.fillText(e.downed ? 'RUTH — WOUNDED' : 'RUTH (ALLY)', e.x, e.y + 30);
      }
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

  // Canopies (sprites with a gentle wind sway; fade if something is underneath)
  const lowQ = lowQuality();
  for (const tr of canopies) {
    const x = tr.cx * TILE + 16, y = tr.cy * TILE + 16;
    const hsh = hash2(tr.cx, tr.cy);
    let sh = lowQ ? 0 : Math.sin(t * 1.3 + hsh * 6) * 1.2;
    if (tr.shake > 0) { sh += Math.sin(t * 60) * 2.5; tr.shake -= 1 / 60; }
    let under = dist(x, y, p.x, p.y) < 26;
    if (!under) for (const e of G.enemies) if (!e.dead && dist(x, y, e.x, e.y) < 24) { under = true; break; }
    ctx.globalAlpha = under ? 0.45 : 1;
    ctx.drawImage(treeSprite(tr.kind, Math.floor(hsh * 3)), x - 32 + sh, y - 36);
    ctx.globalAlpha = 1;
  }

  // Fires, smoke and thrown bottles
  drawFires(ctx, t, inView);

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

  if (!lowQuality()) drawSmoke(ctx, m, t);

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
  const lq = lowQuality();
  if (dk > 0.15 && !lq) drawGlow(ctx, dk, inView);
  if (dk > 0.6 && !lq) drawFireflies(ctx, t, dk, vx0, vy0, vx1, vy1);
  // Morning gold / dusk amber grading
  const min = G.s.time.minute;
  if (min > 5.5 * 60 && min < 8.5 * 60) {
    const f = 1 - Math.abs(min - 7 * 60) / 90;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = `rgba(255,200,110,${0.07 * clamp(f, 0, 1)})`;
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
  }
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
  } else if (b.rec.gate) {
    ctx.fillStyle = '#8a8f94';
    for (let k = 0; k < 4; k++) ctx.fillRect(1, 4 + k * 8, TILE - 2, 3);
    ctx.fillRect(1, 2, 4, TILE - 4); ctx.fillRect(TILE - 5, 2, 4, TILE - 4);
    ctx.strokeStyle = '#5b6268'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(3, TILE - 4); ctx.lineTo(TILE - 3, 4); ctx.stroke();
    if (b.rec.reinforced) { ctx.fillStyle = '#c0392b'; ctx.fillRect(TILE / 2 - 3, 2, 6, TILE - 4); }
    if (b.condition < 0.5) { ctx.strokeStyle = '#3a2a1c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(6, 6); ctx.lineTo(14, 20); ctx.stroke(); }
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
  if (b.shuttered) {
    ctx.fillStyle = '#7d858c';
    if (b.vertical) ctx.fillRect(8, 0, 16, TILE); else ctx.fillRect(0, 8, TILE, 16);
    ctx.fillStyle = '#5b6268';
    for (let k = 0; k < 4; k++) { if (b.vertical) ctx.fillRect(8, 3 + k * 8, 16, 2); else ctx.fillRect(3 + k * 8, 8, 2, 16); }
    ctx.fillStyle = '#c9cdd2'; if (b.vertical) { ctx.fillRect(10, 2, 2, 2); ctx.fillRect(20, 28, 2, 2); } else { ctx.fillRect(2, 10, 2, 2); ctx.fillRect(28, 20, 2, 2); }
  } else if (b.boarded) {
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

function drawTruck(ctx, e) {
  ctx.save();
  ctx.translate(e.x, e.y); ctx.rotate(e.angle + Math.PI / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-24, -40, 52, 86);
  ctx.fillStyle = e.dead ? '#1a1a1a' : e.hitT > 0 ? '#5a5d63' : e.def.color; roundRect(ctx, -24, -44, 48, 88, 8); ctx.fill();
  if (!e.dead) {
    ctx.fillStyle = 'rgba(160,200,230,0.7)'; roundRect(ctx, -18, -24, 36, 14, 3); ctx.fill();
    ctx.fillStyle = '#1b1d21'; ctx.fillRect(-20, -4, 40, 44); // open bed
    ctx.strokeStyle = e.def.trim; ctx.lineWidth = 2; ctx.strokeRect(-20, -4, 40, 44);
    ctx.fillStyle = '#9aa0a6'; ctx.fillRect(-26, -50, 52, 6); // push bar
    ctx.fillStyle = '#fff6c4'; ctx.fillRect(-20, -45, 9, 4); ctx.fillRect(11, -45, 9, 4);
  } else {
    ctx.fillStyle = 'rgba(255,140,30,0.5)'; ctx.beginPath(); ctx.arc(0, -6, 14 + Math.sin(performance.now() / 90) * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  if (!e.dead) {
    const w = 46, f = e.hp / e.maxHp;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(e.x - w / 2, e.y - 58, w, 5);
    ctx.fillStyle = '#ff3b30'; ctx.fillRect(e.x - w / 2, e.y - 58, w * f, 5);
  }
}

function drawEnemy(ctx, e, t) {
  if (e.def.vehicle) { drawTruck(ctx, e); return; }
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
    weapon: e.def.weapon === 'srifle' ? 'rifle' : e.def.weapon, swing: e.aimT > 0 && e.def.weapon === 'bat' ? 1 - e.aimT / e.def.telegraph : 0,
    ring: e.retreating ? '#f0c040' : '#ff3b30', ringW: e.def.boss ? 4 : 2.5, dashed: e.retreating, flash: e.hitT > 0 ? e.hitT : 0,
  });
  if (e.def.boss) { ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 8, 0, Math.PI * 2); ctx.stroke(); }
  if (e.trapped > 0) { e.trapped -= 1 / 60; ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(e.x, e.y + 6, 8, 0, Math.PI * 2); ctx.stroke(); }
  if (e.muzzle > 0) muzzleFlash(ctx, e.x + Math.cos(e.angle) * (e.def.weapon === 'rifle' || e.def.weapon === 'srifle' ? 34 : 24), e.y + Math.sin(e.angle) * (e.def.weapon === 'rifle' || e.def.weapon === 'srifle' ? 34 : 24), e.angle);
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
    let ex, ey, a;
    if (document.body.classList.contains('touch')) {
      const [px, py] = toScreen(p.x, p.y);
      a = Math.atan2(sy - py, sx - px);
      const r = Math.min(120, Math.min(w, h) * 0.3);
      ex = px + Math.cos(a) * r; ey = py + Math.sin(a) * r;
    } else {
      a = Math.atan2(sy - h / 2, sx - w / 2);
      ex = clamp(sx, m, w - m); ey = clamp(sy, 70, h - m);
    }
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
  // Soft vignette
  if (!lowQuality()) {
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
  }
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

/* ------------------------------------------------------------------ */
/* Effects                                                             */
/* ------------------------------------------------------------------ */
function drawFires(ctx, t, inView) {
  for (const f of G.fires || []) {
    if (!inView(f.x, f.y, 60)) continue;
    const life = Math.min(1, f.life / 1.5);
    ctx.fillStyle = `rgba(40,20,10,${0.45 * life})`;
    ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
    for (let k = 0; k < 9; k++) {
      const a = k * 2.4 + hash2(k, Math.floor(f.x)) * 6;
      const rr = f.r * 0.7 * hash2(k, Math.floor(f.y));
      const fx = f.x + Math.cos(a) * rr, fy = f.y + Math.sin(a) * rr;
      const fl = 6 + Math.sin(t * 14 + k * 1.7) * 3;
      ctx.fillStyle = `rgba(255,${120 + (k % 3) * 40},30,${0.75 * life})`;
      ctx.beginPath(); ctx.ellipse(fx, fy - fl * 0.4, fl * 0.7, fl, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,235,140,${0.8 * life})`;
      ctx.beginPath(); ctx.ellipse(fx, fy - fl * 0.2, fl * 0.3, fl * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (Math.random() < 0.3) spawnSmokePuff(f.x + (Math.random() - 0.5) * f.r, f.y - 6, 0.6);
  }
  for (const l of G.lobs || []) {
    const k = l.t / l.dur;
    const x = l.sx + (l.tx - l.sx) * k, y = l.sy + (l.ty - l.sy) * k;
    const hgt = Math.sin(k * Math.PI) * 50;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y, 4, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x, y - hgt); ctx.rotate(t * 12);
    ctx.fillStyle = '#4a7a3a'; ctx.fillRect(-3, -6, 6, 10);
    ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(0, -8, 3 + Math.random() * 1.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,140,40,0.5)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(l.tx, l.ty, 34, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
}

function spawnSmokePuff(x, y, scale = 1) {
  G.smoke = G.smoke || [];
  if (G.smoke.length > 60) G.smoke.shift();
  G.smoke.push({ x, y, r: 4 * scale, life: 3.5, max: 3.5, vx: 6 + Math.random() * 6, vy: -14 - Math.random() * 8 });
}

let smokeT = 0;
function drawSmoke(ctx, m, t) {
  // Chimney on the home building.
  const hb = m.homeInfo && m.buildings.find((b) => b.id === m.homeInfo.building);
  if (hb && m.buildingAt(G.player.x, G.player.y) !== hb) {
    smokeT -= 1 / 60;
    if (smokeT <= 0) { smokeT = 0.35; spawnSmokePuff(hb.x * TILE + hb.w * TILE - 42, hb.y * TILE + 16, 1); }
  }
  const insideHome = hb && m.buildingAt(G.player.x, G.player.y) === hb;
  for (const sm of G.smoke || []) {
    sm.life -= 1 / 60;
    if (insideHome && sm.y < hb.y * TILE + 40) continue;
    sm.x += sm.vx / 60; sm.y += sm.vy / 60; sm.r += 0.12;
    const a = Math.max(0, sm.life / sm.max) * 0.35;
    ctx.fillStyle = `rgba(200,200,205,${a})`;
    ctx.beginPath(); ctx.arc(sm.x, sm.y, sm.r, 0, Math.PI * 2); ctx.fill();
  }
  if (G.smoke) G.smoke = G.smoke.filter((sm) => sm.life > 0);
}

/** Warm additive glow for lamps, windows and fire on top of the darkness. */
function drawGlow(ctx, dk, inView) {
  const m = G.map;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const glow = (x, y, r, col, a) => {
    if (!inView(x, y, r)) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  for (const l of activeLights()) {
    if (l.building) continue;
    if (l.fire) glow(l.x, l.y, l.r * 0.8, '255,130,40', 0.35 * dk);
    else if (l.street) glow(l.x, l.y, l.r * 0.55, '255,200,120', 0.22 * dk);
    else glow(l.x, l.y, l.r * 0.5, '255,190,110', 0.25 * dk);
  }
  for (const b of m.blockers.values()) {
    if (b.kind !== 'window' || b.shuttered) continue;
    const x = b.cx * TILE + 16, y = b.cy * TILE + 16;
    glow(x, y, b.boarded ? 22 : 38, '255,200,120', (b.boarded ? 0.15 : 0.3) * dk);
  }
  ctx.restore();
}

let flies = null;
function drawFireflies(ctx, t, dk, x0, y0, x1, y1) {
  if (!flies) flies = Array.from({ length: 26 }, (_, i) => ({ s: Math.random() * 1000, i }));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const w = x1 - x0, h = y1 - y0;
  for (const f of flies) {
    const px = x0 + ((hash2(f.i, 3) * w + Math.sin(t * 0.3 + f.s) * 60) % w + w) % w;
    const py = y0 + ((hash2(3, f.i) * h + Math.cos(t * 0.25 + f.s) * 50) % h + h) % h;
    const on = (Math.sin(t * 2 + f.s) + 1) / 2;
    if (on < 0.4) continue;
    const g = ctx.createRadialGradient(px, py, 0, px, py, 7);
    g.addColorStop(0, `rgba(220,255,120,${0.7 * on * dk})`); g.addColorStop(1, 'rgba(220,255,120,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function drawCalf(ctx, x, y, t) {
  const bob = Math.sin(t * 3) * 1;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 6, 18, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2ece0'; ctx.beginPath(); ctx.ellipse(x, y + bob, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.ellipse(x - 5, y - 2 + bob, 6, 5, 0.4, 0, Math.PI * 2); ctx.ellipse(x + 6, y + 3 + bob, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e8d8c8'; ctx.beginPath(); ctx.ellipse(x + 18, y - 1, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d4af37'; ctx.beginPath(); ctx.arc(x + 14, y + 4, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x, y - 16 + Math.sin(t * 4) * 2);
}

function drawDog(ctx, x, y, t) {
  const wag = Math.sin(t * 14) * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 4, 12, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8873a'; ctx.beginPath(); ctx.ellipse(x, y, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2e6d0'; ctx.beginPath(); ctx.ellipse(x + 2, y + 1, 6, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2a1a'; ctx.beginPath(); ctx.ellipse(x - 2, y - 1, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c8873a'; ctx.beginPath(); ctx.arc(x + 12, y - 1, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b3f1a'; ctx.beginPath(); ctx.ellipse(x + 12, y - 6, 2, 4, 0.3, 0, Math.PI * 2); ctx.ellipse(x + 12, y + 4, 2, 4, -0.3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c8873a'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x - 17, y + wag * 8); ctx.stroke();
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x, y - 14 + Math.sin(t * 4) * 2);
}
