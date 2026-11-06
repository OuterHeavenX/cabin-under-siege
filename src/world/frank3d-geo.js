// Frank's body, built entirely in code (3D view): a geometry toolkit (lofts of
// superellipse rings, sculpted head, polar hair cap, ribbons, boxes and prisms),
// the part builders for High and Low quality (and the young Frank of the
// prequels), the bake that writes vertex colour, AO, surface data, face UVs and
// skin weights into ONE merged geometry per quality, the skeleton bind table, the
// white-multiply face atlas, the shared materials with their lighting patch, and
// the small per-rig decal, debris, dust and beam geometries.
//
// Frames: body space, +X forward, +Y up, +Z = Frank's RIGHT; 1 unit = 1 px.
// Bind pose: every bone unrotated, arms hanging straight down.
import * as THREE from '../vendor/three.module.min.js';
import { TUNE, SOCKETS } from './frank3d-clips.js';
import { smoothstep as ss, clamp, lerp, DEG } from './frank3d-anim.js';

const TAU = Math.PI * 2;

/* ================= colour helpers (linear working space) ================= */
const _c = new THREE.Color();
export function lin(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
/** The sRGB hex that, multiplied onto skinHex (both linear), gives targetHex. */
export function mulOver(targetHex, skinHex) {
  const t = lin(targetHex), s = lin(skinHex);
  _c.setRGB(Math.min(1, t[0] / s[0]), Math.min(1, t[1] / s[1]), Math.min(1, t[2] / s[2]));
  return '#' + _c.getHexString();
}
const COL = TUNE.colors;

/* ================= surfaces (roughness, metalness, cloth, skin) ================= */
export const SURF = TUNE.surf;

/* ================= skeleton (§2.2) ================= */
export const SKIRT6 = [30, 90, 150, 210, 270, 330]; // FR SR BR BL SL FL (loft parameter, from +X toward +Z)
export const SKIRT4 = [45, 135, 225, 315];
export const PROP_BIND = [0, 40, 40];
const PROPS = [['pistol', 'root', 0, 40, 40], ['pistolSlide', 'pistol', 0, 42.3, 40], ['pistolMag', 'pistol', -0.9, 37.4, 40],
  ['shotgun', 'root', 0, 40, 40], ['shotgunForend', 'shotgun', 15, 41.4, 40], ['rifle', 'root', 0, 40, 40], ['rifleBolt', 'rifle', -2.0, 42.4, 40],
  ['spareMag', 'root', 0, 40, 40], ['shellHand', 'root', 0, 40, 40], ['roundHand', 'root', 0, 40, 40],
  ['axe', 'root', 0, 40, 40], ['hammer', 'root', 0, 40, 40], ['plank', 'root', 0, 40, 40], ['parcel', 'root', 0, 40, 40], ['rod', 'root', 0, 40, 40]];
export const PROP_NAMES = PROPS.map((p) => p[0]);

/** The bone table for a quality: [{name, parent, pos (body-space bind position)}], parents first. */
export function boneTable(q) {
  const B = [];
  const add = (name, parent, x, y, z) => B.push({ name, parent, pos: [x, y, z] });
  add('root', null, 0, 0, 0);
  add('pelvis', 'root', 0, 37.5, 0);
  add('spine1', 'pelvis', 0, 41.5, 0);
  add('spine2', 'spine1', 0, 48.0, 0);
  if (!q) add('breath', 'spine2', 3.0, 52.0, 0);
  add('neck', 'spine2', 0.6, 59.5, 0);
  add('head', 'neck', 1.0, 63.0, 0);
  if (!q) for (const f of FORELOCKS) add(f.bone, 'head', ...f.root);
  for (const [L, s] of [['L', -1], ['R', 1]]) {
    add('clav' + L, 'spine2', 1.0, 57.0, 2.0 * s);
    add('upperArm' + L, 'clav' + L, 0.3, 57.8, 11.0 * s);
    add('forearm' + L, 'upperArm' + L, 0.3, 44.6, 11.0 * s);
    add('hand' + L, 'forearm' + L, 0.3, 33.0, 11.0 * s);
  }
  for (const [L, s] of [['L', -1], ['R', 1]]) {
    add('thigh' + L, 'pelvis', 0, 37.5, 4.6 * s);
    add('shin' + L, 'thigh' + L, 0, 19.5, 4.6 * s);
    add('foot' + L, 'shin' + L, 0, 3.6, 4.6 * s);
  }
  if (!q) {
    SKIRT6.forEach((th, k) => { const u = coatSurface(38, th * DEG, 0.5); add('skU' + k, 'pelvis', u[0], u[1], u[2]); });
    SKIRT6.forEach((th, k) => { const l = coatSurface(28, th * DEG, 0.5); add('skL' + k, 'skU' + k, l[0], l[1], l[2]); });
  } else SKIRT4.forEach((th, k) => { const u = coatSurface(38, th * DEG, 0.5); add('sk' + k, 'pelvis', u[0], u[1], u[2]); });
  for (const p of PROPS) add(...p);
  return B;
}

/* ================= the coat's outer surface (§3.3 C) ================= */
// [Y, a (half-depth), b (half-width), n, cx]. Deviations from the spec table, all for the look against the portrait: the
// collar-to-shoulder rings sit 0.7 lower with a flatter upper back (cx +0.5, a −0.5), so the neck shows and the high
// camera sees no hump; a softer shoulder slope (more rings); the skirt hangs nearly straight (hem 0.86× the shoulders).
const COAT_RINGS = [
  [60.3, 3.7, 4.1, 2.2, 0.8], [59.7, 4.7, 7.4, 2.5, 0.65], [59.0, 5.1, 10.9, 2.8, 1.05], [57.9, 5.75, 13.5, 3.0, 0.92],
  [56.6, 6.1, 13.0, 2.9, 0.8], [53.0, 6.75, 12.0, 2.6, 0.5], [50.0, 6.4, 11.2, 2.5, 0.3], [46.5, 5.75, 9.7, 2.4, 0.1],
  [43.0, 5.65, 9.6, 2.4, 0], [40.0, 6.2, 9.9, 2.4, 0], [38.0, 6.6, 10.15, 2.3, 0], [36.0, 7.0, 10.4, 2.2, 0], [31.0, 7.4, 10.6, 2.1, 0],
  [28.5, 7.6, 10.8, 2.05, 0], [26.0, 7.8, 11.0, 2.0, 0], [22.0, 8.0, 11.2, 2.0, 0], [18.0, 8.1, 11.4, 2.0, 0],
];
export const COAT_TOP = COAT_RINGS[0][0];
const COAT_RINGS_LQ = [COAT_RINGS[0], COAT_RINGS[1], COAT_RINGS[3], COAT_RINGS[5], COAT_RINGS[7], COAT_RINGS[9], COAT_RINGS[11], COAT_RINGS[12], COAT_RINGS[14], COAT_RINGS[16]];
export const BUTTON_Y = 46.5, HEM_Y = 18.0;
function coatRingAt(Y) {
  const R = COAT_RINGS;
  if (Y >= R[0][0]) return R[0];
  for (let i = 1; i < R.length; i++) if (Y >= R[i][0]) { const a = R[i - 1], b = R[i], t = (Y - b[0]) / (a[0] - b[0]); return [Y, lerp(b[1], a[1], t), lerp(b[2], a[2], t), lerp(b[3], a[3], t), lerp(b[4], a[4], t)]; }
  return R[R.length - 1];
}
const sePt = (phi, a, b, n) => { const c = Math.cos(phi), s = Math.sin(phi), e = 2 / n; return [a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(s) * Math.abs(s) ** e]; };
/** A point on the coat's outer surface at height Y and loft parameter phi, pulled `inset` toward the axis. */
export function coatSurface(Y, phi, inset = 0) {
  const [, a, b, n, cx] = coatRingAt(Y);
  const [x, z] = sePt(phi, a, b, n), r = Math.hypot(x, z) || 1;
  return [cx + x * (1 - inset / r), Y, z * (1 - inset / r)];
}
/** x of the coat's front surface at height Y and lateral offset z. */
export function coatX(Y, z) { const [, a, b, n, cx] = coatRingAt(Y); return cx + a * Math.max(0, 1 - Math.min(1, Math.abs(z) / b) ** n) ** (1 / n); }
/** Front opening full width at height Y (closed at the button). Above it the V is wider than the spec's 7.5 at the top (9.5):
 *  the open shirt collar of the portrait. */
const openW = (Y) => (Y >= BUTTON_Y ? 9.5 * (Y - BUTTON_Y) / (COAT_TOP - BUTTON_Y) : 10 * (BUTTON_Y - Y) / 28.5);
const openPhi = (Y, b, n) => Math.asin(Math.min(1, (openW(Y) / (2 * b)) ** (n / 2)));

/* ================= part toolkit ================= */
class Part {
  constructor(flat = false) { this.P = []; this.I = []; this.N = flat ? [] : null; this.M = []; this.flat = flat; }
  v(x, y, z, m = null) { this.P.push(x, y, z); this.M.push(m); return this.P.length / 3 - 1; }
  vn(x, y, z, nx, ny, nz, m = null) { this.P.push(x, y, z); this.N.push(nx, ny, nz); this.M.push(m); return this.P.length / 3 - 1; }
  tri(a, b, c) { this.I.push(a, b, c); }
  /** A triangle wound so its normal points away from `ref` ([x, y, z]). */
  triAway(a, b, c, ref) {
    const P = this.P, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const gx = (ax + P[b * 3] + P[c * 3]) / 3 - ref[0], gy = (ay + P[b * 3 + 1] + P[c * 3 + 1]) / 3 - ref[1], gz = (az + P[b * 3 + 2] + P[c * 3 + 2]) / 3 - ref[2];
    if (nx * gx + ny * gy + nz * gz >= 0) this.tri(a, b, c); else this.tri(a, c, b);
  }
  /** A flat convex polygon (points [x,y,z]), oriented so its normal points away from `center`. */
  poly(pts, center, m = null) {
    let nx = 0, ny = 0, nz = 0; // Newell's normal (robust for any planar-ish polygon)
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    let gx = 0, gy = 0, gz = 0; for (const p of pts) { gx += p[0]; gy += p[1]; gz += p[2]; } gx /= pts.length; gy /= pts.length; gz /= pts.length;
    const flip = nx * (gx - center[0]) + ny * (gy - center[1]) + nz * (gz - center[2]) < 0;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L; if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const ids = pts.map((p) => this.vn(p[0], p[1], p[2], nx, ny, nz, typeof m === 'function' ? m(p) : m));
    for (let i = 1; i < ids.length - 1; i++) { if (flip) this.tri(ids[0], ids[i + 1], ids[i]); else this.tri(ids[0], ids[i], ids[i + 1]); }
  }
  /** Apply a Matrix4 to positions (and normals). */
  xform(m) {
    const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.P.length; i += 3) { v.set(this.P[i], this.P[i + 1], this.P[i + 2]).applyMatrix4(m); this.P[i] = v.x; this.P[i + 1] = v.y; this.P[i + 2] = v.z; }
    if (this.N) for (let i = 0; i < this.N.length; i += 3) { v.set(this.N[i], this.N[i + 1], this.N[i + 2]).applyMatrix3(nm).normalize(); this.N[i] = v.x; this.N[i + 1] = v.y; this.N[i + 2] = v.z; }
    return this;
  }
}
/** Triangulate a grid G[k][j] of vertex ids. `out` = true when the winding (k→k+1, j→j+1) faces out as a, d, c / a, c, b. */
function grid(part, G, closedJ, out, skipJ = null) {
  const K = G.length, J = G[0].length;
  for (let k = 0; k < K - 1; k++) for (let j = 0; j < (closedJ ? J : J - 1); j++) {
    if (skipJ && skipJ.has(j)) continue;
    const j1 = (j + 1) % J, a = G[k][j], b = G[k][j1], c = G[k + 1][j1], d = G[k + 1][j];
    if (a === d && b === c) continue;
    if (out) { if (a !== d) part.tri(a, d, c); if (b !== c) part.tri(a, c, b); }
    else { if (a !== d) part.tri(a, c, d); if (b !== c) part.tri(a, b, c); }
  }
}
function smoothNormals(P, I) {
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] += nx; N[i + 1] += ny; N[i + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const L = Math.hypot(N[i], N[i + 1], N[i + 2]); if (L > 1e-12) { N[i] /= L; N[i + 1] /= L; N[i + 2] /= L; } else { N[i] = 0; N[i + 1] = 1; N[i + 2] = 0; } }
  return N;
}
/** A box (w along X, h along Y, d along Z) centred at the origin; ch > 0 chamfers every edge (44 tris). */
function boxPart(w, h, d, ch = 0) {
  const p = new Part(true), X = w / 2, Y = h / 2, Z = d / 2, O = [0, 0, 0];
  if (!(ch > 0)) {
    const c = (sx, sy, sz) => [sx * X, sy * Y, sz * Z];
    p.poly([c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)], O); p.poly([c(-1, -1, -1), c(-1, 1, -1), c(-1, 1, 1), c(-1, -1, 1)], O);
    p.poly([c(-1, 1, -1), c(1, 1, -1), c(1, 1, 1), c(-1, 1, 1)], O); p.poly([c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1)], O);
    p.poly([c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)], O); p.poly([c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1)], O);
    return p;
  }
  const k = Math.min(ch, X * 0.9, Y * 0.9, Z * 0.9);
  const px = (sx, sy, sz) => [sx * X, sy * (Y - k), sz * (Z - k)], py = (sx, sy, sz) => [sx * (X - k), sy * Y, sz * (Z - k)], pz = (sx, sy, sz) => [sx * (X - k), sy * (Y - k), sz * Z];
  const S = [-1, 1];
  for (const s of S) {
    p.poly([px(s, -1, -1), px(s, 1, -1), px(s, 1, 1), px(s, -1, 1)], O);
    p.poly([py(-1, s, -1), py(1, s, -1), py(1, s, 1), py(-1, s, 1)], O);
    p.poly([pz(-1, -1, s), pz(1, -1, s), pz(1, 1, s), pz(-1, 1, s)], O);
  }
  for (const a of S) for (const b of S) {
    p.poly([px(a, b, -1), px(a, b, 1), py(a, b, 1), py(a, b, -1)], O); // X–Y edges
    p.poly([px(a, -1, b), px(a, 1, b), pz(a, 1, b), pz(a, -1, b)], O); // X–Z edges
    p.poly([py(-1, a, b), py(1, a, b), pz(1, a, b), pz(-1, a, b)], O); // Y–Z edges
  }
  for (const a of S) for (const b of S) for (const c of S) p.poly([px(a, b, c), py(a, b, c), pz(a, b, c)], O);
  return p;
}
/** A capped cylinder along +X from x0 to x1, radius r0 → r1, `sides` facets (flat sides, flat caps). */
function cylX(x0, x1, r0, r1, sides, cap0 = true, cap1 = true, phase = 0) {
  const p = new Part(true), ring = (x, r) => Array.from({ length: sides }, (_, i) => { const a = phase + i / sides * TAU; return [x, Math.cos(a) * r, Math.sin(a) * r]; });
  const A = ring(x0, r0), B = ring(x1, r1), C = [(x0 + x1) / 2, 0, 0];
  for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; p.poly([A[i], A[j], B[j], B[i]], [(x0 + x1) / 2 + 0, 0, 0]); }
  if (cap0) p.poly(A, [x1 + 1, 0, 0]); if (cap1) p.poly(B, [x0 - 1, 0, 0]);
  void C; return p;
}
const M4 = () => new THREE.Matrix4();
const TR = (x, y, z) => M4().makeTranslation(x, y, z);
const RX = (a) => M4().makeRotationX(a), RY = (a) => M4().makeRotationY(a), RZ = (a) => M4().makeRotationZ(a);
const CH = (...ms) => ms.reduce((acc, m) => acc.multiply(m), M4());

