// Terrain painting for the pre-rendered ground layer.
//
// Natural ground (grass, dirt, gravel, garden soil) is painted at low
// resolution — 8 samples per tile — with smooth multi-octave noise and a
// warped lookup, so borders between grass and paths are organic instead of
// following the tile grid. It is then scaled up with smoothing. Paved and
// built surfaces (roads, floors, water...) are drawn crisp on top by the
// caller, and the small details (grass tufts, wildflowers, pebbles, leaves,
// furrows) are drawn at full resolution afterwards.
//
// Everything here is decoration on a static canvas: it never changes
// collision, cover or interaction.
import { TILE } from '../config.js';
import { GR, SO } from './map.js';
import { hash2 } from '../util.js';

export const NATURAL = new Set([GR.GRASS, GR.DIRT, GR.GRAVEL, GR.GARDEN]);
const PATHY = new Set([GR.DIRT, GR.GRAVEL, GR.ROAD, GR.SIDEWALK, GR.PORCH]);
const S = 8; // low-res samples per tile

function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.03 + 17, y * 2.03 + 9) * 0.3 + vnoise(x * 4.1 + 41, y * 4.1 + 3) * 0.15;

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Palettes: deep shade → sunlit, plus dry straw and trampled earth.
const G_DARK = hex('#3c6529'), G_MID = hex('#558636'), G_LIGHT = hex('#78a847'), G_DRY = hex('#97a052'), G_WORN = hex('#9a8656');
const D_DARK = hex('#74563a'), D_MID = hex('#8d6c45'), D_LIGHT = hex('#a5845a');
const V_DARK = hex('#6f6b63'), V_LIGHT = hex('#928d82');
const SOIL_DARK = hex('#3f2c1d'), SOIL_LIGHT = hex('#5e432c');

/** Per-tile fields: how worn the grass is (near paths) and how shaded (under trees). */
function fields(m) {
  const wear = new Float32Array(m.w * m.h), shadeF = new Float32Array(m.w * m.h);
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy);
    if (m.ground[i] !== GR.GRASS) continue;
    let best = 9;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const nx = cx + ox, ny = cy + oy;
      if (!m.inBounds(nx, ny)) continue;
      if (PATHY.has(m.ground[m.idx(nx, ny)])) best = Math.min(best, Math.hypot(ox, oy));
    }
    wear[i] = best <= 2.3 ? 1 - best / 2.6 : 0;
    let sh = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = cx + ox, ny = cy + oy;
      if (m.inBounds(nx, ny) && m.trees.has(m.idx(nx, ny))) sh += ox === 0 && oy === 0 ? 0.5 : 0.18;
    }
    shadeF[i] = Math.min(0.6, sh);
  }
  return { wear, shadeF };
}

