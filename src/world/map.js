// Tile map with collision, line-of-sight and A* pathfinding.
import { TILE } from '../config.js';

// Ground types
export const GR = {
  GRASS: 0, DIRT: 1, ROAD: 2, FLOOR: 3, PORCH: 4, WATER: 5, GRAVEL: 6, SIDEWALK: 7, GARDEN: 8, TILEFLOOR: 9, ROADLINE: 10,
};

// Static solid kinds
export const SO = {
  NONE: 0,
  WALL: 1,      // blocks movement and bullets
  ROCK: 2,      // blocks movement and bullets (cover)
  WATER: 3,     // blocks movement only
  FENCE: 4,     // blocks movement only
  FURN: 5,      // furniture: blocks movement only
  CAR: 6,       // blocks movement and bullets (cover)
  TREE: 7,      // blocks movement and bullets (cover)
  COUNTER: 8,   // blocks movement only
  LOGS: 9,      // log pile: blocks movement and bullets (cover)
};

const BLOCKS_BULLET = new Set([SO.WALL, SO.ROCK, SO.CAR, SO.TREE, SO.LOGS]);

export class GameMap {
  constructor(id, w, h, name) {
    this.id = id;
    this.name = name;
    this.w = w;
    this.h = h;
    this.ground = new Uint8Array(w * h);
    this.solid = new Uint8Array(w * h);
    this.blockers = new Map(); // cell index -> dynamic blocker (door, window, cover)
    this.trees = new Map(); // cell index -> tree {cx, cy, kind, chopped, chops}
    this.decor = []; // static decorative props drawn on the ground layer
    this.props = []; // interactive / dynamic props {id, kind, x, y, ...}
    this.buildings = [];
    this.points = {}; // named waypoints in pixels {x, y}
    this.spawns = {}; // attacker spawn points by direction
    this.lights = []; // static night lights {x, y, r, building?}
    this.groundCanvas = null;
    this.exits = []; // map edge travel zones
  }

  idx(cx, cy) { return cy * this.w + cx; }
  inBounds(cx, cy) { return cx >= 0 && cy >= 0 && cx < this.w && cy < this.h; }