/* ================= the merged mesh being baked ================= */
class Bake {
  constructor(bones, opts) {
    this.boneIx = Object.fromEntries(bones.map((b, i) => [b.name, i]));
    this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.surf = []; this.si = []; this.sw = []; this.idx = [];
    this.withUV = !!opts.uv; this.parts = {}; this.twins = []; this.ranges = {}; this.twinRanges = [];
  }
  get count() { return this.pos.length / 3; }
  /**
   * Append a part. o.bone (rigid) or o.w(x, y, z, m) → [[boneName, w], ...]; o.col: hex | [r,g,b] | fn(x, y, z, m, n) → [r,g,b];
   * o.surf: SURF entry | fn; o.uv: fn(x, y, z, m) → [u, v] (default white (0.75, 0.5)).
   */
  add(name, part, o) {
    const P = part.P, n = P.length / 3, N = part.N ? part.N : smoothNormals(P, part.I), base = this.count;
    const fixedCol = typeof o.col === 'string' ? lin(o.col) : Array.isArray(o.col) ? o.col : null;
    for (let i = 0; i < n; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], m = part.M[i], nn = [N[i * 3], N[i * 3 + 1], N[i * 3 + 2]];
      this.pos.push(x, y, z); this.nrm.push(nn[0], nn[1], nn[2]);
      const c = fixedCol || o.col(x, y, z, m, nn);
      this.col.push(c[0], c[1], c[2]);
      const s = typeof o.surf === 'function' ? o.surf(x, y, z, m) : o.surf;
      this.surf.push(Math.round(s[0] * 255), Math.round(s[1] * 255), Math.round(s[2] * 255), Math.round(s[3] * 255));
      if (this.withUV) { const uv = o.uv ? o.uv(x, y, z, m) : WHITE_UV; this.uv.push(uv[0], uv[1]); }
      let W = o.bone ? [[o.bone, 1]] : o.w(x, y, z, m);
      // merge influences per bone (e.g. breath folded into spine2) before the top-4 cut, so no slot is wasted or lost
      const acc = new Map();
      for (const [bn, w] of W) { const bi = this.boneIx[bn]; if (bi !== undefined) acc.set(bi, (acc.get(bi) || 0) + w); }
      W = [...acc].filter(([, w]) => w >= 0.01).sort((a, b) => b[1] - a[1]).slice(0, 4);
      if (!W.length) W = [[this.boneIx[o.fallback || 'spine2'], 1]];
      const tot = W.reduce((s2, e) => s2 + e[1], 0);
      for (let k = 0; k < 4; k++) { this.si.push(W[k] ? W[k][0] : 0); this.sw.push(W[k] ? W[k][1] / tot : 0); }
    }
    for (const t of part.I) this.idx.push(base + t);
    this.parts[name] = (this.parts[name] || 0) + part.I.length / 3;
    (this.ranges[name] || (this.ranges[name] = [])).push([base, base + n]);
    if (o.twin) this.twinRanges.push([base, base + n]); // every vertex here must have an outer twin (the geometry test checks)
    return base;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aSurf', new THREE.Uint8BufferAttribute(this.surf, 4, true));
    g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(this.si, 4)); // ≤ 50 bones
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    return g;
  }
}
const WHITE_UV = [0.75, 0.5];

/* ================= weights ================= */
/** The coat shell rule (§3.4) at body-space (x, Y, z) with loft parameter phi (radians, 0..2π). */
function shellWeights(x, Y, z, phi, q, side = null) {
  const W = [];
  const s = side !== null ? side : (z >= 0 ? 1 : -1), L = s > 0 ? 'R' : 'L';
  if (Y >= 39) {
    const wPel = 1 - ss(40, 44, Y), wS1 = ss(40, 44, Y) * (1 - ss(44, 47, Y)), wS2 = ss(44, 47, Y);
    if (wPel > 0) W.push(['pelvis', wPel]);
    if (wS1 > 0) W.push(['spine1', wS1]);
    if (wS2 > 0) {
      const az = Math.abs(z);
      let fB = q ? 0 : 0.8 * ss(1.0, 6.0, x) * ss(47, 50, Y) * (1 - ss(56, 59, Y)) * (1 - ss(6, 9, az));
      let fC = 0.75 * ss(6.5, 10.5, az) * ss(50, 55, Y);
      let fU = 0.30 * ss(9.5, 12.5, az) * ss(46, 50, Y) * (1 - ss(56, 59, Y));
      const sum = fB + fC + fU; if (sum > 1) { fB /= sum; fC /= sum; fU /= sum; }
      W.push(['spine2', wS2 * (1 - fB - fC - fU)]);
      if (fB > 0) W.push(['breath', wS2 * fB]);
      if (fC > 0) W.push(['clav' + L, wS2 * fC]);
      if (fU > 0) W.push(['upperArm' + L, wS2 * fU]);
    }
    return W;
  }
  const vU = ss(39, 35, Y);
  if (1 - vU > 0) W.push(['pelvis', 1 - vU]);
  if (vU <= 0) return W;
  let p = ((phi % TAU) + TAU) % TAU;
  if (q) {
    // 4 single bones at 45/135/225/315, front clamped, vent clamped below 29
    const th = SKIRT4.map((d) => d * DEG);
    const h = hat(p, th, Y, side);
    h.forEach((w, k) => { if (w > 0) W.push(['sk' + k, vU * w]); });
    return W;
  }
  const vL = ss(31, 26, Y);
  const h = hat(p, SKIRT6.map((d) => d * DEG), Y, side);
  h.forEach((w, k) => { if (w > 0) { if (1 - vL > 0) W.push(['skU' + k, vU * (1 - vL) * w]); if (vL > 0) W.push(['skL' + k, vU * vL * w]); } });
  return W;
}
/** Smoothstep hat over chains sorted by angle; clamped across the front opening; the back vent splits below Y 29. */
function hat(p, th, Y, side) {
  const n = th.length, out = new Array(n).fill(0);
  if (p <= th[0]) { out[0] = 1; return out; }
  if (p >= th[n - 1]) { out[n - 1] = 1; return out; }
  let k = 0; while (k < n - 2 && p > th[k + 1]) k++;
  const t = (p - th[k]) / (th[k + 1] - th[k]), sm = t * t * (3 - 2 * t);
  const periodic = [k, k + 1, 1 - sm, sm];
  // Vent: chains straddling π (BR/BL) split when the vent is open.
  const straddles = th[k] < Math.PI && th[k + 1] > Math.PI;
  if (straddles && Y < 33) {
    const sideIsRight = side !== null ? side > 0 : p < Math.PI;
    const b = ss(29, 33, Y);
    out[k] = lerp(sideIsRight ? 1 : 0, periodic[2], b); out[k + 1] = lerp(sideIsRight ? 0 : 1, periodic[3], b);
    return out;
  }
  out[k] = periodic[2]; out[k + 1] = periodic[3];
  return out;
}
const tubeW = (top, bot, s, s0, s1) => { const w = ss(s0, s1, s); return w <= 0 ? [[top, 1]] : w >= 1 ? [[bot, 1]] : [[top, 1 - w], [bot, w]]; };

/* ================= parts ================= */
// ---- head: a loft of two-radius superellipse rings (the jaw, chin and face lines need direct control)
// [Y, xf (front), xw (widest), xb (back), zw (half-width), nf, nb]
const HEAD_RINGS = [
  [62.05, 5.0, 3.6, 2.2, 1.1, 2.3, 2.0], [62.4, 5.6, 3.2, 0.6, 2.2, 2.7, 2.0], [62.95, 5.9, 2.85, -0.7, 2.75, 3.0, 2.2],
  [63.6, 6.0, 2.55, -1.6, 3.42, 3.1, 2.2], [64.35, 6.12, 2.2, -2.25, 3.8, 2.9, 2.2], [65.2, 6.25, 1.9, -2.75, 3.92, 2.75, 2.2],
  [66.1, 6.2, 1.7, -3.1, 4.02, 2.7, 2.2], [67.0, 6.08, 1.55, -3.35, 4.08, 2.75, 2.2], [67.8, 6.1, 1.45, -3.45, 4.1, 2.8, 2.2],
  [68.5, 6.3, 1.38, -3.52, 4.12, 2.7, 2.2], [69.1, 6.42, 1.3, -3.56, 4.12, 2.5, 2.2], [69.9, 6.25, 1.2, -3.56, 4.08, 2.35, 2.2],
  [70.9, 5.92, 1.1, -3.46, 3.94, 2.2, 2.2], [71.9, 5.3, 1.0, -3.15, 3.56, 2.1, 2.1], [72.75, 4.25, 0.95, -2.5, 2.85, 2.0, 2.0],
  [73.35, 2.8, 0.95, -1.5, 1.75, 2.0, 2.0],
];
const HEAD_TOP = [1.0, 73.6, 0], HEAD_BOT = [3.6, 61.85, 0];
const SKULL_C = [1.3, 67.8, 0];
function headRingAt(Y) {
  const R = HEAD_RINGS;
  if (Y <= R[0][0]) return R[0];
  for (let i = 1; i < R.length; i++) if (Y <= R[i][0]) { const a = R[i - 1], b = R[i], t = (Y - a[0]) / (b[0] - a[0]); return a.map((v, k) => lerp(v, b[k], t)); }
  return R[R.length - 1];
}
/** Two-radius superellipse point for parameter phi (0 = front, +π/2 = +Z). */
function headSec(r, phi) {
  const [, xf, xw, xb, zw, nf, nb] = r;
  const c = Math.cos(phi), s = Math.sin(phi);
  if (c >= 0) { const e = 2 / nf; return [xw + (xf - xw) * c ** e, zw * Math.sign(s) * Math.abs(s) ** e]; }
  const e = 2 / nb; return [xw - (xw - xb) * (-c) ** e, zw * Math.sign(s) * Math.abs(s) ** e];
}
/** Is a body-space point inside the head volume (for the hair shell)? */
function insideHead(x, y, z) {
  if (y < HEAD_RINGS[0][0] || y > HEAD_TOP[1]) return false;
  const r = y > HEAD_RINGS[HEAD_RINGS.length - 1][0] ? (() => { const a = HEAD_RINGS[HEAD_RINGS.length - 1], t = (y - a[0]) / (HEAD_TOP[1] - a[0]); return [y, lerp(a[1], 1.05, t), lerp(a[2], 1.0, t), lerp(a[3], 0.95, t), lerp(a[4], 0.05, t), 2, 2]; })() : headRingAt(y);
  const [, xf, xw, xb, zw, nf, nb] = r;
  if (x >= xw) return ((x - xw) / (xf - xw)) ** nf + (Math.abs(z) / zw) ** nf <= 1;
  return ((xw - x) / (xw - xb)) ** nb + (Math.abs(z) / zw) ** nb <= 1;
}
/** Distance from the skull centre to the head surface along a unit direction. */
function headRadius(d) {
  let lo = 0, hi = 9;
  for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (insideHead(SKULL_C[0] + d[0] * m, SKULL_C[1] + d[1] * m, SKULL_C[2] + d[2] * m)) lo = m; else hi = m; }
  return lo;
}
const g2 = (dy, dz, sy, sz) => Math.exp(-(dy * dy) / (2 * sy * sy) - (dz * dz) / (2 * sz * sz));
/** Face sculpt: displacement (along −X mostly) for the eye sockets, brow, cheekbones, mouth and chin. */
function faceSculpt(x, y, z, front) {
  if (front <= 0) return [x, z];
  const az = Math.abs(z);
  let dx = 0;
  dx -= 0.55 * g2(y - 67.75, az - 1.78, 0.75, 0.95);                    // eye sockets
  dx += 0.40 * g2(y - 68.95, 0, 0.42, 9) * (1 - ss(2.5, 3.6, az));      // brow ridge
  dx += 0.30 * g2(y - 66.35, az - 3.0, 0.7, 0.7);                       // cheekbones
  dx -= 0.24 * g2(y - 65.0, az - 2.35, 0.9, 0.65);                      // cheek hollows under the cheekbones
  dx += 0.12 * g2(y - 64.15, 0, 0.35, 1.2);                             // upper lip
  dx -= 0.14 * g2(y - 63.55, 0, 0.3, 1.0);                              // under the lower lip
  dx += 0.18 * g2(y - 62.9, 0, 0.5, 1.4);                               // chin
  dx -= 0.25 * g2(y - 70.2, az - 3.35, 0.9, 0.5);                       // temples
  return [x + dx * front, z];
}
function buildHead(q) {
  const p = new Part();
  const rings = q ? [0, 2, 4, 5, 6, 8, 10, 12, 14].map((i) => HEAD_RINGS[i]) : HEAD_RINGS; // Low: rings on the eye line and the brow
  // Columns: dense across the face, sparse at the back; the back seam (φ = π) is duplicated (face UV seam).
  const nF = q ? 8 : 14, nB = 4, phis = []; // the back of the skull lies under the hair: few columns there
  for (let i = 0; i <= nF; i++) phis.push(-Math.PI / 2 + i / nF * Math.PI);
  for (let i = 1; i <= nB; i++) phis.push(Math.PI / 2 + i / nB * Math.PI); // ends at 3π/2 (= −π/2): closes onto column 0
  // phis: −90..90 (front), then 90+..270 (back). Split the back at π: insert a duplicate.
  const cols = [];
  for (const ph of phis) { cols.push({ ph, side: 0 }); }
  // find the π column and duplicate it
  const iPi = cols.findIndex((c) => Math.abs(c.ph - Math.PI) < 1e-6);
  if (iPi >= 0) cols.splice(iPi + 1, 0, { ph: Math.PI, side: -1 }), cols[iPi].side = 1;
  cols.pop(); // the last (3π/2) equals the first; close the loop instead
  const G = [];
  for (const r of rings) {
    const row = [];
    for (const c of cols) {
      const [sx, sz] = headSec(r, c.ph);
      const front = ss(0.0, 0.5, Math.cos(c.ph));
      const [x, z] = faceSculpt(sx, r[0], sz, front);
      row.push(p.v(x, r[0], z, { ph: c.ph, back: Math.cos(c.ph) < -0.2, seam: c.side }));
    }
    G.push(row);
  }
  // Rings go up (+Y); columns run from −Z through +X to +Z and round the back: from above that's from −Z to +Z through the front.
  // φ increases from +X toward +Z, so the standard winding applies with rings going up.
  const seamSkip = new Set(cols.map((c, j) => (c.side === 1 ? j : -1)).filter((j) => j >= 0));
  grid(p, G, true, true, seamSkip);
  // poles
  const top = p.v(HEAD_TOP[0], HEAD_TOP[1], HEAD_TOP[2], { ph: 0, pole: 1 }), bot = p.v(HEAD_BOT[0], HEAD_BOT[1], HEAD_BOT[2], { ph: 0, pole: -1 });
  const J = cols.length, last = G[G.length - 1], first = G[0];
  for (let j = 0; j < J; j++) { const j1 = (j + 1) % J; if (seamSkip.has(j)) continue; p.tri(last[j], top, last[j1]); p.tri(first[j], first[j1], bot); }
  return p;
}
function buildNose() {
  // two halves, each smooth-shaded, meeting on a hard bridge ridge (no faceting, but the ridge still catches the light)
  const out = [], c = [6.0, 66.6, 0];
  for (const sd of [1, -1]) {
    const p = new Part(), v = (pt) => p.v(pt[0], pt[1], pt[2] * sd);
    const B = v([6.4, 68.45, 0]), T = v([7.45, 65.55, 0]), U = v([6.98, 65.0, 0]), W = v([6.3, 65.2, 0.68]), S = v([6.2, 67.6, 0.44]), N = v([6.1, 65.0, 0.26]);
    const cc = [c[0], c[1], 0];
    p.triAway(B, T, S, cc); p.triAway(S, T, W, cc); p.triAway(T, U, W, cc); p.triAway(W, U, N, cc);
    out.push(p);
  }
  return out;
}
function buildEars(q) {
  // An ear: a raised helix rim round a recessed concha, a back plate, standing 0.3 off the skull and flared back 18°.
  const out = [];
  for (const s of [-1, 1]) {
    const p = new Part(true), K = q ? 3 : 8, rim = [], inner = [], back = [];
    for (let i = 0; i < K; i++) {
      const a = i / K * TAU, y = Math.sin(a) * 1.45, x = Math.cos(a) * 0.95 * (Math.sin(a) < 0 ? 0.8 : 1);
      rim.push([x, y, 0.3]); inner.push([x * 0.72, y * 0.74, 0.36]); back.push([x * 0.9, y * 0.9, -0.3]);
    }
    const concha = [0.05, -0.05, q ? 0.2 : -0.02], bc = [0, 0, -0.3], ctr = [0, 0, 0];
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K;
      if (q) p.poly([rim[i], rim[j], concha], [0, 0, -5], 'in');
      else { p.poly([rim[i], rim[j], inner[j], inner[i]], [0, 0, -5], 'rim'); p.poly([inner[i], inner[j], concha], [0, 0, -5], 'in'); }
      p.poly([back[i], back[j], bc], [0, 0, 5], 'out'); p.poly([rim[i], rim[j], back[j], back[i]], ctr, 'rim');
    }
    p.xform(CH(TR(0.9, 66.9, s * 4.4), RY(s * 18 * DEG), RZ(15 * DEG), s < 0 ? RY(Math.PI) : M4()));
    out.push(p);
  }
  return out;
}
// ---- hair: a polar cap from the hairline to a pole at the occiput, so the columns run hairline → crown → back:
// the slicked-back comb direction. The boundary passes ABOVE the ears (as seen from the pole it is star-shaped, so no
// column folds over another); the sideburns are separate little patches in front of the ears.
const HAIR_POLE = (() => { const v = new THREE.Vector3(-0.957, 0.29, 0).normalize(); return [v.x, v.y, v.z]; })();
// Right-half boundary key points (body space), front centre → nape centre; the left half mirrors.
const HAIR_BOUND = [[6.1, 71.0, 0], [5.9, 71.1, 1.3], [5.3, 71.55, 2.6], [4.45, 70.9, 3.4], [3.5, 69.6, 3.95], [2.5, 69.1, 4.2],
  [1.2, 69.1, 4.35], [-0.2, 68.6, 4.3], [-0.95, 66.8, 4.15], [-1.5, 64.7, 3.85], [-2.1, 63.3, 3.15], [-2.5, 62.8, 1.7], [-2.65, 62.7, 0]];
