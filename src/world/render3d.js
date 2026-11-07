// The 3D view: the same world and the same game, seen through an angled
// perspective camera with real light and shadow. The game logic is still 2D
// (x right, y down, in pixels); here x → X, y → Z and height is Y, one pixel
// one unit. The painted ground canvas becomes the floor; walls, roofs, doors,
// windows, trees, rocks, fences, furniture and water are built from the map,
// and people, animals, cars, bullets, fire and effects are synced every frame.
// The 2D canvas stays on top for overlays (labels, health pips, markers) and
// the screen effects. If WebGL isn't available, the game keeps the 2D view.
import * as THREE from '../vendor/three.module.min.js';
import { G } from '../game/state.js';
import { TILE } from '../config.js';
import { GR, SO } from './map.js';
import { hash2, dist } from '../util.js';
import { darkness, activeLights, inFloodlight } from './lights.js';
import { FLASH_ANGLE, FLASH_RANGE } from './shadowcast.js';
import { facadeOf, LOOKS, ENEMY_LOOK, treeVariant } from './render.js';
import { seasonId } from '../game/season-core.js';
import { lowQuality } from '../game/difficulty.js';
import { critterList, trafficList } from './ambient.js';
import { homeMapId } from '../game/chapters.js';
import { frankRig, poseFrank, frankFx, frankTracer, frankDebug, frankPipY, prewarmFrank } from './frank3d.js';

export const WH = 88; // wall height
const DOOR_H = 66, SILL = 28, HEAD = 64;
const PITCH = 47 * Math.PI / 180, FOV = 30;

let R = null, scene = null, camera = null, sun = null, hemi = null, flash = null, canvas3d = null;
let pool = [];
let world = null; // the current map's static scene
let failed = false;

/* ---------------- setup ---------------- */
let hasGL = null;
export function webglAvailable() {
  if (failed) return false;
  if (hasGL === null) { try { const c = document.createElement('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); hasGL = !!g; if (g && g.getExtension('WEBGL_lose_context')) g.getExtension('WEBGL_lose_context').loseContext(); } catch { hasGL = false; } }
  return hasGL;
}

function init() {
  if (R || failed) return !!R;
  try {
    canvas3d = document.createElement('canvas');
    canvas3d.id = 'game3d';
    canvas3d.setAttribute('aria-hidden', 'true');
    const main = document.getElementById('game');
    main.parentNode.insertBefore(canvas3d, main);
    R = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: !lowQuality(), powerPreference: 'high-performance' });
    R.outputColorSpace = THREE.SRGBColorSpace;
    R.toneMapping = THREE.ACESFilmicToneMapping;
    R.toneMappingExposure = 1.05;
    R.shadowMap.enabled = true;
    R.shadowMap.type = THREE.PCFSoftShadowMap;
  } catch (e) {
    console.warn('3D view unavailable, using the 2D view:', e && e.message);
    failed = true; R = null;
    if (canvas3d) canvas3d.remove();
    return false;
  }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 20, 9000);
  hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a4030, 1.0);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 1.2;
  const sc = sun.shadow.camera; sc.left = -900; sc.right = 900; sc.top = 900; sc.bottom = -900; sc.near = 10; sc.far = 3000;
  scene.add(sun); scene.add(sun.target);
  flash = new THREE.SpotLight(0xfff2cf, 0, FLASH_RANGE * 1.6, FLASH_ANGLE * 1.15, 0.45, 1.1);
  flash.castShadow = !lowQuality();
  flash.shadow.mapSize.set(512, 512);
  scene.add(flash); scene.add(flash.target);
  for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffc27a, 0, 300, 1.4); l.position.set(0, -999, 0); scene.add(l); pool.push(l); }
  scene.fog = new THREE.Fog(0x9fb3c4, 1000, 3000); // linear, measured from the camera: see updateLights
  R.shadowMap.enabled = !lowQuality(); // (compile the variants the first frame will use)
  prewarmFrank(R, scene, camera, !!lowQuality());
  return true;
}

/* ---------------- materials and little helpers ---------------- */
const col = (hex) => new THREE.Color(hex);
const matCache = {};
function mat(hex, o = {}) {
  const key = hex + JSON.stringify(o);
  return matCache[key] || (matCache[key] = new THREE.MeshStandardMaterial({ color: col(hex), roughness: 0.85, metalness: 0, ...o }));
}
function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const hashCell = (x, y) => hash2(x * 13 + 7, y * 17 + 3);

/** Wall surfaces: near-white patterns multiplied with each building's colour. */
const WALL_TEX = {};
function wallTex(style) {
  if (WALL_TEX[style]) return WALL_TEX[style];
  const t = canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    if (style === 'brick') { for (let r = 0; r < 8; r++) for (let x = (r % 2) * 8; x < w + 16; x += 16) { g.fillStyle = `rgb(${225 + ((x + r * 7) % 3) * 10},${225 + ((x * 3 + r) % 3) * 9},${225 + ((x + r) % 2) * 8})`; g.fillRect(x - 15, r * 8 + 1, 14, 6); } g.fillStyle = 'rgba(0,0,0,0.25)'; for (let r = 0; r < 8; r++) g.fillRect(0, r * 8, w, 1); }
    else if (style === 'logs') { for (let y = 0; y < h; y += 8) { const gr = g.createLinearGradient(0, y, 0, y + 8); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.6, '#d8d8d8'); gr.addColorStop(1, '#8a8a8a'); g.fillStyle = gr; g.fillRect(0, y, w, 8); } }
    else if (style === 'stone') { for (let r = 0; r < 4; r++) for (let x = (r % 2) * 10; x < w + 20; x += 20) { g.fillStyle = `rgb(${200 + ((x + r) * 37) % 50},${200 + ((x + r) * 37) % 50},${195 + ((x + r) * 37) % 50})`; g.fillRect(x - 19, r * 16 + 1, 18, 14); } }
    else if (style === 'boards') { for (let x = 0; x < w; x += 8) { g.fillStyle = x % 16 ? '#f0f0f0' : '#dcdcdc'; g.fillRect(x, 0, 7, h); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 7, 0, 1, h); } }
    else if (style === 'glass') { g.fillStyle = '#e8fbff'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.9)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 2, h); g.fillRect(0, 0, w, 2); }
    else { for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, y + 6, w, 1.5); g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(0, y + 7.5, w, 1); } }
  }, true);
  WALL_TEX[style] = t;
  return t;
}

/** Collects boxes into one geometry (one draw call). Bottom faces are skipped. */
class Boxes {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; }
  box(x0, y0, z0, x1, y1, z1, hex) {
    const c = col(hex);
    const quad = (a, b, cc, d, nx, ny, nz, uw, vh) => {
      for (const [v, uv] of [[a, [0, 0]], [b, [uw, 0]], [cc, [uw, vh]], [a, [0, 0]], [cc, [uw, vh]], [d, [0, vh]]]) {
        this.p.push(...v); this.n.push(nx, ny, nz); this.c.push(c.r, c.g, c.b); this.u.push(uv[0], uv[1]);
      }
    };
    const W = (x1 - x0) / 32, Hh = (y1 - y0) / 32, D = (z1 - z0) / 32;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], 0, 0, 1, W, Hh); // south
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], 0, 0, -1, W, Hh); // north
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], 1, 0, 0, D, Hh); // east
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], -1, 0, 0, D, Hh); // west
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], 0, 1, 0, W, D); // top
  }
  mesh(material) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

/* ---------------- the static world for a map ---------------- */
function disposeWorld() {
  if (!world) return;
  scene.remove(world.group);
  world.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.userData.own) { if (o.material.map && o.material.userData.ownMap) o.material.map.dispose(); o.material.dispose(); } });
  if (world.groundTex) world.groundTex.dispose();
  world = null;
}