/** Smoothly interpolated per-tile field value at fractional tile coords. */
function sampleField(m, f, tx, ty) {
  const x = tx - 0.5, y = ty - 0.5;
  const x0 = Math.max(0, Math.min(m.w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(m.h - 1, Math.floor(y)));
  const x1 = Math.min(m.w - 1, x0 + 1), y1 = Math.min(m.h - 1, y0 + 1);
  const u = clamp01(x - x0), v = clamp01(y - y0);
  const a = f[y0 * m.w + x0], b = f[y0 * m.w + x1], c = f[y1 * m.w + x0], d = f[y1 * m.w + x1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Paint the smooth natural base layer onto the full-size ground canvas. */
export function paintNaturalBase(g, m) {
  const lw = m.w * S, lh = m.h * S;
  const low = document.createElement('canvas');
  low.width = lw; low.height = lh;
  const lg = low.getContext('2d');
  const img = lg.createImageData(lw, lh);
  const D = img.data;
  const { wear, shadeF } = fields(m);
  const groundAt = (cx, cy) => m.ground[Math.max(0, Math.min(m.h - 1, cy)) * m.w + Math.max(0, Math.min(m.w - 1, cx))];
  for (let py = 0; py < lh; py++) {
    const ty = (py + 0.5) / S;
    for (let px = 0; px < lw; px++) {
      const tx = (px + 0.5) / S;
      const own = groundAt(Math.floor(tx), Math.floor(ty));
      // Warp the lookup so natural borders wander instead of following the grid.
      let gt = own;
      if (NATURAL.has(own)) {
        const wx = tx + (vnoise(tx * 0.85, ty * 0.85) - 0.5) * 0.8;
        const wy = ty + (vnoise(tx * 0.85 + 31, ty * 0.85 + 17) - 0.5) * 0.8;
        const wt = groundAt(Math.floor(wx), Math.floor(wy));
        if (NATURAL.has(wt)) gt = wt;
      }
      const speck = (hash2(px, py) - 0.5) * 0.09;
      let col;
      if (gt === GR.GRASS) {
        const n = fbm(tx / 6.5, ty / 6.5);
        const fine = vnoise(tx * 1.6 + 70, ty * 1.6 + 5);
        let t = clamp01((n - 0.28) * 1.9);
        col = t < 0.5 ? lerp3(G_DARK, G_MID, t * 2) : lerp3(G_MID, G_LIGHT, (t - 0.5) * 2);
        col = lerp3(col, G_LIGHT, clamp01((fine - 0.6) * 1.2) * 0.35);
        const dry = clamp01((fbm(tx / 9 + 300, ty / 9 + 120) - 0.6) * 3.2);
        col = lerp3(col, G_DRY, dry * 0.55);
        const wr = sampleField(m, wear, tx, ty) * clamp01(0.55 + (vnoise(tx * 1.3 + 9, ty * 1.3 + 2) - 0.5) * 1.2);
        col = lerp3(col, G_WORN, wr * 0.55);
        const sh = sampleField(m, shadeF, tx, ty);
        col = lerp3(col, G_DARK, sh * 0.7);
      } else if (gt === GR.DIRT) {
        const n = fbm(tx / 3 + 50, ty / 3 + 80);
        col = n < 0.5 ? lerp3(D_DARK, D_MID, n * 2) : lerp3(D_MID, D_LIGHT, (n - 0.5) * 2);
      } else if (gt === GR.GRAVEL) {
        const n = fbm(tx / 2 + 10, ty / 2 + 40);
        col = lerp3(V_DARK, V_LIGHT, n);
      } else if (gt === GR.GARDEN) {
        const n = vnoise(tx * 0.8 + 3, ty * 0.8 + 90);
        col = lerp3(SOIL_DARK, SOIL_LIGHT, n);
      } else {
        col = D_MID; // under paved/built tiles: the crisp layer covers it
      }
      const k = (py * lw + px) * 4;
      const sp = 1 + speck;
      D[k] = col[0] * sp; D[k + 1] = col[1] * sp; D[k + 2] = col[2] * sp; D[k + 3] = 255;
    }
  }
  lg.putImageData(img, 0, 0);
  g.save();
  g.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
  g.drawImage(low, 0, 0, lw, lh, 0, 0, m.w * TILE, m.h * TILE);
  g.restore();
  return { wear, shadeF };
}

/* ------------------------------------------------------------------ */
/* Full-resolution details                                             */
/* ------------------------------------------------------------------ */
const FLOWER_SETS = [
  ['#f4f1e6', '#e9d64a'], // daisies
  ['#f2d43c', '#c98a1c'], // buttercups
  ['#b48ad8', '#f4e08a'], // asters
  ['#e88fb0', '#f8e2a0'], // clover blossom
  ['#7fa8e8', '#f4f1e6'], // chicory
];

function tuft(g, x, y, s, dark, light) {
  g.strokeStyle = dark; g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(x, y); g.lineTo(x - 2 * s, y - 4 * s);
  g.moveTo(x + 1, y); g.lineTo(x + 1, y - 5 * s);
  g.moveTo(x + 2, y); g.lineTo(x + 4 * s, y - 3.5 * s);
  g.stroke();
  g.strokeStyle = light; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(x + 1, y - 2 * s); g.lineTo(x + 1, y - 5 * s); g.stroke();
}

function flower(g, x, y, petal, center) {
  g.fillStyle = petal;
  g.fillRect(x - 1.5, y - 0.5, 1, 1); g.fillRect(x + 0.5, y - 0.5, 1, 1);
  g.fillRect(x - 0.5, y - 1.5, 1, 1); g.fillRect(x - 0.5, y + 0.5, 1, 1);
  g.fillStyle = center; g.fillRect(x - 0.5, y - 0.5, 1, 1);
}

function pebble(g, x, y, r) {
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(x + 0.6, y + 0.8, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8f8a80'; g.beginPath(); g.ellipse(x, y, r, r * 0.72, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.beginPath(); g.ellipse(x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.3, 0, 0, Math.PI * 2); g.fill();
}

function leaf(g, x, y, a, col) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.fillStyle = col; g.beginPath(); g.ellipse(0, 0, 2.2, 1.1, 0, 0, Math.PI * 2); g.fill();
  g.restore();
}

/** Grass tufts, wildflower patches, pebbles, leaf litter, ruts and furrows. */
export function paintNaturalDetails(g, m, flds) {
  const { wear } = flds;
  const leafCols = ['rgba(150,110,45,0.55)', 'rgba(140,80,35,0.5)', 'rgba(105,75,40,0.55)', 'rgba(165,140,60,0.5)'];
  const treeNear = (cx, cy, r) => { for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) { const nx = cx + ox, ny = cy + oy; if (m.inBounds(nx, ny) && m.trees.has(m.idx(nx, ny))) return true; } return false; };
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy);
    const gt = m.ground[i];
    if (!NATURAL.has(gt)) continue;
    const solid = m.solid[i];
    if (solid !== SO.NONE && solid !== SO.TREE) continue; // buildings, fences, crops props cover it
    const x = cx * TILE, y = cy * TILE;
    const h = hash2(cx * 3 + 1, cy * 7 + 2);
    if (gt === GR.GRASS) {
      const w = wear[i];
      // Tufts, denser where grass is healthy, sparse on trampled ground.
      const dens = vnoise(cx / 3 + 11, cy / 3 + 7);
      const n = Math.round((1 - w) * (1 + dens * 4));
      for (let k = 0; k < n; k++) {
        const tx = x + 3 + hash2(cx * 11 + k, cy * 5) * 26, ty = y + 6 + hash2(cx * 5, cy * 11 + k) * 24;
        tuft(g, tx, ty, 0.8 + hash2(k, cx + cy) * 0.5, 'rgba(32,62,22,0.55)', 'rgba(150,196,92,0.45)');
      }
      // Wildflower patches (clustered by noise, colour picked per patch).
      const fp = vnoise(cx / 4.5 + 200, cy / 4.5 + 60);
      if (fp > 0.71 && w < 0.5 && !treeNear(cx, cy, 1)) {
        const set = FLOWER_SETS[Math.floor(hash2(Math.floor(cx / 4), Math.floor(cy / 4)) * FLOWER_SETS.length)];
        const nf = 1 + Math.floor((fp - 0.71) * 16);
        for (let k = 0; k < nf; k++) flower(g, x + 3 + hash2(cx + k * 7, cy * 3) * 26, y + 3 + hash2(cx * 3, cy + k * 7) * 26, set[0], set[1]);
      } else if (h > 0.975) {
        const set = FLOWER_SETS[Math.floor(hash2(cx, cy) * FLOWER_SETS.length)];
        flower(g, x + 8 + h * 14, y + 10 + hash2(cy, cx) * 12, set[0], set[1]);
      }
      // Clover leaves
      if (vnoise(cx / 2.5 + 400, cy / 2.5 + 9) > 0.78) {
        g.fillStyle = 'rgba(70,120,45,0.55)';
        for (let k = 0; k < 4; k++) { const lx = x + hash2(cx + k, cy * 9) * 28 + 2, ly = y + hash2(cx * 9, cy + k) * 28 + 2; g.beginPath(); g.arc(lx, ly, 1.6, 0, Math.PI * 2); g.arc(lx + 2, ly, 1.6, 0, Math.PI * 2); g.arc(lx + 1, ly - 1.6, 1.6, 0, Math.PI * 2); g.fill(); }
      }
      // Pebbles on trampled edges, a rare small stone in open grass.
      if (w > 0.3 && h < 0.35) pebble(g, x + 6 + hash2(cx, cy * 13) * 20, y + 6 + hash2(cx * 13, cy) * 20, 1.4);
      if (h > 0.993) pebble(g, x + 16, y + 18, 3.2);
      // Leaf litter under and around trees.
      if (m.trees.has(i) || (treeNear(cx, cy, 1) && h > 0.55)) {
        const nl = 1 + Math.floor(h * 2.5);
        for (let k = 0; k < nl; k++) leaf(g, x + hash2(cx * 7 + k, cy) * 30 + 1, y + hash2(cx, cy * 7 + k) * 30 + 1, hash2(k, cx) * 6, leafCols[(k + cx) % leafCols.length]);
      }
    } else if (gt === GR.DIRT) {
      // Ruts along the direction the path runs, plus pebbles and footprints of wear.
      const isD = (a, b) => m.inBounds(a, b) && PATHY.has(m.ground[m.idx(a, b)]);
      const horiz = isD(cx - 1, cy) || isD(cx + 1, cy), vert = isD(cx, cy - 1) || isD(cx, cy + 1);
      g.strokeStyle = 'rgba(60,40,22,0.28)'; g.lineWidth = 1.4;
      g.beginPath();
      if (vert && !horiz) { g.moveTo(x + 10 + h * 2, y); g.lineTo(x + 10 + h * 2, y + TILE); g.moveTo(x + 22 - h * 2, y); g.lineTo(x + 22 - h * 2, y + TILE); }
      else if (horiz && !vert) { g.moveTo(x, y + 11 + h * 2); g.lineTo(x + TILE, y + 11 + h * 2); g.moveTo(x, y + 22 - h * 2); g.lineTo(x + TILE, y + 22 - h * 2); }
      g.stroke();
      g.strokeStyle = 'rgba(200,170,120,0.18)'; g.lineWidth = 1;
      g.beginPath();
      if (vert && !horiz) { g.moveTo(x + 16, y); g.lineTo(x + 16, y + TILE); } else if (horiz && !vert) { g.moveTo(x, y + 16.5); g.lineTo(x + TILE, y + 16.5); }
      g.stroke();
      const np = 1 + Math.floor(h * 3);
      for (let k = 0; k < np; k++) pebble(g, x + 3 + hash2(cx * 3 + k, cy * 17) * 26, y + 3 + hash2(cx * 17, cy * 3 + k) * 26, 1 + hash2(k, cy) * 1.2);
      if (h > 0.8) { g.fillStyle = 'rgba(90,120,50,0.5)'; tuft(g, x + h * 24 + 4, y + 26, 0.7, 'rgba(60,90,35,0.55)', 'rgba(140,170,80,0.4)'); }
    } else if (gt === GR.GRAVEL) {
      for (let k = 0; k < 9; k++) {
        const px = x + hash2(cx * 9 + k, cy * 4) * 30 + 1, py = y + hash2(cx * 4, cy * 9 + k) * 30 + 1;
        g.fillStyle = k % 3 ? 'rgba(60,58,52,0.4)' : 'rgba(220,214,200,0.35)';
        g.fillRect(px, py, 1.6, 1.6);
      }
    } else if (gt === GR.GARDEN) {
      // Furrows: raised rows of soil with a lit top edge.
      for (let r = 0; r < 4; r++) {
        const ry = y + 4 + r * 8;
        g.fillStyle = 'rgba(25,15,8,0.35)'; g.fillRect(x, ry + 3, TILE, 2);
        g.fillStyle = 'rgba(150,110,70,0.25)'; g.fillRect(x, ry, TILE, 1);
      }
    }
  }
}