function hairBoundary(nCols) {
  const pts = [...HAIR_BOUND, ...HAIR_BOUND.slice(1, -1).reverse().map(([x, y, z]) => [x, y, -z])]; // closed loop
  // arc-length parametrised Catmull-Rom (periodic)
  const n = pts.length, seg = [], P = (i) => pts[((i % n) + n) % n];
  // weighted arc length: the front hairline gets ~1.9× the column density (the locks that sweep over the top live there)
  const wgt = (a, b) => 1 + 0.9 * ss(2.0, 5.0, (a[0] + b[0]) / 2);
  let tot = 0; for (let i = 0; i < n; i++) { const a = P(i), b = P(i + 1), L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * wgt(a, b); seg.push(L); tot += L; }
  const out = [];
  for (let j = 0; j < nCols; j++) {
    let d = j / nCols * tot, i = 0; while (d > seg[i]) { d -= seg[i]; i++; }
    const t = d / seg[i], p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2), t2 = t * t, t3 = t2 * t;
    out.push([0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
  }
  return out;
}
function slerpDir(a, b, t) {
  const d = clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1), om = Math.acos(d);
  if (om < 1e-5) return a.slice();
  const s = Math.sin(om), ka = Math.sin((1 - t) * om) / s, kb = Math.sin(t * om) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}
/** Hair thickness over the skull along direction d (v = 0 at the hairline → 1 at the pole; d0 = the column's boundary direction). */
function hairThick(d, v, d0) {
  const up = d[1], side = Math.abs(d[2]);
  const upF = ss(0.25, 0.95, up), sideF = ss(0.45, 0.95, side);
  let full = lerp(0.36, 1.25, upF * (1 - 0.45 * sideF));                         // full on top, flat at the sides
  const backF = ss(-0.15, -0.8, d[0]) * (1 - ss(-0.15, -0.6, up));
  full = lerp(full, 1.3, backF * (1 - 0.5 * upF));                               // a full back of the head
  full *= lerp(1, 0.5, ss(-0.25, -0.7, up));                                     // short at the nape
  const frontCol = ss(0.3, 0.75, d0[0]) * (1 - ss(0.55, 0.85, Math.abs(d0[2])));
  full += 0.5 * frontCol * ss(0.0, 0.12, v) * (1 - ss(0.3, 0.62, v));           // the swept-back quiff
  const edge = 0.14 + 0.5 * frontCol;                                            // a real lip at the front hairline
  return lerp(edge, full, ss(0, 0.2, v));
}
const LOCK = [-0.2, 0.24, 0.24];
function buildHair(q) {
  const p = new Part(), nC = q ? 16 : 30, nR = q ? 4 : 6;
  const B = hairBoundary(nC), G = [];
  const vs = [-0.05]; for (let r = 0; r <= nR; r++) vs.push((r / nR) ** 1.15 * 0.95);
  for (let k = 0; k < vs.length; k++) {
    const v = vs[k], row = [];
    for (let j = 0; j < nC; j++) {
      const b = B[j], bd = [b[0] - SKULL_C[0], b[1] - SKULL_C[1], b[2] - SKULL_C[2]], bl = Math.hypot(...bd), d0 = bd.map((c) => c / bl);
      const d = slerpDir(d0, HAIR_POLE, Math.max(0, v));
      const R = headRadius(d);
      let th = k === 0 ? -0.4 : hairThick(d, v, d0);
      // locks (High): every third column is a groove between two raised columns, so the slicked-back hair breaks into broad
      // combed clumps (in the outline too), fading at the hairline, toward the pole and over the ears
      if (!q && k > 1) th += LOCK[j % 3] * ss(0.06, 0.26, v) * (1 - ss(0.5, 0.78, v)) * (1 - 0.75 * ss(0.6, 0.9, Math.abs(d[2])) * (1 - ss(0.3, 0.6, d[1])));
      const x = SKULL_C[0] + d[0] * (R + th), y = SKULL_C[1] + d[1] * (R + th), z = SKULL_C[2] + d[2] * (R + th);
      row.push(p.v(x, y, z, { v, k, j, d, d0 }));
    }
    G.push(row);
  }
  // orientation: (b−a)×(c−a) on the first real row against the outward direction
  const a = G[1][0], b2 = G[1][1], c = G[2][0];
  const P = p.P, ax = P[b2 * 3] - P[a * 3], ay = P[b2 * 3 + 1] - P[a * 3 + 1], az = P[b2 * 3 + 2] - P[a * 3 + 2];
  const bx = P[c * 3] - P[a * 3], by = P[c * 3 + 1] - P[a * 3 + 1], bz = P[c * 3 + 2] - P[a * 3 + 2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const ox = P[a * 3] - SKULL_C[0], oy = P[a * 3 + 1] - SKULL_C[1], oz = P[a * 3 + 2] - SKULL_C[2];
  const outward = -(nx * ox + ny * oy + nz * oz) > 0; // grid 'out' winds a, d, c
  grid(p, G, true, outward);
  const pr = headRadius(HAIR_POLE) + hairThick(HAIR_POLE, 1, HAIR_POLE);
  const pole = p.v(SKULL_C[0] + HAIR_POLE[0] * pr, SKULL_C[1] + HAIR_POLE[1] * pr, SKULL_C[2], { v: 1, k: 99, j: 0, d: HAIR_POLE, d0: HAIR_POLE });
  const L = G[G.length - 1];
  for (let j = 0; j < nC; j++) { const j1 = (j + 1) % nC; if (outward) p.tri(L[j], pole, L[j1]); else p.tri(L[j], L[j1], pole); }
  return p;
}
/** The sideburns: thin patches on the skull in front of each ear, tucked under the cap's edge at the top. */
function buildSideburns(q) {
  const out = [];
  for (const s of [-1, 1]) {
    const p = new Part(), G = [], rows = q ? [69.6, 66.8] : [69.6, 68.6, 67.7, 66.8], cols = 1;
    for (const Y of rows) {
      const t = ss(69.6, 66.8, Y), x0 = lerp(1.95, 2.25, t), x1 = lerp(3.45, 2.85, t), row = [];
      for (let c = 0; c <= cols; c++) {
        const x = lerp(x0, x1, c / cols), dd = [x - SKULL_C[0], Y - SKULL_C[1], s * 4.6], L = Math.hypot(...dd), d = dd.map((e) => e / L);
        const R = headRadius(d) + lerp(0.08, 0.16, t) - (Y > 69.3 ? 0.05 : 0);
        row.push(p.v(SKULL_C[0] + d[0] * R, SKULL_C[1] + d[1] * R, SKULL_C[2] + d[2] * R, { t, c }));
      }
      G.push(row);
    }
    // rows go DOWN, columns go forward (+X): on the right (+Z) side the outward winding is a, d, c
    grid(p, G, false, s > 0);
    out.push(p);
  }
  return out;
}
function hairColor(young, q = false) {
  const base = lin(young ? COL.hairYoung : COL.hair), root = lin(young ? '#24170f' : COL.hairRoot), hi = lin(young ? '#5a3e30' : COL.hairHi);
  const g0 = lin(COL.grey0), g1 = lin(COL.grey1);
  const B = (() => { const L = Math.hypot(0.22, 1); return [0.22 / L, 1 / L, 0]; })();
  return (x, y, z, m) => {
    if (!m || !m.d) return base;
    const v = m.v, d = m.d;
    let c = mix(root, base, ss(-0.02, 0.14, v));
    // nape: darker roots low at the back
    c = mix(c, root, (1 - ss(-0.45, -0.15, d[1])) * ss(-0.2, -0.7, d[0]) * 0.55);
    // the anime gloss ring round the crown, broken by the comb lines
    const dc = d[0] * B[0] + d[1] * B[1];
    const groove = !q && m.j % 3 === 0 && m.k < 99;
    const band = Math.exp(-(((dc - 0.8) / 0.075) ** 2)) * (q ? 0.6 : groove ? 0.4 : 1) * (1 - ss(0.6, 0.95, Math.abs(d[2])));
    c = mix(c, hi, band * 0.9);
    // the comb grooves read darker, with the same envelope as their geometry (so no star converges on the pole)
    if (groove && m.k > 1) c = mul(c, 1 - 0.14 * ss(0.06, 0.26, v) * (1 - ss(0.5, 0.78, v)));
    if (!young) {
      // exaggerated grey temples, swept back above the ears (his right side, +Z, a little larger)
      // soft edges; the top edge rises toward the back (swept back); the front reaches the face (a grey flick beside it from
      // the high camera). Low's coarse cap keeps the grey to the side planes, below the crown.
      const R = z > 0, az = Math.abs(z), xr = x - SKULL_C[0];
      const xlo = R ? -2.6 : -2.0, yhi = (R ? 71.6 : 71.0) + 0.35 * Math.max(0, -xr);
      let mask = ss(2.7, 3.7, az) * ss(65.0, 65.8, y) * (1 - ss(yhi - 1.6, yhi, y)) * ss(xlo - 0.8, xlo + 0.4, xr) * (1 - ss(3.4, 4.2, xr));
      if (q) mask *= ss(0.6, 0.85, Math.abs(d[2])) * (1 - ss(70.4, 71.0, y));
      const g = mix(g0, g1, ss(67.5, yhi, y));
      // High: the grey combs back in clumps (the groove columns keep some dark hair between the silver locks)
      c = mix(c, g, clamp(mask * 1.2, 0, 1) * (groove ? 0.92 : 1));
    }
    return c;
  };
}
// Forelocks (HQ): two tapered strips that fall from under the quiff over his LEFT brow, lying 0.25 off the forehead. Each
// bone's pivot is its strip's root (so M2's springs swing them about the scalp, not off it).
function foreheadX(y, z) {
  const r = headRingAt(y), [, xf, xw, , zw, nf] = r, u = Math.min(1, Math.abs(z) / zw);
  const x = xw + (xf - xw) * Math.max(0, 1 - u ** nf) ** (1 / nf);
  return faceSculpt(x, y, z, 1)[0];
}
// the shirt's collar points (HQ): [band angle to Bv, M y, M z, M lift, tip y, tip z, tip lift]
// (M2: the outer corner and the tip pulled 0.6 in and laid a little closer to the lapel, and the points skinned like the
// coat under them: with a torso twist they stuck out past the lapels as flat white wings)
const CP = { pts: [[59.75, 3.75, 0.95], [59.75, 5.3, 0.85], [58.6, 5.15, 0.75], [56.9, 3.75, 0.8]] }; // [y, |z|, lift off the coat]
const FORELOCKS = [
  // [bone, root y, root z, length, root width, z drift]
  ['forelockA', 71.7, -1.0, 2.9, 1.8, -0.9],
  ['forelockB', 71.5, -2.3, 2.3, 1.4, -0.6],
].map(([bone, y, z, len, w0, dz]) => ({ bone, root: [foreheadX(y, z) + 0.3, y, z], len, w0, dz }));
function buildForelocks() {
  const out = [], bend = Math.tan(35 * DEG);
  for (const f of FORELOCKS) {
    const p = new Part(true), N = 4, front = [], back = [];
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), w = lerp(f.w0, 0.4, t ** 1.2) / 2;
      // down across the brow with a slight S, always just off the skin
      const cy = f.root[1] - f.len * t ** 1.3, cz = f.root[2] + f.dz * t + 0.35 * Math.sin(t * Math.PI) * (f.dz < -0.7 ? 1 : -1);
      const cx = foreheadX(cy, cz) + 0.25 + 0.2 * Math.sin(t * 2.4) * (1 - t);
      // the outer sheet's normal tips 35° up, so a high sun lights the strands instead of leaving them black
      const nx = 1, ny = bend, L = Math.hypot(nx, ny);
      front.push(p.vn(cx + 0.12, cy, cz - w, nx / L, ny / L, 0, { t }), p.vn(cx + 0.12, cy, cz + w, nx / L, ny / L, 0, { t }));
      back.push(p.vn(cx - 0.1, cy + 0.04, cz - w * 0.9, -1, 0, 0, { t }), p.vn(cx - 0.1, cy + 0.04, cz + w * 0.9, -1, 0, 0, { t }));
    }
    for (let i = 0; i < N - 1; i++) {
      const a = front[i * 2], b = front[i * 2 + 1], c = front[i * 2 + 3], d = front[i * 2 + 2];
      p.tri(a, b, c); p.tri(a, c, d);
      const A = back[i * 2], B2 = back[i * 2 + 1], C = back[i * 2 + 3], D = back[i * 2 + 2];
      p.tri(A, C, B2); p.tri(A, D, C);
    }
    out.push([f.bone, p]);
  }
  return out;
}
// ---- vertical tubes (neck, sleeves, trousers): rings [s, r] below a pivot, optional flattening
function vtube(pivot, rings, sides, opts = {}) {
  const p = new Part(), G = [];
  for (const [s, r, extra] of rings) {
    const row = [];
    for (let j = 0; j < sides; j++) {
      const a = j / sides * TAU;
      let rr = r * (opts.shape ? opts.shape(a, s) : 1);
      let x = pivot[0] + Math.cos(a) * rr * (opts.kx || 1) + (opts.dx ? opts.dx(s) : 0), z = pivot[2] + Math.sin(a) * rr;
      let y = pivot[1] - s + (opts.dy ? opts.dy(a, s, extra) : 0);
      row.push(p.v(x, y, z, { s, a, extra }));
    }
    G.push(row);
  }
  // rings go DOWN (s increases): flip the standard winding
  grid(p, G, true, false);
  if (opts.capTop) { const c = p.v(pivot[0], pivot[1] - rings[0][0] + 0.3, pivot[2], { s: rings[0][0], cap: 1 }); const R0 = G[0]; for (let j = 0; j < sides; j++) p.tri(R0[j], c, R0[(j + 1) % sides]); }
  if (opts.capBot !== undefined && opts.capBot !== false) { const L = rings[rings.length - 1], c = p.v(pivot[0] + (opts.dx ? opts.dx(L[0]) : 0), pivot[1] - L[0] - (opts.capBot === true ? 0 : opts.capBot), pivot[2], { s: L[0], cap: -1 }); const R1 = G[G.length - 1]; for (let j = 0; j < sides; j++) p.tri(R1[j], R1[(j + 1) % sides], c); }
  return p;
}
function ballCap(center, r, segs, rings, axis /* [x,y,z] unit */) {
  // hemisphere around +Y, then rotated so +Y → axis
  const p = new Part(), G = [];
  for (let k = 0; k < rings; k++) {
    const lat = k / rings * Math.PI / 2, row = [];
    for (let j = 0; j < segs; j++) { const a = j / segs * TAU; row.push(p.v(Math.cos(a) * Math.cos(lat) * r, Math.sin(lat) * r, Math.sin(a) * Math.cos(lat) * r)); }
    G.push(row);
  }
  grid(p, G, true, true);
  const top = p.v(0, r, 0), L = G[rings - 1];
  for (let j = 0; j < segs; j++) p.tri(L[j], top, L[(j + 1) % segs]);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...axis).normalize());
  p.xform(new THREE.Matrix4().compose(new THREE.Vector3(...center), q, new THREE.Vector3(1, 1, 1)));
  return p;
}
function sphere(center, r, segs, rings, sx = 1, sy = 1, sz = 1) {
  const p = new Part(), G = [];
  for (let k = 1; k < rings; k++) { const lat = -Math.PI / 2 + k / rings * Math.PI, row = []; for (let j = 0; j < segs; j++) { const a = j / segs * TAU; row.push(p.v(center[0] + Math.cos(a) * Math.cos(lat) * r * sx, center[1] + Math.sin(lat) * r * sy, center[2] + Math.sin(a) * Math.cos(lat) * r * sz)); } G.push(row); }
  grid(p, G, true, true);
  const top = p.v(center[0], center[1] + r * sy, center[2]), bot = p.v(center[0], center[1] - r * sy, center[2]);
  const L = G[G.length - 1], F = G[0];
  for (let j = 0; j < segs; j++) { const j1 = (j + 1) % segs; p.tri(L[j], top, L[j1]); p.tri(F[j], F[j1], bot); }
  return p;
}