function roofTexture(b, wpx, hpx) {
  const snow = seasonId() === 'winter';
  return canvasTex(256, Math.max(64, Math.round(256 * hpx / wpx)), (g, w, h) => {
    g.fillStyle = b.roof || '#6b3b2a'; g.fillRect(0, 0, w, h);
    // shingle courses run parallel to each eave
    g.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 1.2);
    for (let y = 0; y < h; y += 12) for (let x = (y / 12) % 2 ? 0 : 8; x < w; x += 16) g.fillRect(x, y, 1, 6);
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 90; i++) g.fillRect(hash2(i, b.x) * w, hash2(b.y, i) * h, 10, 3);
    if (snow) { g.fillStyle = 'rgba(240,245,250,0.78)'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(170,190,210,0.4)'; for (let y = 0; y < h; y += 12) g.fillRect(0, y, w, 1); }
    if (b.name && b.w >= 6) {
      const fs = Math.max(9, Math.min(13, w / Math.max(10, b.name.length) * 1.1));
      g.font = `800 ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      // a painted sign on the lower slope, facing the street
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,0.5)'; g.strokeText(b.name.toUpperCase(), w / 2, h * 0.78);
      g.fillStyle = 'rgba(245,240,228,0.85)'; g.fillText(b.name.toUpperCase(), w / 2, h * 0.78);
    }
  });
}

function hipRoof(b, eave = 8) {
  const x0 = b.x * TILE - eave, x1 = (b.x + b.w) * TILE + eave, z0 = b.y * TILE - eave, z1 = (b.y + b.h) * TILE + eave;
  const wpx = x1 - x0, hpx = z1 - z0, y = WH;
  const rise = Math.min(60, Math.min(wpx, hpx) * 0.32 + 10);
  const pts = [];
  const tri = (a, bb, c) => pts.push(a, bb, c);
  if (wpx >= hpx) {
    const zm = (z0 + z1) / 2, d = hpx / 2;
    const L = [x0 + d, y + rise, zm], Rr = [x1 - d, y + rise, zm];
    tri([x0, y, z0], L, Rr); tri([x0, y, z0], Rr, [x1, y, z0]);
    tri([x0, y, z1], [x1, y, z1], Rr); tri([x0, y, z1], Rr, L);
    tri([x0, y, z0], [x0, y, z1], L); tri([x1, y, z0], Rr, [x1, y, z1]);
  } else {
    const xm = (x0 + x1) / 2, d = wpx / 2;
    const T = [xm, y + rise, z0 + d], B = [xm, y + rise, z1 - d];
    tri([x0, y, z0], [x0, y, z1], B); tri([x0, y, z0], B, T);
    tri([x1, y, z0], T, B); tri([x1, y, z0], B, [x1, y, z1]);
    tri([x0, y, z0], T, [x1, y, z0]); tri([x0, y, z1], [x1, y, z1], B);
  }
  const pos = [], uv = [];
  for (const p of pts) { pos.push(...p); uv.push((p[0] - x0) / wpx, 1 - (p[2] - z0) / hpx); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ map: roofTexture(b, wpx, hpx), roughness: 0.8, side: THREE.DoubleSide });
  m.userData.own = true; m.userData.ownMap = true;
  const mesh = new THREE.Mesh(g, m);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

const FURN = { table: ['#6b4a2e', 20], bed: ['#d9d4c8', 16], counter: ['#4a3626', 30], shelf: ['#5a3e26', 58], stove: ['#2a2a2c', 30], crate: ['#8a6a3e', 26], workbench: ['#7a5a36', 26], stall: ['#b8865a', 26], pews: ['#5a3e26', 18], logs: ['#6b4a2b', 26], hay: ['#c8a84a', 22], tractor: ['#3a6a2a', 34], camper: ['#e8e2d4', 46], silo: ['#a8a8a0', 120], tent: ['#7a8a5a', 40], gazebo: ['#e8e2d4', 44], boat: ['#e8e2d4', 16] };

function buildWorld(m) {
  disposeWorld();
  const group = new THREE.Group();
  const W = m.w * TILE, H = m.h * TILE;
  // The floor: the painted ground canvas, plus a wide margin so the camera never sees the void.
  const groundTex = new THREE.CanvasTexture(m.groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = R.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true;
  group.add(ground);
  const edge = new THREE.Mesh(new THREE.PlaneGeometry(W + 6000, H + 6000), mat('#26331f', { roughness: 1 }));
  edge.rotation.x = -Math.PI / 2; edge.position.set(W / 2, -1, H / 2); edge.receiveShadow = true;
  group.add(edge);

  // Which building each wall cell belongs to.
  const owner = new Array(m.w * m.h).fill(null);
  for (const b of m.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) owner[m.idx(x, y)] = b;
  const perB = new Map();
  const loose = { brick: new Boxes(), stone: new Boxes(), siding: new Boxes() };
  const bx = (b) => { if (!perB.has(b)) perB.set(b, { style: facadeOf(b).style, color: facadeOf(b).color, boxes: new Boxes() }); return perB.get(b); };
  // Walls: merge horizontal runs into single boxes.
  const isWall = (x, y) => m.inBounds(x, y) && m.solid[m.idx(x, y)] === SO.WALL;
  for (let y = 0; y < m.h; y++) {
    let x = 0;
    while (x < m.w) {
      if (!isWall(x, y)) { x++; continue; }
      const b = owner[m.idx(x, y)], st = m.stone && m.stone.has(m.idx(x, y));
      let x2 = x;
      while (x2 + 1 < m.w && isWall(x2 + 1, y) && owner[m.idx(x2 + 1, y)] === b && (m.stone && m.stone.has(m.idx(x2 + 1, y))) === st) x2++;
      const h = st && !b ? 58 : WH;
      if (b) { const e = bx(b); e.boxes.box(x * TILE, 0, y * TILE, (x2 + 1) * TILE, h, (y + 1) * TILE, e.color); }
      else (st ? loose.stone : loose.siding).box(x * TILE, 0, y * TILE, (x2 + 1) * TILE, h, (y + 1) * TILE, st ? '#8d877c' : '#9a948a');
      x = x2 + 1;
    }
  }
  // Doors and windows: the wall around them, and the door/glass themselves (kept for updates).
  const openings = [];
  for (const b of m.blockers.values()) {
    if (b.kind !== 'door' && b.kind !== 'window') continue;
    const ob = owner[m.idx(b.cx, b.cy)];
    const color = ob ? facadeOf(ob).color : '#8d877c';
    const target = ob ? bx(ob).boxes : loose.stone;
    const x0 = b.cx * TILE, z0 = b.cy * TILE;
    const gate = !!b.rec.gate;
    if (b.kind === 'door' && !gate) target.box(x0, DOOR_H, z0, x0 + TILE, ob ? WH : 58, z0 + TILE, color);
    if (b.kind === 'window') { target.box(x0, 0, z0, x0 + TILE, SILL, z0 + TILE, color); target.box(x0, HEAD, z0, x0 + TILE, WH, z0 + TILE, color); }
    openings.push(makeOpening(b, gate, !!ob));
  }
  for (const [b, e] of perB) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, map: wallTex(e.style), roughness: e.style === 'glass' ? 0.2 : 0.88, transparent: e.style === 'glass', opacity: e.style === 'glass' ? 0.55 : 1 });
    material.userData.own = true; material.userData.glass = e.style === 'glass';
    const mesh = e.boxes.mesh(material);
    e.mesh = mesh;
    if (mesh) group.add(mesh);
  }
  for (const [st, bxs] of Object.entries(loose)) { const mm = bxs.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, map: wallTex(st === 'siding' ? 'stone' : st), roughness: 0.9 })); if (mm) { mm.material.userData.own = true; group.add(mm); } }
  for (const o of openings) group.add(o.group);

  // Roofs.
  const roofs = [];
  for (const b of m.buildings) { const r = hipRoof(b); group.add(r); roofs.push({ b, mesh: r, walls: perB.get(b) && perB.get(b).mesh }); }

  // Fences, hedges, rocks, logs, furniture.
  const low = new Boxes();
  const decorAt = new Map();
  for (const d of m.decor || []) for (let y = Math.floor(d.y); y < Math.ceil(d.y + (d.h || 1)); y++) for (let x = Math.floor(d.x); x < Math.ceil(d.x + (d.w || 1)); x++) decorAt.set(m.idx(x, y), d);
  const rocks = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = m.idx(x, y), so = m.solid[i], x0 = x * TILE, z0 = y * TILE;
    if (so === SO.FENCE) {
      if (m.hedge && m.hedge.has(i)) low.box(x0 + 1, 0, z0 + 3, x0 + 31, 30, z0 + 29, '#2f5a26');
      else {
        low.box(x0 + 13, 0, z0 + 13, x0 + 19, 30, z0 + 19, '#6b4a2e');
        const ew = m.inBounds(x + 1, y) && m.solid[m.idx(x + 1, y)] === SO.FENCE, sn = m.inBounds(x, y + 1) && m.solid[m.idx(x, y + 1)] === SO.FENCE;
        if (ew) { low.box(x0 + 16, 12, z0 + 14.5, x0 + 48, 16, z0 + 17.5, '#7a5a36'); low.box(x0 + 16, 22, z0 + 14.5, x0 + 48, 26, z0 + 17.5, '#7a5a36'); }
        if (sn) { low.box(x0 + 14.5, 12, z0 + 16, x0 + 17.5, 16, z0 + 48, '#7a5a36'); low.box(x0 + 14.5, 22, z0 + 16, x0 + 17.5, 26, z0 + 48, '#7a5a36'); }
      }
    } else if (so === SO.ROCK) {
      const d = decorAt.get(i);
      if (d && d.kind === 'fountain') continue;
      if (d && d.kind === 'statue') { low.box(x0 + 8, 0, z0 + 8, x0 + 24, 12, z0 + 24, '#8a8680'); low.box(x0 + 11, 12, z0 + 11, x0 + 21, 46, z0 + 21, '#a8a49c'); continue; }
      rocks.push([x0 + 16, z0 + 16, hashCell(x, y)]);
    } else if (so === SO.LOGS) {
      for (let k = 0; k < 3; k++) low.box(x0 + 2, k * 8, z0 + 4 + k * 2, x0 + 30, k * 8 + 8, z0 + 28 - k * 2, k % 2 ? '#7a5532' : '#6b4a2b');
    } else if (so === SO.FURN || so === SO.COUNTER) {
      const d = decorAt.get(i);
      const [c, h] = FURN[d && d.kind] || ['#6b4a2e', 22];
      low.box(x0 + 1, 0, z0 + 1, x0 + 31, h, z0 + 31, c);
      if (d && d.kind === 'bed') low.box(x0 + 3, h, z0 + 3, x0 + 29, h + 4, z0 + 14, '#f2efe8');
    }
  }
  // Fountains, a few tall props.
  for (const d of m.decor || []) {
    if (d.kind === 'fountain') {
      const cx = (d.x + d.w / 2) * TILE, cz = (d.y + d.h / 2) * TILE, r = Math.min(d.w, d.h) * TILE * 0.5;
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 2, 12, 28), mat('#9a958a'));
      basin.position.set(cx, 6, cz); basin.castShadow = basin.receiveShadow = true; group.add(basin);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(r - 4, r - 4, 1, 28), mat('#3d7aa0', { roughness: 0.1, metalness: 0.2 }));
      water.position.set(cx, 11, cz); group.add(water);
      const spout = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, 30, 10), mat('#a8a49c')); spout.position.set(cx, 15, cz); spout.castShadow = true; group.add(spout);
    }
    if (d.kind === 'pole' || d.kind === 'phonepole') { const pole = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 3, 150, 6), mat('#5a4632')); pole.position.set(d.x * TILE + 16, 75, d.y * TILE + 16); pole.castShadow = true; group.add(pole); }
  }
  const lowMesh = low.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  if (lowMesh) { lowMesh.material.userData.own = true; group.add(lowMesh); }
  if (rocks.length) {
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(13, 0), mat('#7d7a74', { roughness: 0.95, flatShading: true }), rocks.length);
    const o = new THREE.Object3D();
    rocks.forEach(([x, z, h], k) => { o.position.set(x, 6, z); o.rotation.set(h * 3, h * 7, h * 5); o.scale.set(1 + h * 0.3, 0.7 + h * 0.3, 1 + (1 - h) * 0.3); o.updateMatrix(); im.setMatrixAt(k, o.matrix); });
    im.castShadow = im.receiveShadow = true; group.add(im);
  }
  // Street lamps.
  for (const l of m.lights || []) {
    if (!l.street) continue;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.6, 96, 6), mat('#2a2c30', { metalness: 0.6, roughness: 0.4 }));
    pole.position.set(l.x, 48, l.y); pole.castShadow = true; group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 8), new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 0 }));
    head.material.userData.own = true; head.position.set(l.x, 97, l.y); group.add(head); l._head = head;
  }
  // Water: a glossy surface over the painted water.
  const wb = new Boxes();
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.solid[m.idx(x, y)] === SO.WATER) wb.box(x * TILE, 0, y * TILE, (x + 1) * TILE, 1.5, (y + 1) * TILE, '#ffffff');
  const water = wb.mesh(new THREE.MeshStandardMaterial({ color: 0x2f6a8e, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.55 }));
  if (water) { water.castShadow = false; water.material.userData.own = true; group.add(water); }

  // Trees (instanced): trunks, and canopies split into "solid" and "faded" so nothing hides a fight.
  const trees = [...m.trees.values()];
  const n = Math.max(1, trees.length);
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(3, 4.5, 1, 6), mat('#4a3220'), n);
  const pineG = coneStack(), oakG = blob(26), fruitG = blob(20);
  const leafMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  const fadeMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true, transparent: true, opacity: 0.28, depthWrite: false });
  const canopy = { pine: [new THREE.InstancedMesh(pineG, leafMat, n), new THREE.InstancedMesh(pineG, fadeMat, n)], oak: [new THREE.InstancedMesh(oakG, leafMat, n), new THREE.InstancedMesh(oakG, fadeMat, n)], fruit: [new THREE.InstancedMesh(fruitG, leafMat, n), new THREE.InstancedMesh(fruitG, fadeMat, n)] };
  trunk.castShadow = true; trunk.receiveShadow = true; group.add(trunk);
  for (const pair of Object.values(canopy)) { pair[0].castShadow = true; pair[0].receiveShadow = true; group.add(pair[0], pair[1]); }
  const veg = buildVegetation(m, group);
  world = { map: m, group, groundTex, groundSrc: m.groundCanvas, roofs, openings, trees, trunk, canopy, season: seasonId(), perB, veg };
  paintTrees(); paintVegetation();
  scene.add(group);
}

function coneStack() {
  const parts = [[26, 34, 30], [20, 28, 52], [13, 24, 70]].map(([r, h, y]) => { const g = new THREE.ConeGeometry(r, h, 8); g.translate(0, y, 0); return g; });
  return mergeGeos(parts);
}
function blob(r) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.82 + hash2(i, 9) * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.85, p.getZ(i) * k); }
  g.translate(0, r + 26, 0);
  g.computeVertexNormals();
  return g;
}
function mergeGeos(list) {
  const pos = [], nor = [];
  for (const g of list) { const ng = g.index ? g.toNonIndexed() : g; pos.push(...ng.attributes.position.array); nor.push(...ng.attributes.normal.array); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return out;
}
const LEAVES = {
  spring: { oak: ['#4f8a34', '#6aa448', '#3f7a2e'], pine: ['#2a5a32', '#24502c'], fruit: ['#5a9a3e', '#f2d6e4'] },
  summer: { oak: ['#3f7a2e', '#4f8a34', '#356a28'], pine: ['#23502b', '#1d4426'], fruit: ['#4a8434', '#5a9a3e'] },
  autumn: { oak: ['#c8642a', '#d89a2c', '#a8401f', '#8a8a2a'], pine: ['#23502b', '#1d4426'], fruit: ['#c8862a', '#9a8a30'] },
  winter: { oak: ['#6b5a48', '#5e5040'], pine: ['#3e5e48', '#4c6a56'], fruit: ['#6b5a48'] },
};
/* Vegetation: grass tufts that lean in the wind, wildflowers and bushes on open grass (instanced, one draw each).
   The 2D view draws its own grass; this is the 3D view's. Thinner on Low graphics; none under snow. */
const GRASS_U = { uTime: { value: 0 } };
const TUFT_COLS = { spring: ['#5a9238', '#6aa440', '#4c8430'], summer: ['#64923a', '#74a042', '#577f32'], autumn: ['#7a823a', '#8a8240', '#667234'], winter: ['#8a9078', '#7c8270', '#949a84'] };
const FLOWER_COLS = { spring: ['#f4f0f8', '#f4d84a', '#c88ad8', '#f29ab8'], summer: ['#f4d84a', '#ffffff', '#e86a4a'], autumn: ['#c88a3a', '#b8702a'], winter: null };
const BUSH_COLS = { spring: ['#3e7a2c', '#4a8a34'], summer: ['#3a6e28', '#46802e'], autumn: ['#6e6a2c', '#8a5a24', '#5a6a28'], winter: ['#5a5e4c', '#4c5244'] };
function tuftGeometry() {
  const pos = [];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + k * 0.7, lean = 0.25 + (k % 3) * 0.12, h = 7 + (k % 3) * 2.5, w = 1.6;
    const bx = Math.cos(a) * 1.6, bz = Math.sin(a) * 1.6, px = Math.cos(a + Math.PI / 2) * w, pz = Math.sin(a + Math.PI / 2) * w;
    pos.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + Math.cos(a) * h * lean, h, bz + Math.sin(a) * h * lean);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  // Grass normals point up so the blades take the sky light like the ground they grow from.
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
let tuftGeo = null;
function buildVegetation(m, group) {
  const lq = lowQuality();
  const tufts = [], flowers = [], bushes = [];
  for (let cy = 0; cy < m.h; cy++) for (let cx = 0; cx < m.w; cx++) {
    const i = m.idx(cx, cy);
    if (m.ground[i] !== GR.GRASS || m.solid[i] !== SO.NONE || m.buildingAt(cx * TILE + 16, cy * TILE + 16)) continue;
    const h = hash2(cx * 7 + 3, cy * 11 + 5);
    const per = lq ? (h < 0.5 ? 1 : 0) : (h < 0.35 ? 3 : h < 0.85 ? 2 : 1);
    for (let k = 0; k < per; k++) tufts.push([cx * TILE + 3 + hash2(cx + k * 13, cy * 3 + k) * 26, cy * TILE + 3 + hash2(cx * 3 + k, cy + k * 17) * 26, hash2(cx - k, cy + k * 5)]);
    if (h > 0.9) flowers.push([cx * TILE + 8 + hash2(cx, cy * 5) * 16, cy * TILE + 8 + hash2(cx * 5, cy) * 16, hash2(cx * 9, cy * 9)]);
    if (!lq && hash2(cx * 13 + 1, cy * 17 + 2) < 0.022) bushes.push([cx * TILE + 16, cy * TILE + 16, hash2(cx * 19, cy * 23)]);
  }
  if (!tuftGeo) tuftGeo = tuftGeometry();
  const tuftMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  tuftMat.userData.own = true;
  tuftMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = GRASS_U.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float gw = sin(uTime * 1.6 - (ip.x * 0.9 + ip.z * 0.36) * 0.012) * 0.6 + 0.4;
        transformed.x += gw * position.y * 0.22; transformed.z += gw * position.y * 0.08;
      #endif`);
  };
  const o = new THREE.Object3D();
  const mk = (geo, mtl, list, place) => { if (!list.length) return null; const im = new THREE.InstancedMesh(geo, mtl, list.length); list.forEach((q, k) => { place(o, q); o.updateMatrix(); im.setMatrixAt(k, o.matrix); }); im.receiveShadow = true; group.add(im); return im; };
  const tuft = mk(tuftGeo, tuftMat, tufts, (ob, [x, z, r]) => { ob.position.set(x, 0, z); ob.rotation.set(0, r * 6.28, 0); const sc = 0.8 + r * 0.6; ob.scale.set(sc, sc * (0.85 + r * 0.4), sc); });
  const flowerMat = new THREE.MeshLambertMaterial(); flowerMat.userData.own = true;
  const flower = mk(new THREE.IcosahedronGeometry(1.7, 0), flowerMat, flowers, (ob, [x, z, r]) => { ob.position.set(x, 8 + r * 3, z); ob.rotation.set(0, 0, 0); ob.scale.setScalar(1); });
  const bushMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }); bushMat.userData.own = true;
  const bush = mk(new THREE.DodecahedronGeometry(10, 1), bushMat, bushes, (ob, [x, z, r]) => { ob.position.set(x, 6, z); ob.rotation.set(r * 2, r * 9, r * 4); ob.scale.set(1.1 + r * 0.6, 0.75 + r * 0.3, 1.1 + (1 - r) * 0.5); });
  if (bush) bush.castShadow = true;
  return { tuft, flower, bush, tufts, flowers, bushes };
}
function paintVegetation() {
  const v = world && world.veg; if (!v) return;
  const sid = seasonId(), c = new THREE.Color();
  const tint = (im, list, cols) => { if (!im) return; im.visible = !!cols; if (!cols) return; list.forEach((q, k) => { c.set(cols[Math.floor(q[2] * 97) % cols.length]); im.setColorAt(k, c); }); if (im.instanceColor) im.instanceColor.needsUpdate = true; };
  tint(v.tuft, v.tufts, TUFT_COLS[sid]);
  if (v.tuft && sid === 'winter') v.tuft.visible = false; // under snow
  tint(v.flower, v.flowers, FLOWER_COLS[sid]);
  tint(v.bush, v.bushes, BUSH_COLS[sid]);
}
function paintTrees() {
  const w = world, sid = seasonId();
  const o = new THREE.Object3D(), c = new THREE.Color();
  w.trees.forEach((tr, i) => {
    const x = tr.cx * TILE + 16, z = tr.cy * TILE + 16;
    const v = tr.v || (tr.v = treeVariant(tr));
    const sc = [0.88, 1, 1.12][v.size] || 1;
    o.position.set(x, 0, z); o.rotation.set(0, hashCell(tr.cx, tr.cy) * 6, 0);
    o.scale.set(sc, tr.chopped ? 6 : 34 * sc, sc); o.updateMatrix(); w.trunk.setMatrixAt(i, o.matrix);
    o.position.y = tr.chopped ? -999 : 0; o.scale.set(sc, sc * (sid === 'winter' && tr.kind !== 'pine' ? 0.7 : 1), sc); o.updateMatrix();
    const kind = tr.kind === 'pine' ? 'pine' : tr.kind === 'fruit' ? 'fruit' : 'oak';
    for (const k of Object.keys(w.canopy)) { w.canopy[k][0].setMatrixAt(i, k === kind ? o.matrix : ZERO); w.canopy[k][1].setMatrixAt(i, ZERO); }
    const pal = LEAVES[sid][kind];
    c.set(pal[Math.floor(hashCell(tr.cx + 3, tr.cy) * pal.length)]);
    for (const k of Object.keys(w.canopy)) { w.canopy[k][0].setColorAt(i, c); w.canopy[k][1].setColorAt(i, c); }
    tr._kind = kind; tr._m = o.matrix.clone(); tr._chopped = tr.chopped;
  });
  w.trunk.instanceMatrix.needsUpdate = true;
  for (const k of Object.keys(w.canopy)) for (const im of w.canopy[k]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/* ---------------- doors and windows ---------------- */
function makeOpening(b, gate, inBuilding) {
  const g = new THREE.Group();
  const x0 = b.cx * TILE, z0 = b.cy * TILE;
  g.position.set(x0 + 16, 0, z0 + 16);
  if (b.vertical) g.rotation.y = Math.PI / 2;
  const o = { b, group: g, key: '' };
  if (b.kind === 'door') {
    const pivot = new THREE.Group(); pivot.position.set(-16, 0, 0); g.add(pivot);
    const h = gate ? 46 : DOOR_H;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(32, h, gate ? 3 : 5), new THREE.MeshStandardMaterial({ color: gate ? 0x3a3c40 : 0x6b4428, roughness: gate ? 0.45 : 0.7, metalness: gate ? 0.6 : 0 }));
    leaf.material.userData.own = true;
    leaf.position.set(16, h / 2, 0); leaf.castShadow = true; pivot.add(leaf);
    if (gate) for (let k = -12; k <= 12; k += 6) { const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, h, 4), leaf.material); bar.position.set(16 + k, h / 2, 0); pivot.add(bar); }
    const brace = new THREE.Mesh(new THREE.BoxGeometry(30, 5, 7), mat('#8a8a8e', { metalness: 0.7, roughness: 0.35 })); brace.position.set(16, h * 0.55, 0); pivot.add(brace);
    o.pivot = pivot; o.leaf = leaf; o.brace = brace;
  } else {
    const glass = new THREE.Mesh(new THREE.BoxGeometry(30, HEAD - SILL, 2), new THREE.MeshStandardMaterial({ color: 0x9ec8e0, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, emissive: 0xffc070, emissiveIntensity: 0 }));
    glass.material.userData.own = true;
    glass.position.set(0, (SILL + HEAD) / 2, 0); g.add(glass);
    const boards = new THREE.Group();
    for (const [y, r] of [[SILL + 7, 0.08], [SILL + 18, -0.06], [SILL + 29, 0.05]]) { const p = new THREE.Mesh(new THREE.BoxGeometry(34, 7, 4), mat('#8a6a3e')); p.position.set(0, y, 3); p.rotation.z = r; p.castShadow = true; boards.add(p); }
    g.add(boards);
    const shutters = new THREE.Mesh(new THREE.BoxGeometry(32, HEAD - SILL, 4), mat('#6a6e74', { metalness: 0.6, roughness: 0.4 })); shutters.position.set(0, (SILL + HEAD) / 2, 4); g.add(shutters);
    o.glass = glass; o.boards = boards; o.shutters = shutters; o.inBuilding = inBuilding;
  }
  return o;
}
function updateOpenings(dk) {
  for (const o of world.openings) {
    const b = o.b, r = b.rec;
    if (b.kind === 'door') {
      const key = `${r.open ? 1 : 0}${b.broken ? 1 : 0}${r.reinforced ? 1 : 0}`;
      if (key !== o.key) {
        o.key = key;
        o.pivot.visible = !b.broken;
        o.pivot.rotation.y = r.open ? -Math.PI / 2 * 0.92 : 0;
        o.brace.visible = !!r.reinforced && !r.open;
      }
    } else {
      const key = `${r.glass > 0 ? 1 : 0}${r.boards ? 1 : 0}${r.shutters ? 1 : 0}${b.rec.open ? 1 : 0}`;
      if (key !== o.key) { o.key = key; o.glass.visible = r.glass > 0; o.boards.visible = !!r.boards; o.shutters.visible = !!r.shutters; }
      // Lit windows at night.
      o.glass.material.emissiveIntensity = o.inBuilding ? dk * 0.9 : 0;
    }
  }
}