  setGround(cx, cy, g) { if (this.inBounds(cx, cy)) this.ground[this.idx(cx, cy)] = g; }
  setSolid(cx, cy, s) { if (this.inBounds(cx, cy)) this.solid[this.idx(cx, cy)] = s; }
  fillGround(x, y, w, h, g) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.setGround(i, j, g); }
  fillSolid(x, y, w, h, s) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.setSolid(i, j, s); }

  getSolid(cx, cy) {
    if (!this.inBounds(cx, cy)) return SO.WALL;
    return this.solid[this.idx(cx, cy)];
  }

  blockerAt(cx, cy) { return this.blockers.get(this.idx(cx, cy)) || null; }

  /** Can an entity of the given kind move through this cell? */
  blocksMove(cx, cy, who) {
    const s = this.getSolid(cx, cy);
    if (s !== SO.NONE) return true;
    const b = this.blockerAt(cx, cy);
    if (b && b.blocksMove(who)) return true;
    return false;
  }

  /** Does this cell stop a bullet? May mutate blockers (damage). */
  bulletCell(cx, cy, bullet) {
    const s = this.getSolid(cx, cy);
    if (BLOCKS_BULLET.has(s)) return true;
    const b = this.blockerAt(cx, cy);
    if (b) return b.onBullet(bullet);
    return false;
  }

  /** Line-of-sight test (treats windows and doors per their sight rules). */
  los(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 8);
    let lastCell = -1;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
      const id = cy * this.w + cx;
      if (id === lastCell) continue;
      lastCell = id;
      const s = this.getSolid(cx, cy);
      if (BLOCKS_BULLET.has(s)) return false;
      const b = this.blockers.get(id);
      if (b && b.blocksSight()) return false;
    }
    return true;
  }

  /** True if the cell is cover (blocks bullets) — used by AI to find cover spots. */
  isCoverCell(cx, cy) {
    const s = this.getSolid(cx, cy);
    if (s === SO.ROCK || s === SO.CAR || s === SO.TREE || s === SO.LOGS || s === SO.WALL) return true;
    const b = this.blockerAt(cx, cy);
    return !!(b && b.kind === 'cover');
  }

  /**
   * Resolve a circle against solid cells. Moves the entity by (dx, dy) with sliding.
   */
  moveCircle(ent, dx, dy, who) {
    const r = ent.radius;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len / 6));
    const sx = dx / steps, sy = dy / steps;
    for (let s = 0; s < steps; s++) {
      ent.x += sx;
      ent.y += sy;
      this.pushOut(ent, r, who);
    }
  }

  pushOut(ent, r, who) {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const minCx = Math.floor((ent.x - r) / TILE), maxCx = Math.floor((ent.x + r) / TILE);
      const minCy = Math.floor((ent.y - r) / TILE), maxCy = Math.floor((ent.y + r) / TILE);
      for (let cy = minCy; cy <= maxCy; cy++) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          if (!this.blocksMove(cx, cy, who)) continue;
          const rx = cx * TILE, ry = cy * TILE;
          const px = Math.max(rx, Math.min(ent.x, rx + TILE));
          const py = Math.max(ry, Math.min(ent.y, ry + TILE));
          let ddx = ent.x - px, ddy = ent.y - py;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 >= r * r) continue;
          if (d2 < 0.0001) {
            // Centre inside the cell: push out along the shallowest axis.
            const left = ent.x - rx, right = rx + TILE - ent.x, top = ent.y - ry, bot = ry + TILE - ent.y;
            const m = Math.min(left, right, top, bot);
            if (m === left) ent.x = rx - r; else if (m === right) ent.x = rx + TILE + r;
            else if (m === top) ent.y = ry - r; else ent.y = ry + TILE + r;
          } else {
            const d = Math.sqrt(d2);
            const push = r - d;
            ent.x += (ddx / d) * push;
            ent.y += (ddy / d) * push;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    ent.x = Math.max(r, Math.min(this.w * TILE - r, ent.x));
    ent.y = Math.max(r, Math.min(this.h * TILE - r, ent.y));
  }

  /**
   * A* pathfinding over cells. `costFn(cx, cy)` returns Infinity for impassable
   * or an extra cost >= 0. Returns an array of {cx, cy} (excluding start) or null.
   */
  findPath(sx, sy, tx, ty, costFn, maxNodes = 5000) {
    const W = this.w, H = this.h;
    if (!this.inBounds(tx, ty) || !this.inBounds(sx, sy)) return null;
    const start = sy * W + sx, goal = ty * W + tx;
    if (start === goal) return [];
    const g = new Float32Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const closed = new Uint8Array(W * H);
    const heap = new MinHeap();
    g[start] = 0;
    heap.push(start, 0);
    let expanded = 0;
    const h = (i) => {
      const x = i % W, y = (i / W) | 0;
      const ddx = Math.abs(x - tx), ddy = Math.abs(y - ty);
      return Math.max(ddx, ddy) + 0.414 * Math.min(ddx, ddy);
    };
    let best = start, bestH = h(start);
    while (heap.size) {
      const cur = heap.pop();
      if (cur === goal) { best = goal; break; }
      if (closed[cur]) continue;
      closed[cur] = 1;
      if (++expanded > maxNodes) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; best = cur; }
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = cx + ox, ny = cy + oy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (closed[ni]) continue;
          let c = costFn(nx, ny);
          if (c === Infinity) continue;
          if (ox && oy) {
            // no corner cutting
            if (costFn(cx + ox, cy) === Infinity || costFn(cx, cy + oy) === Infinity) continue;
            c += 1.414;
          } else c += 1;
          const ng = g[cur] + c;
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            heap.push(ni, ng + h(ni));
          }
        }
      }
    }
    if (best === start) return null;
    const path = [];
    let c = best;
    while (c !== start && c !== -1) {
      path.push({ cx: c % W, cy: (c / W) | 0 });
      c = came[c];
    }
    path.reverse();
    return path;
  }

  /** Is the point inside a building's interior? Returns the building or null. */
  buildingAt(x, y) {
    const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
    for (const b of this.buildings) {
      if (cx > b.x && cx < b.x + b.w - 1 && cy > b.y && cy < b.y + b.h - 1) return b;
    }
    return null;
  }
}

class MinHeap {
  constructor() { this.items = []; this.prio = []; }
  get size() { return this.items.length; }
  push(item, p) {
    const a = this.items, pr = this.prio;
    a.push(item); pr.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= pr[i]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      [pr[parent], pr[i]] = [pr[i], pr[parent]];
      i = parent;
    }
  }
  pop() {
    const a = this.items, pr = this.prio;
    const top = a[0];
    const lastI = a.pop(), lastP = pr.pop();
    if (a.length) {
      a[0] = lastI; pr[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && pr[l] < pr[m]) m = l;
        if (r < a.length && pr[r] < pr[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        [pr[m], pr[i]] = [pr[i], pr[m]];
        i = m;
      }
    }
    return top;
  }
}
