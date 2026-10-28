// Procedural top-down renderer: pre-rendered ground layer, y-sorted entities,
// tree canopies, roofs that hide when you step inside, and night lighting.
import { G, isNight } from '../game/state.js';
import { TILE } from '../config.js';
import { GR, SO } from './map.js';
import { drawWorldFx, drawScreenFlash, fxZoom } from './fx.js';
import { drawGallery } from '../game/townlife.js';
import { lowQuality } from '../game/difficulty.js';
import { drawDecals, drawWorldWeather, drawScreenAtmosphere } from './atmosphere.js';
import { castPoly, lightPoly, FLASH_ANGLE, FLASH_RANGE } from './shadowcast.js';
import { hash2, dist, clamp } from '../util.js';
import { activeLights, darkness, inFloodlight } from './lights.js';
import { derived } from '../game/progression.js';
import { jobProps } from '../game/jobs.js';
import { questProps } from '../game/quests.js';
import { errandProps } from '../game/errands.js';
import { ratProps } from '../game/rat.js';
import { homeMapId } from '../game/chapters.js';
import { ITEMS } from '../data/items.js';
import { REGROW_DAYS } from '../game/activities.js';
import { NATURAL, paintNaturalBase, paintNaturalDetails, paintWater } from './terrain.js';

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
  // Natural ground: smooth, organic base painted at low resolution (terrain.js).
  const flds = paintNaturalBase(g, m);
  paintWater(g, m);
  // Built and paved surfaces: crisp tiles on top.
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      const gt = m.ground[m.idx(cx, cy)];
      if (NATURAL.has(gt)) continue;
      const cols = GROUND_COLORS[gt] || GROUND_COLORS[GR.GRASS];
      const h = hash2(cx, cy);
      const x = cx * TILE, y = cy * TILE;
      if (gt !== GR.WATER) {
        g.fillStyle = gt === GR.TILEFLOOR ? cols[(cx + cy) & 1] : cols[Math.floor(h * cols.length)];
        g.fillRect(x, y, TILE, TILE);
      }
      detailTile(g, m, gt, cx, cy, x, y, h);
    }
  }
  // Edges: curbs, shorelines, and ambient occlusion along interior walls.
  for (let cy = 0; cy < m.h; cy++) {
    for (let cx = 0; cx < m.w; cx++) {
      const gt = m.ground[m.idx(cx, cy)];
      const x = cx * TILE, y = cy * TILE;
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + ox, ny = cy + oy;
        if (!m.inBounds(nx, ny)) continue;
        const nt = m.ground[m.idx(nx, ny)];
        if (nt === gt) continue;
        if ((gt === GR.ROAD || gt === GR.SIDEWALK) && NATURAL.has(nt)) {
          // curb shadow along paved edges
          g.fillStyle = 'rgba(0,0,0,0.22)';
          if (ox === 1) g.fillRect(x + TILE - 2, y, 2, TILE); if (ox === -1) g.fillRect(x, y, 2, TILE);
          if (oy === 1) g.fillRect(x, y + TILE - 2, TILE, 2); if (oy === -1) g.fillRect(x, y, TILE, 2);
        } else if (gt === GR.WATER && nt !== GR.WATER) {
          // a sandy, uneven shoreline with a lighter wet edge
          for (let k = 0; k < 5; k++) {
            const t = (k + 0.5) / 5, r = 2.5 + hash2(cx * 5 + k, cy * 3 + ox + oy * 2) * 3;
            const px = ox ? (ox > 0 ? x + TILE - r * 0.5 : x + r * 0.5) : x + t * TILE;
            const py = oy ? (oy > 0 ? y + TILE - r * 0.5 : y + r * 0.5) : y + t * TILE;
            g.fillStyle = 'rgba(196,182,138,0.75)'; g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
          }
          g.fillStyle = 'rgba(220,240,245,0.22)';
          if (ox === 1) g.fillRect(x + TILE - 7, y, 2, TILE); if (ox === -1) g.fillRect(x + 5, y, 2, TILE);
          if (oy === 1) g.fillRect(x, y + TILE - 7, TILE, 2); if (oy === -1) g.fillRect(x, y + 5, TILE, 2);
        } else if ((gt === GR.FLOOR || gt === GR.TILEFLOOR) && m.getSolid(nx, ny) === SO.WALL) {
          // ambient occlusion inside buildings
          const grd = ox ? g.createLinearGradient(ox > 0 ? x + TILE : x, 0, ox > 0 ? x + TILE - 10 : x + 10, 0) : g.createLinearGradient(0, oy > 0 ? y + TILE : y, 0, oy > 0 ? y + TILE - 10 : y + 10);
          grd.addColorStop(0, 'rgba(0,0,0,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grd; g.fillRect(x, y, TILE, TILE);
        } else if (gt === GR.PORCH && NATURAL.has(nt)) {
          // porch boards cast a small shadow on the ground beside them
          g.fillStyle = 'rgba(0,0,0,0.25)';
          if (oy === 1) g.fillRect(x, y + TILE, TILE, 3); if (ox === 1) g.fillRect(x + TILE, y, 3, TILE);
        }
      }
    }
  }
  paintNaturalDetails(g, m, flds);
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
    // asphalt grain, the odd crack and patch
    for (let k = 0; k < 10; k++) { g.fillStyle = k % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.12)'; g.fillRect(x + hash2(cx * 10 + k, cy) * 31, y + hash2(cx, cy * 10 + k) * 31, 1.4, 1.4); }
    if (h > 0.9) { g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 4 + h * 6, y + 6); g.lineTo(x + 12, y + 14); g.lineTo(x + 10 + h * 8, y + 24); g.stroke(); }
    else if (h < 0.06) { g.fillStyle = 'rgba(20,20,22,0.35)'; g.fillRect(x + 6, y + 8, 14, 10); }
  } else if (gt === GR.PORCH) {
    // weathered porch boards with gaps and nail heads
    for (let i = 0; i < 4; i++) {
      g.fillStyle = hash2(cx * 4 + i, cy) > 0.5 ? 'rgba(255,240,210,0.07)' : 'rgba(60,35,15,0.08)'; g.fillRect(x, y + i * 8, TILE, 7);
      g.fillStyle = 'rgba(40,25,10,0.45)'; g.fillRect(x, y + i * 8 + 7, TILE, 1);
      g.fillStyle = 'rgba(30,20,10,0.5)'; g.fillRect(x + 3, y + i * 8 + 3, 1, 1); g.fillRect(x + TILE - 4, y + i * 8 + 3, 1, 1);
    }
  } else if (gt === GR.FLOOR) {
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
  if (m.stone && m.stone.has(m.idx(cx, cy))) {
    g.fillStyle = '#5d5a55'; g.fillRect(x, y, TILE, TILE);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
      const off = r % 2 ? 6 : 0, bx = x + ((k * 12 + off) % TILE), by = y + r * 8;
      g.fillStyle = hash2(cx * 3 + k, cy * 5 + r) > 0.5 ? '#77736c' : '#6b6760';
      g.fillRect(bx + 1, by + 1, 10, 6);
    }
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x, y + TILE - 3, TILE, 3);
    return;
  }
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
  if (m.hedge && m.hedge.has(m.idx(cx, cy))) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 6, TILE, TILE - 4);
    for (let k = 0; k < 5; k++) { g.fillStyle = k % 2 ? '#2f5a2a' : '#3b6e33'; g.beginPath(); g.arc(x + 5 + k * 6, y + 14 + hash2(cx + k, cy) * 4, 8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.08)'; g.beginPath(); g.arc(x + 12, y + 10, 5, 0, Math.PI * 2); g.fill();
    return;
  }
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
        g.fillStyle = '#4a3423'; g.fillRect(x + i * TILE, y + j * TILE, TILE, TILE);
        for (let r = 0; r < 4; r++) { g.fillStyle = 'rgba(25,15,8,0.35)'; g.fillRect(x + i * TILE, y + j * TILE + 7 + r * 8, TILE, 2); }
        drawCropTile(g, x + i * TILE, y + j * TILE, CROP_KINDS[(d.y + j) % CROP_KINDS.length], 3, 0, d.x + i);
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
    case 'blind':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 4, y + 6, w, h);
      g.fillStyle = '#5a4a2e'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = '#3e5a2a'; for (let k = 0; k < 7; k++) { g.beginPath(); g.arc(x + 6 + k * 13, y + 4 + (k % 2) * 4, 7, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#1a1410'; g.fillRect(x + w / 2 - 14, y + h - 12, 28, 6);
      break;
    case 'scaffold': {
      // A building site: posts, a frame that fills in as the days go by.
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 3, y + 4, w, h);
      g.fillStyle = '#b08a5a'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.strokeStyle = '#6a4a2a'; g.lineWidth = 3;
      for (const [px, py] of [[x + 3, y + 3], [x + w - 3, y + 3], [x + 3, y + h - 3], [x + w - 3, y + h - 3]]) { g.beginPath(); g.arc(px, py, 2.5, 0, Math.PI * 2); g.stroke(); }
      g.lineWidth = 2; g.beginPath(); g.moveTo(x + 3, y + 3); g.lineTo(x + w - 3, y + h - 3); g.moveTo(x + w - 3, y + 3); g.lineTo(x + 3, y + h - 3); g.stroke();
      g.fillStyle = 'rgba(122,86,52,0.9)'; g.fillRect(x + 4, y + h - 6 - (h - 10) * (d.stage || 0), w - 8, (h - 10) * (d.stage || 0));
      break;
    }
    case 'workshop': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 4, y + 5, w, h);
      g.fillStyle = '#6a4a34'; g.fillRect(x, y, w, h);
      g.fillStyle = '#4a3a2a'; for (let i = 0; i < w; i += 6) g.fillRect(x + i, y, 3, h);
      g.fillStyle = '#9a9aa0'; g.fillRect(x + 6, y + h - 14, w - 12, 8);
      g.fillStyle = '#c0392b'; g.fillRect(x + 10, y + 6, 8, 5); g.fillStyle = '#d4af37'; g.fillRect(x + 24, y + 6, 10, 4);
      break;
    }
    case 'watchtower': {
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 10, y + 10, w + 14, h + 6);
      g.strokeStyle = '#5a3a24'; g.lineWidth = 4;
      g.beginPath(); g.moveTo(x + 4, y + h); g.lineTo(x + 12, y + 6); g.moveTo(x + w - 4, y + h); g.lineTo(x + w - 12, y + 6); g.stroke();
      g.fillStyle = '#7a5634'; g.fillRect(x + 2, y - 4, w - 4, h - 18);
      g.fillStyle = '#5a3a24'; g.fillRect(x, y - 10, w, 6);
      g.fillStyle = '#3a2a1a'; g.fillRect(x + 8, y, w - 16, 8);
      break;
    }
    case 'radio': {
      g.strokeStyle = '#9aa0a6'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x + 16, y + 30); g.lineTo(x + 16, y - 6); g.moveTo(x + 8, y + 2); g.lineTo(x + 24, y + 2); g.moveTo(x + 10, y + 10); g.lineTo(x + 22, y + 10); g.stroke();
      g.fillStyle = '#e74c3c'; g.beginPath(); g.arc(x + 16, y - 7, 2.5, 0, Math.PI * 2); g.fill();
      break;
    }
    case 'smokehouse': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 4, y + 5, w, h);
      g.fillStyle = '#5a4030'; g.fillRect(x + 2, y + 2, w - 4, h - 4);
      g.fillStyle = '#3a2a20'; g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x + w / 2, y - 8); g.lineTo(x + w, y + 6); g.closePath(); g.fill();
      g.fillStyle = '#2a2a2a'; g.fillRect(x + w - 14, y - 10, 6, 10);
      g.fillStyle = '#c0782a'; g.fillRect(x + w / 2 - 5, y + h - 14, 10, 10);
      break;
    }
    case 'stall': {
      // Market stall: a counter under a striped awning.
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 6, w, h);
      g.fillStyle = '#7a5634'; g.fillRect(x + 2, y + 10, w - 4, h - 12);
      for (let i = 0; i < w; i += 8) { g.fillStyle = (i / 8) % 2 ? '#e8e2d0' : '#b0302a'; g.fillRect(x + i, y - 4, 8, 12); }
      g.fillStyle = '#d9a441'; g.fillRect(x + 6, y + 12, 6, 5); g.fillStyle = '#6a8a3a'; g.fillRect(x + 16, y + 12, 7, 5); g.fillStyle = '#a3201c'; g.fillRect(x + 28, y + 12, 6, 5);
      break;
    }
    case 'tent': {
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + w / 2 + 3, y + h - 4, w / 2, 8, 0, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 6; i++) { g.fillStyle = i % 2 ? '#f0e6d0' : '#2f5d7a'; g.beginPath(); g.moveTo(x + w / 2, y - 10); g.lineTo(x + (i / 6) * w, y + h); g.lineTo(x + ((i + 1) / 6) * w, y + h); g.closePath(); g.fill(); }
      g.fillStyle = '#d4af37'; g.beginPath(); g.moveTo(x + w / 2, y - 18); g.lineTo(x + w / 2 + 8, y - 14); g.lineTo(x + w / 2, y - 10); g.fill();
      break;
    }
    case 'gallery': {
      // County-fair shooting gallery, seen from the front like the buildings:
      // marquee sign, striped awning, painted backdrop, the duck rail, a counter with prizes.
      const top = y - 44, bot = y + 58;
      g.fillStyle = 'rgba(10,14,8,0.28)'; g.fillRect(x + 8, bot - 2, w, 12); // shadow
      // backdrop: painted sky, sun, clouds, bullseyes
      const sky = g.createLinearGradient(0, y - 18, 0, y + 40); sky.addColorStop(0, '#3f7fb2'); sky.addColorStop(1, '#9fd0e6');
      g.fillStyle = '#4a2c18'; g.fillRect(x, y - 22, w, bot - y + 22);
      g.fillStyle = sky; g.fillRect(x + 6, y - 18, w - 12, 60);
      g.fillStyle = '#f6d24a'; g.beginPath(); g.arc(x + w - 34, y - 2, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.85)';
      for (const [cx2, cy2] of [[x + 30, y - 4], [x + 92, y + 6], [x + 150, y - 6]]) { g.beginPath(); g.arc(cx2, cy2, 5, 0, Math.PI * 2); g.arc(cx2 + 7, cy2 - 3, 7, 0, Math.PI * 2); g.arc(cx2 + 14, cy2, 5, 0, Math.PI * 2); g.fill(); }
      for (const bx of [x + 62, x + 128, x + 194]) {
        for (const [r, col] of [[9, '#f4f1e6'], [6.5, '#c8302a'], [4, '#f4f1e6'], [1.8, '#c8302a']]) { g.fillStyle = col; g.beginPath(); g.arc(bx, y + 18, r, 0, Math.PI * 2); g.fill(); }
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(bx, y + 18, 9, 0, Math.PI * 2); g.stroke();
      }
      // tin waves along the rail the ducks ride on
      for (let row = 0; row < 2; row++) {
        g.fillStyle = row ? '#2f6f9a' : '#4a92bf';
        g.beginPath(); g.moveTo(x + 6, bot - 4);
        for (let xx = x + 6; xx <= x + w - 6; xx += 16) g.quadraticCurveTo(xx + 8, y + 34 + row * 8 - 7, xx + 16, y + 34 + row * 8);
        g.lineTo(x + w - 6, bot - 4); g.closePath(); g.fill();
      }
      g.fillStyle = '#9aa0a6'; g.fillRect(x + 6, y + 52, w - 12, 2); // rail
      // corner posts, red-and-white like a barber pole
      for (const px of [x - 2, x + w - 8]) {
        g.fillStyle = '#f4f1e6'; g.fillRect(px, top + 10, 10, bot - top - 10);
        g.fillStyle = '#c8302a'; for (let yy = top + 12; yy < bot; yy += 10) g.fillRect(px, yy, 10, 4);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(px + 7, top + 10, 3, bot - top - 10);
      }
      // scalloped striped awning
      for (let i = 0; i < w; i += 16) {
        g.fillStyle = (i / 16) % 2 ? '#f4f1e6' : '#c8302a';
        g.fillRect(x + i, y - 28, 16, 8);
        g.beginPath(); g.arc(x + i + 8, y - 20, 8, 0, Math.PI); g.fill();
      }
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x, y - 28, w, 2);
      // marquee sign with light bulbs
      g.fillStyle = '#7a1a14'; g.fillRect(x + 36, top - 2, w - 72, 22);
      g.strokeStyle = '#e8c15a'; g.lineWidth = 2; g.strokeRect(x + 37, top - 1, w - 74, 20);
      for (let xx = x + 42; xx < x + w - 40; xx += 9) { g.fillStyle = '#ffe7a0'; g.beginPath(); g.arc(xx, top + 1.5, 1.6, 0, Math.PI * 2); g.arc(xx, top + 16.5, 1.6, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = '#ffffff'; g.font = 'bold 10px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('SHOOTING GALLERY', x + w / 2, top + 9.5);
      // counter, prizes and the price
      g.fillStyle = '#8a5a34'; g.fillRect(x - 4, bot - 4, w + 8, 6);
      g.fillStyle = '#5e3a20'; g.fillRect(x - 4, bot + 2, w + 8, 6);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x - 4, bot - 4, w + 8, 1);
      for (const [bx, col] of [[x + 14, '#a8743e'], [x + w - 16, '#e88fb0'], [x + w - 30, '#7fa8e8']]) {
        g.fillStyle = col; g.beginPath(); g.arc(bx, bot - 9, 5, 0, Math.PI * 2); g.arc(bx - 4, bot - 14, 2.2, 0, Math.PI * 2); g.arc(bx + 4, bot - 14, 2.2, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(bx, bot - 13, 3.6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#1a1210'; g.fillRect(bx - 1.6, bot - 14, 1, 1); g.fillRect(bx + 0.8, bot - 14, 1, 1);
      }
      g.fillStyle = '#f4ecd6'; g.fillRect(x + w / 2 - 14, bot + 1, 28, 9); g.fillStyle = '#7a1a14'; g.font = 'bold 8px system-ui, sans-serif'; g.fillText('$5 A GO', x + w / 2, bot + 5.8);
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
      // bunting from the posts
      g.strokeStyle = 'rgba(60,40,20,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x + 2, top + 14); g.quadraticCurveTo(x - 30, top + 30, x - 60, top + 18); g.moveTo(x + w - 2, top + 14); g.quadraticCurveTo(x + w + 30, top + 30, x + w + 60, top + 18); g.stroke();
      const flags = ['#c8302a', '#f2d43c', '#3f7fb2', '#f4f1e6'];
      for (let k = 0; k < 5; k++) for (const side of [-1, 1]) {
        const t2 = (k + 0.5) / 5, fx = side < 0 ? x + 2 - t2 * 62 : x + w - 2 + t2 * 62, fy = top + 14 + Math.sin(t2 * Math.PI) * 9;
        g.fillStyle = flags[k % 4]; g.beginPath(); g.moveTo(fx - 3, fy); g.lineTo(fx + 3, fy); g.lineTo(fx, fy + 6); g.fill();
      }
      break;
    }
    case 'irongate':
      if (d.rammed) {
        // Twisted bars on the gravel where Ingrid's truck came through
        g.strokeStyle = '#1b1b1d'; g.lineWidth = 3;
        for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(x + 4 + i * 12, y + 20 + (i % 2) * 6); g.lineTo(x + 10 + i * 11, y + 44 + (i % 3) * 5); g.stroke(); }
        break;
      }
      g.fillStyle = '#141416'; g.fillRect(x, y + 4, w, h - 8);
      g.fillStyle = '#2a2a2e';
      for (let bx = x + 3; bx < x + w - 2; bx += 6) g.fillRect(bx, y - 4, 3, h + 2);
      g.fillStyle = '#c9a227'; g.fillRect(x + w / 2 - 5, y + h / 2 - 5, 10, 10);
      for (let bx = x + 3; bx < x + w - 2; bx += 6) { g.beginPath(); g.moveTo(bx - 1, y - 4); g.lineTo(bx + 1.5, y - 9); g.lineTo(bx + 4, y - 4); g.fill(); }
      break;
    case 'statue':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 19, y + 22, 12, 7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#8d8a84'; g.fillRect(x + 6, y + 18, 20, 10);
      g.fillStyle = '#c9c5bc'; g.beginPath(); g.ellipse(x + 16, y + 14, 7, 9, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + 16, y + 5, 4, 0, Math.PI * 2); g.fill();
      break;
    case 'boat':
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + w / 2 + 3, y + h / 2 + 4, w / 2, h / 2 + 2, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8e2d4'; g.beginPath(); g.moveTo(x + 2, y + 4); g.lineTo(x + w - 14, y + 4); g.quadraticCurveTo(x + w, y + h / 2, x + w - 14, y + h - 4); g.lineTo(x + 2, y + h - 4); g.closePath(); g.fill();
      g.fillStyle = '#2f5d7a'; g.fillRect(x + 6, y + 9, w * 0.45, h - 18);
      g.strokeStyle = '#8a7a5a'; g.lineWidth = 1.5; g.stroke();
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
// Tree sprites, baked once per (kind, palette, size). Deciduous trees are a
// union of leafy clumps lit from the upper left, with leaf texture inside;
// pines are stacked needle tiers; fruit trees carry apples.
const TREE_SIZES = [0.88, 1, 1.12];
const OAK_PALS = [
  ['#24461f', '#3d6b2c', '#5c9440', '#8cc25e'],
  ['#1e3d1b', '#335f27', '#4f8237', '#77ad50'],
  ['#38521d', '#56802b', '#7eab3f', '#b2d466'],
  ['#1f4632', '#356548', '#53896a', '#86b893'],
];
const PINE_PALS = [
  ['#132f1c', '#1d4428', '#2a5c35', '#4d8a52'],
  ['#162d22', '#22443a', '#2f5d4c', '#5a8a72'],
  ['#1a3318', '#284d24', '#386a30', '#5f9550'],
];
export function treeVariant(tr) {
  const h = hash2(tr.cx * 13 + 5, tr.cy * 7 + 3), h2 = hash2(tr.cx * 3 + 11, tr.cy * 17 + 1);
  const pals = tr.kind === 'pine' ? PINE_PALS.length : tr.kind === 'fruit' ? 2 : OAK_PALS.length;
  return { pal: Math.floor(h * pals), size: Math.floor(h2 * TREE_SIZES.length) };
}
function treeSprite(kind, pal, size) {
  const key = `${kind}:${pal}:${size}`;
  if (treeSprites[key]) return treeSprites[key];
  const sc = TREE_SIZES[size] || 1;
  const c = document.createElement('canvas');
  c.width = 96; c.height = 96;
  const g = c.getContext('2d');
  const cx = 48, cy = 44;
  const rng = (k) => hash2(pal * 31 + size * 7 + k, kind.length * 13 + k * 3);
  if (kind === 'pine') {
    const P = PINE_PALS[pal % PINE_PALS.length];
    const tiers = [[24, 0], [19, -5], [14, -10], [9, -14], [4.5, -17]];
    tiers.forEach(([r0, dy], i) => {
      const r = r0 * sc, oy = cy + dy * sc;
      const star = (ox, oyy, rr, rot) => {
        const pts = 11 + (i % 2);
        g.beginPath();
        for (let k = 0; k <= pts * 2; k++) {
          const a = (k / (pts * 2)) * Math.PI * 2 + rot;
          const rk = k % 2 ? rr * 0.68 : rr * (0.92 + rng(k + i * 20) * 0.12);
          const px = ox + Math.cos(a) * rk, py = oyy + Math.sin(a) * rk;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath();
      };
      // tier shadow (down-right), then the tier lit from the upper left
      star(cx + 2, oy + 3, r, i * 0.31); g.fillStyle = 'rgba(8,20,10,0.45)'; g.fill();
      star(cx, oy, r, i * 0.31);
      const grd = g.createLinearGradient(cx - r, oy - r, cx + r, oy + r);
      grd.addColorStop(0, i >= 3 ? P[3] : P[2]); grd.addColorStop(0.55, P[1]); grd.addColorStop(1, P[0]);
      g.fillStyle = grd; g.fill();
      // needle highlights on the sunny side
      g.strokeStyle = P[3]; g.globalAlpha = 0.55; g.lineWidth = 1;
      for (let k = 0; k < 9; k++) {
        const a = Math.PI * (1.0 + rng(k + i * 9) * 0.75), rr = r * (0.45 + rng(k + i * 5) * 0.4);
        const px = cx + Math.cos(a) * rr, py = oy + Math.sin(a) * rr;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * 3, py + Math.sin(a) * 3); g.stroke();
      }
      g.globalAlpha = 1;
    });
  } else {
    const P = kind === 'fruit' ? (pal ? ['#2a4f22', '#447a30', '#68a245', '#9acb63'] : ['#2f5523', '#4a8034', '#6ea84a', '#a2d06c']) : OAK_PALS[pal % OAK_PALS.length];
    const R = 25 * sc;
    const n = 8;
    const clumps = [[0, 0, R * 0.62]];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng(k) * 0.5, d = R * (0.48 + rng(k + 9) * 0.14);
      clumps.push([Math.cos(a) * d, Math.sin(a) * d * 0.92, R * (0.42 + rng(k + 30) * 0.14)]);
    }
    // soft dark underside (gives the canopy volume)
    g.fillStyle = 'rgba(10,25,10,0.5)';
    for (const [ox, oy, r] of clumps) { g.beginPath(); g.arc(cx + ox + 2.5, cy + oy + 3.5, r, 0, Math.PI * 2); g.fill(); }
    // clumps, back to front so lower-right ones read as nearer
    const order = clumps.slice().sort((p, q) => (p[0] + p[1]) - (q[0] + q[1]));
    for (const [ox, oy, r] of order) {
      const grd = g.createRadialGradient(cx + ox - r * 0.45, cy + oy - r * 0.5, r * 0.1, cx + ox, cy + oy, r);
      grd.addColorStop(0, P[3]); grd.addColorStop(0.45, P[2]); grd.addColorStop(0.85, P[1]); grd.addColorStop(1, P[0]);
      g.fillStyle = grd; g.beginPath(); g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2); g.fill();
    }
    // leaf texture, clipped to the canopy
    g.save();
    g.beginPath(); for (const [ox, oy, r] of clumps) { g.moveTo(cx + ox + r, cy + oy); g.arc(cx + ox, cy + oy, r, 0, Math.PI * 2); } g.clip();
    for (let k = 0; k < 140; k++) {
      const a = rng(k * 2) * Math.PI * 2, d = Math.sqrt(rng(k * 2 + 1)) * R * 1.1;
      const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
      const lit = (px - cx) + (py - cy) < -R * 0.15;
      g.fillStyle = lit ? 'rgba(220,255,170,0.22)' : 'rgba(5,25,5,0.25)';
      g.beginPath(); g.ellipse(px, py, 2.2, 1.4, a, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // a rim of sunlight on the upper-left edge
    g.strokeStyle = 'rgba(235,255,190,0.28)'; g.lineWidth = 1.5;
    for (const [ox, oy, r] of clumps) if (ox + oy < -R * 0.2) { g.beginPath(); g.arc(cx + ox, cy + oy, r - 1, Math.PI * 1.05, Math.PI * 1.55); g.stroke(); }
    if (kind === 'fruit') {
      // apples: red with a highlight, more on the sunny side
      for (let k = 0; k < 16; k++) {
        const a = rng(k + 70) * Math.PI * 2, d = (0.25 + rng(k + 90) * 0.7) * R;
        const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
        g.fillStyle = 'rgba(40,10,10,0.4)'; g.beginPath(); g.arc(px + 0.6, py + 0.8, 2.3, 0, Math.PI * 2); g.fill();
        g.fillStyle = pal ? '#d8b23a' : '#c8332c'; g.beginPath(); g.arc(px, py, 2.2, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,240,220,0.75)'; g.fillRect(px - 1, py - 1.2, 1, 1);
      }
    }
  }
  treeSprites[key] = c;
  return c;
}

export const ROOF_RISE = 18; // roofs sit this many pixels above the footprint
const ROOF_PAD = 14;

const FACADES = {
  cabin: ['logs', '#7a5232'], ruth_house: ['siding', '#e8e2d4'], store: ['brick', '#8a4a3a'], diner: ['siding', '#b5523a'],
  chapel: ['stone', '#8d8a84'], henderson: ['siding', '#a8b89a'], miller: ['siding', '#b8aac8'], dee_house: ['siding', '#d9b88a'],
  gus_house: ['siding', '#8a9aa8'], lumber_office: ['logs', '#8a6a3a'],
  house: ['siding', '#a8b8c8'], farmhouse: ['siding', '#ece6d8'], barn: ['boards', '#8f2f24'], ingrid_house: ['siding', '#e2dcc8'],
  coop: ['boards', '#a8884a'], feedstore: ['brick', '#7a4636'], sheriff: ['brick', '#6a6a72'], cafe: ['siding', '#c8a070'],
  manor: ['stone', '#9a958a'], greenhouse: ['glass', '#a8d8d0'], gatehouse: ['stone', '#8a8478'], boathouse: ['logs', '#6a5038'],
  marina: ['siding', '#e8e2d4'], yacht: ['siding', '#f2efe6'],
};

function facadeOf(b) {
  const f = FACADES[b.id];
  if (f) return { style: f[0], color: f[1] };
  const pal = ['#b8a58a', '#a8b4a0', '#c9b89a', '#9aa4ac', '#b89a8a'];
  let h = 0; for (const ch of b.id || 'x') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { style: 'siding', color: pal[h % pal.length] };
}

function shadeHex(hex, f) {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function buildRoofCanvas(b) {
  const w = b.w * TILE, h = b.h * TILE, R = ROOF_RISE;
  const c = document.createElement('canvas');
  c.width = w + ROOF_PAD; c.height = h + R + ROOF_PAD;
  const g = c.getContext('2d');
  const fac = facadeOf(b);
  const roofH = R + h - TILE; // roof covers every row but the front wall, lifted by R
  const glass = fac.style === 'glass';

  // Shadow cast down and to the right, layered so its edge is soft
  for (const [o, a] of [[13, 0.1], [10, 0.1], [7, 0.12]]) {
    g.fillStyle = `rgba(10,14,8,${a})`;
    g.beginPath(); g.moveTo(o - 2, R + o); g.lineTo(w + o, R + o); g.lineTo(w + o, R + h + o); g.lineTo(o, R + h + o); g.closePath(); g.fill();
  }

  // Front wall (facade), one tile tall
  const fy = roofH, fh = R + h - roofH;
  g.fillStyle = fac.color; g.fillRect(0, fy, w, fh);
  if (fac.style === 'logs') {
    for (let yy = fy + 2; yy < fy + fh; yy += 6) { g.fillStyle = shadeHex(fac.color, 0.72); g.fillRect(0, yy + 4, w, 1.5); g.fillStyle = shadeHex(fac.color, 1.15); g.fillRect(0, yy, w, 1.2); }
    g.fillStyle = shadeHex(fac.color, 0.6); for (const xx of [0, w - 5]) g.fillRect(xx, fy, 5, fh);
  } else if (fac.style === 'brick') {
    for (let r = 0, yy = fy; yy < fy + fh; r++, yy += 5) for (let xx = (r % 2) * 6; xx < w; xx += 12) { g.fillStyle = (xx + r) % 3 ? shadeHex(fac.color, 1.06) : shadeHex(fac.color, 0.9); g.fillRect(xx + 0.5, yy + 0.5, 11, 4); }
  } else if (fac.style === 'stone') {
    for (let r = 0, yy = fy; yy < fy + fh; r++, yy += 8) for (let xx = (r % 2) * 9; xx < w; xx += 18) { g.fillStyle = hash2(xx, r) > 0.5 ? shadeHex(fac.color, 1.1) : shadeHex(fac.color, 0.9); g.fillRect(xx + 1, yy + 1, 16, 6.5); }
  } else if (fac.style === 'boards') {
    for (let xx = 0; xx < w; xx += 6) { g.fillStyle = shadeHex(fac.color, xx % 12 ? 1 : 0.85); g.fillRect(xx, fy, 5, fh); }
  } else if (glass) {
    g.fillStyle = 'rgba(200,240,235,0.45)'; g.fillRect(0, fy, w, fh);
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5; for (let xx = 0; xx <= w; xx += 16) { g.beginPath(); g.moveTo(xx, fy); g.lineTo(xx, fy + fh); g.stroke(); }
  } else { // clapboard siding
    for (let yy = fy + 3; yy < fy + fh; yy += 5) { g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(0, yy, w, 1); g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(0, yy + 1, w, 1); }
    g.fillStyle = shadeHex(fac.color, 0.85); g.fillRect(0, fy, 3, fh); g.fillRect(w - 3, fy, 3, fh);
  }
  // weathering: a little grime splashed up from the ground
  { const wg = g.createLinearGradient(0, fy + fh - 12, 0, fy + fh - 4); wg.addColorStop(0, 'rgba(60,45,30,0)'); wg.addColorStop(1, 'rgba(60,45,30,0.22)'); g.fillStyle = wg; g.fillRect(0, fy + fh - 12, w, 8); }
  // stone foundation, then the shadow under the eave
  g.fillStyle = '#4a4540'; g.fillRect(0, fy + fh - 5, w, 5);
  for (let xx = 0, k = 0; xx < w; xx += 9, k++) { g.fillStyle = hash2(xx + b.x * 5, b.y) > 0.5 ? '#6e675e' : '#5f5951'; g.fillRect(xx + 0.5, fy + fh - 4.5, 8, 4); }
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, fy + fh - 5, w, 1);
  // shrubs and flowers planted along homes
  if (!glass && fac.style !== 'brick' && fac.style !== 'stone' && fac.style !== 'boards') {
    for (let xx = 10 + hash2(b.x, b.y) * 20; xx < w - 10; xx += 26 + hash2(xx, b.x) * 30) {
      if (hash2(xx * 3, b.y + 1) < 0.35) continue;
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(xx + 2, fy + fh - 1, 8, 3, 0, 0, Math.PI * 2); g.fill();
      for (const [ox, oy, r, col] of [[-4, -3, 4.5, '#2f5a26'], [3, -4, 5, '#3c6e30'], [0, -6, 4, '#4f8a3a']]) { g.fillStyle = col; g.beginPath(); g.arc(xx + ox, fy + fh - 2 + oy, r, 0, Math.PI * 2); g.fill(); }
      const fl = ['#e86a8a', '#f2d43c', '#f4f1e6', '#b48ad8'][Math.floor(hash2(xx, b.y * 3) * 4)];
      g.fillStyle = fl; for (let k = 0; k < 4; k++) g.fillRect(xx - 4 + hash2(k, xx) * 8, fy + fh - 10 + hash2(xx, k) * 6, 1.6, 1.6);
    }
  }
  const eg = g.createLinearGradient(0, fy, 0, fy + 9);
  eg.addColorStop(0, 'rgba(0,0,0,0.45)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = eg; g.fillRect(0, fy, w, 9);

  // Roof: hip roof along the long axis, lit from the upper left
  const long = w >= roofH;
  const hip = long ? Math.min(roofH / 2, w / 4) : Math.min(w / 2, roofH / 4);
  const base = b.roof;
  const moss = fac.style === 'logs' || fac.style === 'boards' || b.id === 'chapel';
  const slopes = long ? [
    { pts: [[0, 0], [w, 0], [w - hip, roofH / 2], [hip, roofH / 2]], f: 1.18 }, // back slope (lit)
    { pts: [[hip, roofH / 2], [w - hip, roofH / 2], [w, roofH], [0, roofH]], f: 0.82 }, // front slope
    { pts: [[0, 0], [hip, roofH / 2], [0, roofH]], f: 1.05 }, // left hip
    { pts: [[w, 0], [w - hip, roofH / 2], [w, roofH]], f: 0.68 }, // right hip
  ] : [
    { pts: [[0, 0], [w / 2, hip], [w / 2, roofH - hip], [0, roofH]], f: 1.15 },
    { pts: [[w, 0], [w / 2, hip], [w / 2, roofH - hip], [w, roofH]], f: 0.75 },
    { pts: [[0, 0], [w, 0], [w / 2, hip]], f: 1.05 },
    { pts: [[0, roofH], [w, roofH], [w / 2, roofH - hip]], f: 0.85 },
  ];
  for (const sl of slopes) {
    g.save();
    g.beginPath(); sl.pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
    g.fillStyle = glass ? `rgba(190,235,230,${0.35 + (sl.f - 0.7) * 0.4})` : shadeHex(base, sl.f); g.fill();
    g.clip();
    if (!glass) {
      // shingle rows
      for (let yy = 2, r = 0; yy < roofH + 4; yy += 6, r++) {
        for (let xx = (r % 2) * 5 - 5; xx < w; xx += 10) {
          const hv = hash2(xx + b.x * 7, r + b.y * 3);
          g.fillStyle = hv > 0.9 ? 'rgba(0,0,0,0.16)' : hv > 0.75 ? 'rgba(255,255,255,0.07)' : hv < 0.25 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.02)';
          g.fillRect(xx, yy - 5, 9, 5);
          g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(xx, yy - 5, 1, 5);
          if (moss && hash2(xx * 3 + b.x, r * 5 + b.y) > 0.93) { g.fillStyle = 'rgba(90,120,50,0.35)'; g.fillRect(xx + 1, yy - 4, 7, 4); }
        }
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, yy, w, 1);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, yy + 1, w, 1);
      }
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; for (let xx = 0; xx < w; xx += 16) { g.beginPath(); g.moveTo(xx, 0); g.lineTo(xx, roofH); g.stroke(); }
    }
    g.restore();
  }
  // ridge and hip lines
  g.strokeStyle = glass ? 'rgba(255,255,255,0.7)' : shadeHex(base, 0.5); g.lineWidth = 2; g.lineCap = 'round';
  g.beginPath();
  if (long) { g.moveTo(hip, roofH / 2); g.lineTo(w - hip, roofH / 2); g.moveTo(0, 0); g.lineTo(hip, roofH / 2); g.lineTo(0, roofH); g.moveTo(w, 0); g.lineTo(w - hip, roofH / 2); g.lineTo(w, roofH); }
  else { g.moveTo(w / 2, hip); g.lineTo(w / 2, roofH - hip); g.moveTo(0, 0); g.lineTo(w / 2, hip); g.lineTo(w, 0); g.moveTo(0, roofH); g.lineTo(w / 2, roofH - hip); g.lineTo(w, roofH); }
  g.stroke();
  if (!glass) { g.strokeStyle = shadeHex(base, 1.4); g.lineWidth = 1; g.beginPath(); if (long) { g.moveTo(hip, roofH / 2 - 1); g.lineTo(w - hip, roofH / 2 - 1); } else { g.moveTo(w / 2 - 1, hip); g.lineTo(w / 2 - 1, roofH - hip); } g.stroke(); }
  // ridge caps along the top of the roof
  if (!glass && long) for (let xx = hip; xx < w - hip; xx += 6) { g.fillStyle = shadeHex(base, 0.7); g.fillRect(xx, roofH / 2 - 2.5, 5, 4); g.fillStyle = shadeHex(base, 1.3); g.fillRect(xx, roofH / 2 - 2.5, 5, 1); }
  // eave edge with a gutter
  g.fillStyle = shadeHex(base, 0.45); g.fillRect(0, roofH - 2, w, 3);
  if (!glass) { g.fillStyle = 'rgba(190,195,200,0.55)'; g.fillRect(0, roofH, w, 1.5); }
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.5; g.strokeRect(0.75, 0.75, w - 1.5, roofH - 1.5);

  // Chimney on homes (a little box with a lit top and a shaded side)
  if (b.isHome || b.id === 'diner' || b.id === 'gatehouse' || b.id === 'ruth_house' || b.id === 'ingrid_house') {
    const cx = w - 46, cy = Math.max(4, roofH / 2 - 22);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx + 4, cy + 22, 16, 6);
    g.fillStyle = '#7a4a3a'; g.fillRect(cx, cy + 6, 16, 18);
    g.fillStyle = '#5a3428'; g.fillRect(cx + 12, cy + 6, 4, 18);
    for (let k = 0; k < 3; k++) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(cx, cy + 10 + k * 5, 12, 1); }
    g.fillStyle = '#9a6a52'; g.fillRect(cx - 1, cy + 2, 18, 5);
    g.fillStyle = '#1a1414'; g.fillRect(cx + 2, cy + 3, 12, 3);
    b.chimney = { x: cx + 8, y: cy + 3 - R };
  }

  if (b.name && !b.isHome) {
    const label = b.name.toUpperCase();
    g.font = 'bold 12px system-ui, sans-serif';
    const tw = g.measureText(label).width;
    if (tw < w - 8) {
      const ly = long ? roofH * 0.7 : roofH / 2;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect(w / 2 - tw / 2 - 6, ly - 9, tw + 12, 18);
      g.fillStyle = '#f5ecd6';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, w / 2, ly);
    }
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Characters: 3/4-view figures with walking legs, swinging arms,      */
/* clothes per person and the weapon held toward the aim.              */
/* ------------------------------------------------------------------ */
const LOOKS = {
  frank: { style: 'jacket', pants: '#2c3446', shoes: '#2a1a12', stubble: true },
  ruth: { style: 'cardigan', pants: '#5a4a3a', female: true, glasses: true, bun: true },
  dee: { style: 'apron', pants: '#3a3550', female: true, curls: true },
  gus: { style: 'work', pants: '#3b3b2e', bulk: 1.15, beard: true },
  marcus: { style: 'cardigan', pants: '#3a3a40', glasses: true, bald: true },
  rosa: { style: 'work', pants: '#2b2b38', female: true, long: true },
  pete: { style: 'work', pants: '#2e3f55', hatKind: 'cap', hatCol: '#2f5878', beard: true, bulk: 1.1 },
  ingrid: { style: 'flannel', pants: '#3e4a5e', female: true, braid: true },
  bo: { style: 'overalls', pants: '#3b4f6e', beard: true, bulk: 1.15 },
  tess: { style: 'flannel', pants: '#2e2e36', female: true },
  eleanor: { style: 'dress', female: true, pearls: true },
  theo: { style: 'work', pants: '#3a3a44', glasses: true },
  walt: { style: 'flannel', pants: '#3a3a2e', hatKind: 'cap', hatCol: '#3c4a2c' },
  stranger: { style: 'coat', pants: '#2a2a2e', hatKind: 'fedora', hatCol: '#2b2d31' },
  deputy: { style: 'uniform', pants: '#4a4030', hatKind: 'trooper', hatCol: '#6b5a3a' },
  reyes: { style: 'suit', pants: '#1d2230', female: true, bun: true },
  scout: { style: 'work', pants: '#2a2c33', hatKind: 'beanie', hatCol: '#3d3d46' },
  gunman: { style: 'coat', pants: '#1f2228', hatKind: 'fedora', hatCol: '#1f2328' },
  enforcer: { style: 'work', pants: '#232020', bulk: 1.3, bald: true },
  arsonist: { style: 'work', pants: '#3a2a1a', hatKind: 'beanie', hatCol: '#7a4a1a' },
  sniper: { style: 'flannel', pants: '#2f3a25', hatKind: 'cap', hatCol: '#3d4a2f' },
  handler: { style: 'coat', pants: '#2e281e', hatKind: 'cap', hatCol: '#4a3a24' },
  lieutenant: { style: 'suit', pants: '#121216', bulk: 1.2, hatKind: 'fedora', hatCol: '#0e0e12' },
  dom: { style: 'suit', pants: '#141418', tie: '#f4f2ee', glasses: true, bald: true },
  angie: { style: 'apron', pants: '#2b2b38', female: true, curls: true },
  mickey: { style: 'work', pants: '#2e3a30', bulk: 1.1 },
  leo: { style: 'suit', pants: '#111114', tie: '#8b0000' },
  guard: { style: 'suit', pants: '#16161a', tie: '#2a2a2a' },
};