/* ---------------- people, animals, vehicles ---------------- */
const rigs = new Map();
const G_LEG = new THREE.CapsuleGeometry(2.6, 14, 3, 6), G_ARM = new THREE.CapsuleGeometry(2.2, 12, 3, 6), G_TORSO = new THREE.CapsuleGeometry(7, 9, 4, 10), G_HEAD = new THREE.SphereGeometry(6, 14, 10), G_HAIR = new THREE.SphereGeometry(6.5, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), G_GUN = new THREE.BoxGeometry(14, 2.6, 2.6), G_BRIM = new THREE.CylinderGeometry(8.5, 8.5, 1.2, 14), G_CROWN = new THREE.CylinderGeometry(5.6, 6, 4.5, 12), G_RING = new THREE.RingGeometry(13, 15.5, 32);
function personRig(o) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const m = (hex) => { const mm = new THREE.MeshStandardMaterial({ color: col(hex), roughness: 0.75 }); mm.userData.own = true; return mm; };
  const pantsM = m(o.pants || '#2c3446'), bodyM = m(o.body), skinM = m(o.skin), hairM = m(o.hair);
  const legL = new THREE.Mesh(G_LEG, pantsM), legR = new THREE.Mesh(G_LEG, pantsM);
  for (const [l, z] of [[legL, -3.6], [legR, 3.6]]) { const piv = new THREE.Group(); piv.position.set(0, 21, z); l.position.set(0, -10, 0); piv.add(l); body.add(piv); l.castShadow = true; }
  const torso = new THREE.Mesh(G_TORSO, bodyM); torso.position.set(0, 32, 0); torso.scale.set(0.85, 1, 1.05); torso.castShadow = true; body.add(torso);
  const armL = new THREE.Group(), armR = new THREE.Group();
  for (const [a, z] of [[armL, -9.5], [armR, 9.5]]) { a.position.set(0, 39, z); const mesh = new THREE.Mesh(G_ARM, bodyM); mesh.position.set(0, -8, 0); mesh.castShadow = true; a.add(mesh); const hand = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 6), skinM); hand.position.set(0, -16, 0); a.add(hand); body.add(a); }
  const head = new THREE.Mesh(G_HEAD, skinM); head.position.set(0, 50, 0); head.castShadow = true; body.add(head);
  if (!o.bald) { const hair = new THREE.Mesh(G_HAIR, hairM); hair.position.set(-0.8, 50.5, 0); hair.rotation.z = 0.25; body.add(hair); }
  if (o.hat) { const hm = m(o.hat); const brim = new THREE.Mesh(G_BRIM, hm); brim.position.set(0, 55, 0); const crown = new THREE.Mesh(G_CROWN, hm); crown.position.set(0, 58, 0); body.add(brim, crown); }
  const gun = new THREE.Mesh(G_GUN, mat('#18181a', { metalness: 0.5, roughness: 0.4 })); gun.position.set(0, -16, 0); gun.rotation.z = Math.PI / 2; gun.visible = !!o.armed; armR.add(gun);
  const ring = new THREE.Mesh(G_RING, new THREE.MeshBasicMaterial({ color: col(o.ring || '#5bc0de'), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.material.userData.own = true; ring.rotation.x = -Math.PI / 2; ring.position.y = 0.8; ring.visible = !!o.ring; g.add(ring);
  const sc = 1.22 * (o.r || 10) / 10 * (o.bulk ? 1 + (o.bulk - 1) * 0.6 : 1); // a touch heroic, so people read at this distance
  g.scale.setScalar(sc);
  return { g, body, legL: legL.parent, legR: legR.parent, armL, armR, gun, torso, ring, mats: [pantsM, bodyM, skinM, hairM], kind: 'person' };
}
function quadRig(coat, dark, big = 1, antlers = false) {
  const g = new THREE.Group(); const body = new THREE.Group(); g.add(body);
  const cm = new THREE.MeshStandardMaterial({ color: col(coat), roughness: 0.85 }); cm.userData.own = true;
  const dm = mat(dark);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(5 * big, 12 * big, 3, 8), cm); torso.rotation.z = Math.PI / 2; torso.position.set(0, 13 * big, 0); torso.castShadow = true; body.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(8 * big, 6.5 * big, 6.5 * big), cm); head.position.set(13 * big, 18 * big, 0); head.castShadow = true; body.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(4 * big, 3 * big, 3.6 * big), dm); snout.position.set(18 * big, 16.5 * big, 0); body.add(snout);
  const legs = [];
  for (const [x, z] of [[8, -3.5], [8, 3.5], [-8, -3.5], [-8, 3.5]]) { const piv = new THREE.Group(); piv.position.set(x * big, 11 * big, z * big); const l = new THREE.Mesh(new THREE.BoxGeometry(2.6 * big, 11 * big, 2.6 * big), dm); l.position.y = -5.5 * big; l.castShadow = true; piv.add(l); body.add(piv); legs.push(piv); }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(7 * big, 2 * big, 2 * big), cm); tail.position.set(-13 * big, 16 * big, 0); tail.rotation.z = 0.5; body.add(tail);
  if (antlers) for (const s of [-1, 1]) { const a = new THREE.Mesh(new THREE.BoxGeometry(1.4, 10, 1.4), mat('#d8c8a0')); a.position.set(13 * big, 26 * big, s * 3); a.rotation.x = s * 0.5; body.add(a); }
  return { g, body, legs, torso, mats: [cm], kind: 'quad' };
}
/* Cars: real low-poly 3D bodies built from side profiles (rear -> front along +x in profile space), extruded across
   the width and turned so the front faces local -Z (render3d's convention: rotation.y = -PI/2 drives east). */
