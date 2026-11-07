// Frank's animation maths (3D view). PURE: no DOM and no game state, so node can
// unit-test every function here. Easing and keyed tracks, angle helpers,
// critically damped and pendulum springs on fixed sub-steps, the two-bone IK
// solver (pure hinges, so the elbow and knee weights never candy-wrap), the
// foot step planner, value noise, a seeded PRNG and quadratic Béziers.
import { Vector3, Quaternion, Matrix4 } from '../vendor/three.module.min.js';

export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
/** smoothstep that also works with e0 > e1 (a falling edge). */
export function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function smootherstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/* ---------------- easing ---------------- */
// Ids used in the clip tables: L linear, S smooth (in-out), O ease-out, I ease-in,
// O3/I3 cubic out/in, B back-out (about 10% overshoot), H hold the previous value.
export const EASE = {
  L: (t) => t,
  S: (t) => t * t * (3 - 2 * t),
  O: (t) => 1 - (1 - t) * (1 - t),
  I: (t) => t * t,
  O3: (t) => 1 - (1 - t) ** 3,
  I3: (t) => t * t * t,
  B: (t) => { const c = 1.70158 * 0.62, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; },
  H: () => 0,
};
export const EASE_IDS = Object.keys(EASE);

/**
 * Sample a keyed track. A track is an array of keys [t, value, ease?]; the ease
 * shapes the segment that ARRIVES at that key ('H' holds the previous value until
 * the key). Before the first key the first value holds; after the last, the last.
 */
export function sample(track, t) {
  const n = track.length;
  if (!n) return 0;
  if (t <= track[0][0]) return track[0][1];
  for (let i = 1; i < n; i++) {
    const k = track[i];
    if (t <= k[0]) {
      const p = track[i - 1], e = k[2] || 'S';
      if (e === 'H') return p[1];
      const span = k[0] - p[0];
      const u = span > 1e-9 ? (t - p[0]) / span : 1;
      return p[1] + (k[1] - p[1]) * (EASE[e] || EASE.S)(u);
    }
  }
  return track[n - 1][1];
}
/**
 * Sample a keyed VECTOR track: keys [t, [v0, v1, ...], ease?] (the same rules as sample()), into out (an array of the
 * same length). Allocation-free.
 */
export function sampleV(track, t, out) {
  const n = track.length, m = out.length;
  if (!n) return out;
  let a = track[0], b = a, u = 0;
  if (t > a[0]) {
    let i = 1;
    while (i < n && t > track[i][0]) i++;
    if (i >= n) { a = b = track[n - 1]; }
    else {
      a = track[i - 1]; b = track[i];
      const e = b[2] || 'S', span = b[0] - a[0];
      u = e === 'H' ? 0 : (EASE[e] || EASE.S)(span > 1e-9 ? (t - a[0]) / span : 1);
    }
  }
  for (let k = 0; k < m; k++) out[k] = a[1][k] + (b[1][k] - a[1][k]) * u;
  return out;
}

/* ---------------- angles ---------------- */
export function wrap(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}
/** The signed angle from a to b (same convention as util.js angleDiff). */
export const angleDiff = (a, b) => wrap(b - a);
export const lerpAngle = (a, b, t) => a + wrap(b - a) * t;

/* ---------------- springs ---------------- */
// Every spring advances in n = min(8, ceil(dt / (1/120))) equal sub-steps of dt/n, so no frame ever runs zero steps (a
// 144 Hz frame still moves the spring, no repeated poses), the step never exceeds 1/120 s below 15 fps, and a long frame
// can't blow it up. A dt of 0 is an exact no-op.
export const SPRING_H = 1 / 120;
export function makeSpring(x = 0) { return { x, v: 0 }; }
export function resetSpring(s, x) { s.x = x; s.v = 0; }
let _h = SPRING_H;
function substeps(dt) {
  if (!(dt > 0)) return 0;
  const n = Math.min(8, Math.ceil(dt / SPRING_H - 1e-9));
  _h = dt / n;
  return n;
}
/** Critically damped spring toward target (exact closed form per sub-step: unconditionally stable). */
export function springTo(s, target, omega, dt) {
  const n = substeps(dt);
  if (!n) return s.x;
  const h = _h, e = Math.exp(-omega * h);
  for (let i = 0; i < n; i++) {
    const x0 = s.x - target, v0 = s.v;
    const c = v0 + omega * x0;
    s.x = target + (x0 + c * h) * e;
    s.v = (c - omega * (x0 + c * h)) * e;
  }
  return s.x;
}
/** The same for an angle (takes the short way round; x stays unwrapped-continuous). */
export function springAngle(s, target, omega, dt) {
  return springTo(s, s.x + wrap(target - s.x), omega, dt);
}
/** Under-damped pendulum (cloth, forelocks): semi-implicit Euler at 120 Hz. extra(x, v) adds acceleration. */
export function springPend(s, target, omega, zeta, dt, accel = 0, lo = -Infinity, hi = Infinity) {
  const n = substeps(dt);
  const h = _h;
  for (let i = 0; i < n; i++) {
    const a = -omega * omega * (s.x - target) - 2 * zeta * omega * s.v - accel;
    s.v += a * h; s.x += s.v * h;
    if (s.x < lo) { s.x = lo; if (s.v < 0) s.v = 0; }
    else if (s.x > hi) { s.x = hi; if (s.v > 0) s.v = 0; }
  }
  return s.x;
}
/** Two independent critically damped channels (2-DOF). */
export function makeSpring2(x = 0, y = 0) { return { a: makeSpring(x), b: makeSpring(y) }; }
export function spring2To(s, tx, ty, omega, dt) { springTo(s.a, tx, omega, dt); springTo(s.b, ty, omega, dt); return s; }