/** Water tiles: deeper in the middle, lighter in the shallows. */
export function paintWater(g, m) {
  const depth = new Float32Array(m.w * m.h);
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy);
    if (m.ground[i] !== GR.WATER) continue;
    let best = 4;
    for (let oy = -3; oy <= 3; oy++) for (let ox = -3; ox <= 3; ox++) {
      const nx = cx + ox, ny = cy + oy;
      if (m.inBounds(nx, ny) && m.ground[m.idx(nx, ny)] !== GR.WATER) best = Math.min(best, Math.hypot(ox, oy));
    }
    depth[i] = Math.min(1, (best - 1) / 2.5);
  }
  const shallow = hex('#4a8aa0'), deep = hex('#1f4a66');
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy);
    if (m.ground[i] !== GR.WATER) continue;
    const x = cx * TILE, y = cy * TILE;
    // 4 sub-cells per tile so the depth gradient is smooth
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const tx = cx + (sx + 0.5) / 4, ty = cy + (sy + 0.5) / 4;
      const d = clamp01(sampleField(m, depth, tx, ty) + (vnoise(tx * 1.5, ty * 1.5) - 0.5) * 0.2);
      const c = lerp3(shallow, deep, d);
      g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      g.fillRect(x + sx * 8, y + sy * 8, 8, 8);
    }
  }
}