const CAR_SHAPES = {
  //        length, width, body profile (lower), cabin (glass) profile, roof height, wheel radius, wheel x
  sedan:  { L: 96, W: 44, body: [[-48, 5], [48, 5], [48, 15], [44, 19], [16, 21], [-28, 21], [-44, 20], [-48, 16]], cab: [[-30, 21], [15, 21], [4, 33], [-22, 33]], wr: 8.5, wx: 30 },
  muscle: { L: 98, W: 46, body: [[-49, 4.5], [49, 4.5], [49, 12], [45, 16.5], [8, 19], [-34, 19], [-47, 18], [-49, 13.5]], cab: [[-40, 19], [8, 19], [-3, 29.5], [-19, 29.5]], wr: 9, wx: 31, spoiler: true },
  suv:    { L: 98, W: 46, body: [[-49, 7], [49, 7], [49, 19], [45, 24], [20, 25], [-46, 25], [-49, 22]], cab: [[-46, 25], [19, 25], [10, 41], [-44, 41]], wr: 10, wx: 31 },
  pickup: { L: 104, W: 46, body: [[-52, 7], [52, 7], [52, 19], [48, 23], [22, 24], [-52, 24]], cab: [[-6, 24], [20, 24], [13, 39], [-4, 39]], wr: 10, wx: 34, bed: true },
  hatch:  { L: 84, W: 42, body: [[-42, 5], [42, 5], [42, 15], [38, 19], [14, 21], [-40, 21], [-42, 17]], cab: [[-40, 21], [13, 21], [2, 33], [-37, 32]], wr: 8, wx: 26 },
};
const carGeoCache = new Map();
function profileGeo(pts, w, bevel) {
  const sh = new THREE.Shape(); sh.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) sh.lineTo(pts[k][0], pts[k][1]); sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - bevel * 2, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 1 });
  g.translate(0, 0, -(w - bevel * 2) / 2); g.rotateY(Math.PI / 2); // profile x (rear->front) -> local -Z front... after rotateY(+90): x' = z, z' = -x
  g.computeVertexNormals();
  return g;
}
// Pull a geometry's sides in toward the centre line as it rises (car bodies curve in: the belt line and the greenhouse).
function taperX(g, y0, y1, k) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))); p.setX(i, p.getX(i) * (1 - (1 - k) * t * t)); }
  p.needsUpdate = true; g.computeVertexNormals(); return g;
}
function carGeos(model) {
  const key = CAR_SHAPES[model] ? model : 'sedan';
  if (carGeoCache.has(key)) return carGeoCache.get(key);
  const S = CAR_SHAPES[key];
  const roofY = Math.max(...S.cab.map((q) => q[1]));
  const roofPts = S.cab.filter((q) => q[1] === roofY).map((q) => q[0]);
  const r0 = Math.min(...roofPts) + 1, r1 = Math.max(...roofPts) - 1;
  const out = {
    S, body: taperX(profileGeo(S.body, S.W, 2.6), S.cab[0][1] - 7, S.cab[0][1] + 1, 0.9),
    cab: taperX(profileGeo(S.cab, S.W - 5, 1.2), S.cab[0][1], roofY, 0.72),
    roof: taperX(profileGeo([[r0, roofY - 0.2], [r1, roofY - 0.2], [r1 - 1, roofY + 1.4], [r0 + 1, roofY + 1.4]], (S.W - 5) * 0.74, 0.6), roofY, roofY + 2, 0.92),
    tire: new THREE.CylinderGeometry(S.wr, S.wr, 7, 16), hub: new THREE.CylinderGeometry(S.wr * 0.55, S.wr * 0.55, 7.4, 10),
    light: new THREE.BoxGeometry(7, 3, 1.4), grille: new THREE.BoxGeometry(S.W * 0.42, 4, 1), bumper: new THREE.BoxGeometry(S.W - 2, 3.4, 3),
    bed: S.bed ? new THREE.BoxGeometry(S.W - 9, 1.2, 40) : null, spoiler: S.spoiler ? new THREE.BoxGeometry(S.W - 6, 1.2, 4) : null,
  };
  carGeoCache.set(key, out);
  return out;
}
function carRig(model, color, lit) {
  const g = new THREE.Group();
  const C = carGeos(model), S = C.S;
  const bodyM = new THREE.MeshStandardMaterial({ color: col(color), roughness: 0.28, metalness: 0.55 }); bodyM.userData.own = true;
  const glassM = mat('#7f97ad', { roughness: 0.06, metalness: 0.85 }); // reflects the sky, so it reads as glass
  const add = (geo, m, x, y, z, cast = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = true; g.add(o); return o; };
  add(C.body, bodyM, 0, 0, 0);
  add(C.cab, glassM, 0, 0, 0);
  add(C.roof, bodyM, 0, 0, 0);
  const fz = -S.L / 2, rz = S.L / 2, hw = S.W / 2;
  const front = S.body[2][1] - 2;
  // bumpers, grille, lights (emissive when lit)
  add(C.bumper, mat('#1a1a1c', { roughness: 0.6 }), 0, 7, fz - 0.4, false);
  add(C.bumper, mat('#1a1a1c', { roughness: 0.6 }), 0, 7, rz + 0.4, false);
  add(C.grille, mat('#0d0d0e', { roughness: 0.5, metalness: 0.4 }), 0, front - 2, fz - 0.6, false);
  const headM = new THREE.MeshStandardMaterial({ color: 0xf2f0e6, emissive: lit ? 0xfff2cc : 0x222222, emissiveIntensity: lit ? 2.2 : 0.3, roughness: 0.2 }); headM.userData.own = true;
  const tailM = new THREE.MeshStandardMaterial({ color: 0x8a1010, emissive: 0xff2a1a, emissiveIntensity: lit ? 1.8 : 0.35, roughness: 0.3 }); tailM.userData.own = true;
  for (const sx of [-1, 1]) { add(C.light, headM, sx * (hw - 6), front, fz - 0.7, false); add(C.light, tailM, sx * (hw - 6), front, rz + 0.7, false); }
  // wheels with hubs
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (hw - 2), z = sz * S.wx;
    const t = add(C.tire, mat('#111113', { roughness: 0.9 }), x, S.wr, z); t.rotation.z = Math.PI / 2;
    const h = add(C.hub, mat('#9aa0a8', { roughness: 0.3, metalness: 0.8 }), x, S.wr, z, false); h.rotation.z = Math.PI / 2;
  }
  if (C.bed) add(C.bed, mat('#2a2a2c', { roughness: 0.8 }), 0, S.body[4][1] - 0.6, rz - 24, false);
  if (C.spoiler) add(C.spoiler, bodyM, 0, S.body[5][1] + 1.6, rz - 3, false);
  return { g, kind: 'car', mats: [bodyM, headM, tailM], key: `${model}|${color}|${lit}` };
}