/* ---- the coat ---- */
function buildCoat(q, B) {
  const rings = q ? COAT_RINGS_LQ : COAT_RINGS, H = q ? 7 : 12; // quads per half
  const outer = new Part(), halves = { 1: [], [-1]: [] };
  const surfPt = (r, phi, inset = 0) => { const [Y, a, b, n, cx] = r; const [x, z] = sePt(phi, a, b, n); const rr = Math.hypot(x, z) || 1; return [cx + x * (1 - inset / rr), Y, z * (1 - inset / rr)]; };
  const meta = [];
  for (const side of [1, -1]) {
    const G = [];
    for (const r of rings) {
      const [Y, , b, n] = r, po = openPhi(Y, b, n), row = [];
      for (let j = 0; j <= H; j++) {
        const t = j / H, phi = side > 0 ? lerp(po, Math.PI, t) : lerp(TAU - po, Math.PI, t);
        const pt = surfPt(r, phi);
        const m = { Y, phi, side, j, edge: j === 0, vent: j === H, r };
        row.push(outer.v(pt[0], pt[1], pt[2], m)); meta.push(m);
      }
      G.push(row);
    }
    // rings go DOWN; on the right half φ increases with j (from +X toward +Z: standard), on the left it decreases.
    grid(outer, G, false, side < 0);
    halves[side] = G;
  }
  // smooth the normals across the back seam (the two halves share positions there)
  const N = smoothNormals(outer.P, outer.I);
  for (let k = 0; k < rings.length; k++) {
    const a = halves[1][k][H], b = halves[-1][k][H];
    for (let c = 0; c < 3; c++) { const v = (N[a * 3 + c] + N[b * 3 + c]) / 2; N[a * 3 + c] = v; N[b * 3 + c] = v; }
    const L = Math.hypot(N[a * 3], N[a * 3 + 1], N[a * 3 + 2]) || 1; for (const i of [a, b]) for (let c = 0; c < 3; c++) N[i * 3 + c] /= L;
  }
  outer.N = Array.from(N);
  const wool = lin(COL.coat), hem = lin(COL.coatHem);
  const coatCol = (x, y, z, m) => {
    let c = wool;
    const az = Math.abs(z);
    let k = 1;
    k *= 1 - 0.2 * ss(58.9, 60.1, y);                                     // under the collar
    k *= 1 - 0.2 * ss(9, 11.5, az) * ss(49, 51, y) * (1 - ss(55, 57, y)); // underarm
    if (m && Math.abs(y - 38) < 0.3 && Math.sin(m.phi) ** 2 > 0.55) k *= 0.8; // pocket flap line
    if (m && m.vent && y <= 31.2) k *= 0.75;                               // back vent
    k *= 1 - 0.12 * ss(28, 18, y);                                        // the skirt darkens toward the hem
    k *= 1 + 0.05 * ss(50, 57, y) * Math.cos(m ? m.phi : 0);              // the chest catches a little more light
    if (m && y <= 18.5) c = mix(c, hem, 0.5);
    return mul(c, k);
  };
  const coatW = (x, y, z, m) => shellWeights(x, y, z, m ? m.phi : Math.atan2(z, x), q, m ? m.side : null);
  // lining, hem and edge strips copy the weights of their OUTER twin (same ring height and loft angle), so they never part
  const twinW = (x, y, z, m) => { const o = surfPt(m.r || coatRingAt(m.Y), m.phi); return shellWeights(o[0], m.Y, o[2], m.phi, q, m.side); };
  const tkey = (m) => `${m.Y.toFixed(3)}|${(((m.phi % TAU) + TAU) % TAU).toFixed(4)}|${m.side}`;
  const outerBase = B.add('coat', outer, { w: coatW, col: coatCol, surf: SURF.wool }), outerAt = new Map();
  outer.M.forEach((m, i) => { if (m) outerAt.set(tkey(m), outerBase + i); });
  const pairTwins = (part, base) => part.M.forEach((m, i) => { const o = m && outerAt.get(tkey(m)); if (o !== undefined) B.twins.push([base + i, o]); });

  // ---- lining: an inner shell below the waist (coarser columns), reversed winding, burgundy. Every lining column and ring
  // lands exactly on an outer column and ring, so each lining vertex has an outer twin whose weights it copies (§3.4).
  const liningTop = q ? 40 : 43, LH = q ? 4 : 6;
  const lrings = rings.filter((r) => r[0] <= liningTop);
  const lining = new Part(), lineG = { 1: [], [-1]: [] };
  for (const side of [1, -1]) {
    const G = [];
    for (const r of lrings) {
      const [Y, , b, n] = r, po = openPhi(Y, b, n), row = [];
      for (let j = 0; j <= LH; j++) {
        const jj = Math.round(j * H / LH), t = jj / H, phi = side > 0 ? lerp(po, Math.PI, t) : lerp(TAU - po, Math.PI, t);
        const pt = surfPt(r, phi, 0.45);
        row.push(lining.v(pt[0], pt[1], pt[2], { Y, phi, side, j, vent: j === LH, r }));
      }
      G.push(row);
    }
    grid(lining, G, false, side > 0); // reversed
    lineG[side] = G;
  }
  const lin6 = lin(COL.lining);
  pairTwins(lining, B.add('lining', lining, { w: twinW, col: (x, y, z, m) => mul(lin6, (1 - 0.3 * ss(liningTop - 5, liningTop, y)) * (1 - 0.6 * ss(1.6, 2.9, Math.abs(Math.PI - (m ? m.phi : 0)) < 3 ? Math.PI - Math.abs(Math.PI - m.phi) : 0))), surf: SURF.lining, twin: true }));

  // ---- hem strip (outer hem ring → 0.45 inward), at the outer resolution
  const hemP = new Part(), hr = rings[rings.length - 1];
  for (const side of [1, -1]) {
    const G = [[], []], po = openPhi(hr[0], hr[2], hr[3]);
    for (let j = 0; j <= H; j++) {
      const phi = side > 0 ? lerp(po, Math.PI, j / H) : lerp(TAU - po, Math.PI, j / H);
      const o = surfPt(hr, phi), i = surfPt(hr, phi, 0.45);
      G[0].push(hemP.v(o[0], o[1], o[2], { Y: hr[0], phi, side, r: hr })); G[1].push(hemP.v(i[0], i[1] - 0.05, i[2], { Y: hr[0], phi, side, r: hr }));
    }
    // a horizontal annulus facing down
    grid(hemP, G, false, side < 0);
  }
  pairTwins(hemP, B.add('hem', hemP, { w: twinW, col: hem, surf: SURF.wool, twin: true }));

  // ---- front edge strips (outer front edge → lining front edge), below the lining top
  const edge = new Part();
  for (const side of [1, -1]) {
    const G = [];
    for (const r of lrings) {
      const po = openPhi(r[0], r[2], r[3]), phi = side > 0 ? po : TAU - po;
      const o = surfPt(r, phi), i = surfPt(r, phi, 0.45);
      G.push([edge.v(o[0], o[1], o[2], { Y: r[0], phi, side, r }), edge.v(i[0], i[1], i[2], { Y: r[0], phi, side, r })]);
    }
    grid(edge, G, false, side > 0);
  }
  pairTwins(edge, B.add('edge', edge, { w: twinW, col: mul(wool, 0.7), surf: SURF.wool, twin: true }));

  // ---- notch lapels (HQ): a smooth rolled face on each V edge (it catches the light), a dark wall under its outer edge
  // (the shadow line), the gorge notch, and the upper collar running up to meet the collar band behind the neck
  if (!q) {
    const LY = [46.5, 48.3, 50.3, 52.4, 54.4, 55.8, 56.4, 56.9, 57.9, 59.0, 59.75];
    const LW = [0.25, 1.5, 2.45, 3.1, 3.45, 3.55, 1.5, 2.6, 2.75, 2.4, 1.6];
    const face = new Part(), walls = new Part(true);
    const add3 = (a, k, b2) => [a[0] + b2[0] * k, a[1], a[2] + b2[2] * k];
    for (const side of [1, -1]) {
      const rows = [];
      for (let i = 0; i < LY.length; i++) {
        const Y = LY[i], r = coatRingAt(Y), po = openPhi(Y, r[2], r[3]);
        const ph0 = side > 0 ? po : TAU - po;
        // walk outward along the ring until the arc length reaches the lapel width
        let ph = ph0, prev = surfPt(r, ph0), acc = 0; const stp = 0.01 * side;
        while (acc < LW[i] && Math.abs(ph - ph0) < 1.4) { ph += stp; const pt = surfPt(r, ph); acc += Math.hypot(pt[0] - prev[0], pt[2] - prev[2]); prev = pt; }
        const nrmAt = (phi) => { const pa = surfPt(r, phi - 0.01), pb = surfPt(r, phi + 0.01), tx = pb[0] - pa[0], tz = pb[2] - pa[2], L = Math.hypot(tx, tz) || 1, pt = surfPt(r, phi); let n = [tz / L, 0, -tx / L]; if (n[0] * (pt[0] - r[4]) + n[2] * pt[2] < 0) n = [-n[0], 0, -n[2]]; return n; };
        const e = surfPt(r, ph0), o = prev, ne = nrmAt(ph0), no = nrmAt(ph), nm = [(ne[0] + no[0]) / 2, 0, (ne[2] + no[2]) / 2], T = 0.42;
        const lerp3 = (t) => [lerp(e[0], o[0], t), Y, lerp(e[2], o[2], t)];
        rows.push({ Y, eIn: add3(e, -0.35, ne), eTop: add3(e, T * 0.75, ne), mid: add3(lerp3(0.45), T * 1.05, nm), oTop: add3(lerp3(0.85), T, no),
          oRoll: add3(o, T * 0.35, no), oBot: add3(o, -0.05, no) });
      }
      // the face: rows go up, columns run from the V edge outward
      const G = rows.map((rw) => [face.v(...rw.eTop, 'edge'), face.v(...rw.mid, 'top'), face.v(...rw.oTop, 'top'), face.v(...rw.oRoll, 'roll')]);
      grid(face, G, false, side > 0);
      for (let i = 0; i < rows.length - 1; i++) {
        const a2 = rows[i], b2 = rows[i + 1], avg = (k) => [(a2[k][0] + b2[k][0]) / 2, (a2[k][1] + b2[k][1]) / 2, (a2[k][2] + b2[k][2]) / 2];
        walls.poly([a2.eIn, b2.eIn, b2.eTop, a2.eTop], avg('oTop'), 'inner');   // the rolled edge faces the V
        walls.poly([a2.oRoll, b2.oRoll, b2.oBot, a2.oBot], avg('eIn'), 'wall'); // the outer wall faces the side
      }
    }
    const lapW = (x, y, z) => shellWeights(x, y, z, Math.atan2(z, x - 0.3), q);
    B.add('lapels', face, { w: lapW, col: (x, y, z, m) => mul(wool, m === 'roll' ? 0.9 : m === 'edge' ? 0.98 : 1.06), surf: SURF.wool });
    B.add('lapels', walls, { w: lapW, col: (x, y, z, m) => mul(wool, m === 'wall' ? 0.5 : 0.7), surf: SURF.wool });
  }

  // ---- the collar round the back of the neck: a low turned-down band (outer, top, inner faces), meeting the lapels
  {
    const col = new Part(), Kc = q ? 6 : 12, ps0 = 52 * DEG, rows = [[], [], [], []], Y0 = COAT_TOP - 0.4;
    for (let j = 0; j <= Kc; j++) {
      const ps = lerp(ps0, TAU - ps0, j / Kc), c = Math.cos(ps), s = Math.sin(ps);
      const back = ss(0.2, -1, c); // 1 at the back, 0 at the front ends
      const h = 0.15 + 1.2 * back ** 0.8, flare = 0.5 * back ** 1.2;
      const rx = 3.95, rz = 4.25, cx = 0.75;
      const bo = [cx + c * rx, Y0, s * rz], to = [cx + c * (rx + flare), Y0 + h, s * (rz + flare)];
      // the inner rows stay inside the outer ones and rise monotonically, so the band never folds over itself
      const ti = [cx + c * (rx + flare - 0.55), Y0 + 0.85 * h, s * (rz + flare - 0.55)], bi = [cx + c * (rx - 0.55), Y0 + 0.4 * h, s * (rz - 0.55)];
      rows[0].push(col.v(...bo, { ps, f: 'o' })); rows[1].push(col.v(...to, { ps, f: 'o' })); rows[2].push(col.v(...ti, { ps, f: 'i' })); rows[3].push(col.v(...bi, { ps, f: 'i' }));
    }
    // ps increases from +X toward +Z through the back; the rows go up then over and down inside
    grid(col, rows, false, true);
    B.add('collar', col, { bone: 'spine2', col: (x, y, z, m) => mul(wool, m && m.f === 'i' ? 0.55 : 0.95 - 0.12 * ss(Y0 + 1.2, Y0, y)), surf: SURF.wool });
  }
  // ---- the closing button (HQ): a domed dark horn disc with a lighter rim that catches a highlight
  if (!q) {
    const bp = new Part(), Y = BUTTON_Y, r = coatRingAt(Y), po = openPhi(Y, r[2], r[3]), c = surfPt(r, po);
    const ah = Math.atan2(c[2], c[0] - r[4]), nx = Math.cos(ah), nz = Math.sin(ah), tx = -nz, tz = nx;
    const P = (u, v, h, m) => bp.v(c[0] + nx * h + tx * u, Y + v, c[2] + nz * h + tz * u, m);
    const ref = [c[0] - nx * 3, Y, c[2] - nz * 3], K = 6, ctr = P(0, 0, 0.32, 'c'), inner = [], rim = [], base = [];
    for (let i = 0; i < K; i++) { const a2 = i / K * TAU + Math.PI / 6, cu = Math.cos(a2), sv = Math.sin(a2); inner.push(P(cu * 0.48, sv * 0.48, 0.26, 'c')); rim.push(P(cu * 0.75, sv * 0.75, 0.14, 'rim')); base.push(P(cu * 0.75, sv * 0.75, -0.1, 'rim')); }
    for (let i = 0; i < K; i++) {
      const j = (i + 1) % K;
      bp.triAway(ctr, inner[i], inner[j], ref);
      bp.triAway(inner[i], rim[i], rim[j], ref); bp.triAway(inner[i], rim[j], inner[j], ref);
      bp.triAway(rim[i], base[i], base[j], ref); bp.triAway(rim[i], base[j], rim[j], ref);
    }
    const bc = lin(COL.button), br = lin(COL.buttonRim);
    B.add('buttons', bp, { w: (x, y, z) => shellWeights(x, y, z, Math.atan2(z, x), q), col: (x, y, z, m) => (m === 'rim' ? br : bc), surf: SURF.button });
  }
}