/* ---------------- two-bone IK ---------------- */
const _d = new Vector3(), _bend = new Vector3(), _z = new Vector3(), _x = new Vector3(), _y = new Vector3(), _t = new Vector3(), _zz = new Vector3();
const _m = new Matrix4();
/**
 * solveTwoBone(A, T, P, L1, L2, bendSign, out): A root joint, T target, P pole (all world V3).
 * out = { E: V3 (mid joint), q1: Quaternion (upper world), q2: Quaternion (lower world), reach: |T−A| clamped }.
 * Bone convention: each bone's local −Y points along the limb (bind pose hangs straight down),
 * and both segments share the hinge axis z, so the mid joint is a pure hinge.
 */
export function solveTwoBone(A, T, P, L1, L2, bendSign, out) {
  _d.subVectors(T, A);
  let dist = _d.length();
  if (!(dist > 1e-6)) { _d.set(0, -1, 0); dist = 1e-6; } else _d.multiplyScalar(1 / dist);
  const d = clamp(dist, 0.01, 0.999 * (L1 + L2));
  _bend.subVectors(P, A);
  _bend.addScaledVector(_d, -_bend.dot(_d));
  if (_bend.lengthSq() < 1e-10) { // pole on the line: any perpendicular
    _bend.set(1, 0, 0).addScaledVector(_d, -_d.x);
    if (_bend.lengthSq() < 1e-6) _bend.set(0, 0, 1).addScaledVector(_d, -_d.z);
  }
  _bend.normalize();
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  out.E.copy(A).addScaledVector(_d, a).addScaledVector(_bend, h);
  const Tc = _t.copy(A).addScaledVector(_d, d); // the reachable target
  // shared hinge axis
  _z.copy(_bend).multiplyScalar(bendSign).cross(_x.copy(_d).negate()).normalize();
  // upper: y = A − E (bone −Y along the limb)
  _y.subVectors(A, out.E).normalize();
  _x.crossVectors(_y, _z).normalize();
  const zz = _zz.crossVectors(_x, _y); // re-orthogonalised
  _m.makeBasis(_x, _y, zz); out.q1.setFromRotationMatrix(_m);
  // lower: y = E − T
  _y.subVectors(out.E, Tc).normalize();
  _x.crossVectors(_y, zz).normalize();
  const z2 = zz.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, z2); out.q2.setFromRotationMatrix(_m);
  out.reach = d;
  return out;
}
export function makeIKOut() { return { E: new Vector3(), q1: new Quaternion(), q2: new Quaternion(), reach: 0 }; }

/* ---------------- swing-twist, reach ---------------- */
/** The twist (radians, wrapped) of quaternion q about the unit axis (ax, ay, az): the swing-twist decomposition. */
export function twistAngle(q, ax, ay, az) {
  return wrap(2 * Math.atan2(q.x * ax + q.y * ay + q.z * az, q.w));
}
/**
 * The pelvis reach fix for one leg (§4.6): how far the hip joint (hx, hy, hz) must drop so the ankle target
 * (ax, ay, az) lies within Lmax. 0 when it already does; capped at `cap`.
 */
export function reachDrop(hx, hy, hz, ax, ay, az, Lmax, cap = 10) {
  const dx = ax - hx, dz = az - hz, dy = hy - ay, h2 = dx * dx + dz * dz, L2 = Lmax * Lmax;
  if (h2 + dy * dy <= L2) return 0;
  const need = h2 >= L2 ? dy : dy - Math.sqrt(L2 - h2);
  return clamp(need, 0, cap);
}

/* ---------------- pose buffer and crossfade (§4.3) ---------------- */
// One Float32Array per pose, with named offsets (PK). Channel kinds: angle in degrees, position, weight/scalar,
// quaternion component (four in a row, x y z w) and a discrete id that switches at the blend midpoint.
const KINDS = [];
const K_ANG = 0, K_POS = 1, K_W = 2, K_Q = 3, K_ID = 4;
function chan(kind, n = 1) { const o = KINDS.length; for (let i = 0; i < n; i++) KINDS.push(kind); return o; }
export const PK = {
  // root (root motion, falls) and pelvis offsets: dx, dy, dz, pitch, yaw, roll
  root: chan(K_POS, 3), rootRot: chan(K_ANG, 3), pel: chan(K_POS, 3), pelRot: chan(K_ANG, 3),
  s1: chan(K_ANG, 3), s2: chan(K_ANG, 3), neck: chan(K_ANG, 3), head: chan(K_ANG, 3), // pitch, yaw, roll
  clavL: chan(K_ANG, 2), clavR: chan(K_ANG, 2),                                         // elev, prot
  armL: chan(K_ANG, 7), armR: chan(K_ANG, 7),  // flex, abd, twist, elbow, wflex, wdev, wroll
  legL: chan(K_ANG, 5), legR: chan(K_ANG, 5),  // flex, abd, twist, knee, dorsi (FK: falls, IK fallback)
  handL: chan(K_POS, 3), handLQ: chan(K_Q, 4), handLW: chan(K_W), handR: chan(K_POS, 3), handRQ: chan(K_Q, 4), handRW: chan(K_W),
  footIKW: chan(K_W),
  gun: chan(K_POS, 3), gunQ: chan(K_Q, 4), gunDriver: chan(K_ID), gunVis: chan(K_W),
  tool: chan(K_POS, 3), toolQ: chan(K_Q, 4),
  breath: chan(K_W), blob: chan(K_W), crouch: chan(K_W), aimW: chan(K_W), armIKW: chan(K_W),
};
export const POSE_N = KINDS.length;
export const POSE_KIND = Uint8Array.from(KINDS);
const QUATS = [PK.handLQ, PK.handRQ, PK.gunQ, PK.toolQ];
export function poseRest(a) {
  a.fill(0);
  for (const o of QUATS) a[o + 3] = 1;
  a[PK.footIKW] = 1; a[PK.blob] = 1; a[PK.armIKW] = 1;
  return a;
}
export function makePose() { return poseRest(new Float32Array(POSE_N)); }
/** out = blend(a, b, t) (out may be a or b): angles, positions and weights lerp, quaternions nlerp the short way, ids switch at 0.5. */
export function poseBlend(out, a, b, t) {
  for (let i = 0; i < POSE_N; i++) {
    const k = POSE_KIND[i];
    if (k === K_Q) {
      const ax = a[i], ay = a[i + 1], az = a[i + 2], aw = a[i + 3];
      let bx = b[i], by = b[i + 1], bz = b[i + 2], bw = b[i + 3];
      if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      let x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, w = aw + (bw - aw) * t;
      const L = Math.hypot(x, y, z, w) || 1;
      out[i] = x / L; out[i + 1] = y / L; out[i + 2] = z / L; out[i + 3] = w / L;
      i += 3; continue;
    }
    out[i] = k === K_ID ? (t < 0.5 ? a[i] : b[i]) : a[i] + (b[i] - a[i]) * t;
  }
  return out;
}
/** Per-layer snapshot crossfade (inertialisation-lite): on a state change, blend from the layer's last output. */
export function makeFade() { return { state: null, snap: makePose(), t: 0, T: 0, active: false }; }
export function fadeStart(f, lastOut, T) { f.snap.set(lastOut); f.t = 0; f.T = T; f.active = T > 0; }
/** Blend the live layer output from the snapshot (in place); returns the eased weight of the live pose. */
export function fadeApply(f, live, dt) {
  if (!f.active) return 1;
  f.t += dt;
  const u = f.t / f.T;
  if (u >= 1) { f.active = false; return 1; }
  const w = EASE.S(u);
  poseBlend(live, f.snap, live, w);
  return w;
}