function rigFor(e, make) {
  let r = rigs.get(e);
  if (!r) { r = make(); r.e = e; scene.add(r.g); rigs.set(e, r); }
  r.seen = true;
  return r;
}
function posePerson(r, x, y, angle, walk, o = {}) {
  r.g.position.set(x, 0, y);
  r.g.rotation.y = -angle;
  const sw = Math.sin(walk || 0) * (o.moving === false ? 0 : 0.6);
  r.legL.rotation.z = sw; r.legR.rotation.z = -sw;
  if (o.aim) { r.armR.rotation.z = Math.PI / 2 * 0.95; r.armL.rotation.z = Math.PI / 2 * 0.75; r.armL.rotation.x = 0.35; }
  else { r.armR.rotation.z = -sw * 0.8; r.armL.rotation.z = sw * 0.8; r.armL.rotation.x = 0; }
  if (o.downed) { r.body.rotation.z = -Math.PI / 2; r.body.position.y = 7; } else { r.body.rotation.z = 0; r.body.position.y = 0; }
  if (r.torso) r.torso.material.emissive.setRGB(o.flash ? 0.9 : 0, o.flash ? 0.9 : 0, o.flash ? 0.9 : 0);
  if (r.ring) r.ring.visible = !!o.ring && !o.downed;
  r.g.visible = o.visible !== false;
}
function poseQuad(r, x, y, angle, walk, o = {}) {
  r.g.position.set(x, 0, y); r.g.rotation.y = -angle;
  const sw = Math.sin(walk || 0) * 0.7;
  r.legs.forEach((l, i) => { l.rotation.z = (i % 2 ? sw : -sw) * (i < 2 ? 1 : -1); });
  if (o.downed) { r.body.rotation.x = Math.PI / 2; r.body.position.y = 5; } else { r.body.rotation.x = 0; r.body.position.y = 0; }
  r.torso.material.emissive.setRGB(o.flash ? 0.9 : 0, o.flash ? 0.9 : 0, o.flash ? 0.9 : 0);
  r.g.visible = o.visible !== false;
}

function enemyVisible(e, dk, seeR) {
  const p = G.player;
  return dk < 0.4 || dist(e.x, e.y, p.x, p.y) < seeR || e.spotted > 0 || inFloodlight(e.x, e.y) || litByLights(e.x, e.y);
}
function litByLights(x, y) {
  for (const l of activeLights()) { if (l.building) continue; if ((x - l.x) ** 2 + (y - l.y) ** 2 < (l.r * 0.75) ** 2) return true; }
  return false;
}