/* ---- torso core (blocks see-through), shirt and neck ---- */
function buildTorso(q, B) {
  // The core's profile (the shirt is laid on it). The mesh pulls the waist rings in (−0.7 deep, −1.2 wide): the core only
  // has rings at Y 40 and 47 while the coat has four there, so in a strafe's 70° torso twist the two shells deform
  // differently and the core's wide flanks, swung round to the back, came through the coat.
  const PROFILE = [[40, 5.3, 8.4, 0], [47.0, 4.95, 8.5, 0.1], [50.5, 5.55, 9.6, 0.3], [53.5, 5.85, 10.1, 0.45], [56.3, 5.6, 10.3, 0.4], [58.3, 4.6, 7.6, 0.55], [60.5, 3.15, 3.4, 0.8]];
  const CORE = PROFILE.map((r) => (r[0] < 48 ? [r[0], r[1] - 0.7, r[2] - 1.2, r[3]] : r));
  const V_SKIN = 56.6; // the open collar shows skin above this height
  const rings = q ? [CORE[0], CORE[2], CORE[4], CORE[6]] : CORE, S = q ? 6 : 8;
  const core = new Part(), G = [];
  for (const [Y, a, b, cx] of rings) { const row = []; for (let j = 0; j < S; j++) { const ph = j / S * TAU; const [x, z] = sePt(ph, a, b, 2.4); row.push(core.v(cx + x, Y, z, { ph })); } G.push(row); }
  grid(core, G, true, true);
  const top = rings[rings.length - 1], tc = core.v(top[3] + 0.4, top[0] + 0.5, 0); const L = G[G.length - 1];
  for (let j = 0; j < S; j++) core.tri(L[j], tc, L[(j + 1) % S]);
  const skin = lin(COL.skin), dark = lin(COL.coatInside), shirt = lin(COL.shirt);
  B.add('core', core, { w: (x, y, z) => shellWeights(x, y, z, Math.atan2(z, x), q).map(([b, w]) => [b === 'breath' ? 'spine2' : b, w]),
    col: (x, y, z, m) => { const f = ss(0.3, 0.8, Math.cos(m ? m.ph : 0)); return y > V_SKIN ? mix(dark, mul(skin, 0.8), f) : mix(dark, shirt, f * 0.8); }, surf: (x, y) => (y > V_SKIN ? SURF.skin : SURF.shirt) });

  // shirt halves: their inner edges make the open-collar V, their outer edges tuck under the coat
  const shirtP = new Part(), coreFront = (Y, z) => { // x on the core front surface + offset
    let i = 1; while (i < PROFILE.length - 1 && PROFILE[i][0] < Y) i++;
    const a = PROFILE[i - 1], b = PROFILE[i], t = clamp((Y - a[0]) / (b[0] - a[0]), 0, 1);
    const A = lerp(a[1], b[1], t), Bw = lerp(a[2], b[2], t), cx = lerp(a[3], b[3], t);
    const u = clamp(Math.abs(z) / Bw, 0, 0.98); return cx + A * (1 - u ** 2.4) ** (1 / 2.4);
  };
  // The top row tucks under the collar band and the outer edge stays inside the coat (never wider than the coat's ring less
  // 1.4), so no shirt can pierce the shoulders.
  const SY = q ? [45.5, 52, 56.9, 59.9] : [45.5, 49.5, 53.5, 55.9, 57.1, 58.8, 59.9];
  const SC = q ? 2 : 3;
  for (const side of [1, -1]) {
    const G2 = [];
    for (const Y of SY) {
      const v = Y < V_SKIN + 0.2 ? -0.5 : (Y - V_SKIN - 0.2) * 0.72, wOut = Math.min(7.5, openW(Y) / 2 + 2.4, coatRingAt(Y)[2] - 1.4), row = [];
      for (let j = 0; j <= SC; j++) { const zz = side * lerp(v, wOut, j / SC); row.push(shirtP.v(coreFront(Y, zz) + 0.16, Y, zz, { Y })); }
      G2.push(row);
    }
    grid(shirtP, G2, false, side > 0);
  }
  B.add('shirt', shirtP, { w: (x, y, z) => shellWeights(x, y, z, Math.atan2(z, x), q), col: (x, y) => mul(shirt, 1 - 0.18 * ss(57.3, 60.3, y)), surf: SURF.shirt });
  // the shirt's open collar: a folded band round the neck inside the coat collar (out, up, a roll outward at the top, then
  // down the inside), its points lying on the lapels as real wedges
  {
    const sc = new Part(), K = q ? 4 : 10, ps0 = 34 * DEG, Y0 = COAT_TOP - 0.5, rows = q ? [[], [], []] : [[], [], [], [], []];
    for (let j = 0; j <= K; j++) {
      const ps = lerp(ps0, TAU - ps0, j / K), c = Math.cos(ps), sn = Math.sin(ps);
      const back = ss(0.3, -1, c), y1 = Y0 + lerp(0.85, 1.6, back);
      const rx = 3.25, rz = 3.55, cx = 0.75, R = (o, y, f) => sc.v(cx + c * (rx + o), y, sn * (rz + o), { f });
      if (q) { rows[0].push(R(0, Y0, 'o')); rows[1].push(R(0.3, y1, 'roll')); rows[2].push(R(-0.33, Y0 + 0.1, 'i')); continue; }
      rows[0].push(R(0, Y0, 'o')); rows[1].push(R(0.12, y1 - 0.4, 'o')); rows[2].push(R(0.42, y1 - 0.05, 'roll'));
      rows[3].push(R(0.02, y1 + 0.06, 'i')); rows[4].push(R(-0.33, Y0 + 0.1, 'i'));
    }
    grid(sc, rows, false, true);
    B.add('shirtCollar', sc, { bone: 'spine2', col: (x, y, z, m) => mul(shirt, m === 'i' ? 0.8 : m === 'roll' ? 1.0 : 0.92), surf: SURF.shirt });
    if (!q) {
      const cpt = new Part(true);
      for (const sd of [1, -1]) {
        // a wedge folded down over the lapel: the root at the band's front end, the tip on the lapel below the notch
        const ps = sd > 0 ? ps0 : TAU - ps0, c = Math.cos(ps), sn = Math.sin(ps);
        // A: the band's front end (the V of the open shirt), Bv: further round the band, hidden under the coat collar,
        // M: out on the lapel, Tp: the tip, down and out on the lapel. Held clear of the lapel face (0.44 proud) so it never
        // z-fights or pokes through it.
        // The point lies flat on the lapel (its plane is the chest's, held 0.45 above the lapel face so it never z-fights):
        // A the inner root at the V, Bv the outer root under the coat collar, M down the outer edge, Tp the tip.
        const on = (pt) => [coatX(pt[0], pt[1]) + pt[2], pt[0], sd * pt[1]];
        const [A, Bv, M, Tp] = CP.pts.map(on);
        void c; void sn;
        const top = [A, Bv, M, Tp];
        // the face normal, bent 30° toward +Y so the point catches the sun
        const e1 = [Bv[0] - A[0], Bv[1] - A[1], Bv[2] - A[2]], e2 = [Tp[0] - A[0], Tp[1] - A[1], Tp[2] - A[2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (n[0] < 0) n = n.map((v) => -v);
        let L = Math.hypot(...n); n = n.map((v) => v / L);
        const nb = [n[0], n[1] + 0.58, n[2]]; L = Math.hypot(...nb); const nn = nb.map((v) => v / L);
        const bot = top.map((pt) => [pt[0] - n[0] * 0.25, pt[1] - n[1] * 0.25, pt[2] - n[2] * 0.25]);
        const ids = top.map((pt) => cpt.vn(pt[0], pt[1], pt[2], nn[0], nn[1], nn[2], 'o'));
        const ctr = [(A[0] + Tp[0]) / 2 - n[0] * 2, (A[1] + Tp[1]) / 2 - n[1] * 2, (A[2] + Tp[2]) / 2 - n[2] * 2];
        cpt.triAway(ids[0], ids[1], ids[2], ctr); cpt.triAway(ids[0], ids[2], ids[3], ctr);
        cpt.poly(bot, [A[0] + n[0] * 3, A[1] + n[1] * 3, A[2] + n[2] * 3], 'i');
        const mid = [(A[0] + M[0]) / 2 - n[0] * 0.12, (A[1] + M[1]) / 2, (A[2] + M[2]) / 2 - n[2] * 0.12];
        for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; cpt.poly([top[i], top[j], bot[j], bot[i]], mid, 'w'); }
      }
      B.add('collarPts', cpt, { w: (x, y, z) => shellWeights(x, y, z, Math.atan2(z, x), q, z >= 0 ? 1 : -1), col: (x, y, z, m) => mul(shirt, m === 'i' ? 0.8 : m === 'w' ? 0.85 : 1), surf: SURF.shirt });
    }
  }
  // neck
  const neck = vtube([0.35, 64.6, 0], q ? [[0, 2.7], [6.2, 3.05]] : [[0, 2.7], [1.6, 2.75], [3.4, 2.85], [6.2, 3.05]], q ? 6 : 10, {});
  // shift so the axis leans 12° forward going up (top at x ≈ 1.6, bottom at x ≈ 0.4)
  for (let i = 0; i < neck.P.length; i += 3) neck.P[i] += (neck.P[i + 1] - 58.4) * Math.tan(12 * DEG);
  B.add('neck', neck, { w: (x, y) => { const a = ss(59.5, 61.5, y), b = ss(62.5, 64.5, y); return [['spine2', 1 - a], ['neck', a * (1 - b)], ['head', a * b]]; },
    col: (x, y, z, m) => { const c = mul(skin, 1 - 0.25 * ss(61.5, 63.8, y) * ss(-0.2, 0.6, Math.cos(m ? m.a : 0))); return c; }, surf: SURF.skin });
}

/* ---- arms ---- */
// [s below the shoulder pivot, radius]. The top rings close into a dome (the shoulder ball cap, bound to the upper arm) that
// sits under the coat's pad; the hinge band (11.2–15.2) has the spec's three rings (11.5, 13.2 with the elbow bulge, 14.9).
const SLEEVE = [[-0.75, 1.9], [-0.2, 3.0], [2, 3.43], [7, 3.36], [11.5, 3.25], [13.2, 3.32], [14.9, 3.2], [18, 3.05], [22, 3.0], [24.0, 3.04], [24.6, 2.98]];
const SLEEVE_LQ = [[-0.75, 1.9], [-0.2, 3.0], [7, 3.38], [13.2, 3.3], [19, 3.05], [24.6, 2.98]];
function buildArms(q, B) {
  const wool = lin(COL.coat), shirt = lin(COL.shirt), skin = lin(COL.skin), warm = lin(COL.skinWarm), cuffIn = lin(COL.cuffInside);
  for (const [L, s] of [['L', -1], ['R', 1]]) {
    const up = 'upperArm' + L, fo = 'forearm' + L, hand = 'hand' + L, piv = [0.3, 57.8, 11 * s];
    const S = q ? 6 : 10;
    // the sleeve: slightly flattened front-back, cloth bulge at the elbow
    const sl = vtube(piv, q ? SLEEVE_LQ : SLEEVE, S, { kx: 0.94, capTop: true });
    B.add('sleeve' + L, sl, { w: (x, y, z, m) => (m && m.cap ? [[up, 1]] : tubeW(up, fo, m ? m.s : 0, 11.2, 15.2)),
      col: (x, y, z, m) => { const sv = m ? m.s : 0; let k = 1 - 0.12 * ss(23.4, 24.6, sv); k *= 1 - 0.1 * ss(0.6, -0.4, Math.cos(m && m.a !== undefined ? m.a : 0)) * ss(4, 0, sv); return mul(wool, k); }, surf: SURF.wool });
    // cuff turn-in and shirt cuff
    if (!q) { const turn = vtube(piv, [[24.6, 2.98], [24.35, 2.45]], S, {}); B.add('cuffIn' + L, turn, { bone: fo, col: COL.cuffInside, surf: SURF.wool }); }
    // (tapered to 0.8 at its end, the end cap the dark cuff-inside: turned end-on to the camera, a full-size cap read as a
    // flat white disc bigger than the wrist)
    const sc = vtube(piv, [[24.1, 2.36], [25.4, 1.85]], S, { capBot: 0 });
    B.add('shirtCuff' + L, sc, { bone: fo, col: (x, y, z, m) => (m && m.cap ? cuffIn : shirt), surf: SURF.shirt });
    // elbow cap under the hinge band
    if (!q) B.add('elbow' + L, ballCap([0.3, 44.6, 11 * s], 2.95, 8, 2, [-1, 0, 0]), { bone: fo, col: wool, surf: SURF.wool });
    // the hand (1.25×), rigid, built around the gun grip it holds
    const hp = buildHand(q, s);
    B.add('hand' + L, hp, { bone: hand, col: (x, y, z, m) => (m === 'knuckle' ? mix(skin, warm, 0.55) : m === 'fingers' ? mul(mix(skin, warm, 0.25), 0.97) : skin), surf: SURF.skin });
  }
}
/** A box of width w (hand X), thickness t, running from a to b (hand-local points). */
function boxAlong(a, b, w, t, ch = 0) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d.normalize());
  return boxPart(w, len, t, ch).xform(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
}
function buildHand(q, s) {
  // Hand-local: wrist at the origin, fingers toward −Y, palm facing −s·Z (toward the body), thumb toward +X (§3.3 F, 1.25×).
  // One modelled grip serves every hold: a palm, a three-finger mitten curled round the grip bar (SOCKETS.hand.grip, the bar
  // running along X through the fist), the index finger lying down the frame onto the trigger, and a two-part thumb along
  // the far side of the grip. Rigid on the hand bone; fingers are never animated.
  const parts = [], add = (p, m) => parts.push([p, m]), Z = (v) => [v[0], v[1], v[2] * s];
  if (q) {
    add(boxPart(3.4, 3.8, 1.6, 0).xform(TR(0, -1.9, 0.05 * s)), 'skin');
    add(boxAlong(Z([-0.5, -3.4, -0.3]), Z([-0.5, -4.9, -1.9]), 2.6, 1.5), 'fingers');
    return merge(parts).xform(TR(0.3, 33.0, 11 * s));
  }
  add(boxPart(3.4, 3.8, 1.6, 0.6).xform(TR(0, -1.95, 0.05 * s)), 'skin');                       // palm (knuckles at y −3.85)
  add(boxAlong(Z([-0.55, -3.45, -0.05]), Z([-0.55, -5.0, -0.95]), 2.3, 1.2), 'knuckle');        // mitten: proximal, down
  add(boxAlong(Z([-0.55, -4.85, -0.6]), Z([-0.55, -4.75, -2.25]), 2.2, 1.1), 'fingers');        //   middle, under the grip
  add(boxAlong(Z([-0.55, -4.7, -2.1]), Z([-0.55, -3.55, -2.25]), 2.05, 0.95), 'fingers');       //   tips, up the far side
  add(boxAlong(Z([1.15, -3.45, -0.15]), Z([1.15, -5.2, -0.75]), 0.95, 1.0), 'knuckle');         // index: down the frame
  add(boxAlong(Z([1.15, -5.05, -0.6]), Z([0.75, -5.55, -1.5]), 0.85, 0.85), 'fingers');         //   curled on the trigger
  add(boxAlong(Z([1.45, -0.9, -0.45]), Z([1.4, -2.55, -1.95]), 1.05, 1.0), 'skin');             // thumb: base
  add(boxAlong(Z([1.4, -2.4, -1.85]), Z([1.3, -4.0, -2.45]), 0.9, 0.85), 'fingers');            //   tip, down the bore
  add(sphere([0, -0.25, 0], 1.45, 6, 3, 1.05, 0.95, 0.85), 'skin');                            // wrist ball (inside the cuff)
  return merge(parts).xform(TR(0.3, 33.0, 11 * s));
}
function merge(list) {
  const out = new Part(true);
  for (const [p, m] of list) {
    const N = p.N || smoothNormals(p.P, p.I), base = out.P.length / 3;
    for (let i = 0; i < p.P.length / 3; i++) out.vn(p.P[i * 3], p.P[i * 3 + 1], p.P[i * 3 + 2], N[i * 3], N[i * 3 + 1], N[i * 3 + 2], m || p.M[i]);
    for (const t of p.I) out.I.push(base + t);
  }
  return out;
}