/* ---------------- swing curves (§4.6) ---------------- */
/** Catmull-Rom (non-uniform, Hermite form) through the keys' column `col` at u. Keys: [[u, ...values], ...], u ascending. */
export function crSample(keys, u, col) {
  const n = keys.length;
  if (u <= keys[0][0]) return keys[0][col];
  if (u >= keys[n - 1][0]) return keys[n - 1][col];
  let i = 0;
  while (i < n - 2 && u > keys[i + 1][0]) i++;
  const k0 = keys[i], k1 = keys[i + 1], du = k1[0] - k0[0], t = (u - k0[0]) / du;
  const m0 = i > 0 ? (k1[col] - keys[i - 1][col]) / (k1[0] - keys[i - 1][0]) : (k1[col] - k0[col]) / du;
  const m1 = i + 2 < n ? (keys[i + 2][col] - k0[col]) / (keys[i + 2][0] - k0[0]) : (k1[col] - k0[col]) / du;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * k0[col] + (t3 - 2 * t2 + t) * du * m0 + (-2 * t3 + 3 * t2) * k1[col] + (t3 - t2) * du * m1;
}
const kv = (v, toe, heel) => (v === 'toe' ? toe : v === 'heel' ? heel : v * DEG);
/** One swing set at progress u: X (0..1 along the step), Y (ankle lift) and P (foot pitch, radians, S-eased between keys). */
export function swingSample(set, u, toe, heel, out) {
  out.X = clamp(crSample(set, u, 1), 0, 1);
  out.Y = Math.max(0, crSample(set, u, 2));
  const n = set.length;
  if (u <= set[0][0]) out.P = kv(set[0][3], toe, heel);
  else if (u >= set[n - 1][0]) out.P = kv(set[n - 1][3], toe, heel);
  else {
    let i = 0;
    while (i < n - 2 && u > set[i + 1][0]) i++;
    const a = kv(set[i][3], toe, heel), b = kv(set[i + 1][3], toe, heel), t = (u - set[i][0]) / (set[i + 1][0] - set[i][0]);
    out.P = a + (b - a) * EASE.S(t);
  }
  return out;
}
/** The shoe's contact points in the foot frame (ankle = origin): heel and ball of the foot, sole 3.6 below. */
export const FOOT = { heel: -2.6, ball: 6.5, h: 3.6 };
/**
 * The ankle's offset [along the foot, up] from its flat position when the foot is pitched P (radians, + = toes up)
 * and rests on its heel (P > 0) or on the ball of the foot (P < 0): the contact point stays put.
 */
export function pivotOffset(P, out) {
  const px = P > 0 ? FOOT.heel : FOOT.ball, c = Math.cos(P), s = Math.sin(P), h = FOOT.h;
  out[0] = px - px * c - h * s;
  out[1] = -h - px * s + h * c;
  return out;
}