const FCTX = { dk: 0, camera: null, sun: null, toWorld: null };
function syncActors(dk, seeR) {
  for (const r of rigs.values()) r.seen = false;
  const m = G.map, p = G.player, t = G.time;
  const inside = m.buildingAt(p.x, p.y);
  // Frank: the articulated rig (frank3d.js). Kept alive while dead (death animation).
  if (p) {
    const q = !!lowQuality(), young = !!G.prequel; // lowQuality() can be undefined ('auto' before autoLow is ever set)
    let r = rigs.get(p), carry = null;
    if (r && (r.q !== q || r.young !== young)) { carry = r.st; scene.remove(r.g); r.dispose(); rigs.delete(p); }
    r = rigFor(p, () => frankRig({ q, young, carry }));
    FCTX.dk = dk; FCTX.camera = camera; FCTX.sun = sun; FCTX.toWorld = toWorld;
    poseFrank(r, p, FCTX);
  }
  for (const n of G.npcs) {
    if (!n.present && !n.scripted) continue;
    if (n.present === false) continue;
    const nb = m.buildingAt(n.x, n.y) && m.buildingAt(n.x, n.y) !== inside;
    const d = n.def || {};
    const look = LOOKS[n.id] || {};
    const r = rigFor(n, () => personRig({ body: d.body || '#5a6a7a', skin: d.skin || '#e0b494', hair: d.hair || '#2a2220', pants: look.pants, bald: look.bald, hat: d.hat || look.hatKind ? (look.hatCol || '#3a3a3a') : null, ring: n.ally ? '#6fdc7a' : n.stranger ? '#b9a4e0' : n.deputy || n.reyes ? '#d4af37' : '#5bc0de', armed: !!n.ally, bulk: look.bulk, r: 11 }));
    posePerson(r, n.x, n.y, n.angle || 0, n.walkPhase, { aim: n.ally && n.aimT > 0, downed: n.downed, flash: n.hitT > 0, ring: !n.folk && !nb });
  }
  for (const e of G.enemies) {
    if (e.gone) continue;
    const vis = e.dead || enemyVisible(e, dk, seeR);
    if (e.def.vehicle) {
      const r = rigFor(e, () => carRig('pickup', '#2a2a2e', true));
      r.g.position.set(e.x, 0, e.y); r.g.rotation.y = -e.angle - Math.PI / 2; r.g.visible = vis;
      continue;
    }
    if (e.def.dog) {
      const r = rigFor(e, () => quadRig('#2a221c', '#141010', 1));
      poseQuad(r, e.x, e.y, e.angle, e.walkPhase, { downed: e.dead, flash: e.hitT > 0, visible: vis });
      continue;
    }
    const look = ENEMY_LOOK[e.type] || ENEMY_LOOK.gunman, lk = LOOKS[e.type] || {};
    const r = rigFor(e, () => personRig({ body: e.def.color || '#2a2a30', skin: look.skin, hair: look.hair, hat: look.hat, pants: lk.pants, bald: lk.bald, armed: e.def.weapon !== 'bat' && e.def.weapon !== 'molotov', bulk: lk.bulk, r: e.radius, ring: '#ff3b30' }));
    posePerson(r, e.x, e.y, e.aimT > 0 ? e.aimAngle : e.angle, e.walkPhase, { aim: e.aimT > 0 || e.alerted, downed: e.dead, flash: e.hitT > 0, ring: !e.dead && dk >= 0.4, visible: vis && !(e.dead && e.deadT > 20) });
  }
  if (G.dog) {
    const d = G.dog;
    const r = rigFor(d, () => quadRig('#b07a3c', '#2a1e14', 1));
    poseQuad(r, d.x, d.y, d.angle, d.walk, { downed: d.hurt, flash: d.hitT > 0 });
  }
  for (const a of G.animals || []) {
    const r = rigFor(a, () => quadRig('#8a6a48', '#3a2a1e', 1.35, a.buck));
    poseQuad(r, a.x, a.y, a.angle, a.walk, { downed: a.dead });
  }
  // Cars: Frank's (and any prop car), the dark sedan, parked cars, traffic.
  for (const pr of m.props) {
    if (pr.kind !== 'car' && pr.kind !== 'strange_car' && pr.kind !== 'parked') continue;
    const model = pr.kind === 'car' ? (G.prequel ? 'sedan' : 'muscle') : pr.kind === 'parked' ? ['sedan', 'suv', 'pickup', 'hatch'][Math.floor(hash2(pr.x, pr.y) * 4)] : 'sedan';
    const color = pr.kind === 'car' ? (G.prequel ? '#2a2a30' : '#a5161d') : pr.kind === 'strange_car' ? '#16181c' : pr.color || '#333';
    const lit = pr.kind === 'strange_car' || (pr.kind === 'car' && dk > 0.5);
    const r = rigFor(pr, () => carRig(model, color, lit));
    r.g.position.set(pr.x, 0, pr.y); r.g.rotation.y = pr.kind === 'car' ? 0 : -Math.PI / 2;
  }
  for (const c of trafficList()) {
    const r = rigFor(c, () => carRig(c.model, c.col, dk > 0.4));
    r.g.position.set(c.x, 0, c.y); r.g.rotation.y = c.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
  }
  for (const c of critterList()) {
    const r = rigFor(c, () => critterRig(c.kind, c.s));
    const fly = c.kind === 'bird' && c.state === 'fly';
    r.g.position.set(c.x, c.kind === 'butterfly' ? 18 + Math.sin(t * 3 + c.s) * 4 : fly ? 10 + Math.min(1, c.fly) * 70 : c.kind === 'duck' ? 1 : 0, c.y);
    r.g.rotation.y = -(fly ? Math.atan2(c.vy, c.vx) : c.a);
    if (r.wings) for (const wgn of r.wings) wgn.rotation.x = (fly || c.kind === 'butterfly' ? Math.sin(t * (c.kind === 'butterfly' ? 18 : 22) + c.s) * 0.9 : 0) * (wgn.userData.s || 1);
    r.g.position.y += c.kind === 'rabbit' || c.kind === 'squirrel' ? Math.abs(Math.sin(c.hop || 0)) * 3 : 0;
  }
  // Remove what's gone.
  for (const [e, r] of rigs) if (!r.seen) { scene.remove(r.g); if (r.dispose) r.dispose(); r.g.traverse((o) => { if (o.material && o.material.userData && o.material.userData.own) { if (o.material.map && o.material.userData.ownMap) o.material.map.dispose(); o.material.dispose(); } }); rigs.delete(e); }
}
function critterRig(kind, s) {
  const g = new THREE.Group();
  const add = (geo, hex, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat(hex)); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  const wings = [];
  if (kind === 'bird') { add(new THREE.SphereGeometry(3, 8, 6), '#2a2622', 0, 3, 0).scale.set(1.4, 0.8, 0.9); add(new THREE.SphereGeometry(1.8, 8, 6), '#2a2622', 3.5, 4.2, 0); for (const sd of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 6), mat('#3a3430')); w.position.set(0, 4, sd * 3.5); w.userData.s = sd; g.add(w); wings.push(w); } }
  else if (kind === 'rabbit') { add(new THREE.SphereGeometry(4, 10, 8), '#8a7058', 0, 4, 0).scale.set(1.4, 1, 1); add(new THREE.SphereGeometry(2.8, 8, 6), '#8a7058', 5, 6, 0); for (const sd of [-1, 1]) add(new THREE.BoxGeometry(1, 5, 1.4), '#a88a70', 5, 10, sd * 1.2); add(new THREE.SphereGeometry(1.5, 6, 4), '#f0ece4', -6, 5, 0); }
  else if (kind === 'squirrel') { add(new THREE.SphereGeometry(3, 8, 6), '#7a6a5e', 0, 3, 0).scale.set(1.4, 1, 1); add(new THREE.SphereGeometry(2, 8, 6), '#7a6a5e', 4, 5, 0); add(new THREE.SphereGeometry(2.8, 8, 6), '#8a7a6c', -5, 6, 0).scale.set(0.8, 1.6, 0.8); }
  else if (kind === 'duck') { add(new THREE.SphereGeometry(4, 10, 8), '#6a5a3e', 0, 2.5, 0).scale.set(1.5, 0.8, 1); add(new THREE.SphereGeometry(2.4, 8, 6), (s | 0) % 2 ? '#2f6a3a' : '#7a6a4e', 5, 5, 0); add(new THREE.BoxGeometry(2.6, 1, 1.6), '#e0a830', 7.5, 5, 0); }
  else { const hex = ['#f4f0d8', '#f4c84a', '#e8885a', '#a8c8f0'][Math.floor(s) % 4]; for (const sd of [-1, 1]) { const w = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshBasicMaterial({ color: col(hex), side: THREE.DoubleSide })); w.material.userData.own = true; w.position.set(0, 0, sd * 1.8); w.userData.s = sd; g.add(w); wings.push(w); } }
  return { g, kind: 'critter', wings, mats: [] };
}