/* ---- legs ---- */
// [s below the hip joint, radius]. The knee's hinge band (thigh → shin weights over s 16–20) has five rings (14, 16.3, 18,
// 19.7, 21.5), so a bent knee reads as a rounded bend instead of a crease; the rings at s 4 and 26 went (both on straight
// runs, 0.04 off the straight line) to pay for them. The top ring sits 2.4 above the hip joint (spec 4): it is rigid on the
// thigh, and from 4 up a striding thigh swung it out through the coat's back.
const TROUSER = [[-2.4, 4.45], [0, 4.2], [9, 3.62], [14, 3.3], [16.3, 3.13], [18, 3.02], [19.7, 2.96], [21.5, 2.91], [30.5, 2.6], [33.9, 2.65], [35.4, 2.88]];
const TROUSER_LQ = [[-4, 4.6], [0, 4.2], [7, 3.75], [15, 3.25], [19.5, 2.97], [27, 2.7], [35.4, 2.88]];
function buildLegs(q, B) {
  const tr = lin(COL.trousers), shoe = lin(COL.shoes), sole = lin(COL.sole);
  // seat block (pelvis, rigid)
  const SEAT = q ? [[31, 4.3, 7.0], [35, 5.5, 8.5], [40.5, 5.3, 8.3]] : [[31, 4.3, 7.0], [33.5, 5.25, 8.3], [37, 5.6, 8.6], [40.5, 5.3, 8.3]], S = q ? 6 : 10;
  const seat = new Part(), G = [];
  for (const [Y, a, b] of SEAT) { const row = []; for (let j = 0; j < S; j++) { const [x, z] = sePt(j / S * TAU, a, b, 2.3); row.push(seat.v(x, Y, z)); } G.push(row); }
  grid(seat, G, true, true);
  const bc = seat.v(0, 30.6, 0); for (let j = 0; j < S; j++) seat.tri(G[0][j], G[0][(j + 1) % S], bc);
  B.add('seat', seat, { bone: 'pelvis', col: (x, y, z) => mul(tr, 1 - 0.2 * ss(4, 0, Math.abs(z)) * ss(34, 31, y)), surf: SURF.trousers });
  for (const [L, s] of [['L', -1], ['R', 1]]) {
    const th = 'thigh' + L, sh = 'shin' + L, ft = 'foot' + L, piv = [0, 37.5, 4.6 * s];
    const tube = vtube(piv, q ? TROUSER_LQ : TROUSER, q ? 6 : 10, {
      kx: 1.04,
      // a pressed crease down the front; the break rests on the instep (front higher)
      shape: (a, sv) => 1 + 0.05 * Math.max(0, Math.cos(a)) ** 10 * ss(8, 14, sv),
      dy: (a, sv) => (sv > 35 ? 0.95 * Math.cos(a) - 0.15 : 0),
    });
    B.add('trouser' + L, tube, { w: (x, y, z, m) => tubeW(th, sh, m ? m.s : 0, 16, 20),
      col: (x, y, z, m) => mul(tr, 1 - 0.2 * ss(0.3, 1, -Math.sin(m ? m.a : 0) * s) * ss(14, 2, m ? m.s : 0)), surf: SURF.trousers });
    if (!q) { const hemIn = vtube(piv, [[35.4, 2.88], [35.15, 2.35]], 10, { dy: (a) => 0.95 * Math.cos(a) - 0.15 }); B.add('trouserHem' + L, hemIn, { bone: sh, col: COL.cuffInside, surf: SURF.trousers }); }
    if (!q) B.add('knee' + L, ballCap([0.2, 19.5, 4.6 * s], 2.85, 8, 2, [1, 0, 0]), { bone: sh, col: tr, surf: SURF.trousers });
    const shoeP = buildShoe(q, s);
    B.add('shoe' + L, shoeP, { bone: ft, col: (x, y, z, m) => (m === 'sole' ? sole : mul(shoe, (m && m.k !== undefined ? 1 - 0.25 * ss(1.4, 0.9, m.h) : 1))), surf: (x, y, z, m) => (m === 'sole' ? SURF.sole : SURF.shoes) });
  }
}
function buildShoe(q, s) {
  // foot-local (ankle at the origin, ground at y −3.6), then moved to the ankle (0, 3.6, ±4.6)
  const X = q ? [-2.6, 0.5, 4.5, 8.4] : [-2.6, -1.0, 1.8, 4.2, 6.2, 7.7, 8.5];
  const W = (x) => (x < 5.6 ? lerp(1.8, 2.1, ss(-2.6, 5.6, x)) : lerp(2.1, 1.25, ss(5.6, 8.6, x)));
  const Ht = (x) => (x < 1.8 ? lerp(3.0, 3.45, ss(-2.6, 0.6, x)) : x < 5.6 ? lerp(3.45, 2.05, ss(1.8, 5.6, x)) : lerp(2.05, 1.05, ss(5.6, 8.6, x)));
  const spring = (x) => 0.6 * ss(5.4, 8.6, x) ** 2;
  const soleT = (x) => (x < 0.4 ? 0.85 : 0.45); // a dress shoe's thin sole and low heel
  const p = new Part(), K = q ? 3 : 6, G = [];
  for (const x of X) {
    const w = W(x) * (x > 8.4 ? 0.7 : 1), h = Ht(x) * (x > 8.4 ? 0.85 : 1), yb = soleT(x) + spring(x), row = [];
    for (let k = 0; k <= K; k++) {
      const ps = k / K * Math.PI, c = Math.cos(ps), sn = Math.sin(ps), e = 2 / 2.6;
      const z = w * Math.sign(c) * Math.abs(c) ** e, y = yb + (h - yb) * Math.abs(sn) ** e;
      row.push(p.v(x, y - 3.6, z, { k, h: y }));
    }
    G.push(row);
  }
  // sections march along +X; each section runs from +Z over the top to −Z
  grid(p, G, false, true);
  // heel and toe caps
  const hc = p.v(-2.75, Ht(-2.6) * 0.5 - 3.6 + 0.6, 0, { k: 0, h: 2 }), tc = p.v(X[X.length - 1] + 0.1, 0.5 + spring(8.6) - 3.6 + 0.4, 0, { k: 0, h: 1.2 });
  for (let k = 0; k < K; k++) { p.tri(G[0][k], G[0][k + 1], hc); const L = G[G.length - 1]; p.tri(L[k], tc, L[k + 1]); }
  // the sole: the upper's base outline extruded down (walls and a bottom)
  const sole = new Part(true), ring = [];
  for (const x of X) { const w = W(x) * (x > 8.4 ? 0.7 : 1), yb = soleT(x) + spring(x); ring.push([x, yb, w]); } // flush with the upper: no open gap from above
  const top = (i, sd) => [ring[i][0], ring[i][1] - 3.6, sd * ring[i][2]], bot = (i, sd) => [ring[i][0], spring(ring[i][0]) + (ring[i][0] < 0.4 ? 0 : 0) - 3.6, sd * ring[i][2] * 0.97];
  const ctr = [3, -2.9, 0];
  for (let i = 0; i < ring.length - 1; i++) for (const sd of [1, -1]) sole.poly([top(i, sd), top(i + 1, sd), bot(i + 1, sd), bot(i, sd)], ctr);
  sole.poly([top(0, 1), top(0, -1), bot(0, -1), bot(0, 1)], ctr); const n = ring.length - 1; sole.poly([top(n, 1), top(n, -1), bot(n, -1), bot(n, 1)], ctr);
  for (let i = 0; i < ring.length - 1; i++) sole.poly([bot(i, 1), bot(i + 1, 1), bot(i + 1, -1), bot(i, -1)], [3, 5, 0]);
  const out = merge([[p, null], [sole, 'sole']]);
  return out.xform(TR(0, 3.6, 4.6 * s));
}