/* ---------------- step planner (§4.6), world space ---------------- */
// Feet are planted in WORLD space and never slide. While the gait runs, each foot's cycle position
// c = (phi − offset) mod 1 (left contact at phi 0, right at 0.5, so contacts land on the sim's step sound at
// walkPhase = kπ) splits stance (c < σ) from swing. The landing spot is re-predicted from the measured velocity
// until 85% of the swing, then frozen, and it is always kept inside the leg's reach of the hip at contact. The swing
// foot travels the REMAINING way to the landing (so a re-predicted landing turns it, never teleports it), and the
// swing set and pitches are latched at lift-off (a mode change only affects the next step). A planted foot may PIVOT
// (yaw only, about the ball or the heel, whichever is on the ground; that point stays put) when the hips have turned
// more than 35° off it, so a sharp cut or a reversal never twists the leg. When the gait stops, swinging feet finish to
// their neutral spots; idle steps (settle, turn in place, corrective) move one foot at a time, and a turn in place
// alternates the feet while the planted one pivots on its ball. Inputs come in one reused object (see frank3d.js).
const S_STANCE = 0, S_SWING = 1, S_STEP = 2;
export const PLANNER = {
  pivotAt: 35 * DEG,          // a planted foot pivots once the hips are this far off it ...
  pivotRate: 900 * DEG,       // ... at up to this rate (gait) ...
  pivotBudget: 90 * DEG,      // ... and by at most this much per stance
  idlePivotAt: 4 * DEG, idlePivotRate: 900 * DEG, idlePivotBudget: 70 * DEG,  // the stance foot during a turn step (on its ball)
  turnCap: 130 * DEG,         // the most one turn step rotates a foot (a 180° flick: two steps)
  turnDur: 0.13, settleDur: 0.2, corrDur: 0.16,
  reach: 33.4,                // 0.985 (L1 + L2)
  reachK: 0.92,               // the landing stays within this share of the horizontal reach at the contact height
};
function footState(side) {
  return {
    side, mode: S_STANCE, c: 0, cs: 0, uu: 0, frozen: false,
    plant: [0, 0], plantYaw: 0, toeOff: 0, from: [0, 0], fromYaw: 0, landing: [0, 0], landYaw: 0, landToe: 0, landP: 0,
    x: 0, z: 0, yaw: 0, pitch: 0, ax: 0, ay: FOOT.h, az: 0, lift: 0, sx: 0, sy: 0, liftK: 1,
    setA: null, setB: null, setW: 0, toe: 0, heel: 0, toeP: NaN, pivot: 0, pivotUsed: 0, strain: false,
    step: { t: 0, e: 0, dur: 0.2, lift: 2, lift0: 0, kind: 0, from0: 0, from1: 0, to: [0, 0], toYaw: 0, toToe: 0 },
    heelRef: [0, 0, 0], ballRef: [0, 0, 0], hasHeel: false, hasBall: false,
  };
}
const _po = [0, 0], _sw = { X: 0, Y: 0, P: 0 }, _sw2 = { X: 0, Y: 0, P: 0 }, _tgt = [0, 0, 0, 0], _err = [0, 0], _yerr = [0, 0];
export class StepPlanner {
  constructor() {
    this.feet = [footState(-1), footState(1)];
    this.contacts = 0; this.maxStanceDrift = 0; this.gait = false; this.gap = 0; this.stepping = 0; this.needTurn = false;
    this.lastContact = -1; // the foot that landed last
    this.turnActive = false; this.turnNext = 0; this.kick = false; this.forced = 0; this.pivots = 0;
  }
  /** Put both feet on their neutral spots ([[x, z, yaw, toe], [x, z, yaw, toe]], world; toe = the signed toe-out). */
  reset(neutral) {
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], n = neutral[i];
      f.mode = S_STANCE; f.plant[0] = f.from[0] = f.landing[0] = f.x = f.ax = n[0]; f.plant[1] = f.from[1] = f.landing[1] = f.z = f.az = n[1];
      f.plantYaw = f.fromYaw = f.landYaw = f.yaw = n[2]; f.toeOff = f.landToe = n[3] || 0; f.pitch = 0; f.lift = 0; f.ay = FOOT.h;
      f.hasHeel = f.hasBall = false; f.pivot = 0; f.pivotUsed = 0; f.strain = false; f.toeP = NaN; f.landP = 0; f.setA = null;
    }
    this.gait = false; this.gap = 0; this.stepping = 0; this.turnActive = false; this.kick = false;
  }
  /** Skid: carry both feet along with the body by (dx, dz) (a dodge until M4's dash clip, or most of a shove; never drift). */
  drag(dx, dz) {
    for (const f of this.feet) {
      f.plant[0] += dx; f.plant[1] += dz; f.from[0] += dx; f.from[1] += dz; f.landing[0] += dx; f.landing[1] += dz;
      f.x += dx; f.z += dz; f.ax += dx; f.az += dz; f.step.to[0] += dx; f.step.to[1] += dz;
      f.step.from0 += dx; f.step.from1 += dz;
      f.hasHeel = f.hasBall = false;
    }
  }
  /** Plant foot i at (x, z) with yaw (world) and toe-out, now (a full-body clip hands the foot back to the planner). */
  place(i, x, z, yaw, toe = 0) {
    const f = this.feet[i];
    f.mode = S_STANCE; f.plant[0] = f.from[0] = f.landing[0] = f.x = f.ax = x; f.plant[1] = f.from[1] = f.landing[1] = f.z = f.az = z;
    f.plantYaw = f.fromYaw = f.landYaw = f.yaw = yaw; f.toeOff = f.landToe = toe; f.pitch = 0; f.lift = 0; f.ay = FOOT.h;
    f.hasHeel = f.hasBall = false; f.pivot = 0; f.pivotUsed = 0; f.strain = false; f.toeP = NaN; f.setA = null;
  }
  /** Slide a planted foot by (dx, dz) (the dash's brake skid: the only allowed plant slide). */
  slide(i, dx, dz) {
    const f = this.feet[i];
    f.plant[0] += dx; f.plant[1] += dz; f.x += dx; f.z += dz; f.ax += dx; f.az += dz; f.landing[0] += dx; f.landing[1] += dz;
    f.hasHeel = f.hasBall = false;
  }
  /** A forced idle step of foot i to n = [x, z, yaw, toe] over dur with lift (a lunge, a stumble); false if it can't step now. */
  forceStep(i, n, dur, lift) {
    const f = this.feet[i];
    if (this.gait || f.mode !== S_STANCE) return false;
    this._startStep(f, n, dur, 3, lift);
    this.feet[1 - i].pivotUsed = 0; this.gap = 0;
    return true;
  }
  /** Is foot i on the ground (planted, not stepping or swinging)? */
  planted(i) { return this.feet[i].mode === S_STANCE; }
  /** The hip yaw a planted foot implies (its yaw less its toe-out). */
  bodyYaw(i) { const f = this.feet[i]; return f.plantYaw - f.toeOff; }
  update(I) {
    const dt = I.dt;
    if (!(dt > 0)) return;
    for (let i = 0; i < 2; i++) this.feet[i].pivot = 0;
    if (I.gait) this._gait(I); else this._idle(I);
    for (let i = 0; i < 2; i++) this._drift(this.feet[i]);
  }
  _ankle(f, P, endW) {
    // the ankle output from the ground position (f.x, f.z), lift and pitch: the contact point stays put
    pivotOffset(P, _po);
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw), k = endW;
    f.ax = f.x + c * _po[0] * k; f.az = f.z + s * _po[0] * k;
    f.ay = FOOT.h + Math.max(f.lift, _po[1]);
    f.pitch = P;
  }
  _latch(f, I) { f.setA = I.setA; f.setB = I.setB; f.setW = I.setW; f.toe = I.toe; f.heel = I.heel; }
  _liftOff(f, c, I) {
    f.mode = S_SWING; f.cs = Math.min(c, 0.97); f.frozen = false; f.uu = 0; f.sx = 0; f.sy = 0;
    // an early (forced) lift makes a long swing: it stays lower, a drag step rather than a slow high-knee
    f.liftK = clamp((1 - I.sigma) / Math.max(0.03, 1 - f.cs), 0.45, 1);
    f.from[0] = f.ax; f.from[1] = f.az; f.fromYaw = f.plantYaw;
    f.x = f.ax; f.z = f.az; f.yaw = f.plantYaw;
    f.landing[0] = f.ax; f.landing[1] = f.az; f.landYaw = f.plantYaw; f.landToe = f.toeOff;
    this._latch(f, I);
  }
  _contact(f, I) {
    f.mode = S_STANCE; f.plant[0] = f.x = f.landing[0]; f.plant[1] = f.z = f.landing[1]; f.plantYaw = f.yaw = f.landYaw; f.toeOff = f.landToe;
    f.lift = 0; f.hasHeel = f.hasBall = false; f.pivotUsed = 0; f.strain = false;
    f.toeP = f.setA ? f.toe : NaN; // the stance's toe-off angle, latched from its swing (a backpedal ends rolled onto the heel)
    this.contacts++; this.lastContact = f.side > 0 ? 1 : 0;
  }
  _swingCurves(f, I, u) {
    const A = f.setA || I.setA, B = f.setA ? f.setB : I.setB, W = f.setA ? f.setW : I.setW, toe = f.setA ? f.toe : I.toe, heel = f.setA ? f.heel : I.heel;
    swingSample(A, u, toe, heel, _sw);
    if (W > 0 && B) {
      swingSample(B, u, toe, heel, _sw2);
      _sw.X += (_sw2.X - _sw.X) * W; _sw.Y += (_sw2.Y - _sw.Y) * W; _sw.P += (_sw2.P - _sw.P) * W;
    }
    return _sw;
  }
  /** Pivot a planted foot toward `want` (yaw) once it is more than `thr` off, about its ball or heel (that point stays put). */
  _pivot(f, want, thr, maxStep, ball, budget) {
    const e = wrap(want - f.plantYaw), ae = Math.abs(e);
    if (ae <= thr || f.pivotUsed >= budget || !(maxStep > 0)) return;
    const d = Math.sign(e) * Math.min(ae - thr, maxStep, budget - f.pivotUsed);
    const px = ball ? FOOT.ball : FOOT.heel;
    const Px = f.plant[0] + Math.cos(f.plantYaw) * px, Pz = f.plant[1] + Math.sin(f.plantYaw) * px;
    f.plantYaw += d;
    f.plant[0] = Px - Math.cos(f.plantYaw) * px; f.plant[1] = Pz - Math.sin(f.plantYaw) * px;
    f.pivotUsed += Math.abs(d); f.pivot = ball ? 1 : 2; this.pivots++;
    if (ball) f.hasHeel = false; else f.hasBall = false;
  }
  _gait(I) {
    const T = 2 * Math.PI / Math.max(I.rate, 1), ch = Math.cos(I.hipYaw), sh = Math.sin(I.hipYaw), dt = I.dt;
    if (!this.gait) {
      this.gait = true; this.turnActive = false; this.kick = false;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        // an idle step caught by the gait starting carries on as this cycle's swing, from where it is (no drop to the ground)
        const c = ((I.phi - (i ? 0.5 : 0)) % 1 + 1) % 1;
        if (f.mode === S_STEP) {
          const lift = f.lift;
          this._liftOff(f, c, I); f.x = f.ax; f.z = f.az; f.lift = lift;
        } else if (i === I.startLead && f.mode === S_STANCE) {
          // the start's lead foot (frank3d.js put it well into its swing) lifts now, however close its beat is
          this._liftOff(f, c, I); f.lift = 0; this._ankle(f, f.pitch, 0); f.ax = f.from[0]; f.az = f.from[1];
        }
        f.c = c;
      }
    }
    this.stepping = 0;
    const spd = Math.hypot(I.vx, I.vz);
    // the landing's reach disc: the horizontal reach left at the hip height (the ankle sits 3.6 up)
    const dy = Math.max(0, (I.hipY ?? 34) - FOOT.h), R = PLANNER.reachK * Math.sqrt(Math.max(36, PLANNER.reach * PLANNER.reach - dy * dy));
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i], side = f.side;
      // (a limp: this foot's own stance fraction and stride, I.sigD / I.leadK; both 0 / 1 otherwise)
      const sig = I.sigma + (I.sigD ? I.sigD[i] : 0), leadK = I.leadK ? I.leadK[i] : 1;
      const c = ((I.phi - (i ? 0.5 : 0)) % 1 + 1) % 1, prev = f.c, wrapped = c < prev - 0.5;
      f.c = c;
      // this foot's neutral spot under the hip now
      const hx = I.rx + ch * 0.5 - sh * side * I.half, hz = I.rz + sh * 0.5 + ch * side * I.half;
      if (f.mode === S_SWING) {
        if (wrapped) { f.landP = this._swingCurves(f, I, 1).P * I.pitchScale; this._contact(f, I); this._stance(f, I, c / sig, dt); continue; }
        const uu = clamp((c - f.cs) / (1 - f.cs), 0, 1);
        f.uu = uu;
        const tTo = (1 - c) * T, cx = hx + I.vx * tTo, cz = hz + I.vz * tTo;
        if (uu < 0.85 || !f.frozen) {
          if (uu >= 0.85) f.frozen = true;
          const lead = (tTo + sig * T * (I.land ?? 0.5)) * leadK;
          f.landing[0] = hx + I.vx * lead; f.landing[1] = hz + I.vz * lead;
          f.landYaw = I.hipYaw + side * I.toeOut; f.landToe = side * I.toeOut;
        }
        // always within reach of the hip at contact (a reversal or a cut never plants a foot the leg can't reach)
        const dx = f.landing[0] - cx, dz = f.landing[1] - cz, dl = Math.hypot(dx, dz);
        if (dl > R) { f.landing[0] = cx + dx * R / dl; f.landing[1] = cz + dz * R / dl; }
        const sw = this._swingCurves(f, I, uu);
        // travel the remaining way: a re-predicted landing bends the path, never jumps the foot
        const k = sw.X >= 1 ? 1 : f.sx >= 1 ? 1 : clamp((sw.X - f.sx) / (1 - f.sx), 0, 1);
        f.x += (f.landing[0] - f.x) * k; f.z += (f.landing[1] - f.z) * k; f.sx = Math.max(f.sx, sw.X);
        const e = EASE.S(uu), ky = e >= 1 || f.sy >= 1 ? 1 : clamp((e - f.sy) / (1 - f.sy), 0, 1);
        f.yaw += wrap(f.landYaw - f.yaw) * ky; f.sy = Math.max(f.sy, e);
        f.lift = sw.Y * I.lift * f.liftK;
        // the heel-strike pivot offset blends in toward the landing (the lift-off one is already in `from`)
        this._ankle(f, sw.P * I.pitchScale, smoothstep(0.6, 1, uu));
        continue;
      }
      if (f.mode === S_STEP) { f.mode = S_STANCE; f.plant[0] = f.x; f.plant[1] = f.z; f.plantYaw = f.yaw; }
      // stance: lift off at σ, or forced when the body has left this foot behind (a start, a reversal, a shove) or the
      // leg's joints can't hold it (frank3d.js flags a strained foot)
      const ox = f.plant[0] - hx, oz = f.plant[1] - hz;
      let forced = false;
      if (c > 0.08 * sig) {
        const jx = I.rx - sh * side * 4.6, jz = I.rz + ch * side * 4.6;
        const need = reachDrop(jx, I.hipY ?? 34, jz, f.ax, f.ay, f.az, PLANNER.reach), other = this.feet[1 - i];
        // (it waits for the other foot to come down first, unless it can't reach at all: no long float at a start)
        forced = (spd > 20 && need > 1.2 && other.mode === S_STANCE) || need > 3 || Math.hypot(ox, oz) > 30 || f.strain;
      }
      f.strain = false;
      if ((c >= sig && !wrapped && 1 - c > 0.18) || forced) {
        if (forced && !(c >= sig)) this.forced++;
        this._liftOff(f, c, I);
        f.lift = this._swingCurves(f, I, 0).Y * I.lift * f.liftK;
        this._ankle(f, f.pitch, 0);
        f.ax = f.from[0]; f.az = f.from[1];
        continue;
      }
      this._stance(f, I, c / sig, dt);
    }
  }
  _stance(f, I, s, dt) {
    s = clamp(s, 0, 1);
    // the heel slaps down (ease-out), the toe-off rolls onto the ball (ease-in); both pitches latched for this stance
    const toe = (Number.isNaN(f.toeP) ? I.toe : f.toeP) * I.pitchScale; // (a foot planted by an idle step: the live gait value)
    const P = s < 0.15 ? f.landP * (1 - EASE.O(s / 0.15)) : s > 0.6 ? toe * EASE.I((s - 0.6) / 0.4) : 0;
    // the pivot: on whichever end of the foot is on the ground (flat: the heel early in the stance, the ball after)
    const ball = P < -1e-4 ? true : P > 1e-4 ? false : s >= 0.3;
    this._pivot(f, I.hipYaw + f.toeOff, PLANNER.pivotAt, PLANNER.pivotRate * dt, ball, PLANNER.pivotBudget);
    f.x = f.plant[0]; f.z = f.plant[1]; f.yaw = f.plantYaw; f.lift = 0;
    this._ankle(f, P, 1);
  }
  _idle(I) {
    const dt = I.dt, PLN = PLANNER;
    if (this.gait) {
      // the gait stopped: swinging feet finish to their neutral spots within 0.12 s
      this.gait = false;
      for (let i = 0; i < 2; i++) {
        const f = this.feet[i];
        if (f.mode !== S_SWING) continue;
        this._startStep(f, I.neutral[i], Math.max(0.07, 0.12 * (1 - f.uu)), 0, 3);
        f.step.lift0 = f.lift;
      }
    }
    this.gap = Math.max(0, this.gap - dt);
    let busy = false, turnStep = false;
    this.stepping = 0;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (f.mode !== S_STEP) continue;
      const S = f.step; S.t += dt;
      const u = clamp(S.t / S.dur, 0, 1), e = EASE.S(u);
      // a turn step keeps re-aiming at the stance the aim is turning to; every step travels the remaining way (no jumps)
      if (S.kind === 1) this._turnTarget(f, I.neutral[i], I, PLN.turnCap);
      const k = e >= 1 ? 1 : clamp((e - S.e) / (1 - S.e), 0, 1); S.e = e;
      f.x += (S.to[0] - f.x) * k; f.z += (S.to[1] - f.z) * k; f.yaw += wrap(S.toYaw - f.yaw) * k;
      // lift: 0 → peak at 40% (ease-out) → 0 (smooth); a finishing swing starts from its current lift
      const pk = Math.max(S.lift, S.lift0 * 0.7);
      f.lift = u < 0.4 ? S.lift0 + (pk - S.lift0) * EASE.O(u / 0.4) : pk * (1 - EASE.S((u - 0.4) / 0.6));
      this._ankle(f, -0.12 * Math.sin(2 * Math.PI * u) * Math.min(1, S.lift / 2), 0);
      this.stepping = Math.max(this.stepping, Math.sin(Math.PI * u));
      if (u >= 1) {
        f.landing[0] = S.to[0]; f.landing[1] = S.to[1]; f.landYaw = S.toYaw; f.landToe = S.toToe; f.setA = null; this._contact(f, I);
        this._ankle(f, 0, 1); this.gap = S.kind === 1 ? 0.02 : 0.03;
        if (S.kind === 1) this.turnNext = 1 - i;
      } else { busy = true; if (S.kind === 1) turnStep = true; }
    }
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (f.mode === S_STEP) continue;
      // planted: any heel-strike or toe-off pitch rolls back to flat about its contact point
      if (f.mode === S_SWING) { f.mode = S_STANCE; f.plant[0] = f.x; f.plant[1] = f.z; f.plantYaw = f.yaw; }
      // while the other foot takes a turn step, this one pivots on its ball after the hips (only ever toward its new
      // spot: a lagging hip never turns it back)
      if (turnStep) {
        const e = wrap(I.hipYaw + f.toeOff - f.plantYaw), toN = wrap(I.neutral[i][2] - f.plantYaw);
        if (e * toN > 0) this._pivot(f, I.hipYaw + f.toeOff, PLN.idlePivotAt, PLN.idlePivotRate * dt, true, PLN.idlePivotBudget);
      }
      f.x = f.plant[0]; f.z = f.plant[1]; f.yaw = f.plantYaw; f.lift = 0;
      this._ankle(f, f.pitch * Math.exp(-dt / 0.05), 1);
    }
    // choose the next idle step (one foot at a time)
    const N = I.neutral, F0 = this.feet[0], F1 = this.feet[1];
    let need = 0, pick = -1, kind = 0;
    this.needTurn = false;
    const err = _err, yerr = _yerr;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      err[i] = Math.hypot(N[i][0] - f.plant[0], N[i][1] - f.plant[1]);
      yerr[i] = Math.abs(wrap(N[i][2] - f.plantYaw));
      if (yerr[i] > 10 * DEG || err[i] > 2.5) this.needTurn = true;
    }
    // (I.hold: a full-body clip owns the feet for now, e.g. the dodge and its tail: no new idle step starts)
    if (busy || this.gap > 0 || I.hold) { F0.strain = F1.strain = false; return; }
    if (I.turning) {
      // turn in place: the turning-side foot first, then the feet alternate (never the same foot twice running)
      if (!this.turnActive) { this.turnActive = true; this.turnNext = I.turnSide > 0 ? 1 : 0; }
      const a = this.turnNext, b = 1 - a, wants = (i) => yerr[i] > 10 * DEG || err[i] > 2.5;
      if (wants(a)) pick = a; else if (wants(b)) pick = b;
      kind = 1;
    } else {
      this.turnActive = false;
      const loose = I.stanceChanged;
      for (let i = 0; i < 2; i++) {
        const bad = err[i] > (loose ? 2 : 5) || yerr[i] > (loose ? 10 : 20) * DEG;
        const score = err[i] / 5 + yerr[i] / (20 * DEG);
        if (bad && I.still > (I.settleT ?? 0.25) && score > need) { need = score; pick = i; kind = 2; }
      }
      // corrective: the body has drifted off the feet (shoves, recoil), a leg is strained, or a shove asked for one
      const mx = (F0.plant[0] + F1.plant[0]) / 2 - I.rx, mz = (F0.plant[1] + F1.plant[1]) / 2 - I.rz;
      const strained = F0.strain ? 0 : F1.strain ? 1 : -1;
      if (strained >= 0) { pick = F0.strain && F1.strain ? (err[0] > err[1] ? 0 : 1) : strained; kind = 3; }
      else if (pick < 0 && (Math.hypot(mx, mz) > 12 || (this.kick && Math.max(err[0], err[1]) > 1.5))) { pick = err[0] > err[1] ? 0 : 1; kind = 3; }
    }
    F0.strain = F1.strain = false; this.kick = false;
    if (pick >= 0) {
      const dur = kind === 1 ? PLN.turnDur : kind === 3 ? PLN.corrDur : PLN.settleDur, lift = kind === 2 ? 2 : 2.5;
      // a big turn goes round in steps of up to turnCap (the target swung back about the body), never a pirouette
      const f = this.feet[pick];
      this.feet[1 - pick].pivotUsed = 0;
      this._startStep(f, N[pick], dur, kind, lift);
      this._turnTarget(f, N[pick], I, kind === 1 ? PLN.turnCap : 80 * DEG);
    }
  }
  _startStep(f, n, dur, kind, lift) {
    const S = f.step;
    f.mode = S_STEP; S.t = 0; S.e = 0; S.dur = dur; S.kind = kind; S.lift = lift; S.lift0 = 0;
    S.from0 = f.x; S.from1 = f.z; f.fromYaw = f.yaw; S.to[0] = n[0]; S.to[1] = n[1]; S.toYaw = n[2]; S.toToe = n[3] || 0;
  }
  /** A step's target: the neutral spot n, but a big turn goes round by at most `cap` per step (the spot swung back about
   *  the body by the excess), never a pirouette. */
  _turnTarget(f, n, I, cap) {
    const S = f.step, dyw = wrap(n[2] - f.fromYaw);
    if (Math.abs(dyw) > cap + 15 * DEG) {
      const ex = dyw - Math.sign(dyw) * cap, c = Math.cos(-ex), s = Math.sin(-ex), ox = n[0] - I.rx, oz = n[1] - I.rz;
      S.to[0] = I.rx + ox * c - oz * s; S.to[1] = I.rz + ox * s + oz * c; S.toYaw = n[2] - ex;
    } else { S.to[0] = n[0]; S.to[1] = n[1]; S.toYaw = n[2]; }
    S.toToe = n[3] || 0;
  }
  /** Stance drift of the planner's own output: the heel (heel strike, flat) and the ball (flat, toe-off) never move. */
  _drift(f) {
    if (f.mode !== S_STANCE) return;
    const P = f.pitch, c = Math.cos(f.yaw), s = Math.sin(f.yaw), cp = Math.cos(P), sp = Math.sin(P), h = FOOT.h;
    const heelK = P > -1e-4 && f.pivot !== 1, ballK = P < 1e-4 && f.pivot !== 2;
    for (let k = 0; k < 2; k++) {
      if (k === 0 ? !heelK : !ballK) continue;
      const px = k === 0 ? FOOT.heel : FOOT.ball, fwd = px * cp + h * sp, up = px * sp - h * cp;
      const X = f.ax + c * fwd, Y = f.ay + up, Z = f.az + s * fwd;
      const ref = k === 0 ? f.heelRef : f.ballRef, has = k === 0 ? f.hasHeel : f.hasBall;
      if (!has) { ref[0] = X; ref[1] = Y; ref[2] = Z; if (k === 0) f.hasHeel = true; else f.hasBall = true; continue; }
      const d = Math.hypot(X - ref[0], Y - ref[1], Z - ref[2]);
      if (d > this.maxStanceDrift) this.maxStanceDrift = d;
    }
  }
}