/* ---------------- dynamic bits: pickups, props, covers, traps, crops, bullets, particles, fire ---------------- */
let dyn = null;
function ensureDyn() {
  if (dyn) return dyn;
  const glow = canvasTex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  const flame = canvasTex(64, 96, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h * 0.7, 2, w / 2, h * 0.6, w * 0.5); gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.3, 'rgba(255,190,70,0.95)'); gr.addColorStop(0.7, 'rgba(230,80,20,0.6)'); gr.addColorStop(1, 'rgba(180,30,10,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(w / 2, 0); g.quadraticCurveTo(w, h * 0.55, w / 2, h); g.quadraticCurveTo(0, h * 0.55, w / 2, 0); g.fill(); });
  const cap = 700;
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(cap * 3), 3));
  pg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(cap * 3), 3));
  const points = new THREE.Points(pg, new THREE.PointsMaterial({ size: 5, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false, map: glow }));
  points.frustumCulled = false;
  const tracer = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1.6, 1.6), new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }), 96);
  tracer.instanceMatrix.setUsage(THREE.DynamicDrawUsage); tracer.frustumCulled = false;
  tracer.setColorAt(0, new THREE.Color(1, 1, 1));
  const flames = [];
  for (let i = 0; i < 48; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flame, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.visible = false; flames.push(s); scene.add(s); }
  const muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); muzzle.visible = false; muzzle.scale.set(26, 26, 1); scene.add(muzzle);
  scene.add(points, tracer);
  dyn = { glow, flame, points, tracer, flames, muzzle, things: new Map() };
  return dyn;
}
function thing(key, make) {
  let o = dyn.things.get(key);
  if (!o) { o = make(); scene.add(o); dyn.things.set(key, o); }
  o.userData.seen = true;
  return o;
}
const PICK_COL = { cash: '#3fae5a', ammo: '#c9a43a', bandage: '#f2f2f2', note: '#f6eed8', burner: '#222222', ledger: '#6b3e1f', signet: '#d4af37', blueprint: '#3a6ea5', study_key: '#d4af37', item: '#e0474a' };
function marker(hex) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(14, 17, 32), new THREE.MeshBasicMaterial({ color: col(hex), transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.9; g.add(ring);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30, 6), new THREE.MeshBasicMaterial({ color: col(hex), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = 15; g.add(beam);
  g.userData.ring = ring;
  return g;
}
const TR_OB = new THREE.Object3D(), TR_H = new THREE.Vector3(), TR_T = new THREE.Vector3(), TR_D = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0), Y_AXIS3 = new THREE.Vector3(0, 1, 0), TR_ENEMY = new THREE.Color(1, 0.45, 0.3), TR_PLAYER = new THREE.Color(1, 0.95, 0.7);
function syncDynamic(props, dk) {
  ensureDyn();
  for (const o of dyn.things.values()) o.userData.seen = false;
  const t = G.time;
  for (const pk of G.pickups) {
    const o = thing(pk, () => { const g = new THREE.Group(); const b = new THREE.Mesh(new THREE.BoxGeometry(11, 7, 9), mat(PICK_COL[pk.kind] || '#e0474a', { emissive: col(PICK_COL[pk.kind] || '#e0474a'), emissiveIntensity: 0.25 })); b.castShadow = true; g.add(b); g.add(marker('#ffd166')); g.userData.box = b; return g; });
    o.position.set(pk.x, 0, pk.y); o.userData.box.position.y = 9 + Math.sin(t * 4 + pk.x) * 2.5; o.userData.box.rotation.y = t * 1.5;
  }
  for (const pr of props) {
    const o = thing(`${pr.kind}:${Math.round(pr.x)}:${Math.round(pr.y)}`, () => marker(pr.watch || pr.sign ? '#b9a4e0' : pr.kind === 'k_list' ? '#ffd166' : '#5bd6ff'));
    o.position.set(pr.x, 0, pr.y); o.userData.ring.material.opacity = 0.55 + Math.sin(t * 4) * 0.25;
  }
  for (const b of G.map.blockers.values()) {
    if (b.kind !== 'cover') continue;
    const o = thing(b, () => { const g = new THREE.Group(); const sb = b.rec.type === 'sandbags'; for (let k = 0; k < (sb ? 6 : 3); k++) { const m = new THREE.Mesh(sb ? new THREE.CapsuleGeometry(4.5, 7, 3, 8) : new THREE.BoxGeometry(30, 8, 6), mat(sb ? '#b8a07a' : '#7a5a36')); if (sb) { m.rotation.z = Math.PI / 2; m.position.set(-9 + (k % 3) * 9, 5 + Math.floor(k / 3) * 8, 0); } else m.position.set(0, 5 + k * 9, 0); m.castShadow = true; g.add(m); } return g; });
    o.position.set(b.cx * TILE + 16, 0, b.cy * TILE + 16);
  }
  if (G.map.id === homeMapId()) for (const tp of G.s.home.traps || []) {
    const o = thing(tp, () => { const g = new THREE.Group(); const r = new THREE.Mesh(new THREE.TorusGeometry(8, 1.4, 6, 16), mat('#6d7378', { metalness: 0.7, roughness: 0.4 })); r.rotation.x = -Math.PI / 2; r.position.y = 1.5; g.add(r); const c = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 4), mat('#c0392b')); c.position.y = 2; g.add(c); g.userData.c = c; return g; });
    o.position.set(tp.cx * TILE + 16, 0, tp.cy * TILE + 16); o.userData.c.visible = !!tp.armed;
  }
  for (const b of G.boats || []) {
    const o = thing(b, () => { const g = new THREE.Group(); const hull = new THREE.Mesh(new THREE.BoxGeometry(56, 10, 20), mat('#1c1c22')); hull.position.y = 4; hull.castShadow = true; g.add(hull); const st = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 14), mat('#8b0d12')); st.position.set(-8, 12, 0); g.add(st); return g; });
    o.position.set(b.x, Math.sin(t * 2 + b.x) * 1.5, b.y); o.rotation.y = -b.a;
  }
  for (const [k, o] of dyn.things) if (!o.userData.seen) { scene.remove(o); dyn.things.delete(k); }

  // Bullets as glowing tracers. Frank's leave his barrel and merge into the true sim path (frank3d.js).
  const tr = dyn.tracer, ob = TR_OB, fr = G.player && rigs.get(G.player), frk = fr && fr.frank ? fr : null;
  let n = 0;
  for (const b of G.bullets) {
    if (n >= 96) break;
    if (b.owner === 'player' && frk) {
      if (!frankTracer(frk, b, TR_H, TR_T)) continue;
      TR_D.subVectors(TR_H, TR_T); const L = TR_D.length();
      ob.position.lerpVectors(TR_T, TR_H, 0.5);
      if (L > 1e-6) ob.quaternion.setFromUnitVectors(X_AXIS, TR_D.multiplyScalar(1 / L)); else ob.quaternion.identity();
      ob.scale.set(Math.max(4, L), 1, 1);
    } else {
      const dx = b.x - b.px, dy = b.y - b.py, len = Math.max(6, Math.hypot(dx, dy) * 2.2);
      ob.position.set(b.x - dx * 0.6, 30, b.y - dy * 0.6); ob.quaternion.setFromAxisAngle(Y_AXIS3, -Math.atan2(dy, dx)); ob.scale.set(len, b.owner === 'player' ? 1 : 1.3, b.owner === 'player' ? 1 : 1.3);
    }
    ob.updateMatrix();
    tr.setMatrixAt(n, ob.matrix); tr.setColorAt(n, b.owner === 'enemy' ? TR_ENEMY : TR_PLAYER); n++;
  }
  tr.count = n; tr.instanceMatrix.needsUpdate = true; if (tr.instanceColor) tr.instanceColor.needsUpdate = true;
  // Particles (blood, sparks, splinters).
  const pp = dyn.points.geometry.attributes.position, pc = dyn.points.geometry.attributes.color, c = new THREE.Color();
  let k = 0;
  for (const p of G.particles) {
    if (k >= 700) break;
    const f = Math.max(0, p.life / p.max);
    pp.setXYZ(k, p.x, 8 + f * 18, p.y); c.set(p.color); pc.setXYZ(k, c.r, c.g, c.b); k++;
  }
  dyn.points.geometry.setDrawRange(0, k); pp.needsUpdate = true; pc.needsUpdate = true;
  // Fire.
  let fi = 0;
  for (const f of G.fires) {
    const a = Math.min(1, f.life / 1.5);
    for (let j = 0; j < 6 && fi < dyn.flames.length; j++, fi++) {
      const s = dyn.flames[fi]; s.visible = true;
      const ph = t * (3 + j) + j * 1.7 + f.x;
      const rr = f.r * 0.55 * (j / 6);
      s.position.set(f.x + Math.cos(j * 2.4) * rr, 14 + ((t * 40 + j * 9) % 30), f.y + Math.sin(j * 2.4) * rr);
      const sz = (f.r * 0.9) * (0.7 + 0.3 * Math.sin(ph)) * a;
      s.scale.set(sz, sz * 1.5, 1);
      s.material.opacity = 0.85 * a;
    }
  }
  for (; fi < dyn.flames.length; fi++) dyn.flames[fi].visible = false;
  // Muzzle flash: on Frank's barrel when the rig has the gun up, else the classic spot.
  const p = G.player, fx = frk ? frankFx(frk) : null;
  dyn.muzzle.visible = p.muzzle > 0;
  if (p.muzzle > 0) {
    if (fx && fx.valid) { dyn.muzzle.position.copy(fx.flashPos); dyn.muzzle.scale.set(fx.flashSize, fx.flashSize, 1); }
    else { dyn.muzzle.position.set(p.x + Math.cos(p.angle) * 26, 36, p.y + Math.sin(p.angle) * 26); dyn.muzzle.scale.set(26, 26, 1); }
  }
}
/** Frank's flashlight and muzzle light, placed from the rig's anchors (after syncActors; updateLights runs before it). */
function placeFrankFx(dk) {
  const p = G.player, r = p && rigs.get(p); if (!r || !r.frank) return;
  const fx = frankFx(r);
  // (only with the gun up: a relaxed gun hangs at his side, and a beam from it toward the aim crossed his own coat while
  // his body turned after the mouse; then the light keeps updateLights' spot, out in front along the aim)
  if (dk > 0.25 && !p.dead && fx.valid && fx.aimed) flash.position.copy(fx.lightOrigin); // intensity and target unchanged from updateLights
  if (p.muzzle > 0 && dk > 0.15 && fx.valid) { // borrow the farthest pool light for the flash; updateLights restores it next frame
    // (8 u out along the bore, so the coat is lit at a grazing angle instead of point-blank; softer and wider: at 2500 the
    // three flash frames blew the charcoal coat out to khaki and the ground to yellow)
    const l = pool[7], M0 = p.weapon === 'shotgun' ? 0.09 : 0.06;
    l.position.copy(fx.muzzle).addScaledVector(fx.bore, 8); l.color.setHex(0xffb469); l.distance = 240; l.intensity = 1000 * Math.min(1, p.muzzle / M0);
  }
}