/* ---- props (bound 100% to their bones; built in gun-local space then moved to the bind spot) ---- */
function buildProps(q, B) {
  const at = (p) => p.xform(TR(...PROP_BIND));
  const steel = lin(COL.steel), worn = lin(COL.steelWorn), walnut = lin(COL.walnut);
  const add = (name, bone, parts) => { const p = merge(parts.map(([pp, m]) => [pp, m])); at(p); B.add(name, p, { bone, col: (x, y, z, m) => PCOL[m] || steel, surf: (x, y, z, m) => PSURF[m] || SURF.steel }); };
  const PCOL = { steel, worn, walnut, wood: lin('#5e3820'), stock: lin('#6a3f24'), pad: lin('#1c1c1e'), brass: lin(COL.brass), rwal: lin('#7a4a2a'), scope: lin('#1e1f23'), glass: lin('#1d2c3a'), spacer: lin('#d8d4cc'),
    shell: lin(COL.shell), lens: lin('#fff6d8'), lensP: lin('#fff6d8'), lensS: lin('#fff6d8'), lensR: lin('#fff6d8'), hick: lin('#8a6a3e'), axehead: lin('#6e757c'), axeedge: lin('#c4cad1'), hamh: lin('#7a5a36'), hamhead: lin('#5a5e64'), plank: lin('#9a7a52'), kraft: lin('#b08a5a'), string: lin('#e8dcc0'), rod: lin('#5a4030'), mag: lin('#2e3036') };
  const PSURF = { walnut: SURF.wood, wood: SURF.wood, stock: SURF.wood, rwal: SURF.wood, pad: SURF.rubber, brass: SURF.brass, scope: SURF.rubber, glass: SURF.scope, spacer: SURF.rubber, shell: SURF.rubber,
    // (each gun's lens carries its id inside the lens band of the cloth channel z (≥ 0.985: 252/253/254 of 255), never in
    // the skin channel w, which tints the fill and the rim)
    lens: SURF.lens, lensP: [SURF.lens[0], SURF.lens[1], 252 / 255, 0], lensS: [SURF.lens[0], SURF.lens[1], 253 / 255, 0], lensR: [SURF.lens[0], SURF.lens[1], 254 / 255, 0], hick: SURF.wood, axeedge: SURF.edge, hamh: SURF.wood, plank: SURF.wood, kraft: SURF.wood, string: SURF.wood, rod: SURF.wood };
  const ch = q ? 0 : 0.28;
  // ---- pistol (1911-style)
  // the frame, grip, trigger guard, hammer and lens ride the pistol bone; the slide (with its serration strip and front
  // sight) rides pistolSlide and the whole magazine rides pistolMag, so M3's recoil, slide lock and reload move real parts
  add('pistol', 'pistol', [
    [boxPart(7.4, 1.0, 1.36, 0).xform(TR(1.4, 0.88, 0)), 'steel'],
    [boxPart(2.05, 4.7, 1.55, q ? 0 : 0.25).xform(CH(TR(-0.65, -1.45, 0), RZ(-17 * DEG))), 'walnut'],
    ...(q ? [] : [
      [boxPart(2.7, 0.35, 0.5, 0).xform(TR(1.75, -0.55, 0)), 'steel'], [boxPart(0.35, 1.1, 0.5, 0).xform(TR(3.0, -0.05, 0)), 'steel'],
      [boxPart(0.6, 0.6, 0.55, 0).xform(CH(TR(-3.05, 2.95, 0), RZ(25 * DEG))), 'worn'],
      [cylX(5.65, 5.75, 0.55, 0.55, 6).xform(TR(0, 0.95, 0)), 'lensP']]),
  ]);
  add('pistolSlide', 'pistolSlide', [[boxPart(10.5, 1.9, 1.5, ch).xform(TR(2.35, 2.3, 0)), 'steel'],
    ...(q ? [] : [[boxPart(1.6, 0.2, 1.52, 0).xform(TR(-1.6, 3.27, 0)), 'worn'], [boxPart(0.3, 0.5, 0.35, 0).xform(TR(7.2, 3.45, 0)), 'worn']])]);
  // 1.1 × 4.2 × 1.3, seated up the raked grip; only its base pad shows below the grip
  add('pistolMag', 'pistolMag', [[boxPart(1.1, 4.2, 1.3, 0).xform(CH(TR(-0.92, -2.1, 0), RZ(-17 * DEG))), 'mag']]);
  // ---- shotgun (pump, wood)
  const sg = q ? 4 : 8;
  add('shotgun', 'shotgun', [
    [cylX(9.0, 32, 0.72, 0.72, sg).xform(TR(0, 2.8, 0)), 'steel'], [cylX(9.0, 24.5, 0.6, 0.6, sg, false, true).xform(TR(0, 1.35, 0)), 'steel'],
    [boxPart(9.0, 3.1, 1.75, ch).xform(TR(5.0, 2.55, 0)), 'steel'],
    [stockPart([[0.8, 3.9, 1.0, 0.85], [-0.6, 3.5, -1.2, 0.8], [-2.6, 3.25, -0.7, 0.8], [-10.0, 3.1, -1.1, 0.85]]), 'stock'], [boxPart(0.6, 4.2, 1.75, 0).xform(TR(-10.3, 1.0, 0)), 'pad'],
    ...(q ? [] : [[sphere([31.6, 3.65, 0], 0.32, 6, 4), 'brass'], [cylX(29.9, 30.0, 0.5, 0.5, 6).xform(TR(0, 1.6, 0)), 'lensS'], [boxPart(2.6, 0.35, 0.5, 0).xform(TR(2.4, 0.15, 0)), 'steel']]),
  ]);
  add('shotgunForend', 'shotgunForend', [[boxPart(8.5, 2.1, 2.05, ch).xform(TR(15, 1.4, 0)), 'wood']]);
  // ---- rifle (bolt action, scoped)
  add('rifle', 'rifle', [
    [cylX(11.5, 34, 0.62, 0.48, sg, false, true).xform(TR(0, 2.6, 0)), 'steel'], [cylX(3.8, 11.5, 0.85, 0.85, sg).xform(TR(0, 2.6, 0)), 'steel'],
    [stockPart(q ? [[21, 2.0, 0.75, 0.62], [0.6, 2.25, -0.5, 0.8], [-3.8, 3.3, -0.95, 0.8], [-12, 3.25, -1.35, 0.85]] : [[21, 2.0, 0.75, 0.62], [12, 2.05, 0.15, 0.72], [4, 2.1, -0.05, 0.8], [0.6, 2.25, -0.5, 0.8], [-1.4, 2.35, -1.3, 0.75], [-3.8, 3.3, -0.95, 0.8], [-12, 3.25, -1.35, 0.85]]), 'rwal'], [boxPart(0.7, 3.9, 1.75, 0).xform(TR(-12.25, 0.75, 0)), 'pad'], ...(q ? [] : [[boxPart(0.12, 3.95, 1.78, 0).xform(TR(-11.85, 0.75, 0)), 'spacer']]),
    [cylX(-0.5, 12, 0.62, 0.62, sg, q, q).xform(TR(0, 4.5, 0)), 'scope'], [cylX(12, 14.5, 0.62, 1.15, sg, false, true).xform(TR(0, 4.5, 0)), 'scope'], ...(q ? [] : [[cylX(-2.7, -0.5, 1.0, 0.62, sg, true, false).xform(TR(0, 4.5, 0)), 'scope']]),
    ...(q ? [] : [[cylX(14.5, 14.55, 1.0, 1.0, sg).xform(TR(0, 4.5, 0)), 'glass'], [boxPart(1.0, 1.3, 1.0, 0).xform(TR(5.5, 5.4, 0)), 'scope'], [boxPart(0.6, 1.2, 1.6, 0).xform(TR(1.5, 3.7, 0)), 'scope'], [boxPart(0.6, 1.2, 1.6, 0).xform(TR(9.5, 3.7, 0)), 'scope'],
      [cylX(21.9, 22.0, 0.45, 0.45, 6).xform(TR(0, 1.0, 0)), 'lensR']]),
  ]);
  // the bolt handle: a stem out of the action's right side to the knob at SOCKETS.rifle.boltKnob (M3's hand target)
  const bk = SOCKETS.rifle.boltKnob;
  add('rifleBolt', 'rifleBolt', [[boxPart(0.5, 0.5, 1.6, 0).xform(TR(bk[0], (2.6 + bk[1]) / 2, 0.75 + 0.8)), 'steel'], [q ? boxPart(1.1, 1.1, 1.1, 0).xform(TR(bk[0], bk[1], bk[2])) : sphere([bk[0], bk[1], bk[2]], 0.62, 6, 4), 'steel']]);
  // ---- small props
  add('spareMag', 'spareMag', [[boxPart(1.25, 4.4, 1.5, 0).xform(TR(0, -1.0, 0)), 'mag']]);
  add('shellHand', 'shellHand', [[cylX(-1.2, 1.0, 0.45, 0.45, q ? 4 : 6), 'shell'], [cylX(-1.4, -1.2, 0.5, 0.5, q ? 4 : 6, true, false), 'brass']]);
  add('roundHand', 'roundHand', [[cylX(-1.4, 1.2, 0.3, 0.18, q ? 4 : 6), 'brass']]);
  // ---- tools
  add('axe', 'axe', [[cylX(-4, 18, 0.55, 0.5, 6), 'hick'], [boxPart(3.6, 5.2, 0.9, 0).xform(TR(18.5, 0.6, 0)), 'axehead'], ...(q ? [] : [[boxPart(0.7, 5.4, 0.6, 0).xform(TR(20.5, 0.6, 0)), 'axeedge']])]);
  add('hammer', 'hammer', [[cylX(-3, 11, 0.5, 0.45, 6), 'hamh'], [boxPart(1.4, 4.2, 1.4, 0).xform(TR(11.3, 0.6, 0)), 'hamhead']]);
  add('plank', 'plank', [[boxPart(26, 4, 1, 0), 'plank']]);
  add('parcel', 'parcel', [[boxPart(10, 7, 7, 0), 'kraft']]);
  add('rod', 'rod', [[cylX(-6, 40, 0.5, 0.18, q ? 4 : 6), 'rod']]);
}
/** A gun stock from explicit sections [x, top, bottom, halfWidth] (front to butt), flat-shaded. */
function stockPart(secs) {
  const p = new Part(true), S = secs.map(([x, t, b, w]) => [[x, t, w], [x, t, -w], [x, b, -w * 0.9], [x, b, w * 0.9]]);
  for (let i = 0; i < S.length - 1; i++) {
    const ref = [(secs[i][0] + secs[i + 1][0]) / 2, (secs[i][1] + secs[i][2] + secs[i + 1][1] + secs[i + 1][2]) / 4, 0];
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; p.poly([S[i][k], S[i][k1], S[i + 1][k1], S[i + 1][k]], ref); }
  }
  p.poly(S[0], [secs[1][0], (secs[0][1] + secs[0][2]) / 2, 0]); const n = S.length - 1; p.poly(S[n], [secs[n - 1][0], (secs[n][1] + secs[n][2]) / 2, 0]);
  return p;
}

/* ================= face UVs (HQ) ================= */
// Planar front projection; vertices behind the face plane are pushed out sideways into white, and the
// back seam is split, so no triangle ever interpolates across the painted features.
function faceUV(x, y, z, m) {
  const v = clamp((y - 61.6) / 12.4, 0.004, 0.996);
  let u = 0.25 + z / 19.2;
  const back = x - SKULL_C[0] < 1.2;
  if (back) { const sd = m && m.seam ? m.seam : z >= 0 ? 1 : -1; u = 0.25 + sd * Math.max(Math.abs(z) / 19.2, 0.29); }
  return [clamp(u, -0.1, 0.99), v];
}