/* ---------------- noise, PRNG, Bézier ---------------- */
function hash1(i) { let x = Math.imul(i | 0, 374761393) ^ 0x9e3779b9; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; }
/** Smooth value noise in [−1, 1]. */
export function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return (hash1(i) * (1 - u) + hash1(i + 1) * u) * 2 - 1;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const uniform = (rnd, a, b) => a + (b - a) * rnd();
/** Quadratic Bézier between a and b through control c, into out (V3-likes). */
export function qbez(a, c, b, t, out) {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
  out.z = u * u * a.z + 2 * u * t * c.z + t * t * b.z;
  return out;
}

/* ---------------- sim time and weapon edges (§4.1, §4.2): pure, so node can test the classification ---------------- */
/**
 * The sim's own dt this frame (Map 1 G4): the lastHurt delta (lastHurt counts up by the scaled dt, so hit-stop, slow-mo
 * and gameSpeed come for free), else the lastCombat delta, else (both were reset this frame) the previous frame's dt.
 * A non-finite lastHurt falls back to frameDt. Clamped to [0, 0.05]; 0 whenever update() didn't run.
 */
export function simDtFrom(prevLastHurt, prevLastCombat, lastSimDt, lastHurt, lastCombat, frameDt) {
  let d;
  if (!Number.isFinite(lastHurt)) d = frameDt || 0;
  else {
    const dH = lastHurt - (prevLastHurt || 0), dC = (Number.isFinite(lastCombat) ? lastCombat : 0) - (prevLastCombat || 0);
    d = dH >= 0 ? dH : dC >= 0 ? dC : lastSimDt || 0;
  }
  return Number.isFinite(d) ? clamp(d, 0, 0.05) : 0;
}
/**
 * The weapon edges of one frame (§4.2) from the previous frame's values `prev` {muzzle, reloadT, swapT, fireCd, weapon}
 * and the player `p` now; every field is guarded (undefined reloadMax, swapT, fireCd give no NaN). A reload that ends
 * is a NATURAL completion only when its last countdown fit in this frame's sim dt and nothing else ended it (no swap,
 * no shot): only that one may play the rack. Anything else (a swap, a hold-fire interrupt) is an interrupt.
 */