/* ---------------- lights, camera, frame ---------------- */
const skyDay = new THREE.Color(0xcfe3ff), skyNight = new THREE.Color(0x4a5e94), fogDay = new THREE.Color(0xa9bccb), fogNight = new THREE.Color(0x0b1220);
let camDist = 1000;
function updateLights(tx, tz, dk) {
  const h = G.s ? G.s.time.minute / 60 : 12;
  const warm = Math.max(0, 1 - Math.abs(h - 12.5) / 6.5); // midday → 1, dawn/dusk → 0
  sun.intensity = 2.7 * (1 - dk) + 0.6 * dk; // by night it's the moon
  sun.color.setRGB(1 - dk * 0.45, 0.78 + warm * 0.2 - dk * 0.1, 0.55 + warm * 0.38 + dk * 0.3);
  // Light from the north-west, like the 2D shadows; low sun at dawn and dusk.
  const elev = 0.45 + warm * 0.55;
  sun.position.set(tx - 420, 380 + elev * 700, tz - 520);
  sun.target.position.set(tx, 0, tz);
  // Snap the shadow camera to its texels so shadows don't shimmer.
  const step = 1800 / 2048;
  sun.target.position.x = Math.round(sun.target.position.x / step) * step; sun.target.position.z = Math.round(sun.target.position.z / step) * step;
  sun.shadow.camera.updateProjectionMatrix();
  hemi.intensity = 0.95 * (1 - dk) + 0.5 * dk;
  hemi.color.copy(skyDay).lerp(skyNight, dk);
  const rain = G.rainLevel || 0, fog = G.fogLevel || 0, snow = G.snowLevel || 0;
  scene.fog.color.copy(fogDay).lerp(fogNight, dk);
  // The camera sits ~camDist from Frank, so fog starts just past him: the play area around him stays clear and
  // weather and night only thicken the far part of the view (the top of the screen), never the middle.
  const thick = Math.min(1, fog + rain * 0.35 + snow * 0.45 + dk * 0.25);
  scene.fog.near = camDist * (1.02 - 0.08 * thick);
  scene.fog.far = camDist * (3.2 - 1.55 * thick);
  sun.intensity *= 1 - Math.min(0.6, rain * 0.5 + fog * 0.4);
  R.setClearColor(scene.fog.color);
  // Frank's flashlight at night.
  const p = G.player;
  if (dk > 0.25 && p && !p.dead) {
    flash.intensity = 2600 * Math.min(1, (dk - 0.25) * 2);
    flash.position.set(p.x + Math.cos(p.angle) * 14, 46, p.y + Math.sin(p.angle) * 14);
    flash.target.position.set(p.x + Math.cos(p.angle) * 200, 0, p.y + Math.sin(p.angle) * 200);
  } else flash.intensity = 0;
  // Point lights from the nearest lamps, porch, floodlight and fires.
  const lights = dk > 0.05 ? activeLights().filter((l) => !l.building).map((l) => ({ l, d: (l.x - tx) ** 2 + (l.y - tz) ** 2 })).sort((a, b) => a.d - b.d) : [];
  pool.forEach((pl, i) => {
    const e = lights[i];
    if (!e) { pl.intensity = 0; return; }
    const l = e.l;
    pl.position.set(l.x, l.fire ? 26 : l.street ? 92 : 60, l.y);
    pl.distance = l.r * 2.2;
    pl.color.set(l.fire ? 0xff8a3a : l.street ? 0xffd9a0 : 0xffe2b0);
    pl.intensity = (l.fire ? 5200 : 3600) * Math.min(1, dk * 1.6 + (l.fire ? 0.5 : 0));
  });
  for (const l of G.map.lights || []) if (l._head) l._head.material.emissiveIntensity = dk * 2;
}

/** Project a world point (x, y, height) to CSS pixels. */
const v3 = new THREE.Vector3();
export function toScreen(x, y, h = 0) {
  v3.set(x, h, y).project(camera);
  return [(v3.x + 1) / 2 * G.view.w, (1 - v3.y) / 2 * G.view.h, v3.z];
}
/** CSS pixels → world point on the plane at height h (for mouse aim). */
const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
export function toWorld(sx, sy, h = 0) {
  ray.setFromCamera({ x: sx / G.view.w * 2 - 1, y: -(sy / G.view.h * 2 - 1) }, camera);
  plane.constant = -h;
  return ray.ray.intersectPlane(plane, hit) ? [hit.x, hit.z] : null;
}
/** World units per screen pixel at a point (for sizing overlays). */
export function pxPerUnit(x, y, h = 0) { const a = toScreen(x, y, h), b = toScreen(x + 10, y, h); return Math.hypot(b[0] - a[0], b[1] - a[1]) / 10; }

let lastW = 0, lastH = 0, lastDpr = 0, lastQ = null;
export function render3d() {
  if (!init()) return false;
  const m = G.map, p = G.player;
  if (!m || !p) return true;
  const { w, h, dpr } = G.view;
  const q = lowQuality();
  if (w !== lastW || h !== lastH || dpr !== lastDpr) { R.setPixelRatio(dpr); R.setSize(w, h, false); canvas3d.style.width = `${w}px`; canvas3d.style.height = `${h}px`; lastW = w; lastH = h; lastDpr = dpr; }
  if (q !== lastQ) {
    const switched = lastQ !== null && !!lastQ !== !!q; // ('auto' reads undefined until autoLow is set)
    R.shadowMap.enabled = !q; lastQ = q; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    // a mid-session switch (auto → Low, or Settings): compile the new quality's Frank (and his hidden debris and dust
    // programs, whose shadow variant just went stale) now, not on the first casing or dodge in a fight
    if (switched) prewarmFrank(R, scene, camera, !!q);
  }
  if (!world || world.map !== m || world.groundSrc !== m.groundCanvas) buildWorld(m);
  if (world.season !== seasonId()) { world.season = seasonId(); paintTrees(); paintVegetation(); }
  GRASS_U.uTime.value = G.time;
  const dk = darkness();
  // Camera: an angled view from the south, following the 2D camera (which already leads and clamps).
  const cam = G.camera;
  const tx = cam.x + (cam.shakeX || 0), tz = cam.y + (cam.shakeY || 0);
  const z = cam.zoom || 1;
  const d = (h / z) / (2 * Math.tan(FOV * Math.PI / 360)) * 1.12;
  camDist = d;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  camera.position.set(tx, Math.sin(PITCH) * d, tz + Math.cos(PITCH) * d);
  camera.lookAt(tx, 0, tz);
  camera.updateMatrixWorld();
  updateLights(tx, tz, dk);
  // Roofs: hidden over the building you're in; see-through when something's inside or behind it.
  const inside = m.buildingAt(p.x, p.y);
  for (const r of world.roofs) {
    const b = r.b;
    const x0 = b.x * TILE, x1 = (b.x + b.w) * TILE, z0 = b.y * TILE;
    const behind = p.x > x0 - 10 && p.x < x1 + 10 && p.y < z0 + 6 && p.y > z0 - 95; // just north of it: the building hides Frank
    const busy = G.enemies.some((e) => !e.dead && m.buildingAt(e.x, e.y) === b);
    // Inside it, or just behind it: cut the building away (roof off, walls low). Attackers inside: see-through roof.
    const cut = inside === b || behind;
    r.mesh.visible = !cut;
    const op = busy ? 0.4 : 1;
    r.mesh.material.transparent = op < 1; r.mesh.material.opacity = op; r.mesh.material.depthWrite = op >= 1;
    if (r.walls) r.walls.scale.y = cut ? 0.3 : 1;
  }
  updateOpenings(dk);
  // Trees near people fade, so nothing hides a fight; a gentle sway in the wind.
  const near = [p, ...G.enemies.filter((e) => !e.dead && !e.gone)];
  const o = new THREE.Object3D(), sway = new THREE.Matrix4();
  let dirty = false;
  for (let i = 0; i < world.trees.length; i++) {
    const tr = world.trees[i];
    if (tr.chopped !== tr._chopped) { paintTrees(); break; }
    if (tr.chopped || (tr.cx * TILE - tx) ** 2 + (tr.cy * TILE - tz) ** 2 > 900 * 900) continue;
    const x = tr.cx * TILE + 16, zz = tr.cy * TILE + 16;
    let fade = false;
    for (const e of near) { const dx = e.x - x, dz = e.y - zz; if (dx * dx + (dz + 30) * (dz + 30) < 46 * 46 || (Math.abs(dx) < 34 && dz < 0 && dz > -70)) { fade = true; break; } }
    const c = world.canopy[tr._kind];
    o.matrix.copy(tr._m);
    if (!q) o.matrix.multiply(sway.makeRotationZ(Math.sin(G.time * 1.3 + hashCell(tr.cx, tr.cy) * 6) * 0.02));
    c[fade ? 1 : 0].setMatrixAt(i, o.matrix); c[fade ? 0 : 1].setMatrixAt(i, ZERO);
    dirty = true;
  }
  if (dirty) for (const k of Object.keys(world.canopy)) for (const im of world.canopy[k]) im.instanceMatrix.needsUpdate = true;
  syncActors(dk, derivedSee());
  placeFrankFx(dk);
  syncDynamic(propsNow(), dk);
  R.render(scene, camera);
  return true;
}

let seeFn = () => 200, propsFn = () => [];
/** main.js hands over how far Frank sees and the interactive props on this map. */
export function setRender3dHooks({ see, props }) { if (see) seeFn = see; if (props) propsFn = props; }
const derivedSee = () => seeFn();
const propsNow = () => propsFn();

/** Turn the 3D view off (the classic 2D view takes over). */
export function hide3d() { if (canvas3d) canvas3d.style.display = 'none'; }
export function show3d() { if (canvas3d) canvas3d.style.display = ''; }
export const active3dCanvas = () => canvas3d;

/** For the automated test: what the 3D view is showing. */
export function view3dState() {
  return { map: world && world.map.id, roofsCut: world ? world.roofs.filter((r) => !r.mesh.visible).map((r) => r.b.id) : [], rigs: rigs.size, people: [...rigs.values()].filter((r) => r.kind === 'person').length, cars: [...rigs.values()].filter((r) => r.kind === 'car').length, canvas: !!canvas3d && canvas3d.style.display !== 'none',
    frank: (() => { const r = G.player && rigs.get(G.player); if (!r || !r.frank) return null;
      const d = frankDebug(r); d.flashPos = dyn && dyn.muzzle.visible ? dyn.muzzle.position.toArray() : null; return d; })(),
    mem: R ? { geometries: R.info.memory.geometries, textures: R.info.memory.textures } : null };
}
/** Where Frank's health pips go (head top + 7, low-passed), for overlay3d. */
export function frankPipHeight() { const r = G.player && rigs.get(G.player); return r && r.frank ? frankPipY(r) : 70; }
/** Render one frame and copy it out (WebGL clears its buffer after compositing). */
export function snapshot3d() {
  if (!render3d()) return null;
  const c = document.createElement('canvas'); c.width = 160; c.height = 100;
  const g = c.getContext('2d'); g.drawImage(canvas3d, 0, 0, 160, 100);
  const d = g.getImageData(0, 0, 160, 100).data, seen = new Set();
  for (let i = 0; i < d.length; i += 16) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
  return { colors: seen.size };
}