/* ================= assets (module-level cache) ================= */
const CACHE = new Map();
/** Build (or fetch) the merged geometry + bind data for a quality and age. opts.noCanvas: node tests (no face texture). */
export function frankAssets(q, young, opts = {}) {
  const key = `${q ? 'lq' : 'hq'}|${young ? 'y' : 'a'}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const bones = boneTable(q);
  const B = new Bake(bones, { uv: !q });
  const skin = lin(COL.skin), warm = lin(COL.skinWarm), ao = lin(COL.skinAO), stub = lin(COL.stubbleLow), brow = lin(COL.browLow);
  // head
  B.add('head', buildHead(q), { bone: 'head', uv: q ? null : faceUV, surf: SURF.skin, col: (x, y, z, m) => {
    let c = skin;
    const xr = x - SKULL_C[0], front = ss(0.5, 3.0, xr);
    c = mul(c, 1 - 0.25 * ss(63.4, 62.2, y) * ss(4.5, 2.0, xr + 1.5));            // under the jaw
    c = mul(c, 1 - 0.12 * ss(64.2, 63.0, y) * (1 - ss(1.5, 3.5, Math.abs(z))) * 0); // (chin shading lives in the texture)
    c = mix(c, warm, 0.35 * ss(2.4, 4.4, Math.abs(z)) * ss(64.5, 66.5, y) * (1 - ss(67, 68.5, y)) * front); // warm cheeks
    if (q) { // Low: the face lives in vertex colour
      if (!young) c = mix(c, stub, 0.35 * front * ss(65.2, 64.4, y)); // a shadow of stubble, not a ginger beard
      c = mix(c, ao, 0.7 * front * Math.exp(-(((y - 67.8) / 0.7) ** 2)) * ss(0.6, 1.6, Math.abs(z)) * (1 - ss(2.6, 3.4, Math.abs(z))));
      c = mix(c, brow, 0.85 * front * Math.exp(-(((y - 68.9) / 0.45) ** 2)) * ss(0.5, 1.2, Math.abs(z)) * (1 - ss(3.0, 3.6, Math.abs(z))));
    }
    return c;
  } });
  for (const np of buildNose()) B.add('nose', np, { bone: 'head', uv: q ? null : (x, y, z) => [0.25 + z / 19.2, clamp((y - 61.6) / 12.4, 0, 1)], surf: SURF.skin,
    col: (x, y) => mix(skin, warm, 0.6 * ss(66.5, 65.3, y)) });
  for (const e of buildEars(q)) B.add('ears', e, { bone: 'head', surf: SURF.skin, col: (x, y, z, m) => (m === 'in' ? mul(mix(warm, skin, 0.4), 0.7) : mul(mix(warm, skin, 0.4), m === 'rim' ? 0.86 : 0.9)) });
  B.add('hair', buildHair(q), { bone: 'head', surf: SURF.hair, col: hairColor(young, q) });
  const sbHair = lin(young ? COL.hairYoung : COL.hair), sbGrey = lin(COL.grey0);
  // the sideburns: greying where they meet the temples, the dark hair colour below (not grey plates)
  for (const sb of buildSideburns(q)) B.add('sideburns', sb, { bone: 'head', surf: SURF.hair, col: (x, y, z, m) => (young ? mul(sbHair, 1.05) : mix(sbHair, sbGrey, (z > 0 ? 0.85 : 0.78) - 0.2 * (m ? m.t : 0))) });
  // the forelocks: the quiff's highlight at the root, the base hair colour at the tip
  if (!q) for (const [bone, p] of buildForelocks()) B.add('forelocks', p, { bone, surf: SURF.hair, col: (x, y, z, m) => mix(lin(young ? '#5a3e30' : COL.hairHi), lin(young ? COL.hairYoung : COL.hair), 0.55 * (m ? m.t : 0)) });
  buildTorso(q, B);
  buildCoat(q, B);
  buildArms(q, B);
  buildLegs(q, B);
  const bodyTris = B.idx.length / 3;
  // the hair top (the highest head-bound vertex): frankDebug.headTop and the pip height follow this point on the head bone
  let hairTop = [1.3, 75, 0];
  for (const [lo, hi] of B.ranges.hair) for (let v = lo; v < hi; v++) if (B.pos[v * 3 + 1] > hairTop[1]) hairTop = [B.pos[v * 3], B.pos[v * 3 + 1], B.pos[v * 3 + 2]];
  buildProps(q, B);
  const geometry = B.geometry();
  geometry.computeBoundingSphere();
  const inverses = bones.map((b) => new THREE.Matrix4().makeTranslation(-b.pos[0], -b.pos[1], -b.pos[2]));
  const a = { key, q, young, bones, inverses, geometry, tris: B.idx.length / 3, bodyTris, verts: B.count, parts: B.parts, twins: B.twins, twinRanges: B.twinRanges, hairTop,
    buildMs: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
  if (!opts.noCanvas) a.material = frankMaterial(q, young);
  CACHE.set(key, a);
  return a;
}
/** For tests: drop the cache (node only). */
export function _clearFrankCache() { CACHE.clear(); }

/* ================= face atlas (HQ only): white everywhere, features as multipliers ================= */
const FACE_TEX = {};
function faceTexture(young) {
  const k = young ? 'y' : 'a';
  if (FACE_TEX[k]) return FACE_TEX[k];
  const S = 4, c = document.createElement('canvas'); c.width = 128 * S; c.height = 64 * S;
  const g = c.getContext('2d'); g.scale(S, S);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 64);
  const skin = COL.skin, M = (hex) => mulOver(hex, skin);
  const line = (pts, w, hex, a = 1) => { g.globalAlpha = a; g.strokeStyle = M(hex); g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.stroke(); g.globalAlpha = 1; };
  // cheek hollows and stubble first (under everything)
  if (!young) {
    g.save(); g.filter = 'blur(1.4px)'; g.globalAlpha = 0.8;
    g.fillStyle = M('#b8957f');
    g.beginPath(); g.moveTo(32 - 15.5, 43); g.lineTo(32 - 14, 56); g.lineTo(32 - 8, 62); g.lineTo(32, 63.6); g.lineTo(32 + 8, 62); g.lineTo(32 + 14, 56); g.lineTo(32 + 15.5, 43);
    g.lineTo(32 + 11, 45.5); g.lineTo(32 + 6, 46.5); g.lineTo(32 - 6, 46.5); g.lineTo(32 - 11, 45.5); g.closePath(); g.fill();
    g.fillRect(25.5, 46, 13, 4.6); // upper-lip band
    g.restore();
    // cut the lip band back to white
    g.save(); g.filter = 'blur(0.6px)'; g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(32, 52.3, 5.2, 1.5, 0, 0, TAU); g.fill(); g.restore();
    // speckle: a few darker hairs so it reads as stubble, not a shadow
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    g.fillStyle = M('#7e6254');
    for (let i = 0; i < 420; i++) {
      const x = 32 + (rnd() * 2 - 1) * 15, y = 44 + rnd() * 19.5;
      const inside = Math.abs(x - 32) < 15 - Math.max(0, y - 55) * 0.9 && !(y > 50.8 && y < 53.8 && Math.abs(x - 32) < 5);
      if (inside) { g.globalAlpha = 0.18 + rnd() * 0.3; g.fillRect(x, y, 0.4, 0.4); }
    }
    g.globalAlpha = 1;
    // cheek hollows
    g.save(); g.filter = 'blur(2px)'; g.globalAlpha = 0.4; g.fillStyle = M('#b48a74');
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(32 + s * 12.5, 43, 2.6, 3.2, 0, 0, TAU); g.fill(); }
    g.restore();
  }
  // eye sockets
  for (const s of [-1, 1]) {
    const gr = g.createRadialGradient(32 + s * 12, 31.5, 0, 32 + s * 12, 31.5, 7);
    gr.addColorStop(0, hexA(M('#94634e'), 0.5)); gr.addColorStop(1, hexA(M('#94634e'), 0));
    g.fillStyle = gr; g.fillRect(32 + s * 12 - 8, 23, 16, 16);
  }
  // forehead creases
  if (!young) { line([[23, 16.5], [41, 16.2]], 0.9, '#9a6248', 0.32); line([[24.5, 19.6], [39.5, 19.4]], 0.9, '#9a6248', 0.26); line([[29.6, 24.5], [30.4, 21.8]], 0.8, '#9a6248', 0.12); }
  // nasolabial folds
  g.save(); g.filter = 'blur(0.5px)';
  for (const s of [-1, 1]) line([[32 + s * 5, 41], [32 + s * 7.6, 45.5], [32 + s * 8.6, 50]], 1.1, '#a06a50', 0.38);
  g.restore();
  // brows: heavy, angled down toward the centre (the scowl); his right brow (px > 32) a pixel lower
  for (const s of [-1, 1]) {
    const dy = s > 0 ? 1 : 0;
    g.fillStyle = M('#33201a');
    g.beginPath(); g.moveTo(32 + s * 3.6, 26.7 + dy); g.lineTo(32 + s * 9, 23.8 + dy); g.lineTo(32 + s * 17.5, 23.6 + dy); g.lineTo(32 + s * 17.0, 24.9 + dy); g.lineTo(32 + s * 9.5, 25.4 + dy); g.lineTo(32 + s * 4.2, 28.1 + dy); g.closePath(); g.fill();
  }
  // upper lids (heavy, hooded), irises, a thin lower lid
  for (const s of [-1, 1]) {
    line([[32 + s * 7.2, 31.2], [32 + s * 10.5, 30.0], [32 + s * 14, 30.1], [32 + s * 16, 31.1]], 1.6, '#1e1210');
    g.fillStyle = M('#4a3226'); g.beginPath(); g.ellipse(32 + s * 11.6, 32.0, 1.35, 1.25, 0, 0, TAU); g.fill();
    g.fillStyle = M('#1a0e0a'); g.beginPath(); g.arc(32 + s * 11.6, 32.0, 0.55, 0, TAU); g.fill();
    line([[32 + s * 8.4, 33.6], [32 + s * 11.6, 34.1], [32 + s * 14.6, 33.4]], 0.6, '#9a6248', 0.6);
  }
  // mouth: a hard, flat line; his right corner a pixel lower
  line([[26, 52], [29, 52.4], [35, 52.5], [38, 53.1]], 1.4, '#7a4434');
  line([[28.5, 54.4], [35.5, 54.4]], 0.8, '#b8765e', 0.5); // lower-lip shadow
  // nostril shadows
  for (const s of [-1, 1]) { g.fillStyle = hexA(M('#7a4a38'), 0.7); g.beginPath(); g.ellipse(32 + s * 1.7, 46.8, 0.9, 0.5, 0, 0, TAU); g.fill(); }
  // jaw underside
  const jg = g.createLinearGradient(0, 61, 0, 64); jg.addColorStop(0, hexA(M('#a8644a'), 0)); jg.addColorStop(1, hexA(M('#a8644a'), 0.5));
  g.fillStyle = jg; g.fillRect(12, 61, 40, 3);
  // painted at 4× for clean anti-aliased lines, stored at 2× (256 × 128, a quarter of the GPU memory)
  const c2 = document.createElement('canvas'); c2.width = 256; c2.height = 128;
  const g2 = c2.getContext('2d'); g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high'; g2.drawImage(c, 0, 0, 256, 128);
  const t = new THREE.CanvasTexture(c2);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  FACE_TEX[k] = t;
  return t;
}
function hexA(hex, a) { const h = hex.replace('#', ''); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`; }

/* ================= materials and the lighting patch (§3.8) ================= */
export const FRANK_U = {
  uFill: { value: new THREE.Color(1, 1, 1) }, uFillSkin: { value: new THREE.Color(TUNE.light.fillSkin) }, uRim: { value: new THREE.Color(0, 0, 0) },
  uRimFloor: { value: 0.2 }, uKeyDirV: { value: new THREE.Vector3(0, 1, 0) }, uSheen: { value: new THREE.Color(0, 0, 0) },
  uFlash: { value: 0 }, uWet: { value: 0 }, uLens: { value: 0 }, uLensGun: { value: 0 },
};
export let PATCH_OK = true;
let COMPILED = false;
/** { ok: every patch token was found, compiled: the patch has run at least once } */
export function patchState() { return { ok: PATCH_OK, compiled: COMPILED }; }
const warned = new Set();
function rep(src, token, add, after = true) {
  if (!src.includes(token)) { PATCH_OK = false; if (!warned.has(token)) { warned.add(token); console.warn('Frank shader patch: missing ' + token); } return src; }
  return src.replace(token, after ? token + '\n' + add : add + '\n' + token);
}
function patch(sh, hq) {
  COMPILED = true;
  Object.assign(sh.uniforms, FRANK_U);
  sh.vertexShader = rep(sh.vertexShader, '#include <common>', 'attribute vec4 aSurf;\nvarying vec4 vSurf;');
  sh.vertexShader = rep(sh.vertexShader, '#include <begin_vertex>', 'vSurf = aSurf;');
  let f = sh.fragmentShader;
  f = rep(f, '#include <common>', 'varying vec4 vSurf;\nuniform vec3 uFill, uFillSkin, uRim, uKeyDirV, uSheen;\nuniform float uRimFloor, uFlash, uWet, uLens, uLensGun;');
  f = rep(f, '#include <color_fragment>', 'float fLens = step(0.985, vSurf.z); float fCloth = step(0.01, vSurf.z) * (1.0 - fLens);\ndiffuseColor.rgb *= 1.0 - 0.15 * uWet * fCloth;');
  if (hq) {
    f = rep(f, '#include <roughnessmap_fragment>', 'roughnessFactor = mix(vSurf.x, vSurf.x * 0.72, uWet * fCloth);');
    f = rep(f, '#include <metalnessmap_fragment>', 'metalnessFactor = vSurf.y;');
  }
  f = rep(f, '#include <emissivemap_fragment>', `{ float ndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 3.0);
  float key = mix(uRimFloor, 1.0, smoothstep(-0.15, 0.45, dot(normal, uKeyDirV)));
  totalEmissiveRadiance += uRim * fr * key * mix(1.0, 0.6, vSurf.w) + vec3(uFlash) + uLens * vec3(1.0, 0.95, 0.81) * 3.0 * fLens * (1.0 - step(0.002, abs(vSurf.z - uLensGun))); }`);
  f = rep(f, '#include <lights_fragment_maps>', `#if defined( RE_IndirectDiffuse )
  { float nv = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
    irradiance += mix(uFill, uFill * uFillSkin, vSurf.w) * (0.6 + 0.4 * nv);
    irradiance += uSheen * vSurf.z * (1.0 - fLens) * (1.0 - nv) * (1.0 - nv) * 3.0; }
  #endif`);
  sh.fragmentShader = f;
}
const MATS = {};
export function frankMaterial(q, young) {
  const k = q ? 'lq' : young ? 'hqy' : 'hq';
  if (MATS[k]) return MATS[k];
  let m;
  if (q) { m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.onBeforeCompile = (sh) => patch(sh, false); m.customProgramCacheKey = () => 'frank-lq-1'; }
  else {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, map: typeof document !== 'undefined' ? faceTexture(young) : null, roughness: 1, metalness: 0 });
    m.onBeforeCompile = (sh) => patch(sh, true); m.customProgramCacheKey = () => 'frank-hq-1';
  }
  MATS[k] = m;
  return m;
}

/* ================= decal, debris, dust, cone ================= */
export const DECAL = { ringIn: 15.5, ringOut: 17.5, underIn: 15.0, underOut: 18.7, seg: 32, chevR: 19.5, chevLen: 3.5, chevW: 4, blobX: 16, blobZ: 13, blobSeg: 24, footW: 3, footL: 5 };
/** Per-rig decal geometry (dynamic): rings, chevron, contact blob and (HQ) foot patches. Layout offsets are returned. */
export function decalGeometry(q) {
  const D = DECAL, pos = [], col = [], idx = [];
  const v = (x, y, z, r, g, b, a) => { pos.push(x, y, z); col.push(r, g, b, a); return pos.length / 3 - 1; };
  // contact blob first (drawn underneath)
  const blob0 = pos.length / 3;
  const bc = v(0, 0.5, 0, 0, 0, 0, 0.35);
  for (let i = 0; i < D.blobSeg; i++) { const a = i / D.blobSeg * TAU; v(Math.cos(a) * D.blobX, 0.5, Math.sin(a) * D.blobZ, 0, 0, 0, 0); }
  for (let i = 0; i < D.blobSeg; i++) idx.push(bc, blob0 + 1 + ((i + 1) % D.blobSeg), blob0 + 1 + i);
  const ring = (r0, r1, y, c, a) => { const s = pos.length / 3; for (let i = 0; i < D.seg; i++) { const t = i / D.seg * TAU; v(Math.cos(t) * r0, y, Math.sin(t) * r0, c, c, c, a); v(Math.cos(t) * r1, y, Math.sin(t) * r1, c, c, c, a); } for (let i = 0; i < D.seg; i++) { const a0 = s + i * 2, a1 = s + ((i + 1) % D.seg) * 2; idx.push(a0, a1 + 1, a0 + 1, a0, a1, a1 + 1); } return s; };
  const under0 = ring(D.underIn, D.underOut, 0.7, 0, 0.45);
  const ring0 = ring(D.ringIn, D.ringOut, 0.8, 1, 0.9);
  const chev0 = pos.length / 3; for (let i = 0; i < 4; i++) v(0, 0.85, 0, 1, 1, 1, 0.9);
  idx.push(chev0, chev0 + 1, chev0 + 2, chev0, chev0 + 2, chev0 + 3);
  let feet0 = -1;
  if (!q) { feet0 = pos.length / 3; for (let f = 0; f < 2; f++) { for (let i = 0; i < 4; i++) v(0, 0.55, 0, 0, 0, 0, 0.45); const b = feet0 + f * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); } }
  const g = new THREE.BufferGeometry();
  const pa = new THREE.Float32BufferAttribute(pos, 3), ca = new THREE.Float32BufferAttribute(col, 4);
  pa.setUsage(THREE.DynamicDrawUsage); ca.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('color', ca); g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
  return { geometry: g, blob0, under0, ring0, chev0, feet0 };
}
let DECAL_MAT = null;
export function decalMaterial() {
  return DECAL_MAT || (DECAL_MAT = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
}
let DEBRIS_GEO = null, DEBRIS_MAT = null;
export function debrisAssets() {
  if (!DEBRIS_GEO) { DEBRIS_GEO = new THREE.CylinderGeometry(0.5, 0.5, 1, 6); DEBRIS_GEO.rotateZ(Math.PI / 2); DEBRIS_MAT = new THREE.MeshLambertMaterial({ color: 0xffffff }); }
  return { geometry: DEBRIS_GEO, material: DEBRIS_MAT };
}
let DUST_MAT = null;
export function dustMaterial() {
  if (DUST_MAT) return DUST_MAT;
  let map = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32);
    map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace;
  }
  DUST_MAT = new THREE.PointsMaterial({ size: 7, map, color: 0xb8ab98, transparent: true, depthWrite: false });
  return DUST_MAT;
}
let CONE_GEO = null, CONE_MAT = null;
export function coneAssets() {
  if (!CONE_GEO) { CONE_GEO = new THREE.CylinderGeometry(1, 22, 110, 12, 1, true); CONE_GEO.translate(0, -55, 0); CONE_GEO.rotateZ(Math.PI / 2); CONE_MAT = new THREE.MeshBasicMaterial({ color: 0xfff2cf, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }); }
  return { geometry: CONE_GEO, material: CONE_MAT };
}