export function weaponEdges(prev, p, simDt, out = {}) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const rT = num(p.reloadT), rP = num(prev.reloadT), sT = num(p.swapT), sP = num(prev.swapT), rM = num(p.reloadMax);
  out.shot = num(p.muzzle) > num(prev.muzzle) + 1e-4;
  out.swapStart = sT > sP + 0.01;
  out.reloadStart = rT > 0 && rP <= 0;
  out.reloadCycle = rT > rP + 1e-3 && rP > 0;
  out.reloadEndNat = rP > 0 && rT <= 0 && rP <= num(simDt) + 0.002 && !out.swapStart && !out.shot;
  out.reloadInterr = rP > 0 && rT <= 0 && !out.reloadEndNat;
  out.dryFire = num(p.fireCd) > num(prev.fireCd) + 0.1 && !out.shot && num(p.mag) === 0;
  out.weaponJump = !!prev.weapon && !!p.weapon && p.weapon !== prev.weapon && !out.swapStart && !(sT > 0);
  out.f = rT > 0 && rM > 0 ? clamp(1 - rT / rM, 0, 1) : 0;
  return out;
}
/** A critically damped impulse response (a jolt): 0 at t ≤ 0, peaks at 1 when t = 1/ω, then settles. */
export function jolt(t, omega) { return t <= 0 ? 0 : omega * t * Math.exp(1 - omega * t); }