function drawPerson(ctx, e, o) {
  const look = o.look || LOOKS[e.type] || LOOKS[e.id] || (e === G.player ? LOOKS.frank : {});
  const r = o.r || 10;
  const s = (r / 10) * (look.bulk ? 1 + (look.bulk - 1) * 0.5 : 1);
  const a = o.angle;
  const fx = Math.cos(a), fy = Math.sin(a);
  const facingBack = fy < -0.35, facingFront = fy > 0.35;
  const flip = fx < 0 ? -1 : 1;
  const walk = o.walk || 0;
  const moving = Math.abs(Math.sin(walk)) > 0.01;
  const jitter = o.flash > 0 ? (Math.random() - 0.5) * 2.5 : 0;
  const x = e.x + jitter, y = e.y;
  const gy = y + 9 * s; // ground under the feet
  const bob = moving ? Math.abs(Math.sin(walk)) * 1.2 * s : (o.downed ? 0 : (Math.sin(G.time * 2.2 + e.x * 0.05) + 1) * 0.3 * s);
  const body = o.body, dark = shade(body, 0.6), light = shade(body, 1.3);
  const pants = look.pants || shade(body, 0.55);

  // Ground ring (team colour + shape) and a soft contact shadow
  ctx.fillStyle = 'rgba(10,12,8,0.18)';
  ctx.beginPath(); ctx.ellipse(x + 2.5, gy + 0.5, 11 * s, 4.6 * s, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(10,12,8,0.3)';
  ctx.beginPath(); ctx.ellipse(x + 1.5, gy, 7.5 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  if (o.ring) {
    const rx = (r + 4) * 1.05, ry = (r + 4) * 0.48;
    if (o.ringBack) { ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = (o.ringW || 2) + 2; ctx.beginPath(); ctx.ellipse(x, gy - 1, rx, ry, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.strokeStyle = o.ring; ctx.lineWidth = o.ringW || 2;
    if (o.dashed) ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(x, gy - 1, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    if (o.ticks) { // hostile: four tick marks, so it doesn't rely on colour alone
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * (rx - 1), gy - 1 + dy * (ry - 1)); ctx.lineTo(x + dx * (rx + 4), gy - 1 + dy * (ry + 2.5)); }
      ctx.stroke();
    }
  }

  ctx.save();
  if (o.downed) { ctx.translate(x, gy); ctx.rotate(1.45 * flip); ctx.translate(-x, -gy); }
  ctx.translate(x, gy - bob);
  ctx.scale(s, s);

  // Legs (stride from the walk phase)
  const st = moving ? Math.sin(walk) : 0;
  const legW = look.style === 'dress' ? 0 : 3.6;
  const legs = (front) => {
    const k = front ? 1 : -1;
    const lift = Math.max(0, st * k) * 2.2;
    const lx = (front ? 2.2 : -2.2) + (facingFront || facingBack ? 0 : st * k * 2.4 * flip);
    ctx.fillStyle = 'rgba(12,8,6,0.75)'; ctx.fillRect(lx - legW / 2 - 0.6, -10, legW + 1.2, 10.4 - lift);
    ctx.fillStyle = pants; ctx.fillRect(lx - legW / 2, -10, legW, 10 - lift);
    ctx.fillStyle = look.shoes || '#1a1414'; ctx.beginPath(); ctx.ellipse(lx + (facingFront || facingBack ? 0 : 1 * flip), -lift - 0.5, 2.6, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  };
  if (legW) { legs(false); legs(true); }

  // Arms + weapon (behind the body when facing away)
  const drawArms = () => {
    const sx = 0, sy = -16;
    const dx = fx, dy = fy * 0.7;
    const recoil = (o.muzzle > 0 ? 2.5 : 0);
    const reach = 8 - recoil + (o.reach || 0) * 4;
    const hx = sx + dx * reach, hy = sy + 6 + dy * reach;
    ctx.lineCap = 'round';
    for (const [col, lw] of [['rgba(12,8,6,0.7)', 4.6], [shade(body, 0.85), 3.2]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(sx - 3.5 * flip, sy + 1); ctx.lineTo(hx - 1 * flip, hy + 1); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx + 3.5 * flip, sy + 1); ctx.lineTo(hx, hy); ctx.stroke();
    }
    ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(hx, hy, 1.9, 0, Math.PI * 2); ctx.fill();
    drawHeldWeapon(ctx, o, hx, hy, Math.atan2(dy, dx), flip);
  };
  const armed = !!o.weapon;
  if (armed && facingBack) drawArms();

  // Torso
  const tw = 6.8, top = -21, hip = look.style === 'coat' ? -6 : look.style === 'dress' ? -1 : -9;
  const tg = ctx.createLinearGradient(-tw, top, tw, hip);
  tg.addColorStop(0, light); tg.addColorStop(1, dark);
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(-tw + 1, top); ctx.lineTo(tw - 1, top);
  ctx.quadraticCurveTo(tw + 0.5, top + 1, tw, top + 4);
  ctx.lineTo(look.style === 'dress' ? tw + 2.5 : tw - 0.5, hip);
  ctx.lineTo(look.style === 'dress' ? -tw - 2.5 : -tw + 0.5, hip);
  ctx.lineTo(-tw, top + 4); ctx.quadraticCurveTo(-tw - 0.5, top + 1, -tw + 1, top);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(12,8,6,0.85)'; ctx.lineWidth = 1.3; ctx.stroke();
  // Clothing details (front only where it matters)
  if (!facingBack) torsoDetails(ctx, look, o, tw, top, hip);
  else { ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(-0.5, top + 2, 1, hip - top - 3); }
  if (o.trim) { ctx.fillStyle = o.trim; ctx.fillRect(-tw + 0.5, top + 5, 2.4, 3); } // armband
  if (!armed) { // relaxed arms swing while walking
    ctx.strokeStyle = shade(body, 0.85); ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const k of [-1, 1]) { const sw = st * k * 2; ctx.beginPath(); ctx.moveTo(k * (tw - 0.8), top + 2); ctx.lineTo(k * (tw + 0.2) + sw * flip * 0.5, top + 11); ctx.stroke(); ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(k * (tw + 0.2) + sw * flip * 0.5, top + 12, 1.6, 0, Math.PI * 2); ctx.fill(); }
  }

  // Head
  const hy = top - 5.5;
  ctx.fillStyle = o.skin; ctx.fillRect(-1.8, top - 2, 3.6, 2.5); // neck
  ctx.beginPath(); ctx.arc(0, hy, 5.4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(12,8,6,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
  drawHair(ctx, look, o, hy, facingBack, facingFront, flip);
  if (!facingBack) drawFace(ctx, look, o, hy, facingFront, flip);
  drawHat(ctx, look, o, hy, flip);
  // rim light
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(-1.8, hy - 2, 2.2, 0, Math.PI * 2); ctx.fill();

  if (armed && !facingBack) drawArms();
  ctx.restore();

  if (o.hurt > 0) {
    ctx.save(); ctx.globalAlpha = Math.min(0.55, o.hurt); ctx.fillStyle = '#ff3b30';
    ctx.beginPath(); ctx.ellipse(x, y - 4 * s, 8 * s, 15 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (o.flash > 0) {
    ctx.save(); ctx.globalAlpha = Math.min(0.7, o.flash * 4); ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(x, y - 4 * s, 7 * s, 14 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
}

function torsoDetails(ctx, look, o, tw, top, hip) {
  switch (look.style) {
    case 'coat':
      ctx.fillStyle = '#d8d2c4'; ctx.beginPath(); ctx.moveTo(-2.4, top); ctx.lineTo(0, top + 5); ctx.lineTo(2.4, top); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-2.4, top); ctx.lineTo(-1, hip); ctx.moveTo(2.4, top); ctx.lineTo(1, hip); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-tw + 0.5, top + 9, tw * 2 - 1, 1.2); // belt
      break;
    case 'jacket': // Frank's leather jacket over a pale shirt
      ctx.fillStyle = '#e6dfcf'; ctx.beginPath(); ctx.moveTo(-2.2, top); ctx.lineTo(0, top + 5); ctx.lineTo(2.2, top); ctx.fill();
      ctx.fillStyle = 'rgba(30,18,10,0.55)'; ctx.beginPath(); ctx.moveTo(-tw + 1, top); ctx.lineTo(-2.4, top); ctx.lineTo(-1.2, top + 7); ctx.lineTo(-tw + 1.5, top + 4); ctx.fill(); ctx.beginPath(); ctx.moveTo(tw - 1, top); ctx.lineTo(2.4, top); ctx.lineTo(1.2, top + 7); ctx.lineTo(tw - 1.5, top + 4); ctx.fill(); // collar
      ctx.strokeStyle = 'rgba(20,12,6,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(0.4, top + 5); ctx.lineTo(0.4, hip); ctx.stroke(); // zip
      ctx.fillStyle = 'rgba(255,230,200,0.14)'; ctx.fillRect(-tw + 1.2, top + 2, 2, hip - top - 4); // leather sheen
      ctx.fillStyle = 'rgba(20,12,6,0.45)'; ctx.fillRect(-tw + 0.5, hip - 2, tw * 2 - 1, 2); // waistband
      break;
    case 'suit':
      ctx.fillStyle = '#e8e4da'; ctx.beginPath(); ctx.moveTo(-2.6, top); ctx.lineTo(0, top + 6); ctx.lineTo(2.6, top); ctx.fill();
      ctx.fillStyle = look.tie || '#7a0e12'; ctx.fillRect(-0.7, top + 1, 1.4, 6);
      break;
    case 'cardigan':
      ctx.fillStyle = '#ece4d4'; ctx.fillRect(-1.6, top, 3.2, hip - top);
      ctx.fillStyle = '#d0c4b0'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, top + 3 + i * 3.5, 0.7, 0, Math.PI * 2); ctx.fill(); }
      break;
    case 'apron': ctx.fillStyle = '#eee6d4'; ctx.fillRect(-4.5, top + 4, 9, hip - top - 3); break;
    case 'overalls': ctx.fillStyle = look.pants; ctx.fillRect(-4.6, top + 6, 9.2, hip - top - 5); ctx.fillRect(-4, top, 1.6, 7); ctx.fillRect(2.4, top, 1.6, 7); break;
    case 'flannel':
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(i * 2.8, top + 1); ctx.lineTo(i * 2.8, hip); ctx.stroke(); }
      for (let yy = top + 3; yy < hip; yy += 3.5) { ctx.beginPath(); ctx.moveTo(-tw + 1, yy); ctx.lineTo(tw - 1, yy); ctx.stroke(); }
      break;
    case 'uniform':
      ctx.fillStyle = '#d4af37'; ctx.beginPath(); ctx.arc(-3, top + 4, 1.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-tw + 0.5, top + 9, tw * 2 - 1, 1.4);
      break;
    case 'dress':
      if (look.pearls) { ctx.fillStyle = '#f1ece0'; for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.arc(i * 1.3, top + 1.5 + Math.abs(i) * -0.3, 0.7, 0, Math.PI * 2); ctx.fill(); } }
      break;
    default: // work shirt: collar
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.moveTo(-2.4, top); ctx.lineTo(0, top + 3); ctx.lineTo(2.4, top); ctx.fill();
  }
}

function drawHair(ctx, look, o, hy, back, front, flip) {
  if (look.bald) {
    ctx.fillStyle = o.hair; ctx.beginPath(); ctx.arc(0, hy + 0.5, 5.5, Math.PI * 0.85, Math.PI * 1.15); ctx.fill();
    ctx.beginPath(); ctx.arc(0, hy + 0.5, 5.5, -Math.PI * 0.15, Math.PI * 0.15); ctx.fill();
    return;
  }
  ctx.fillStyle = o.hair;
  if (back) { ctx.beginPath(); ctx.arc(0, hy, 5.6, 0, Math.PI * 2); ctx.fill(); }
  else {
    ctx.beginPath(); ctx.arc(0, hy - 0.6, 5.6, Math.PI, 0); ctx.fill(); // crown
    if (!front) { ctx.beginPath(); ctx.arc(-1.5 * flip, hy, 4.8, Math.PI * 0.5, Math.PI * 1.5, flip < 0); ctx.fill(); }
  }
  if (look.bun) { ctx.beginPath(); ctx.arc(back ? 0 : -3 * flip, hy - 5, 2.4, 0, Math.PI * 2); ctx.fill(); }
  if (look.long || look.curls) { ctx.fillRect(-5.6, hy - 1, 2.2, look.long ? 9 : 6); ctx.fillRect(3.4, hy - 1, 2.2, look.long ? 9 : 6); }
  if (look.curls) for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(-4.5 + i * 1.8, hy - 4.8 + (i % 2), 1.6, 0, Math.PI * 2); ctx.fill(); }
  if (look.braid) { for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc((back ? 0 : -3.5 * flip), hy + 3 + i * 2.4, 1.6, 0, Math.PI * 2); ctx.fill(); } }
}

function drawFace(ctx, look, o, hy, front, flip) {
  ctx.fillStyle = '#1a1210';
  if (front) {
    ctx.fillRect(-2.4, hy - 0.4, 1.2, 1.3); ctx.fillRect(1.2, hy - 0.4, 1.2, 1.3);
    ctx.fillStyle = 'rgba(80,30,25,0.6)'; ctx.fillRect(-1.2, hy + 2.6, 2.4, 0.7);
  } else {
    ctx.fillRect(2.2 * flip - 0.6, hy - 0.5, 1.2, 1.3);
    ctx.fillStyle = shade(o.skin, 0.85); ctx.beginPath(); ctx.arc(5 * flip, hy + 0.8, 1.2, 0, Math.PI * 2); ctx.fill(); // nose
  }
  if (look.glasses) { ctx.strokeStyle = 'rgba(20,20,20,0.85)'; ctx.lineWidth = 0.7; if (front) { ctx.strokeRect(-3, hy - 1, 2.4, 2); ctx.strokeRect(0.6, hy - 1, 2.4, 2); } else ctx.strokeRect(1.4 * flip - 1.2, hy - 1, 2.6, 2); }
  if (look.beard) { ctx.fillStyle = shade(o.hair, 0.9); ctx.beginPath(); ctx.arc(front ? 0 : 1.5 * flip, hy + 2.6, 3.6, 0, Math.PI); ctx.fill(); }
  else if (look.stubble) { ctx.fillStyle = 'rgba(30,20,20,0.3)'; ctx.beginPath(); ctx.arc(front ? 0 : 1.5 * flip, hy + 2.2, 3.4, 0, Math.PI); ctx.fill(); }
}

function drawHat(ctx, look, o, hy, flip) {
  const k = look.hatKind || (o.hat ? 'beanie' : null);
  if (!k) return;
  const col = look.hatCol || o.hat || '#222';
  ctx.fillStyle = col;
  if (k === 'fedora' || k === 'trooper') {
    ctx.beginPath(); ctx.ellipse(0, hy - 3.2, k === 'trooper' ? 8.4 : 7.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-4.6, hy - 3); ctx.lineTo(-4, hy - 8.4); ctx.quadraticCurveTo(0, hy - (k === 'trooper' ? 11 : 9.6), 4, hy - 8.4); ctx.lineTo(4.6, hy - 3); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(-4.4, hy - 4.8, 8.8, 1.3);
  } else if (k === 'cap') {
    ctx.beginPath(); ctx.arc(0, hy - 1.8, 5.6, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(3.6 * flip, hy - 1.8, 3.6, 1.2, 0, 0, Math.PI * 2); ctx.fill();
  } else { // beanie
    ctx.beginPath(); ctx.arc(0, hy - 1.2, 5.8, Math.PI, 0); ctx.fill();
    ctx.fillStyle = shade(col, 1.25); ctx.fillRect(-5.8, hy - 1.8, 11.6, 1.6);
  }
}

function drawHeldWeapon(ctx, o, hx, hy, ang, flip) {
  ctx.save();
  ctx.translate(hx, hy); ctx.rotate(ang);
  if (Math.cos(ang) < 0) ctx.scale(1, -1);
  const w = o.weapon;
  if (w === 'pistol') { ctx.fillStyle = '#1c1c1c'; ctx.fillRect(-1, -1.6, 8, 3); ctx.fillRect(-1, -0.4, 2.2, 3.4); }
  else if (w === 'shotgun' || w === 'eshotgun') { ctx.fillStyle = '#5a3a22'; ctx.fillRect(-7, -1.2, 7, 3.2); ctx.fillStyle = '#262626'; ctx.fillRect(0, -1.6, 13, 2.4); ctx.fillStyle = '#4a3220'; ctx.fillRect(4, 0.6, 5, 1.6); }
  else if (w === 'rifle') { ctx.fillStyle = '#4a3220'; ctx.fillRect(-8, -1, 12, 3); ctx.fillStyle = '#222'; ctx.fillRect(3, -1.4, 13, 2); ctx.fillStyle = '#111'; ctx.fillRect(1, -3.4, 6, 1.6); }
  else if (w === 'molotov') { ctx.fillStyle = '#3f6e32'; ctx.fillRect(0, -1.6, 5, 3.2); ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(6.5, 0, 1.6 + Math.random() * 0.8, 0, Math.PI * 2); ctx.fill(); }
  else if (w === 'bat') { ctx.rotate(-0.9 + (o.swing ? -1.6 * o.swing : 0)); ctx.fillStyle = '#8a6a3d'; ctx.fillRect(0, -1.2, 15, 2.6); }
  else if (w === 'axe') { ctx.rotate(o.swing ? -1.4 * o.swing + 0.6 : -0.6); ctx.fillStyle = '#7a5a36'; ctx.fillRect(0, -0.9, 13, 1.9); ctx.fillStyle = '#c4cad1'; ctx.fillRect(9.5, -4, 4, 6); }
  ctx.restore();
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
  handler: { hair: '#3a2a1a', skin: '#d8a888', hat: '#4a3a24' },
};

/* ------------------------------------------------------------------ */
/* Main render                                                         */
/* ------------------------------------------------------------------ */
export function render(ctx) {
  const m = G.map;
  const cam = G.camera;
  const { w, h, dpr } = G.view;
  const z = cam.zoom * fxZoom();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1d2a18';
  ctx.fillRect(0, 0, w * dpr, h * dpr);
  if (!m || !G.player) return;
  const kx = G.fx ? G.fx.kickX : 0, ky = G.fx ? G.fx.kickY : 0;
  const ox = w / 2 - cam.x * z + cam.shakeX + kx, oy = h / 2 - cam.y * z + cam.shakeY + ky;
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
  ctx.imageSmoothingEnabled = false;

  const vx0 = cam.x - w / 2 / z - TILE, vy0 = cam.y - h / 2 / z - TILE;
  const vx1 = cam.x + w / 2 / z + TILE, vy1 = cam.y + h / 2 / z + TILE;
  const inView = (x, y, pad = 40) => x > vx0 - pad && x < vx1 + pad && y > vy0 - pad && y < vy1 + pad;

  // Ground
  const sx = Math.max(0, Math.floor(vx0)), sy = Math.max(0, Math.floor(vy0));
  const sw = Math.min(m.groundCanvas.width - sx, Math.ceil(vx1 - vx0)), sh = Math.min(m.groundCanvas.height - sy, Math.ceil(vy1 - vy0));
  if (sw > 0 && sh > 0) ctx.drawImage(m.groundCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
  drawDecals(ctx, inView);
  for (const b of G.boats || []) {
    const bob = Math.sin(G.time * 2 + b.x) * 1.5;
    ctx.save(); ctx.translate(b.x, b.y + bob); ctx.rotate(b.a);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(3, 4, 30, 11, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1c1c22'; ctx.beginPath(); ctx.moveTo(-28, -9); ctx.lineTo(16, -9); ctx.quadraticCurveTo(32, 0, 16, 9); ctx.lineTo(-28, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8b0d12'; ctx.fillRect(-26, -2, 40, 3);
    ctx.fillStyle = 'rgba(160,200,230,0.6)'; ctx.fillRect(-6, -6, 10, 12);
    ctx.restore();
  }
  if (m.homeInfo && G.s.home.upgrades.safeRoom) {
    const bed = m.props.find((pr) => pr.id === 'bed');
    if (bed) {
      ctx.strokeStyle = 'rgba(160,170,180,0.55)'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.strokeRect(bed.x - 50, bed.y - 50, 100, 100); ctx.setLineDash([]);
      for (const [x, y] of [[-50, -50], [50, -50], [-50, 50], [50, 50]]) { ctx.fillStyle = '#7d858e'; ctx.fillRect(bed.x + x - 3, bed.y + y - 3, 6, 6); }
    }
  }

  const t = G.time;
  const cx0 = Math.max(0, Math.floor(vx0 / TILE)), cy0 = Math.max(0, Math.floor(vy0 / TILE));
  const cx1 = Math.min(m.w - 1, Math.ceil(vx1 / TILE)), cy1 = Math.min(m.h - 1, Math.ceil(vy1 / TILE));

  // Crops: each row grows one crop. Picked cells show the real regrowth:
  // bare soil, then sprouts, then young plants, then ripe again.
  {
    const picked = m.cropsPickable ? ((G.s.world.picked || {})[m.id] || {}) : null;
    const lowQ0 = lowQuality();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (m.ground[m.idx(cx, cy)] !== GR.GARDEN || m.solid[m.idx(cx, cy)] !== SO.NONE) continue;
      const pd = picked ? picked[m.idx(cx, cy)] : null;
      const age = pd != null ? G.s.time.day - pd : 99;
      const stage = age >= REGROW_DAYS ? 3 : Math.max(0, Math.min(2, age));
      const kind = CROP_KINDS[(cy + (m.id.length % 2)) % CROP_KINDS.length];
      // pre-rendered tiles; tall crops get a few wind frames
      const frame = lowQ0 || stage < 2 || (kind !== 'corn' && kind !== 'tomato') ? 1 : Math.floor((Math.sin(t * 1.6 + cx * 0.7) + 1) * 1.5) % 3;
      ctx.drawImage(cropSprite(kind, stage, frame), cx * TILE - CROP_PAD, cy * TILE - CROP_PAD);
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
    // soft shadow cast down-right (same sun as the buildings), then the trunk
    ctx.fillStyle = 'rgba(10,20,8,0.16)';
    ctx.beginPath(); ctx.ellipse(x + 9, y + 4, 27, 16, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 7, y + 3, 20, 11, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#4a3220'; ctx.fillRect(x - 3.5, y - 10, 7, 16);
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(x - 3.5, y - 10, 3, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x, y + 6, 6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
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
  for (const pr of [...questProps(m.id), ...errandProps(m.id), ...ratProps(m.id)]) {
    if (!inView(pr.x, pr.y)) continue;
    if (pr.kind === 'quest_find' && pr.dog) drawDog(ctx, pr.x, pr.y, t);
    if (pr.kind === 'quest_find' && pr.animal === 'cat') drawCat(ctx, pr.x, pr.y, t);
    else if (pr.kind === 'quest_find' && pr.animal === 'calf') drawCalf(ctx, pr.x, pr.y, t);
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
    else if (pk.kind === 'note' || pk.kind === 'burner' || pk.kind === 'ledger' || pk.kind === 'signet' || pk.kind === 'blueprint' || pk.kind === 'study_key') { ctx.fillStyle = pk.kind === 'burner' ? '#222' : pk.kind === 'ledger' ? '#6b3e1f' : pk.kind === 'signet' || pk.kind === 'study_key' ? '#d4af37' : pk.kind === 'blueprint' ? '#3a6ea5' : '#f6eed8'; ctx.fillRect(pk.x - 6, pk.y - 8 + bob, 12, 14); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(pk.x, pk.y + bob, 13 + Math.sin(t * 6) * 2, 0, Math.PI * 2); ctx.stroke(); }
    else if (pk.kind === 'item') {
      ctx.fillStyle = '#2a1414'; ctx.strokeStyle = '#e0474a'; ctx.lineWidth = 1.5;
      ctx.fillRect(pk.x - 9, pk.y - 9 + bob, 18, 16); ctx.strokeRect(pk.x - 9, pk.y - 9 + bob, 18, 16);
      ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.fillText((ITEMS[pk.item] || {}).icon || '?', pk.x, pk.y + 4 + bob);
    }
  }

  // Entities (y-sorted)
  const ents = [];
  for (const n of G.npcs) if (n.present && inView(n.x, n.y)) ents.push(n);
  for (const e of G.enemies) if (!e.gone && inView(e.x, e.y)) ents.push(e);
  ents.push(G.player);
  if (G.dog && inView(G.dog.x, G.dog.y)) ents.push(G.dog);
  for (const a of G.animals || []) if (inView(a.x, a.y)) ents.push(a);
  ents.sort((a, b) => a.y - b.y);
  const p = G.player;
  for (const e of ents) {
    if (e === G.dog) { drawGuardDog(ctx, e, t); continue; }
    if (e.kind === 'deer') { drawDeer(ctx, e, t); continue; }
    if (e.def && e.def.dog) { drawAttackDog(ctx, e, t); continue; }
    if (e === p) {
      if (p.dead) continue;
      const blink = p.invuln > 0 && p.dodgeT <= 0 && Math.floor(t * 20) % 2 === 0;
      if (blink) ctx.globalAlpha = 0.55;
      drawPerson(ctx, p, {
        angle: p.angle, r: 11, walk: p.walkPhase, body: '#6e4a30', skin: '#e0b18e', hair: '#2a2220', muzzle: p.muzzle,
        reach: p.reachT > 0 ? (p.reachT -= G.frameDt || 1 / 60, Math.sin(Math.max(0, 0.3 - p.reachT) / 0.3 * Math.PI)) : 0,
        hurt: G.hurtDir && G.hurtDir.t > 0.9 ? (G.hurtDir.t - 0.9) * 1.8 : 0, ringBack: true,
        weapon: p.chopAnim > 0 ? 'axe' : p.weapon === 'rifle' ? 'rifle' : p.weapon === 'shotgun' ? 'shotgun' : 'pistol', swing: p.chopAnim > 0 ? p.chopAnim * 4 : 0, ring: '#ffffff', ringW: 2.5,
      });
      ctx.globalAlpha = 1;
      if (p.muzzle > 0) muzzleFlash(ctx, p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24, p.angle);
      if (p.reloadT > 0 && p.reloadMax > 0) {
        // reload progress: a ring that fills around Frank's feet
        const f = 1 - p.reloadT / p.reloadMax;
        ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(p.x, p.y - 26, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p.x, p.y - 26, 7, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
      }
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
      drawPerson(ctx, e, { angle: e.angle, downed: e.downed, muzzle: e.muzzle, r: 11, walk: e.downed ? 0 : e.walkPhase, body: d.body, skin: d.skin, hair: d.hair,
        ring: e.ally ? '#6fdc7a' : e.stranger ? '#b9a4e0' : e.deputy || e.reyes ? '#d4af37' : '#5bc0de', ringW: e.ally ? 3 : 2, dashed: !e.named, weapon: e.ally ? 'shotgun' : null, flash: e.hitT > 0 ? e.hitT : 0 });
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
    if (e.def.weapon === 'bat' || e.def.weapon === 'bite') {
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
    // Tracers: a soft glow under a hot core, streaked back along the flight path.
    const tx = b.x - (b.x - b.px) * 2.2, ty = b.y - (b.y - b.py) * 2.2;
    if (!lowQuality()) {
      ctx.strokeStyle = b.owner === 'player' ? 'rgba(255,220,120,0.25)' : 'rgba(255,110,70,0.3)';
      ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.strokeStyle = b.owner === 'player' ? '#fff3b0' : '#ff8a65';
    ctx.lineWidth = b.owner === 'player' ? 2 : 2.5;
    ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // Particles
  for (const pt of G.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / pt.max);
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
  }
  ctx.globalAlpha = 1;
  drawWorldFx(ctx);
  drawGallery(ctx);

  // Canopies (sprites with a gentle wind sway; fade if something is underneath)
  const lowQ = lowQuality();
  for (const tr of canopies) {
    const x = tr.cx * TILE + 16, y = tr.cy * TILE + 16;
    const hsh = hash2(tr.cx, tr.cy);
    let sh = lowQ ? 0 : Math.sin(t * 1.3 + hsh * 6) * 1.2;
    if (tr.shake > 0) { sh += Math.sin(t * 60) * 2.5; tr.shake -= 1 / 60; }
    // Fade the canopy when someone is under it, so trees never hide a fight.
    const cyc = y - 10;
    let under = dist(x, cyc, p.x, p.y) < 34;
    if (!under) for (const e of G.enemies) if (!e.dead && dist(x, cyc, e.x, e.y) < 32) { under = true; break; }
    ctx.globalAlpha = under ? 0.4 : 1;
    const tv = tr.v || (tr.v = treeVariant(tr));
    ctx.drawImage(treeSprite(tr.kind, tv.pal, tv.size), x - 48 + sh, y - 58);
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
    ctx.drawImage(b.roofCanvas, bx, by - ROOF_RISE);
    ctx.globalAlpha = 1;
  }

  if (!lowQuality()) drawSmoke(ctx, m, t);

  // Doors and windows (on walls, above roofs so they're always readable)
  for (const b of m.blockers.values()) {
    if (b.kind === 'cover') continue;
    const x = b.cx * TILE, y = b.cy * TILE;
    if (!inView(x, y)) continue;
    // The building whose walls this opening sits in (buildingAt only covers interiors).
    const bd = m.buildings.find((q) => b.cx >= q.x && b.cx < q.x + q.w && b.cy >= q.y && b.cy < q.y + q.h);
    const outside = bd && bd !== inside;
    const front = outside && !b.vertical && b.cy === bd.y + bd.h - 1;
    if (front) { if (b.kind === 'door') drawFrontDoor(ctx, b, x, y, bd); else drawFrontWindow(ctx, b, x, y, bd); }
    else {
      // Back and side walls rise with the roof, so their doors and windows do too.
      const yy = outside ? y - ROOF_RISE : y;
      if (b.kind === 'door') drawDoor(ctx, b, x, yy); else drawWindow(ctx, b, x, yy);
    }
  }

  drawWorldWeather(ctx, vx0, vy0, vx1, vy1, G.frameDt || 1 / 60);
  if (!lowQuality() && darkness() < 0.5 && !(G.rainLevel > 0.1) && m.trees.size > 20 && !m.buildingAt(p.x, p.y)) drawDriftLeaves(ctx, t, vx0, vy0, vx1, vy1);

  // Lighting
  const dk = darkness();
  if (dk > 0.02) drawLighting(ctx, dk, ox, oy, z);
  const lq = lowQuality();
  if (dk > 0.15 && !lq) drawGlow(ctx, dk, inView);
  if (dk > 0.6 && !lq) drawFireflies(ctx, t, dk, vx0, vy0, vx1, vy1);
  // Colour grade: warm daylight, golden hour, a red-orange sunset, pink dawn.
  gradeScreen(ctx, G.s.time.minute / 60, dk, w, h, dpr);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);

  // Overlays (drawn over darkness so they're always readable)
  drawOverlays(ctx, dk, inView);

  // Screen-space effects
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScreenAtmosphere(ctx, w, h, dk, G.frameDt || 1 / 60);
  drawScreenFx(ctx, ox, oy, z);
}

const CROP_KINDS = ['corn', 'cabbage', 'tomato', 'pumpkin'];
const CROP_PAD = 10;
const cropSprites = {};
function cropSprite(kind, stage, frame) {
  const key = `${kind}${stage}${frame}`;
  if (cropSprites[key]) return cropSprites[key];
  const c = document.createElement('canvas');
  c.width = c.height = TILE + CROP_PAD * 2;
  const g = c.getContext('2d');
  g.translate(CROP_PAD, CROP_PAD);
  // the sway is baked in: frame 0/1/2 = leaning left/still/right
  drawCropTile(g, 0, 0, kind, stage, Math.asin((frame - 1) * 0.99) / 1.6, 0);
  cropSprites[key] = c;
  return c;
}
/** One garden cell: two staggered rows of plants. stage 0 bare, 1 sprouts, 2 young, 3 ripe. */
function drawCropTile(ctx, x, y, kind, stage, t, cx) {
  if (stage === 0) { ctx.fillStyle = 'rgba(40,25,12,0.35)'; ctx.fillRect(x + 2, y + 4, TILE - 4, TILE - 8); return; }
  const sway = lowQuality() ? 0 : Math.sin(t * 1.6 + cx * 0.7) * 0.9;
  const per = kind === 'corn' ? 3 : 2;
  for (let j = 0; j < 2; j++) for (let i = 0; i < per; i++) {
    const px = x + (per === 3 ? 6 + i * 10 : 9 + i * 15) + (j % 2 ? 3 : -1), py = y + 13 + j * 14;
    if (stage === 1) { ctx.fillStyle = '#6fae4c'; ctx.fillRect(px - 1, py - 3, 2, 3); ctx.fillRect(px - 3, py - 4, 2, 2); ctx.fillRect(px + 1, py - 4, 2, 2); continue; }
    const ripe = stage === 3;
    ctx.save(); ctx.translate(px, py);
    const k = ripe ? 1.25 : 0.85; ctx.scale(k, k);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(2, 1, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    if (kind === 'corn') {
      ctx.strokeStyle = '#3f7a2a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sway, -12); ctx.stroke();
      ctx.strokeStyle = '#6aaa44'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(-5, -6, -7 + sway, -3); ctx.moveTo(0, -6); ctx.quadraticCurveTo(5, -9, 7 + sway, -6); ctx.moveTo(0, -9); ctx.quadraticCurveTo(-4, -12, -5 + sway, -11); ctx.stroke();
      ctx.strokeStyle = 'rgba(200,240,150,0.5)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(0, -6); ctx.quadraticCurveTo(4, -8.5, 6 + sway, -6.3); ctx.stroke();
      if (ripe) { ctx.fillStyle = '#e8c547'; ctx.beginPath(); ctx.ellipse(1.8, -6, 1.4, 2.8, 0.2, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#cfa968'; ctx.fillRect(-0.8 + sway, -14, 1.6, 2.6); }
    } else if (kind === 'cabbage') {
      const leaves = [[-3, -2, 3.4], [3, -2, 3.4], [0, 1, 3.2], [0, -4.5, 3.2]];
      for (const [ox, oy, r] of leaves) { ctx.fillStyle = '#4c8a3c'; ctx.beginPath(); ctx.arc(ox, oy, r, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = ripe ? '#b4dc94' : '#86bd68'; ctx.beginPath(); ctx.arc(0, -1.8, ripe ? 3.4 : 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(70,120,55,0.7)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(0, -1.8, 1.8, 0.3, 3.6); ctx.stroke();
    } else if (kind === 'tomato') {
      ctx.fillStyle = '#8a6a44'; ctx.fillRect(-0.6, -13, 1.2, 13);
      ctx.fillStyle = '#3a7630'; ctx.beginPath(); ctx.ellipse(sway * 0.5, -6, 4.6, 6.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#5c9d45'; ctx.beginPath(); ctx.ellipse(-1.4 + sway * 0.5, -8, 2.6, 3.2, 0, 0, Math.PI * 2); ctx.arc(2, -4, 2, 0, Math.PI * 2); ctx.fill();
      if (ripe) for (const [ox, oy] of [[-2.6, -3.5], [2.2, -7.5], [1.6, -2]]) { ctx.fillStyle = '#d23a2a'; ctx.beginPath(); ctx.arc(ox, oy, 1.8, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,220,200,0.75)'; ctx.fillRect(ox - 0.9, oy - 1, 0.9, 0.9); }
    } else { // pumpkin patch: vines and broad leaves, pumpkins when ripe
      ctx.strokeStyle = '#4f8a32'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-6, 0); ctx.quadraticCurveTo(0, -5, 6, 0); ctx.stroke();
      ctx.fillStyle = '#5a9a3e'; ctx.beginPath(); ctx.arc(-4, -3.5, 2.8, 0, Math.PI * 2); ctx.arc(4, -4, 2.6, 0, Math.PI * 2); ctx.fill();
      if (ripe) { ctx.fillStyle = '#d9792a'; ctx.beginPath(); ctx.ellipse(0, -1.2, 4.4, 3.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = 'rgba(255,200,140,0.35)'; ctx.beginPath(); ctx.ellipse(-1.4, -2.4, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = 'rgba(120,50,10,0.55)'; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(-1.5, -4.4); ctx.lineTo(-1.5, 2); ctx.moveTo(1.5, -4.4); ctx.lineTo(1.5, 2); ctx.stroke(); ctx.fillStyle = '#5a7a2a'; ctx.fillRect(-0.5, -5.8, 1, 1.8); }
    }
    ctx.restore();
  }
}

/** Screen-wide colour grading by time of day: at most one tint fill plus a dusk vignette.
 *  Daylight needs no grade (the terrain palette is already warm), so midday costs nothing. */
function gradeScreen(ctx, hr, dk, w, h, dpr) {
  const lq = lowQuality();
  const ramp = (a, b, c, d) => (hr <= a || hr >= d ? 0 : hr < b ? (hr - a) / (b - a) : hr <= c ? 1 : (d - hr) / (d - c));
  const tints = [
    [255, 170, 70, 0.2 * ramp(15.5, 17, 18, 19)], // golden hour
    [255, 100, 60, 0.2 * ramp(17.8, 18.8, 19.4, 20.6)], // sunset
    [255, 150, 150, 0.14 * ramp(5, 6.2, 6.8, 8.2)], // dawn
  ];
  let a = 0, r = 0, gg = 0, bb = 0;
  for (const [tr, tg, tb, ta] of tints) { a += ta; r += tr * ta; gg += tg * ta; bb += tb * ta; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (a > 0.005) {
    ctx.save();
    if (!lq) ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = `rgba(${(r / a) | 0},${(gg / a) | 0},${(bb / a) | 0},${Math.min(0.35, lq ? a * 0.35 : a)})`;
    ctx.fillRect(0, 0, w * dpr, h * dpr);
    ctx.restore();
  }
  const warm = ramp(17.5, 18.6, 19.3, 20.8) * (1 - dk * 0.6);
  if (warm > 0.01) { ctx.fillStyle = `rgba(255,120,50,${(lq ? 0.04 : 0.08) * warm})`; ctx.fillRect(0, 0, w * dpr, h * dpr); }
  // the low sun also deepens the shadows a touch
  const dusk = ramp(17, 18.5, 19, 20.5) * (1 - dk);
  if (dusk > 0.01) {
    const vg = ctx.createRadialGradient(w * dpr / 2, h * dpr / 2, Math.min(w, h) * dpr * 0.3, w * dpr / 2, h * dpr / 2, Math.max(w, h) * dpr * 0.75);
    vg.addColorStop(0, 'rgba(60,20,40,0)'); vg.addColorStop(1, `rgba(60,20,40,${0.22 * dusk})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w * dpr, h * dpr);
  }
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

/** Doors and windows seen face-on in a building's front wall. */
const homey = (bd) => { if (!bd) return false; const st = facadeOf(bd).style; return st === 'siding' || st === 'logs'; };
function drawFrontDoor(ctx, b, x, y, bd) {
  const sh = b.hitT > 0 ? (Math.random() - 0.5) * 3 : 0;
  ctx.save(); ctx.translate(x + sh, y);
  if (bd && facadeOf(bd).style === 'siding') { ctx.fillStyle = '#efe9dc'; ctx.fillRect(1, -1, TILE - 2, TILE - 2); } // painted trim
  ctx.fillStyle = '#2a1e14'; ctx.fillRect(3, 0, TILE - 6, TILE - 3); // frame
  if (b.broken) {
    ctx.fillStyle = '#0e0a08'; ctx.fillRect(6, 2, TILE - 12, TILE - 6);
    ctx.fillStyle = '#6b4a2b'; ctx.save(); ctx.translate(16, 18); ctx.rotate(0.5); ctx.fillRect(-11, -2, 22, 4); ctx.restore();
    ctx.fillStyle = '#4a3220'; ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(12, 2); ctx.lineTo(7, 12); ctx.fill();
  } else if (b.rec.open) {
    ctx.fillStyle = isNight() ? '#f2c66d' : '#120d0a'; ctx.fillRect(6, 2, TILE - 12, TILE - 6);
    ctx.fillStyle = '#7b5532'; ctx.fillRect(6, 2, 4, TILE - 6);
  } else {
    ctx.fillStyle = b.rec.reinforced ? '#5d4a3a' : '#7b5532'; ctx.fillRect(6, 2, TILE - 12, TILE - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(9, 5, TILE - 18, 9); ctx.fillRect(9, 17, TILE - 18, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(9, 5, TILE - 18, 1.5);
    ctx.fillStyle = '#d9b84a'; ctx.beginPath(); ctx.arc(TILE - 10, 16, 1.6, 0, Math.PI * 2); ctx.fill();
    if (b.rec.reinforced) { ctx.fillStyle = '#9aa0a6'; ctx.fillRect(5, 7, TILE - 10, 3); ctx.fillRect(5, TILE - 11, TILE - 10, 3); }
    if (b.condition < 0.66) { ctx.strokeStyle = '#1a1009'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(9, 4); ctx.lineTo(13, 13); ctx.lineTo(10, 22); ctx.stroke(); }
    if (b.condition < 0.33) { ctx.beginPath(); ctx.moveTo(23, 5); ctx.lineTo(18, 15); ctx.lineTo(22, 26); ctx.stroke(); }
  }
  ctx.fillStyle = '#5e5650'; ctx.fillRect(1, TILE - 4, TILE - 2, 4); // step
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(1, TILE - 4, TILE - 2, 1);
  // a small lamp beside the door, lit after dark
  if (homey(bd)) {
    const lit = isNight();
    ctx.fillStyle = '#2a2420'; ctx.fillRect(TILE - 3, 5, 3, 5);
    ctx.fillStyle = lit ? '#ffd27a' : '#9a9080'; ctx.fillRect(TILE - 2.5, 6, 2, 3);
    if (lit) { const lg = ctx.createRadialGradient(TILE - 1.5, 7.5, 0, TILE - 1.5, 7.5, 9); lg.addColorStop(0, 'rgba(255,210,120,0.55)'); lg.addColorStop(1, 'rgba(255,210,120,0)'); ctx.fillStyle = lg; ctx.fillRect(TILE - 11, -2, 20, 20); }
  }
  ctx.restore();
  if (!b.rec.npc && b.condition < 0.99) bar(ctx, x + 2, y - 6, 28, 4, b.condition, b.condition < 0.35 ? '#e74c3c' : '#e0a542');
}

function drawFrontWindow(ctx, b, x, y, bd) {
  const sh = b.hitT > 0 ? (Math.random() - 0.5) * 3 : 0;
  const night = isNight();
  ctx.save(); ctx.translate(x + sh, y);
  const home = homey(bd) && !b.shuttered;
  if (home) {
    // painted shutters either side, louvered
    const sc = shadeHex(bd.roof, 0.9);
    for (const sx of [-3, TILE - 4]) {
      ctx.fillStyle = sc; ctx.fillRect(sx, 4, 7, TILE - 12);
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 5; k++) ctx.fillRect(sx + 1, 6 + k * 3.6, 5, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(sx, 4, 1, TILE - 12);
    }
  }
  ctx.fillStyle = '#efe9dc'; ctx.fillRect(3, 4, TILE - 6, TILE - 12); // frame
  if (b.rec.glass > 0) {
    const gg = ctx.createLinearGradient(0, 6, 0, TILE - 10);
    if (night) { gg.addColorStop(0, '#ffe8a8'); gg.addColorStop(1, '#f0a848'); } else { gg.addColorStop(0, '#d6ecf6'); gg.addColorStop(0.5, '#9cc2d8'); gg.addColorStop(1, '#6f98b2'); }
    ctx.fillStyle = gg; ctx.fillRect(6, 7, TILE - 12, TILE - 18);
    if (night) { ctx.fillStyle = 'rgba(150,60,30,0.45)'; ctx.fillRect(6, 7, 3, TILE - 18); ctx.fillRect(TILE - 9, 7, 3, TILE - 18); } // curtains
    ctx.fillStyle = '#efe9dc'; ctx.fillRect(15, 7, 2, TILE - 18); ctx.fillRect(6, 13, TILE - 12, 2);
    if (!night) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.beginPath(); ctx.moveTo(7, 8); ctx.lineTo(11, 8); ctx.lineTo(7, 12); ctx.fill(); }
  } else {
    ctx.fillStyle = '#0d0b0a'; ctx.fillRect(6, 7, TILE - 12, TILE - 18);
    ctx.fillStyle = 'rgba(200,230,255,0.65)'; ctx.beginPath(); ctx.moveTo(6, 7); ctx.lineTo(12, 7); ctx.lineTo(7, 14); ctx.fill(); ctx.beginPath(); ctx.moveTo(26, 21); ctx.lineTo(26, 14); ctx.lineTo(21, 21); ctx.fill();
  }
  if (b.shuttered) {
    ctx.fillStyle = '#7d858c'; ctx.fillRect(4, 5, TILE - 8, TILE - 14);
    ctx.fillStyle = '#5b6268'; for (let k = 0; k < 4; k++) ctx.fillRect(4, 7 + k * 4, TILE - 8, 1.5);
    ctx.fillStyle = '#c9cdd2'; ctx.fillRect(5, 6, 2, 2); ctx.fillRect(TILE - 7, TILE - 12, 2, 2);
  } else if (b.boarded) {
    ctx.fillStyle = '#9b7a4c'; ctx.strokeStyle = '#5a3f22'; ctx.lineWidth = 1;
    const n = Math.max(1, Math.ceil((b.rec.boardHp / b.boardMax) * 3));
    for (let i = 0; i < n; i++) { ctx.save(); ctx.translate(16, 13); ctx.rotate((i - 1) * 0.32); ctx.fillRect(-14, -2.5 + (i - 1) * 3, 28, 5); ctx.strokeRect(-14, -2.5 + (i - 1) * 3, 28, 5); ctx.restore(); }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(3, TILE - 8, TILE - 6, 2); // sill shadow
  if (home) {
    // window box with flowers
    ctx.fillStyle = '#6b4a2e'; ctx.fillRect(2, TILE - 9, TILE - 4, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(2, TILE - 5, TILE - 4, 1);
    ctx.fillStyle = '#3f7a32'; for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(5 + k * 4.4, TILE - 9.5, 2.2, 0, Math.PI * 2); ctx.fill(); }
    const fc = ['#e8506a', '#f2d43c', '#f4f1e6', '#c07ae0'][(b.cx + b.cy) % 4];
    ctx.fillStyle = fc; for (let k = 0; k < 5; k++) ctx.fillRect(6 + k * 4.6, TILE - 11.5 + (k % 2), 1.8, 1.8);
  }
  ctx.restore();
  if (!b.rec.npc && b.condition < 0.99) bar(ctx, x + 2, y - 6, 28, 4, b.condition, b.condition < 0.35 ? '#e74c3c' : '#e0a542');
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
  // a soft glow, then a short star of flame pointing down the barrel
  if (!lowQuality()) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
    g.addColorStop(0, 'rgba(255,220,140,0.55)'); g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
  }
  const ca = Math.cos(a), sa = Math.sin(a);
  const pt = (f, s) => [x + ca * f - sa * s, y + sa * f + ca * s];
  ctx.fillStyle = 'rgba(255,170,60,0.85)';
  ctx.beginPath();
  for (const [f, s] of [[16, 0], [4, 3], [6, 8], [1, 3.5], [-3, 0], [1, -3.5], [6, -8], [4, -3]]) { const [px, py] = pt(f, s); ctx.lineTo(px, py); }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,248,210,0.95)';
  ctx.beginPath(); { const [px, py] = pt(8, 0); ctx.moveTo(px, py); } for (const [f, s] of [[1, 2], [-1, 0], [1, -2]]) { const [px, py] = pt(f, s); ctx.lineTo(px, py); } ctx.closePath(); ctx.fill();
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
  const look = ENEMY_LOOK[e.type] || ENEMY_LOOK.gunman;
  if (e.dead) {
    const fade = Math.max(0, 1 - e.deadT / 25);
    ctx.globalAlpha = fade * 0.75;
    ctx.fillStyle = 'rgba(90,10,10,0.6)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + 8, e.radius + 7, e.radius * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    drawPerson(ctx, e, { angle: e.angle, downed: true, r: e.radius, walk: 0, body: e.def.color, trim: e.def.trim, skin: look.skin, hair: look.hair, hat: look.hat });
    ctx.globalAlpha = 1;
    return;
  }
  drawPerson(ctx, e, {
    angle: e.angle, r: e.radius * 1.1, walk: e.walkPhase, body: e.def.color, trim: e.def.trim, skin: look.skin, hair: look.hair, hat: look.hat,
    muzzle: e.muzzle, weapon: e.def.weapon === 'srifle' ? 'rifle' : e.def.weapon, swing: e.aimT > 0 && e.def.weapon === 'bat' ? 1 - e.aimT / e.def.telegraph : 0,
    ring: e.retreating ? '#f0c040' : '#ff3b30', ringW: e.def.boss ? 4 : 2.5, dashed: e.retreating, flash: e.hitT > 0 ? e.hitT : 0, ticks: !e.retreating, ringBack: true,
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
  const lq = lowQuality();
  l.globalCompositeOperation = 'source-over';
  l.clearRect(0, 0, lw, lh);
  l.fillStyle = `rgba(10,16,40,${0.7 * dk})`;
  l.fillRect(0, 0, lw, lh);
  l.globalCompositeOperation = 'destination-out';
  const toS = (x, y) => [(x * z + ox) * scale, (y * z + oy) * scale];
  const offscreen = (x, y, r) => { const [sx, sy] = toS(x, y); const rr = r * z * scale; return sx < -rr || sy < -rr || sx > lw + rr || sy > lh + rr; };
  // A radial light, optionally clipped to a visibility polygon (walls cast shadows).
  const hole = (x, y, r, strength = 1, poly = null) => {
    if (offscreen(x, y, r)) return;
    const [sx, sy] = toS(x, y);
    const rr = r * z * scale;
    l.save();
    if (poly) { l.beginPath(); poly.forEach(([px, py], k) => { const [qx, qy] = toS(px, py); k ? l.lineTo(qx, qy) : l.moveTo(qx, qy); }); l.closePath(); l.clip(); }
    const g = l.createRadialGradient(sx, sy, rr * 0.12, sx, sy, rr);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(0.55, `rgba(0,0,0,${strength * 0.75})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = g;
    l.beginPath(); l.arc(sx, sy, rr, 0, Math.PI * 2); l.fill();
    l.restore();
  };
  const p = G.player;
  const m = G.map;
  const inside = m.buildingAt(p.x, p.y);
  for (const li of activeLights()) {
    const flick = li.fire ? 1 + Math.sin(G.time * 17 + li.x) * 0.06 + Math.sin(G.time * 31) * 0.04 : 1;
    if (li.building) {
      const b = m.buildings.find((bb) => bb.id === li.building);
      if (inside === b) hole(li.x, li.y, li.r * 1.4, 1, lq ? null : lightPoly(m, { ...li, r: li.r * 1.4 }));
      else hole(li.x, li.y, li.r * 1.6, 0.55, lq ? null : lightPoly(m, { ...li, r: li.r * 1.6 })); // spills out through the windows
    } else hole(li.x, li.y, li.r * flick, li.street ? 0.85 : 1, lq || li.fire ? null : lightPoly(m, li));
  }
  // Frank: a small circle of night vision and a flashlight beam that walls stop.
  const d = derived();
  hole(p.x, p.y, Math.max(70, d.seeRadius * 0.42), 0.85);
  const range = FLASH_RANGE + (d.seeRadius - 170) * 0.8;
  const beam = lq ? null : castPoly(m, p.x, p.y, range, p.angle - FLASH_ANGLE, p.angle + FLASH_ANGLE, 40);
  G.flashBeam = { x: p.x, y: p.y, a: p.angle, r: range, poly: beam };
  {
    const [sx, sy] = toS(p.x, p.y);
    const rr = range * z * scale;
    l.save();
    l.beginPath();
    if (beam) { l.moveTo(sx, sy); beam.forEach(([px, py]) => { const [qx, qy] = toS(px, py); l.lineTo(qx, qy); }); }
    else { l.moveTo(sx, sy); l.arc(sx, sy, rr, p.angle - FLASH_ANGLE, p.angle + FLASH_ANGLE); }
    l.closePath(); l.clip();
    const g = l.createRadialGradient(sx, sy, rr * 0.05, sx, sy, rr);
    g.addColorStop(0, 'rgba(0,0,0,0.95)'); g.addColorStop(0.7, 'rgba(0,0,0,0.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = g; l.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    l.restore();
  }
  // Gunfire lights up the room for a split second.
  if (p.muzzle > 0) hole(p.x, p.y, 190, 1, lq ? null : castPoly(m, p.x, p.y, 190, 0, Math.PI * 2, 48));
  for (const e of G.enemies) if (!e.dead && e.muzzle > 0) hole(e.x, e.y, 140, 0.9, lq ? null : castPoly(m, e.x, e.y, 140, 0, Math.PI * 2, 32));
  for (const n of G.npcs) if (n.ally && n.muzzle > 0) hole(n.x, n.y, 150, 0.9);
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
    // Awareness: a "?" that fills as they grow suspicious, a "!" that pops when they spot you.
    if (!e.alerted && e.sus > 0.04) {
      const cy = hy - 14;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(e.x, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(e.x, cy, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, e.sus)); ctx.stroke();
      ctx.fillStyle = '#f5c542'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', e.x, cy + 4);
    } else if (e.alertPop > 0) {
      const k = 1 - e.alertPop / 0.7;
      const sc = k < 0.25 ? 0.6 + k * 4 : 1.6 - Math.min(0.6, (k - 0.25) * 1.2);
      ctx.save(); ctx.translate(e.x, hy - 16); ctx.scale(sc, sc);
      ctx.font = 'bold 18px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText('!', 0, 6);
      ctx.fillStyle = '#ff3b30'; ctx.fillText('!', 0, 6);
      ctx.restore();
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
    if (n.scripted && n.sus > 0.04) {
      // Someone you're tailing: the same "?" the attackers use.
      const cy = n.y - 38;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(n.x, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(n.x, cy, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, n.sus)); ctx.stroke();
      ctx.fillStyle = '#f5c542'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', n.x, cy + 4);
    }
    if (!n.present || dist(n.x, n.y, p.x, p.y) > (n.scripted ? 400 : 110)) continue;
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
    // Pop in big, settle, drift up.
    const age = f.max - f.life;
    const sc = age < 0.12 ? 1.7 - age * 5.8 : 1;
    const big = !/^-?\d/.test(f.text) && f.text.length > 4;
    ctx.save(); ctx.translate(f.x, f.y); ctx.scale(sc, sc);
    ctx.font = `bold ${big ? 13 : 12}px system-ui, sans-serif`; ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
    ctx.restore();
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
  drawScreenFlash(ctx);
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
    // Colour drains out as you weaken.
    if (!lowQuality()) {
      ctx.save(); ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(128,128,128,${0.75 - (p.hp / d.maxHp) * 2})`; ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
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
    if (smokeT <= 0) { smokeT = 0.35; const ch = hb.chimney || { x: hb.w * TILE - 42, y: 16 }; spawnSmokePuff(hb.x * TILE + ch.x, hb.y * TILE + ch.y, 1); }
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
    glow(x, y + 6, b.boarded ? 24 : 46, '255,196,110', (b.boarded ? 0.16 : 0.36) * dk);
  }
  // The flashlight beam: a faint warm cone with dust drifting through it.
  const fb = G.flashBeam;
  if (fb && fb.poly && dk > 0.4) {
    ctx.save();
    ctx.beginPath(); ctx.moveTo(fb.x, fb.y); fb.poly.forEach(([x, y]) => ctx.lineTo(x, y)); ctx.closePath(); ctx.clip();
    const g = ctx.createRadialGradient(fb.x, fb.y, 10, fb.x, fb.y, fb.r);
    g.addColorStop(0, `rgba(255,236,190,${0.16 * dk})`); g.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = g; ctx.fillRect(fb.x - fb.r, fb.y - fb.r, fb.r * 2, fb.r * 2);
    ctx.fillStyle = `rgba(255,245,220,${0.35 * dk})`;
    for (let k = 0; k < 14; k++) {
      const u = (k * 0.618 + G.time * 0.05) % 1, v = Math.sin(k * 12.9 + G.time * 0.7) * 0.5;
      const dd = 30 + u * fb.r * 0.85, aa = fb.a + v * FLASH_ANGLE * 0.9;
      ctx.beginPath(); ctx.arc(fb.x + Math.cos(aa) * dd, fb.y + Math.sin(aa) * dd, 0.9, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

let driftLeaves = null;
/** A handful of leaves drifting on the breeze (world space, wrapped to the view). */
function drawDriftLeaves(ctx, t, x0, y0, x1, y1) {
  if (!driftLeaves) driftLeaves = Array.from({ length: 9 }, (_, i) => ({ s: i * 97.3, c: ['#c9a03a', '#b8662a', '#8a9a3a'][i % 3] }));
  const W = x1 - x0, H = y1 - y0;
  for (const l of driftLeaves) {
    const u = ((l.s * 13.7 + t * 18) % W + W) % W, v = ((l.s * 7.1 + t * 11) % H + H) % H;
    const x = x0 + u + Math.sin(t * 1.3 + l.s) * 10, y = y0 + v;
    ctx.save(); ctx.translate(x, y); ctx.rotate(t * 2 + l.s);
    ctx.globalAlpha = 0.75; ctx.fillStyle = l.c;
    ctx.beginPath(); ctx.ellipse(0, 0, 2.6, 1.3 + Math.abs(Math.sin(t * 3 + l.s)) * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
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

/** A dog seen from above, facing `a`. */
function dogShape(ctx, x, y, a, walk, coat, dark, scale = 1) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(scale, scale);
  const leg = Math.sin(walk) * 3;
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(1, 3, 14, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark;
  for (const [lx, ly, s] of [[6, -5, 1], [6, 5, -1], [-7, -5, -1], [-7, 5, 1]]) ctx.fillRect(lx + leg * s - 1.5, ly - 1.5, 4, 3);
  ctx.fillStyle = coat; ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(-1, 0, 7, 3.6, 0, 0, Math.PI * 2); ctx.fill(); // saddle
  ctx.fillStyle = coat; ctx.beginPath(); ctx.ellipse(12, 0, 4.6, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = dark; ctx.beginPath(); ctx.ellipse(16, 0, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(11, -3); ctx.lineTo(10, -7); ctx.lineTo(13, -4); ctx.moveTo(11, 3); ctx.lineTo(10, 7); ctx.lineTo(13, 4); ctx.fill();
  ctx.strokeStyle = coat; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-11, 0); ctx.quadraticCurveTo(-16, Math.sin(walk * 1.5) * 4, -19, Math.sin(walk * 1.5) * 5); ctx.stroke();
  ctx.restore();
}

function drawGuardDog(ctx, d, t) {
  ctx.globalAlpha = d.hurt ? 0.6 : 1;
  ctx.strokeStyle = '#6fdc7a'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.arc(d.x, d.y, 14, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  dogShape(ctx, d.x, d.y, d.angle, d.walk, d.hitT > 0 ? '#fff' : '#b07a3c', '#2a1e14', 1);
  ctx.globalAlpha = 1;
  if (G.siegeActive || d.hp < 90) bar(ctx, d.x - 12, d.y + 13, 24, 3, d.hp / 90, '#6fdc7a');
  void t;
}

function drawAttackDog(ctx, e, t) {
  if (e.dead) { ctx.globalAlpha = Math.max(0, 1 - e.deadT / 25) * 0.7; dogShape(ctx, e.x, e.y, e.angle + 1.4, 0, '#3a3a3a', '#111', 0.9); ctx.globalAlpha = 1; return; }
  ctx.strokeStyle = e.retreating ? '#f0c040' : '#ff3b30'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(e.x, e.y, 13, 0, Math.PI * 2); ctx.stroke();
  dogShape(ctx, e.x, e.y, e.angle, e.walkPhase, e.hitT > 0 ? '#fff' : '#3a3a3a', '#111', 0.9);
  void t;
}

function drawCat(ctx, x, y, t) {
  // A fat orange cat on a branch.
  ctx.strokeStyle = '#5a3f22'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(x - 22, y + 8); ctx.lineTo(x + 20, y + 2); ctx.stroke();
  ctx.fillStyle = '#e08a2e'; ctx.beginPath(); ctx.ellipse(x, y, 9, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x + 8, y - 5, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + 5, y - 9); ctx.lineTo(x + 6, y - 14); ctx.lineTo(x + 9, y - 10); ctx.moveTo(x + 9, y - 9); ctx.lineTo(x + 12, y - 13); ctx.lineTo(x + 12, y - 8); ctx.fill();
  ctx.strokeStyle = '#e08a2e'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x - 16, y + 8 + Math.sin(t * 3) * 3, x - 12, y + 14); ctx.stroke();
  ctx.fillStyle = '#ffd166'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center'; ctx.fillText('?', x, y - 18 + Math.sin(t * 4) * 2);
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

/** A deer: tan body, white tail, a head that lifts when it's wary; antlers on bucks. */
function drawDeer(ctx, a, t) {
  ctx.save(); ctx.translate(a.x, a.y);
  if (a.dead) {
    ctx.rotate(a.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(90,10,10,0.5)'; ctx.beginPath(); ctx.ellipse(0, 4, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = a.dressed ? '#6a4a34' : '#9a6a40'; ctx.beginPath(); ctx.ellipse(0, 0, 13, 6, 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (!a.dressed) { ctx.fillStyle = '#ffd166'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center'; ctx.fillText('▼', a.x, a.y - 16 + Math.sin(t * 4) * 2); }
    return;
  }
  ctx.rotate(a.angle);
  const leg = Math.sin(a.walk) * 4;
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(1, 4, 15, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3020';
  for (const [lx, ly, s] of [[7, -5, 1], [7, 5, -1], [-8, -5, -1], [-8, 5, 1]]) ctx.fillRect(lx + leg * s - 1.5, ly - 1.2, 4, 2.4);
  ctx.fillStyle = '#9a6a40'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 5.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2e8d8'; ctx.beginPath(); ctx.ellipse(-12, 0, 2.6, 2.2, 0, 0, Math.PI * 2); ctx.fill(); // tail
  const hx = a.alert ? 15 : 17, hy = a.state === 'graze' && !a.alert ? 2 : 0;
  ctx.fillStyle = '#8a5c36'; ctx.beginPath(); ctx.ellipse(hx, hy, 4.4, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a1a10'; ctx.beginPath(); ctx.arc(hx + 4, hy, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8a5c36'; ctx.beginPath(); ctx.ellipse(hx - 2, hy - 4, 1.4, 3, -0.5, 0, Math.PI * 2); ctx.ellipse(hx - 2, hy + 4, 1.4, 3, 0.5, 0, Math.PI * 2); ctx.fill();
  if (a.buck) { ctx.strokeStyle = '#d8c8a8'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(hx - 1, hy - 2); ctx.lineTo(hx - 6, hy - 8); ctx.lineTo(hx - 9, hy - 7); ctx.moveTo(hx - 4, hy - 5); ctx.lineTo(hx - 3, hy - 9); ctx.moveTo(hx - 1, hy + 2); ctx.lineTo(hx - 6, hy + 8); ctx.lineTo(hx - 9, hy + 7); ctx.moveTo(hx - 4, hy + 5); ctx.lineTo(hx - 3, hy + 9); ctx.stroke(); }
  ctx.restore();
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
