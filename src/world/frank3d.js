// Frank in the 3D view: one articulated, skinned character built in code
// (frank3d-geo.js), driven every frame from the game's own state. Rendering
// only: nothing here changes the simulation (the single write is the render-side
// countdown of p.reachT, the exact mirror of render.js). NPCs and enemies keep
// the simple capsule rig in render3d.js.
//
// The per-frame pipeline (§4.0): signals and edges → clocks → layer states →
// facing (face, chest and hip springs, the twist budget) → locomotion (gait table,
// the world-space step planner) → the pose buffer, composed from its layers
// (C locomotion, U upper body, F full body, A additives, with snapshot crossfades)
// → FK → pelvis reach fix, leg IK (swivel clamp, joint limits), arm IK → props →
// secondary motion (coat pendulums, forelocks) → decal, uniforms, effect anchors,
// debug and safety. M2 (locomotion), M3 (weapons: the gun as the driver of the hands, convergence, recoil, actions,
// reloads, swaps, the sling, casings) and M4 (actions: the dash and back-hop, the strike and the takedown, the flinch and
// the revive, death with the dropped gun and the coat on the ground, repair, chop and pick with the tools in hand) live
// here and in frank3d-anim.js / frank3d-clips.js; M5 (life) adds its clips to the same layers.
import * as THREE from '../vendor/three.module.min.js';
import { G } from '../game/state.js';
import { derived } from '../game/progression.js';
import { TUNE, SOCKETS, STANCES, IDLE, AIM, RELAXED, GUN_POSES, HAND_ON, ACTIONS, RECOIL, SWAP, CASING, reloadKeys, breathCurve, gaitAt, makePlannerInput, gaitInputs,
  MELEE, TAKEDOWN, DODGE, FLINCH, REVIVE, DEATH, REPAIR, CHOP, PICK, FIDGETS, LIFE } from './frank3d-clips.js';
import {
  DEG, clamp, lerp, smoothstep as ss, wrap, angleDiff, makeSpring, resetSpring, springTo, springAngle, springPend, solveTwoBone, makeIKOut,
  StepPlanner, PK, makePose, poseRest, makeFade, fadeStart, fadeApply, poseBlend, reachDrop, twistAngle, noise1, SPRING_H, FOOT,
  EASE, sample, sampleV, qbez, simDtFrom, weaponEdges, jolt, mulberry32, uniform,
} from './frank3d-anim.js';
import { input } from '../input.js';
import { WEAPONS } from '../data/weapons.js';
import { ITEMS } from '../data/items.js';
import { SO } from './map.js';
import { frankAssets, FRANK_U, decalGeometry, decalMaterial, debrisAssets, dustMaterial, coneAssets, DECAL, PROP_NAMES, SKIRT6, SKIRT4, patchState, coatSurface } from './frank3d-geo.js';

export const FRANK_TOP = 75;
const LONG = { shotgun: 1, rifle: 1 }, LONG_LIST = ['shotgun', 'rifle'];

/* ---------------- module scratch (no per-frame allocation) ---------------- */
const V = () => new THREE.Vector3();
const _v1 = V(), _v2 = V(), _v3 = V(), _v4 = V(), _hip = V(), _ank = V(), _pole = V(), _tmp = V(), _ax2 = V();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _s1 = V(), _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const IK = makeIKOut();
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const L_THIGH = 18.0, L_SHIN = 15.9, LEG_REACH = 0.985 * (L_THIGH + L_SHIN);
// bone names per side, so the per-frame code never concatenates strings
const SIDES = [['L', -1], ['R', 1]];
const NM = {};
for (const [L] of SIDES) NM[L] = { clav: 'clav' + L, up: 'upperArm' + L, fo: 'forearm' + L, hand: 'hand' + L, thigh: 'thigh' + L, shin: 'shin' + L, foot: 'foot' + L };
const SUB_BONES = ['pistolSlide', 'pistolMag', 'shotgunForend', 'rifleBolt'];
const SKU = SKIRT6.map((_, k) => 'skU' + k), SKL = SKIRT6.map((_, k) => 'skL' + k), SK4 = SKIRT4.map((_, k) => 'sk' + k);
const FEET = ['footL', 'footR'], SHINS = ['shinL', 'shinR'], THIGHS = ['thighL', 'thighR'];
const ARM_R = { flex: 0, abd: 0, twist: 0, elbow: 0, wflex: 0, wdev: 0, wroll: 0 }, ARM_L = { ...ARM_R };
const WHITE = new THREE.Color(1, 1, 1);
// the held gun's frame in the hand (gun +X = hand −Y, +Y = hand +X, +Z = hand +Z), then the grip rake about gun Z
const HELD = (() => {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
  m.multiply(new THREE.Matrix4().makeRotationZ(SOCKETS.hand.rakeDeg * DEG));
  return m;
})();
// the per-frame pose buffers (§4.3): the composed pose, and the U and F layers' live outputs
const PB = makePose(), PU = makePose(), PF = makePose();
const PI = makePlannerInput();
const SC = TUNE.coat, LO = TUNE.loco;

let warnedPose = false, warnedNaN = false, SERIAL = 0;
const DBG = { pose: null, gizmos: false, resetStats: false, twistLog: null, fidget: null, contra: false, perfLog: null };

/* ---------------- rig ---------------- */
function coatState() { const f = () => new Float64Array(6); return { n: 0, a: f(), va: f(), b: f(), vb: f(), g: f(), vg: f(), aT: f(), aT2: f(), bT: f(), lo: f(), loG: f(), xs: f() }; }
function freshState() {
  return {
    lastTime: null, player: null, init: false, prevPos: [0, 0], prevLastHurt: 0, prevLastCombat: 0, lastSimDt: 0, prevPhase: 0, phaseRate: 0,
    prevMuzzle: 0, deadPrev: false, reachLeft: 0,
    vf: [0, 0], vfPrev: [0, 0], acc: [0, 0], speed: 0, moveYaw: 0, gaitOn: false, sprintW: 0, sinceSprint: 99, stillT: 0, movingT: 0,
    face: makeSpring(0), chest: makeSpring(0), hip: makeSpring(0), hipIdleT: 0, turning: false, turnT: 0, turnSide: 1, mode: 'idle', backpedal: false,
    gaitAmp: makeSpring(0), height: makeSpring(0), leanF: makeSpring(0), leanS: makeSpring(0), drop: makeSpring(0), hipYawPrev: 0, yawRate: 0, yawAcc: 0,
    planner: new StepPlanner(), stanceKey: 'relaxed', stanceT: 0, locoAt: 'idle',
    breathPh: 0, breathT: IDLE.breath.calm, breathA: IDLE.breath.amp.calm,
    aimW: 0, aimWe: 0, aimWb: 0, snapT: 9, snapFrom: 0, aimHold: 0, shotSeen: false, shotM0: 0.06, weaponHeld: null, lastLong: null, gunDriver: 'hand',
    deathT: 0, uFlash: 0, wet: 0, pipY: null,
    coat: coatState(), fl: [{ p: 0, vp: 0, r: 0, vr: 0 }, { p: 0, vp: 0, r: 0, vr: 0 }], headP: [0, 0, 0], headV: [0, 0, 0], headA: [0, 0, 0], headOk: 0, headYaw: 0, headYawV: 0, headYawA: 0,
    fadeF: makeFade(), fadeU: makeFade(), stateF: null, stateU: 'base', lastF: makePose(), lastU: makePose(),
    drift: [{ heel: [0, 0, 0], ball: [0, 0, 0], hasH: false, hasB: false, was: false }, { heel: [0, 0, 0], ball: [0, 0, 0], hasH: false, hasB: false, was: false }],
    maxStanceDrift: 0, planted: [true, true], ikBad: [0, 0], fkLeg: [false, false], fkW: [0, 0],
    resets: 0, ikFails: 0, contacts: 0, cpuMs: 0, maxHp: 100, maxSt: 100, derivedT: 0,
    // M2 fixes: the wall-push timer, the backpedal sign spring, the start's visual phase offset and σ ramp, the stop's
    // momentum pendulum, the map the player is on (a new map is a teleport), the foot-pop measurement
    wallT: 0, dirS: makeSpring(1), phOff: 0, startT: 9, stopP: makeSpring(0), stopLatch: false, absorbT: 0, mapRef: null,
    footPrev: [[0, 0, 0], [0, 0, 0]], footPrevOk: false, maxFootStep: 0, minPelvisY: 99, shoves: 0, bladeNow: 0,
    // M3 weapons: the previous frame's weapon fields (edges), the anim clock, the aim distance and convergence, the high
    // port, recoil carry, the pump/bolt action, dry fire, the slide lock, the reload chain, the swap, the slung gun, the
    // gun in spine2-local (a swap's snapshot), dropped magazines, debug counters
    prevReloadT: 0, prevSwapT: 0, prevFireCd: 0, prevWeapon: null, animClock: 0, shotWeapon: null, prevShotWeapon: null,
    aimD: TUNE.aimDist.fallback, muzzleFwd: 30, conv: 0, aimPitch: -7 * DEG, port: makeSpring(0), rcT: 99, rcCarry: {}, rcAmp: 1, rcYaw: 0, act: null, actEj: true, dryT: 9, slideLocked: false,
    rl: { on: false, gunCut: false, need: 0, kind: 'live', weapon: 'pistol', empty: false, cycle: 0, K: {}, f: 0, tau: 0, w: 0, hold: 0, tail: 0, tailT: 0, out: 0, entry: 0, dropped: false, ejected: false, rack: false },
    sw: { on: false, render: false, rT: 0, from: 'pistol', to: 'pistol', snapOk: false, snapP: V(), snapQ: new THREE.Quaternion(), relOk: false, relP: V(), relQ: new THREE.Quaternion() },
    slung: null, slung2: null, backSlot: [null, null], inHand: null, gunLW: null, gunLOk: false, gunLP: V(), gunLQ: new THREE.Quaternion(), lastRw: false, lastRwP: V(), lastRwQ: new THREE.Quaternion(),
    mags: [0, 1, 2].map(() => ({ on: false, t: 0, p: [0, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], bounced: false, rest: false, restT: 0, yaw: 0 })),
    debrisN: 0, wristMax: 0, wristSoft: 0, swivels: 0, elbowClamps: 0, shots: 0, wrist: [[0, 0, 0], [0, 0, 0]], reach: [0, 0],
    // M4 actions: the previous frame's action timers (edges); the clips (ph: 0 off, 1 live, 2 tail, 3 hold), their clocks,
    // catch-up clocks (cT, real seconds) and latches; the hit and the revive; the death template, its ground lift and the
    // dropped gun; the dust puff; the tool in hand and the gun's draw back; neutral-spot offsets for forced steps; the
    // arms' last local rotations (death blends out of the IK'd aim from them)
    prevMeleeAnim: 0, prevChopAnim: 0, prevDodgeT: 0, prevHp: null,
    mel: { ph: 0, conn: false, long: false, u: 0, tailT: 0, cT: 9 },
    td: { ph: 0, yaw: 0, long: false, u: 0, tailT: 0, cT: 9 },
    dg: { ph: 0, hop: false, dir: 0, rel: 0, lead: 0, u: 0, tailT: 0, placed: false, landed: false, skid: 0, skidT: 9, frozen: false, trailPlaced: false, noPush: false, lift: 0, need: [0, 0] },
    ch: { ph: 0, pick: false, yaw: 0, dist: 28, u: 0, tailT: 0, holdT: 0, cT: 9, chain: false },
    rp: { on: false, w: 0, kind: 'door', tx: 0, ty: 0, dist: 20, t: 0 },
    tool: null, drawStart: false, stowed: false, slingLow: 0,
    hurt: { t: 9, ang: 0, A: 0, kind: 'bullet', zone: 'front', s: 1 }, rev: 9, revFree: false, sinceRevive: 99, drawT: 0.25,
    dth: { variant: 'back', F: 0, f0: 0, h0: 0, c0: 0, sign: 1, lift: 0, relOk: false, rel: new THREE.Matrix4(), tool: null,
      gun: { on: false, w: 'pistol', t: 0, p: [0, 0, 0], v: [0, 0, 0], q: new THREE.Quaternion(), ax: V(), bounced: false, rest: false, restT: 0, q0: new THREE.Quaternion(), qRest: new THREE.Quaternion() } },
    dust: { t: 9, x: 0, z: 0, dir: 0, K: null, y: 1.2 }, nOff: [[0, 0], [0, 0]], nOffT: 0,
    armQ: [0, 1, 2, 3, 4, 5].map(() => new THREE.Quaternion()), armQok: false, handRPrev: V(), handRVel: V(), handRok: false,
    // M5 life: contrapposto, glances, fidgets, the stroll, carry, prowl, cover, low HP, hands on knees, gestures, items,
    // abilities, modal poses and the head look (lifeClocks)
    lf: lifeState(),
  };
}
function lifeState() {
  const rnd = mulberry32(0x5f3759df);
  return {
    rnd, c: { side: 1, x: 1, t: uniform(rnd, 3, 5), phase: 0, foot: -1, w: 0, fw: 0 },
    g: { ph: 0, t: 0, next: uniform(rnd, 1.5, 3), y0: 0, p0: 0, y1: 0, p1: 0, hold: 1, yaw: 0, pitch: 0 },
    pg: { ph: 0, t: 0, next: uniform(rnd, 5, 9), hold: 1.5, who: null, w: 0, yaw: 0 },
    fid: null, fu: 0, fw: 0, fT: uniform(rnd, LIFE.fidget.first[0], LIFE.fidget.first[1]), fidLast: null,
    stroll: 0, carry: 0, prowl: 0, cover: 0, coverLow: 1, coverSide: 1, coverT: 0, popT: 9, low: 0, beat: 0, beatPh: 0, hok: 0, hokOn: false, hokT: 0,
    reach: { on: false, t: 9, short: '', x: 0, y: 0, kneel: 9 }, talk: { on: false, x: 0, y: 0, w: 0, who: null, pollT: 0, frank: false, t: 0 },
    phone: 0, item: { t: 9, kind: 'eat' }, abil: { t: 9, id: '' }, steady: 9, modal: 0, modalKind: null, modalTool: null,
    prevCd: {}, prevMed: undefined, prevFood: 0, reachGate: 1, look: { y: makeSpring(0), p: makeSpring(0) }, eye: null, clock: 0,
  };
}
export function frankRig({ q, young, carry }) {
  const A = frankAssets(!!q, !!young);
  const g = new THREE.Group(); g.name = 'frank';
  const body = new THREE.Group(); g.add(body);
  const bones = {}, list = [];
  for (const b of A.bones) {
    // (the upper arms apply abduction, then flex, then a true twist about the arm's own axis: 'XZY'; at twist 0 it is the
    // same rotation as the other bones' 'YXZ')
    const bone = new THREE.Bone(); bone.name = b.name; bone.rotation.order = /^upperArm/.test(b.name) ? 'XZY' : 'YXZ';
    const par = b.parent ? A.bones.find((x) => x.name === b.parent) : null;
    bone.position.set(b.pos[0] - (par ? par.pos[0] : 0), b.pos[1] - (par ? par.pos[1] : 0), b.pos[2] - (par ? par.pos[2] : 0));
    bone.userData.bind = bone.position.clone();
    bone.userData.bindPos = b.pos; // body-space bind position (bonePoint)
    (par ? bones[b.parent] : body).add(bone);
    bones[b.name] = bone; list.push(bone);
  }
  body.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list, A.inverses.map((m) => m.clone()));
  const mesh = new THREE.SkinnedMesh(A.geometry, A.material);
  mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = !q;
  body.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
  // decal (rings, chevron, blob, foot patches), debris, dust, beam: world-space children of g
  const D = decalGeometry(!!q);
  const decal = new THREE.Mesh(D.geometry, decalMaterial()); decal.frustumCulled = false; decal.renderOrder = 1; decal.userData.layout = D; g.add(decal);
  const da = debrisAssets();
  const debris = new THREE.InstancedMesh(da.geometry, da.material, q ? 16 : 48); debris.count = 0; debris.visible = false; debris.frustumCulled = false; g.add(debris);
  debris.setColorAt(0, WHITE); // so prewarm compiles the instanceColor variant (the first casing must not compile a program mid-fight)
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3));
  const dust = new THREE.Points(dg, dustMaterial()); dust.visible = false; dust.frustumCulled = false; g.add(dust);
  let cone = null;
  if (!q) { const ca = coneAssets(); cone = new THREE.Mesh(ca.geometry, ca.material); cone.visible = false; cone.frustumCulled = false; g.add(cone); }
  // §1.7: a quality or prequel rebuild adopts the carried state as it is (springs, clocks, latches, the planner, the
  // crossfades), so the new rig continues the pose instead of snapping. The coat pendulums reset when the chain count
  // differs (6 on High, 4 on Low); the forelocks only exist on High.
  const st = carry ? Object.assign(freshState(), carry) : freshState();
  if (st.coat.n !== (q ? 4 : 6)) st.coat = coatState();
  const r = {
    g, body, mesh, skeleton, bones, decal, debris, dust, cone, kind: 'person', frank: true, q: !!q, young: !!young, ring: decal, st, assets: A,
    serial: ++SERIAL, gizmos: null, handLRef: [0, 0, 0],
    fx: { valid: false, aimed: false, muzzle: V(), bore: V(), flashPos: V(), flashSize: 18, lightOrigin: V(), lensOn: false, port: V(), weapon: 'pistol' },
    dispose() { if (r.gizmos) gizmos(r, false); skeleton.dispose(); decal.geometry.dispose(); debris.dispose(); dust.geometry.dispose(); },
  };
  r.handLRef = idleHandL(r);
  return r;
}
/** The left hand's spot (root frame) in the plain idle FK pose, without breath: the reference for frankDebug.handLMoved. */
function idleHandL(r) {
  const B = r.bones;
  B.pelvis.position.y += IDLE.pelvisDy;
  setSpine(B.pelvis, IDLE.lean * 0.3, 0, 0); setSpine(B.spine1, IDLE.lean * 0.3, 0, 0); setSpine(B.spine2, IDLE.lean * 0.4, 0, 0);
  B.clavL.rotation.set(0, rad(IDLE.clavProt), 0);
  setArm(r, 'L', -1, IDLE.armL);
  r.body.updateMatrixWorld(true);
  const out = bonePoint(r, 'handL', 0.3, 30, -11, _v1).toArray();
  resetBind(r); r.body.updateMatrixWorld(true);
  return out;
}

/* ---------------- helpers ---------------- */
const rad = (d) => d * DEG;
function setSpine(b, pitch, yaw, roll) { b.rotation.set(rad(roll), rad(-yaw), rad(-pitch)); }
function setArm(r, L, s, a) {
  const B = r.bones, n = NM[L];
  B[n.up].rotation.set(rad(-s * a.abd), rad(s * a.twist), rad(a.flex));
  B[n.fo].rotation.set(0, 0, rad(clamp(a.elbow, 0, 145)));
  B[n.hand].rotation.set(rad(clamp(a.wdev, -70, 70)), rad(clamp(a.wroll, -70, 70)), rad(clamp(a.wflex, -70, 70)));
}
/** World position of a bind-space point carried by a bone. */
function bonePoint(r, name, bx, by, bz, out) {
  const b = r.bones[name], bp = b.userData.bindPos;
  return out.set(bx - bp[0], by - bp[1], bz - bp[2]).applyMatrix4(b.matrixWorld);
}
function worldQuat(bone, out) { bone.matrixWorld.decompose(_s1, out, _tmp); return out; }
function hideProp(b) { b.position.set(0, 45, 0); b.quaternion.identity(); b.scale.set(0, 0, 0); }
function showPropAt(r, b, worldM) {
  // local = rootWorld⁻¹ × desired world (the root is never scaled)
  _m2.copy(r.bones.root.matrixWorld).invert().multiply(worldM);
  _m2.decompose(b.position, b.quaternion, b.scale); b.scale.set(1, 1, 1);
}
function resetSubBones(r) { for (const n of SUB_BONES) { const b = r.bones[n]; b.position.copy(b.userData.bind); b.quaternion.identity(); b.scale.set(1, 1, 1); } }
function resetBind(r) {
  for (const b of r.skeleton.bones) { b.position.copy(b.userData.bind); b.quaternion.identity(); b.scale.set(1, 1, 1); }
  for (const n of PROP_NAMES) hideProp(r.bones[n]);
  resetSubBones(r); // the sub-bones keep their bind offsets but ride hidden parents
}
function inCombat() {
  if (G.siegeActive) return true;
  const E = G.enemies || [];
  for (let i = 0; i < E.length; i++) { const e = E[i]; if (e.alerted && !e.dead && !e.retreating) return true; }
  return false;
}

/* ---------------- the per-frame update ---------------- */
export function poseFrank(r, p, ctx) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  try {
    update(r, p, ctx);
  } catch (e) {
    r.st.resets++; r.fx.valid = false; // never place the flash, tracers or flashlight from stale anchors
    if (!warnedPose) { warnedPose = true; console.warn('Frank pose error', e); }
    try { resetBind(r); r.body.position.set(p.x || 0, 0, p.y || 0); r.body.updateMatrixWorld(true); } catch { /* keep going */ }
    if (typeof location !== 'undefined' && String(location.search).includes('debug')) throw e;
  }
  if (t0) { const dt = performance.now() - t0; r.st.cpuMs = r.st.cpuMs ? r.st.cpuMs * 0.95 + dt * 0.05 : dt; if (DBG.perfLog && DBG.perfLog.length < 2000) DBG.perfLog.push(dt); }
}

// Signals of this frame (§4.2): one module-level struct, refilled every frame.
const WPREV = { muzzle: 0, reloadT: 0, swapT: 0, fireCd: 0, weapon: null }, WE = {};
const S = {
  now: 0, first: false, realDt: 0, simDt: 0, presentation: false, animDt: 0, liveDt: 0, adt: 0, jump: 0, teleport: false,
  shot: false, tShot: 99, hit: false, excess: 0, combat: false, weapon: 'pistol', long: false, dPhase: 0, gaitOn: false, wall: false,
  inputYaw: 0, lowHp: false, aimW: 0, aimWb: 0, supW: 1, blade: 0, faceYaw: 0, chestYaw: 0, hipYaw: 0, tau: 0, phi: 0, psi: 0, amp: 0, gs: 0,
  sigma: 0.5, back: false, strafeK: 0, dirSign: 1, crouch: false, breath: 0, bob: 0, counter: 0.6, skid: false,
  shove: false, shoveDrag: 0, stopK: 0, gsVis: 0, hardReset: false, chestRef: 0, chestLag: 0, flickK: 1, shotW: 0,
  reloadStart: false, reloadCycle: false, reloadEndNat: false, reloadInterr: false, swapStart: false, dryFire: false, weaponJump: false, threat: false,
  reach: false, aimWant: false,
};

function update(r, p, ctx) {
  const st = r.st, B = r.bones;
  if (DBG.resetStats) { DBG.resetStats = false; st.maxStanceDrift = 0; st.planner.maxStanceDrift = 0; st.maxFootStep = 0; st.minPelvisY = 99; }
  signals(r, p);
  actionEdges(r, p);
  aimDistance(r, p, ctx);
  clocks(r, p);
  states(r, p);
  gunClips(r, p);
  lifeClocks(r, p);
  facing(r, p);
  locomotion(r, p);
  // 6–9: compose the pose buffer from its layers
  poseRest(PB);
  layerC(r, p);
  layerU(r, p);
  lifePose(r, p);
  layerF(r, p);
  additives(r, p);
  headLook(r, p);
  // 10: FK (root → spine → head, clavicles, arms, FK legs)
  r.body.position.set(p.x, 0, p.y);
  writeFK(r);
  r.body.updateMatrixWorld(true);
  if (st.stateF === 'death') deathFK(r, p); // (the arms out of the aim, the ground clamp)
  if (st.stateF === 'dodge') dodgePlace(r, p); // (the dash's touchdowns; legs() clamps the FK feet above the ground)
  // 11: pelvis reach fix and leg IK onto the planner's feet; arm IK onto the gun
  legs(r, p); // (legs() updates the chains it changes)
  if (st.stateF === 'death') { deathClamp(r); deathHands(r); }
  // (M5) the right hand's life targets (the holster and the pockets, the knees): before the gun, which rides the hand
  lifeArms(r, p);
  // 11–12: the gun first (aim, relaxed, reload, swap), then the hands onto it, then the props (weapons() updates the
  // chains it moves)
  weapons(r, p);
  lifeProps(r, p);
  // (§6 chain-only matrix updates: the IK already updated the chains it moved; the props were only placed)
  for (let i = 0; i < PROP_NAMES.length; i++) B[PROP_NAMES[i]].updateMatrixWorld(true);
  // 13: secondary motion: the coat skirt's pendulums, the forelocks (then their chains only)
  coatSim(r, p);
  forelocks(r, p);
  const SKB = r.q ? SK4 : SKU;
  for (let i = 0; i < SKB.length; i++) B[SKB[i]].updateMatrixWorld(true);
  if (B.forelockA) { B.forelockA.updateMatrixWorld(true); B.forelockB.updateMatrixWorld(true); }
  // 15: decal, uniforms, blink, fx anchors, debug measurements, NaN guard
  measureDrift(r, p);
  updateDecal(r, p, ctx);
  dustUpdate(r);
  updateUniforms(r, p, ctx, S.realDt);
  if (DBG.gizmos !== !!r.gizmos) gizmos(r, DBG.gizmos);
  // the hurt blink (the invulnerability cue, gated: after a hit or a revive, never in a dodge, NEVER while he is down).
  // (Spec owner amendment to Appendix A: never during the first blinkHold s after a hit or reviveHold s after a revive,
  // so the flinch's peak and the stagger's drop are seen, and hidden one frame-window in three, not every other one)
  const hurtB = p.lastHurt >= TUNE.blinkHold && p.lastHurt < TUNE.blinkHurtWindow, revB = st.sinceRevive >= TUNE.reviveHold && st.sinceRevive < TUNE.reviveBlink;
  const blink = !p.dead && p.invuln > 0 && !((p.dodgeT || 0) > 0) && (hurtB || revB) && !(st.sinceRevive < TUNE.reviveHold) && Math.floor(S.now * TUNE.blinkHz) % 3 === 0;
  r.body.visible = !blink;
  // the arms' local rotations of this frame (a death blends out of the IK'd aim from them)
  if (!p.dead) { const A = st.armQ, B = r.bones; A[0].copy(B.upperArmL.quaternion); A[1].copy(B.forearmL.quaternion); A[2].copy(B.handL.quaternion); A[3].copy(B.upperArmR.quaternion); A[4].copy(B.forearmR.quaternion); A[5].copy(B.handR.quaternion); st.armQok = true; }
  fxAnchors(r, p, S.weapon);
  debrisUpdate(r, p);
  beam(r, p, ctx);
  if (!finiteRig(r)) {
    st.resets++;
    if (!warnedNaN) { warnedNaN = true; console.warn('Frank: non-finite transform, reset to bind'); }
    resetBind(r); hardReset(r, p); resetWeaponClips(st);
    st.pipY = null; r.fx.valid = false;
    if (!Number.isFinite(r.body.position.x) || !Number.isFinite(r.body.position.z)) r.body.position.set(0, 0, 0);
    r.body.updateMatrixWorld(true);
    fxAnchors(r, p, S.weapon); // the gun is hidden now: the anchors come out invalid
  }
  // overlay pips: low-passed hair top + 7 (a non-finite target never enters the filter)
  const ht = r.assets.hairTop;
  bonePoint(r, 'head', ht[0], ht[1], ht[2], _v4);
  const pipT = clamp(_v4.y + 7, 30, 84);
  if (Number.isFinite(pipT)) st.pipY = st.pipY === null || !Number.isFinite(st.pipY) || S.first ? pipT : st.pipY + (pipT - st.pipY) * (1 - Math.exp(-S.realDt / TUNE.pipLowPass));
  // remember for next frame
  const lh = p.lastHurt;
  st.prevPos[0] = p.x; st.prevPos[1] = p.y; st.prevLastHurt = Number.isFinite(lh) ? lh : st.prevLastHurt; st.prevLastCombat = p.lastCombat || 0;
  if (S.simDt > 0) st.lastSimDt = S.simDt;
  st.prevPhase = p.walkPhase || 0; st.deadPrev = !!p.dead; st.prevMuzzle = p.muzzle || 0;
  st.prevReloadT = p.reloadT || 0; st.prevSwapT = p.swapT || 0; st.prevFireCd = p.fireCd || 0; st.prevWeapon = S.weapon;
  st.prevMeleeAnim = p.meleeAnim || 0; st.prevChopAnim = p.chopAnim || 0; st.prevDodgeT = p.dodgeT || 0; st.prevHp = Number.isFinite(p.hp) ? p.hp : st.prevHp;
}

/** Teleports, recoveries, a new player, NaN: springs, planner, coat, velocity and hip yaw start over at the sim's pose. */
function hardReset(r, p) {
  const st = r.st, a = p.angle || 0;
  resetSpring(st.face, a); resetSpring(st.chest, a); resetSpring(st.hip, a); st.hipIdleT = a; st.turning = false; st.turnT = 0;
  resetSpring(st.gaitAmp, 0); resetSpring(st.height, 0); resetSpring(st.leanF, 0); resetSpring(st.leanS, 0); resetSpring(st.drop, 0);
  st.vf[0] = st.vf[1] = st.vfPrev[0] = st.vfPrev[1] = st.acc[0] = st.acc[1] = 0; st.speed = 0; st.gaitOn = false; st.phaseRate = 0;
  st.prevPhase = p.walkPhase || 0; st.hipYawPrev = a; st.yawRate = st.yawAcc = 0; st.backpedal = false; st.mode = 'idle';
  st.coat = coatState(); for (const f of st.fl) f.p = f.vp = f.r = f.vr = 0; st.headOk = 0;
  neutralFeet(st, p, a, 'relaxed');
  st.planner.reset(PI.neutral);
  for (const d of st.drift) { d.hasH = d.hasB = false; d.was = false; }
  st.ikBad[0] = st.ikBad[1] = 0; st.fkLeg[0] = st.fkLeg[1] = false; st.fkW[0] = st.fkW[1] = 0;
  st.wallT = 0; resetSpring(st.dirS, 1); st.phOff = 0; st.startT = 9; resetSpring(st.stopP, 0); st.stopLatch = false; st.absorbT = 0; st.footPrevOk = false;
  resetSpring(st.port, 0); st.lastRw = false; st.conv = 0;
}
/** A new player, a recovery or a NaN reset also drop the upper body's clips (a map change or a jump keeps a reload or a swap running: they are keyed on sim timers). */
function resetWeaponClips(st) {
  st.rl.on = false; st.sw.on = false; st.act = null; st.gunLOk = false;
  // (and the M4 actions: a recovery is a hard reset to idle; the dropped gun is picked up)
  st.mel.ph = st.td.ph = st.dg.ph = st.ch.ph = 0; st.mel.cT = st.td.cT = st.ch.cT = 9; st.rp.w = 0; st.rp.on = false;
  st.tool = null; st.drawStart = false; st.stowed = false; st.hurt.t = 9; st.rev = 9; st.dth.lift = 0; st.dth.gun.on = false; st.dth.relOk = false; st.dth.tool = null;
  st.nOffT = 0; st.dust.t = 9;
}

/* ---------------- 1. signals, edges (§4.1, §4.2) ---------------- */
// (the sim's step clock runs at 10 rad/s, 14 sprinting: a measured cadence above that plus a margin is a frame-timing artefact)
const PHASE_RATE_MAX = 16;
function signals(r, p) {
  const st = r.st;
  S.now = G.time || 0;
  S.first = !st.init || st.player !== p || st.lastTime === null;
  S.realDt = S.first ? 0 : clamp(S.now - st.lastTime, 0, 0.05);
  // a long render gap (the 2D shooting gallery: the rig isn't posed while it runs): a discontinuity, like a teleport (the
  // walkPhase and the ground gained in it are not this frame's motion; the clamped dt would read them as a sprint)
  S.gap = !S.first && S.now - st.lastTime > 0.25;
  st.lastTime = S.now;
  const lh = p.lastHurt;
  let simDt = simDtFrom(st.prevLastHurt, st.prevLastCombat, st.lastSimDt, lh, p.lastCombat, G.frameDt);
  S.simDt = simDt = S.first ? 0 : simDt;
  S.presentation = !G.paused && !!(G.modal || G.cutscene || G.sleeping || (G.transition && G.transition.kind !== 'defeat'));
  S.animDt = G.paused ? 0 : simDt > 0 ? simDt : S.presentation ? S.realDt : 0;
  S.liveDt = G.paused ? 0 : simDt > 0 ? simDt : S.presentation || p.dead ? S.realDt : 0;
  S.adt = S.animDt || S.liveDt;
  st.animClock += S.animDt;
  S.jump = Math.hypot(p.x - st.prevPos[0], p.y - st.prevPos[1]);
  const map = G.map || null, newMap = !S.first && st.mapRef !== map;
  st.mapRef = map;
  // a new map (loadMap) is a teleport whatever the distance
  S.teleport = S.first || S.jump > 48 || newMap || (p.dead !== st.deadPrev && !p.dead) || (S.gap && !p.dead);
  S.hardReset = S.first || (p.dead !== st.deadPrev && !p.dead);
  if (S.teleport) { st.player = p; st.init = true; hardReset(r, p); }
  if (S.hardReset) resetWeaponClips(st);
  // a recovery (dead → alive): the fatal hit left lastCombat at 0 and the sim stayed frozen through the hold, the modal and
  // the wake-up dialogue, so he would wake in the aim. Drop the aim latches and ignore that stale lastCombat (clocks).
  // A respawn with the revive's invulnerability (the prequels' TRY AGAIN, invuln 2) is a revive: its blink and stagger.
  if (S.hardReset && !S.first) {
    st.aimW = st.aimHold = st.aimWb = 0; st.snapT = 9; st.staleLC = p.lastCombat ?? 99; st.shotSeen = false; // (the frozen muzzle timer too)
    if ((p.invuln || 0) >= 2) { st.rev = 0; st.revFree = false; st.sinceRevive = 0; }
  }
  // a shove (a ram's 26 u push, a melee hit, a long gun's kick): the body moved further this frame than its own motion
  // explains. All but 5 u of it is a skid (the feet carried along: never drift, never a squat), and a corrective step
  // takes up the rest (frank3d-anim.js).
  // (on a hit frame the sim's clocks can't give the dt (lastHurt reset, lastCombat held at 0 in a firefight): his own
  // motion over the last frame's dt, so a walk isn't read as a push)
  const dtE = simDt > 0 ? simDt : Number.isFinite(lh) && lh < st.prevLastHurt - 1e-6 ? st.lastSimDt : 0;
  const vmax = Math.max(st.speed, Math.hypot(p.vx || 0, p.vy || 0)), excess = S.jump - vmax * dtE;
  S.excess = S.teleport ? 0 : Math.max(0, excess);
  S.shove = !S.teleport && !p.dead && !((p.dodgeT || 0) > 0) && excess > 4;
  S.shoveDrag = S.shove ? Math.max(0, excess - 5) / S.jump : 0;
  if (S.shove) st.shoves++;
  // max HP and stamina (derived() builds an object: refresh it twice a second, not every frame)
  st.derivedT -= S.realDt;
  if (st.derivedT <= 0 || S.first) {
    st.derivedT = 0.5;
    try { if (G.s) { const d = derived(); st.maxHp = d.maxHp || 100; st.maxSt = d.maxStamina || 100; } } catch { /* keep the last values */ }
  }
  // reach: the edge (the sim set reachT this frame), then the render-side countdown (exact mirror of render.js:1386), never
  // twice in one frame
  S.reach = !S.first && (p.reachT || 0) > st.reachLeft + 1e-4;
  if (S.realDt > 0 && (p.reachT || 0) > 0) p.reachT -= G.frameDt || 1 / 60;
  st.reachLeft = p.reachT || 0;
  // edges
  S.shot = !S.first && (p.muzzle || 0) > st.prevMuzzle + 1e-4;
  S.hit = !S.first && Number.isFinite(lh) && lh < st.prevLastHurt - 1e-6;
  S.weapon = p.weapon || 'pistol'; S.long = !!LONG[S.weapon];
  // the weapon edges (§4.2): shot, reload start / shell cycle / natural end / interrupt, swap, dry fire, a weapon jump
  WPREV.muzzle = st.prevMuzzle; WPREV.reloadT = st.prevReloadT; WPREV.swapT = st.prevSwapT; WPREV.fireCd = st.prevFireCd; WPREV.weapon = st.prevWeapon;
  weaponEdges(WPREV, p, simDt, WE);
  const ok = !S.first;
  S.reloadStart = ok && WE.reloadStart; S.reloadCycle = ok && WE.reloadCycle; S.reloadEndNat = ok && WE.reloadEndNat; S.reloadInterr = ok && WE.reloadInterr;
  S.swapStart = ok && WE.swapStart; S.dryFire = ok && WE.dryFire; S.weaponJump = ok && WE.weaponJump;
  if (S.shot) { st.shotSeen = true; st.shotM0 = S.weapon === 'shotgun' ? 0.09 : 0.06; st.prevShotWeapon = st.shotWeapon; st.shotWeapon = S.weapon; st.shots++; }
  S.tShot = st.shotSeen ? st.shotM0 - (p.muzzle || 0) : 99; // valid because the muzzle timer keeps counting below 0
  // the step clock: the sim advances walkPhase exactly while he walks (10 rad/s, 14 sprinting), so the gait runs on it
  S.dPhase = simDt > 0 && !S.teleport ? (p.walkPhase || 0) - st.prevPhase : 0;
  // (the cadence's low-pass is τ 0.05 s, not the spec's 0.1: the sim's step rate only ever jumps between 10 and 14, and the
  // slower filter lagged the sprint's swing timing by a step; a start locks onto the rate at once, below)
  if (S.dPhase > 1e-6 && simDt > 5e-4) {
    const pr = Math.min(PHASE_RATE_MAX, S.dPhase / simDt);
    st.phaseRate += (pr - st.phaseRate) * (1 - Math.exp(-simDt / 0.05));
  }
  // measured velocity (never the sim's p.vx/p.vy, which go stale in a dodge or against a wall)
  if (simDt > 5e-4 && !S.teleport && !S.hit && !(S.shot && S.weapon !== 'pistol') && !S.shove) {
    const vx = (p.x - st.prevPos[0]) / simDt, vy = (p.y - st.prevPos[1]) / simDt, k = 1 - Math.exp(-simDt / 0.06);
    st.vfPrev[0] = st.vf[0]; st.vfPrev[1] = st.vf[1];
    st.vf[0] += (vx - st.vf[0]) * k; st.vf[1] += (vy - st.vf[1]) * k;
    // acceleration: the second difference, EMA 30 ms, |a| ≤ 3000 u/s²
    let ax = (st.vf[0] - st.vfPrev[0]) / simDt, ay = (st.vf[1] - st.vfPrev[1]) / simDt;
    const al = Math.hypot(ax, ay); if (al > 3000) { ax *= 3000 / al; ay *= 3000 / al; }
    const ka = 1 - Math.exp(-simDt / 0.03);
    st.acc[0] += (ax - st.acc[0]) * ka; st.acc[1] += (ay - st.acc[1]) * ka;
  }
  if (S.presentation && simDt === 0) {
    const k = Math.exp(-S.realDt / 0.08); st.vf[0] *= k; st.vf[1] *= k; st.acc[0] *= k; st.acc[1] *= k;
  }
  st.speed = Math.hypot(st.vf[0], st.vf[1]);
  if (st.speed > 10) st.moveYaw = Math.atan2(st.vf[1], st.vf[0]);
  // gait on: the step clock ran this frame (held through a pause, never in presentation, death or dodge)
  if (simDt > 0) {
    const was = st.gaitOn;
    st.gaitOn = S.dPhase > 1e-6 && !p.dead && !((p.dodgeT || 0) > 0);
    if (st.gaitOn && !was && S.dPhase > 1e-6 && simDt > 5e-4) st.phaseRate = Math.min(PHASE_RATE_MAX, S.dPhase / simDt); // a start locks onto the cadence at once
  } else if (S.presentation || p.dead) st.gaitOn = false;
  S.gaitOn = st.gaitOn;
  // the wall push: the step clock runs but he isn't getting anywhere, for 0.12 s (a reversal passes through speed 0)
  st.wallT = S.gaitOn && st.speed < 15 ? st.wallT + S.animDt : 0;
  S.wall = st.wallT > 0.12;
  const ivx = p.vx || 0, ivy = p.vy || 0;
  S.inputYaw = Math.hypot(ivx, ivy) > 1 ? Math.atan2(ivy, ivx) : st.moveYaw;
  S.combat = inCombat();
  S.lowHp = !p.dead && p.hp > 0 && p.hp / st.maxHp < 0.3;
}

/* ---------------- 2. clocks ---------------- */
function clocks(r, p) {
  const st = r.st, adt = S.adt;
  if (S.hit) st.uFlash = TUNE.light.flash;
  else st.uFlash = Math.max(0, st.uFlash - (S.realDt / TUNE.light.flashT) * TUNE.light.flash);
  // weapons owned / held
  const inv = (G.s && G.s.inv) || {};
  if (S.long) st.lastLong = S.weapon;
  if (!st.lastLong || !(inv[st.lastLong] > 0)) st.lastLong = (inv.shotgun || 0) > 0 ? 'shotgun' : (inv.rifle || 0) > 0 ? 'rifle' : null;
  st.weaponHeld = S.weapon;
  // (the back sling's places: backSlots(), in weapons())
  // a threat: an enemy drawing a bead on him within 500
  S.threat = false;
  const E = G.enemies || [];
  for (let i = 0; i < E.length; i++) { const e = E[i]; if (e && !e.dead && (e.aimT || 0) > 0 && Math.hypot(e.x - p.x, e.y - p.y) < 500) { S.threat = true; break; } }
  // aim weight (§4.4 AIM/RELAXED): up in 0.18 s, instantly on a shot; held 0.4 s, then down over 0.6 s
  // (the lastCombat a recovery woke up with is the fatal fight's: ignored while it keeps counting on from there, until it
  // is past the 4 s or a new fight resets it below it, or a hit or a shot)
  const lc = p.lastCombat ?? 99;
  if (st.staleLC != null && (lc < st.staleLC - 1e-6 || lc >= 4 || S.hit || S.shot)) st.staleLC = null;
  const aimWant = !p.dead && (S.combat || (lc < 4 && st.staleLC == null) || S.tShot < 0.5 || (p.reloadT || 0) > 0 || (p.swapT || 0) > 0 ||
    !!input.held.fire || !!(input.aim && input.aim.active) || S.threat);
  // A shot from the relaxed carry (a draw-fire) puts the GUN on the aim line that frame (aimW = 1: the gun and the hands
  // on it), but the BODY comes in under it (aimWb: the blade, the crouch, the chest and the cheek weld) over TUNE.drawSnap.T
  // with an ease-out, so the arms whip out from a still-square torso and the torso turns in under them; the support hand
  // slaps on just behind the gun (supW). (§4.4 'instantly on a shot' applies to the gun.)
  const DS = TUNE.drawSnap;
  if (p.dead) { st.aimW = 0; st.aimHold = 0; st.aimWb = 0; st.snapT = 9; }
  else if (S.shot) { if (st.aimW < 0.5) { st.snapT = 0; st.snapFrom = st.aimWb; } st.aimW = 1; st.aimHold = 0.4; }
  else if (aimWant) { st.aimW = Math.min(1, st.aimW + adt / 0.18); st.aimHold = 0.4; }
  else if (st.aimHold > 0) st.aimHold -= adt;
  else st.aimW = Math.max(0, st.aimW - adt / 0.6);
  // (M4) a tool in his hands (the hammer, the axe) has put the gun away: no aim until a shot draws it; a revive's stagger
  // caps the aim for its first 0.3 s (a shot overrides)
  if ((st.tool || (st.rp.on && st.rp.w > 0)) && !S.shot) { st.aimW = Math.max(0, st.aimW - adt / 0.15); st.aimHold = 0; }
  if (st.rev < REVIVE.aimCapT && !S.shot && !st.revFree) st.aimW = Math.min(st.aimW, REVIVE.aimCap);
  // (M5 fix) a stroll's pistol under the coat: an aim without a shot waits for the hand to bring it out of the holster
  // (lifeClocks runs the holster path back quickly); a shot draws it on the aim line at once
  S.aimWant = aimWant;
  if (st.lf.stroll >= LIFE.stroll.holHide && !S.shot && !p.dead) { st.aimW = 0; st.aimHold = Math.max(st.aimHold, aimWant ? 0.4 : 0); }
  if (st.snapT < 9 && !S.shot) st.snapT += adt;
  const snapU = clamp(st.snapT / DS.T, 0, 1);
  st.aimWb = st.snapT < DS.T ? Math.min(st.aimW, lerp(st.snapFrom, 1, EASE.O(snapU))) : st.aimW;
  S.supW = st.snapT < DS.support ? EASE.O(clamp(st.snapT / DS.support, 0, 1)) : 1;
  S.aimW = st.aimW < 1 && !aimWant ? ss(0, 1, st.aimW) : st.aimW;
  S.aimWb = st.aimWb < 1 && !aimWant ? ss(0, 1, st.aimWb) : st.aimWb;
  st.aimWe = S.aimW;
  // blade: the chest turns right of the aim (relaxed long guns keep a slight blade)
  S.blade = lerp(S.long ? TUNE.blade.relaxedLong : 0, TUNE.blade[S.weapon] || TUNE.blade.pistol, S.aimWb);
  st.bladeNow = S.blade;
  // sprint: the step clock at the sprint rate; its gait column cross-fades in over 0.18 s
  const sprint = S.gaitOn && st.phaseRate > 12;
  st.sprintW = clamp(st.sprintW + (sprint ? 1 : -1) * S.animDt / 0.18, 0, 1);
  if (sprint) st.sinceSprint = 0; else st.sinceSprint += S.liveDt;
  if (S.gaitOn) { st.movingT += S.animDt; st.stillT = 0; } else { st.stillT += S.adt; st.movingT = 0; }
  // breath period and depth (§4.7), eased so a change of state never pops
  const BR = IDLE.breath;
  let Tb = BR.calm, ab = BR.amp.calm;
  if ((p.lastCombat ?? 99) < 8) { Tb = BR.combat; ab = BR.amp.exerted; }
  if ((p.stamina ?? st.maxSt) / st.maxSt < 0.35 || st.sinceSprint < 2) { Tb = BR.winded; ab = BR.amp.exerted; }
  if ((p.steadyT || 0) > 0) { Tb = BR.steady; ab = BR.amp.steady; }
  if (st.lf.hok > 0.5) Tb = BR.hok; // (hands on knees: heaving, a breath a second)
  if (S.lowHp) { Tb /= BR.lowHpDiv; ab = BR.amp.lowHp; }
  const kb = 1 - Math.exp(-S.liveDt / 0.5);
  st.breathT += (Tb - st.breathT) * kb; st.breathA += (ab - st.breathA) * kb;
  if (!p.dead) st.breathPh = (st.breathPh + S.liveDt / st.breathT) % 1;
  S.breath = p.dead ? 0 : breathCurve(st.breathPh) * st.breathA;
}

/* ---------------- 3. layer states (§4.4) ---------------- */
// F (full body), highest first: DEATH > DODGE(+tail) > TAKEDOWN(+tail) > REPAIR > CHOP/PICK(+tail). Each clip blends itself
// in and out over its own envelope (its in/out times); a switch from one clip straight to another (or a cancel: a shot
// ends the dodge's tail or the chop) crossfades from the layer's last output over 0.06 s. Death enters with a jerk (no
// fade: the arms blend out of the aim on the bones, deathFK) and leaves by a snap (the recovery is a hard reset). U: MELEE
// over the AIM/RELAXED base.
function states(r, p) {
  const st = r.st, D = st.dg, C = st.ch;
  let f = null;
  if (p.dead) f = 'death';
  else if (D.ph === 1 || D.ph === 2) f = 'dodge';
  else if (st.td.ph === 1 || st.td.ph === 2) f = 'takedown';
  else if (st.rp.w > 0) f = 'repair';
  else if (C.ph === 1 || C.ph === 2) f = C.pick ? 'pick' : 'chop';
  else if (st.lf.modal > 0) f = 'modal'; // (M5: fishing, crafting, cooking; LV.modal is its own envelope)
  if (f !== st.stateF) {
    st.fadeFreal = false;
    if (S.teleport || f === 'death' || st.stateF === 'death') st.fadeF.active = false; // death: a jerk in, a snap out
    else if (st.stateF) fadeStart(st.fadeF, st.lastF, 0.06); // clip → clip, or a cancel
    else if (f === 'takedown' || f === 'chop') { fadeStart(st.fadeF, st.lastF, 0.4 * TUNE.catchUp); st.fadeFreal = true; } // the catch-up's first leg
    else st.fadeF.active = false; // from the base: the clip's own envelope
    if (f === 'death') deathStart(r, p);
    st.stateF = f;
  }
  const u = st.mel.ph ? 'melee' : 'base';
  if (u !== st.stateU) {
    // a connected strike crossfades from the snapshot on real time (the catch-up's first leg); a whiff starts on its key
    st.fadeUreal = u === 'melee' && st.mel.conn;
    if (st.fadeUreal) fadeStart(st.fadeU, st.lastU, 0.4 * TUNE.catchUp); else st.fadeU.active = false;
    st.stateU = u;
  }
  if (p.dead) st.deathT += G.paused ? 0 : S.realDt;
}

/* ======================= M4: action edges and clip clocks (§4.2, §4.12–§4.17) ======================= */
// The clips are keyed on the sim's own timers (meleeAnim, dodgeT, chopAnim: hit-stop freezes them at the impact), their
// tails and catch-ups on render/real time. Values of this frame (time only, no bones) go to MC (melee), TC (takedown)
// and the per-clip structs in st; the poses read them in layerU / layerF, the gun and the hands in weapons().
const MC = { w: 0, gw: 0, lunge: 0, cu: 1, conn: false, long: false, live: new Array(9).fill(0), wind: new Array(9).fill(0), cur: new Array(9).fill(0), guardW: 0, s2Pitch: 0, snap: 0 };
const TC = { w: 0, gw: 0, cu: 1, long: false, gun: [0, 0, 0, 0], body: [0, 0, 0, 0], collarW: 0, collar: [0, 0, 0] };
const _mk = new Array(8).fill(0), _tk = [0, 0, 0, 0], _tb = [0, 0, 0, 0];
function nearFire(p) { const F = G.fires || []; for (let i = 0; i < F.length; i++) { const f = F[i]; if (f && Math.hypot(f.x - p.x, f.y - p.y) < (f.r || 30) + 20) return true; } return false; }
/** The catch-up (§4.3, D14): from the snapshot through the raised key (40%) to the live key, on real time; returns [0, 1]. */
const catchU = (cT) => clamp(cT / TUNE.catchUp, 0, 1);
/** A forced step of foot i by (dx, dz) along the ground, held there for `hold` s (the settle step brings it back after). */
function lungeStep(st, i, dx, dz, dur, lift, hold) {
  const PL = st.planner, f = PL.feet[i];
  if (!PL.planted(0) || !PL.planted(1) || S.gaitOn) return false;
  const n = [f.plant[0] + dx, f.plant[1] + dz, f.plantYaw, f.toeOff];
  if (!PL.forceStep(i, n, dur, lift)) return false;
  st.nOff[i][0] = dx; st.nOff[i][1] = dz; st.nOff[1 - i][0] = st.nOff[1 - i][1] = 0; st.nOffT = hold;
  return true;
}
function actionEdges(r, p) {
  const st = r.st, live = !S.first && !p.dead, adt = S.adt, cdt = G.paused ? 0 : S.realDt;
  const mA = p.meleeAnim || 0, cA = p.chopAnim || 0, dT = p.dodgeT || 0, a = p.angle || 0;
  // ---- a hit (§4.15): how hard, from where (G.hurtDir is current this frame: we poll after update), what kind; a revive
  const H = st.hurt;
  if (S.hit) {
    const amt = Math.max(0, (Number.isFinite(st.prevHp) ? st.prevHp : p.hp) - (p.hp || 0));
    H.t = 0; H.step2 = false; H.ang = G.hurtDir && Number.isFinite(G.hurtDir.angle) ? G.hurtDir.angle : a; H.A = clamp(amt / 30, 0.35, 1);
    // (classified on the push beyond his own motion, S.excess: at 30 fps or less a plain walk moves him 4–6 u a frame, which
    // the spec's raw-jump bands read as a bite; §4.2 amended)
    H.kind = S.excess >= 15 ? 'ram' : S.excess >= 3 && S.excess <= 9 ? 'bite' : nearFire(p) ? 'fire' : 'bullet';
    const rel = angleDiff(st.chest.x, H.ang), ar = Math.abs(rel);
    H.zone = ar < 60 * DEG ? 'front' : ar <= 120 * DEG ? 'side' : 'back'; H.s = rel >= 0 ? 1 : -1;
    if (!p.dead && (p.invuln || 0) >= 2) { st.rev = 0; st.revFree = false; st.sinceRevive = 0; st.planner.kick = true; } // (one corrective step)
  }
  const tdt = G.paused ? 0 : S.simDt > 0 ? S.simDt : S.realDt;
  H.t += adt; st.rev += adt; st.sinceRevive += tdt;
  // ---- melee: a strike (meleeAnim 0.18) or a takedown (0.25)
  const M = st.mel, T = st.td;
  if (live && mA > st.prevMeleeAnim + 0.01) {
    if (mA >= 0.22) {
      T.ph = 1; T.yaw = a; T.long = S.long; T.cT = cdt; T.u = 0; M.ph = 0;
      const k = TAKEDOWN.step; lungeStep(st, 0, k * Math.cos(a), k * Math.sin(a), TAKEDOWN.stepT, 2, TAKEDOWN.T + TAKEDOWN.tail + 0.15);
    } else {
      M.ph = 1; M.conn = !!(G.fx && G.fx.stop > 0.02); M.long = S.long; M.cT = M.conn ? cdt : 9; M.u = 0;
      const k = MELEE.step; lungeStep(st, 0, k * Math.cos(a), k * Math.sin(a), MELEE.stepT, MELEE.stepLift, MELEE.T + MELEE.tail + 0.15);
    }
  } else { if (M.cT < 9) M.cT += cdt; if (T.cT < 9) T.cT += cdt; }
  if (M.ph === 1) { M.u = clamp(1 - mA / MELEE.T, 0, 1); if (mA <= 0) { M.ph = 2; M.tailT = 0; } }
  else if (M.ph === 2) { M.tailT += adt; if (M.tailT >= MELEE.tail) M.ph = 0; }
  if (T.ph === 1) { T.u = clamp(1 - mA / TAKEDOWN.T, 0, 1); if (mA <= 0) { T.ph = 2; T.tailT = 0; } }
  else if (T.ph === 2) { T.tailT += adt; if (T.tailT >= TAKEDOWN.tail) T.ph = 0; }
  if (p.dead) M.ph = T.ph = 0;
  // ---- dodge: a dash (forward and side) or a back-hop (backward, and the no-input default)
  const D = st.dg;
  if (live && dT > st.prevDodgeT + 0.01) {
    // a dodge mashed inside the last one's tail (the sim has no cooldown) crossfades from the tail's pose: the new clip's
    // keys start at the rest pose (§4.3)
    if (D.ph !== 0) { fadeStart(st.fadeF, st.lastF, 0.06); st.fadeFreal = false; }
    D.ph = 1; D.dir = Math.atan2(p.dodgeDy || 0, p.dodgeDx || 0); D.rel = angleDiff(a, D.dir); D.hop = Math.abs(D.rel) >= DODGE.hopFrom * DEG;
    D.lead = D.rel > 20 * DEG ? 1 : 0; D.u = 0; D.placed = false; D.landed = false; D.skid = 0; D.skidT = 9; D.tailT = 0; D.frozen = false; D.trailPlaced = false;
    // the push-off foot is the one on the ground: out of a run, a forward dash leads with the swinging foot; with neither
    // planted (a sprint's float) both legs go FK at once
    const PL = st.planner, p0 = PL.planted(0), p1 = PL.planted(1);
    if (!D.hop && Math.abs(D.rel) < 45 * DEG && p0 !== p1) D.lead = p0 ? 1 : 0;
    D.noPush = !D.hop && !PL.planted(1 - D.lead);
  }
  if (D.ph === 1) { D.u = clamp(1 - dT / DODGE.T, 0, 1); if (dT <= 0) { D.ph = 2; D.tailT = 0; } }
  else if (D.ph === 2) { D.tailT += adt; if (D.tailT >= DODGE.tail) D.ph = 0; }
  if (D.ph === 2 && S.shot) D.ph = 0; // a shot cancels the tail at once
  if (p.dead) D.ph = 0;
  // ---- chop (axe) / pick: the knock is on the trigger frame
  const C = st.ch;
  if (live && cA > st.prevChopAnim + 0.01) {
    const axe = cA >= 0.225, tg = G.interactTarget;
    let tx = p.x + 20 * Math.cos(a), ty = p.y + 20 * Math.sin(a);
    if (tg && Number.isFinite(tg.x) && Number.isFinite(tg.y)) { tx = tg.x; ty = tg.y; }
    const d = Math.hypot(tx - p.x, ty - p.y);
    C.chain = axe && C.ph >= 1 && !C.pick; // mashing: from wound-up to the contact
    C.ph = 1; C.pick = !axe; C.yaw = d > 4 ? Math.atan2(ty - p.y, tx - p.x) : a; C.dist = d; C.u = 0; C.cT = axe ? cdt : 9; C.tailT = 0;
    if (axe) { st.tool = 'axe'; st.stowed = true; st.drawStart = false; if (st.sw.on && st.sw.render) st.sw.on = false; }
  } else if (C.cT < 9) C.cT += cdt;
  if (C.ph === 1) { C.u = clamp(1 - cA / (C.pick ? PICK.T : CHOP.T), 0, 1); if (cA <= 0) { C.ph = 2; C.tailT = 0; } }
  else if (C.ph === 2) { C.tailT += adt; if (C.tailT >= (C.pick ? PICK.rise : CHOP.tail)) { if (C.pick) C.ph = 0; else { C.ph = 3; C.holdT = 0; } } }
  else if (C.ph === 3) { C.holdT += adt; if (C.holdT >= CHOP.hold) { C.ph = 0; if (st.tool === 'axe') { st.tool = null; st.drawStart = true; st.drawT = CHOP.draw; } } }
  // ---- repair (G.repairHold): the target (a door or window cell, or the nearest phone pole), in 0.15 s, out 0.15 + a draw
  const RP = st.rp, rh = G.repairHold;
  const was = RP.w;
  RP.on = !!rh && !p.dead;
  if (RP.on) {
    RP.t = rh.t || 0;
    const tgt = rh.target;
    RP.kind = rh.kind === 'phone' ? 'phone' : rh.kind === 'window' ? 'window' : 'door';
    if (tgt && Number.isFinite(tgt.cx)) { RP.tx = tgt.cx * 32 + 16; RP.ty = tgt.cy * 32 + 16; }
    else if (was <= 0) {
      let best = Infinity; RP.tx = p.x + 20 * Math.cos(a); RP.ty = p.y + 20 * Math.sin(a);
      for (const pr of (G.map && G.map.props) || []) { if (pr.kind !== 'phonepole') continue; const d = Math.hypot(pr.x - p.x, pr.y - p.y); if (d < best) { best = d; RP.tx = pr.x; RP.ty = pr.y; } }
    }
    RP.dist = Math.hypot(RP.tx - p.x, RP.ty - p.y);
    // the left foot steps 4 toward the opening as he squares up to it, and stays there while he works
    if (was <= 0) { const y = Math.atan2(RP.ty - p.y, RP.tx - p.x); RP.step = lungeStep(st, 0, 4 * Math.cos(y), 4 * Math.sin(y), 0.2, 2, 0.4); }
    else if (RP.step) st.nOffT = Math.max(st.nOffT, 0.3);
  }
  RP.w = clamp(RP.w + (RP.on ? 1 : -1) * adt / (RP.on ? REPAIR.in : REPAIR.out), 0, 1);
  // each blow lands on the phase's wrap (the 'hammer' sfx): a puff of wood chips at the strike point
  if (RP.on && RP.kind !== 'phone' && st.tool === 'hammer') {
    const k = Math.floor(RP.t * REPAIR.rate);
    if (RP.blow !== undefined && k > RP.blow) {
      const y = Math.atan2(RP.ty - p.y, RP.tx - p.x), Hx = clamp(RP.dist - REPAIR.faceBack, 11, 20) + 2, c = Math.cos(y), s = Math.sin(y);
      startDust(st, p.x + c * Hx - s * REPAIR.z, p.y + s * Hx + c * REPAIR.z, y + Math.PI, REPAIR.chips, REPAIR.y[RP.kind] || 44);
    }
    RP.blow = k;
  } else RP.blow = undefined;
  // the hammer comes out at the in-blend's midpoint and goes away at the out-blend's; then the gun is drawn
  if (RP.on && RP.w >= 0.5 && st.tool !== 'hammer' && st.tool !== 'splice') { st.tool = RP.kind === 'phone' ? 'splice' : 'hammer'; st.stowed = true; st.drawStart = false; C.ph = C.ph === 3 ? 0 : C.ph; }
  if (!RP.on && (st.tool === 'hammer' || st.tool === 'splice') && RP.w < 0.5) { st.tool = null; st.drawStart = true; st.drawT = REPAIR.draw; }
  if (p.dead) { RP.w = 0; RP.on = false; }
  // ---- a shot draws the gun on the aim line THAT frame: the axe vanishes, the chop and its tail end (§4.4)
  if (S.shot) {
    if (C.ph) C.ph = 0;
    M.ph = T.ph = 0; // (a shot during a strike or a takedown: the gun is back on the aim line for the flash)
    // (every tool goes: a shot in the repair's out-blend (the sim interrupts the repair, then fires the next tick) has the
    // gun on the aim line too, and the out-blend ends with it)
    if (st.tool) st.tool = null;
    if (!RP.on) RP.w = 0;
    st.drawStart = false;
    // (a shot inside a revive's stagger frees the aim for the rest of the cap window, §4.15)
    if (st.rev < REVIVE.aimCapT) st.revFree = true;
  }
  st.stowed = !!st.tool || (st.rp.w >= 0.5 && st.rp.on);
  meleeValues(st);
  takedownValues(st);
}
/** The melee strike's values this frame (§4.12): the keys (connected: contact on frame 0 after the catch-up; whiff: mid-swing), the tail. */
function meleeValues(st) {
  const M = st.mel;
  MC.w = 0; MC.gw = 0; MC.guardW = 0; MC.s2Pitch = 0; MC.lunge = 0; MC.cu = 1;
  if (!M.ph) return;
  const K = M.long ? MELEE.long : MELEE.pistol, u = M.ph === 1 ? M.u : 1;
  MC.conn = M.conn; MC.long = M.long;
  sampleV(M.conn ? K.hit : K.whiff, u, MC.live);
  for (let i = 0; i < 9; i++) MC.wind[i] = K.windup[i];
  MC.cu = M.conn ? catchU(M.cT) : 1;
  // the catch-up: the raised (wind-up) key, then on to the live key
  const c = MC.cu, k = c < 0.4 ? 0 : ES((c - 0.4) / 0.6);
  for (let i = 0; i < 9; i++) MC.cur[i] = lerp(MC.wind[i], MC.live[i], k);
  // the hit-stop freezes the contact (the sim holds meleeAnim): it shakes there (the spine and the fist)
  if (M.conn && M.ph === 1 && G.fx && G.fx.stop > 0 && c >= 1) {
    const SH = MELEE.shake, ph = 2 * Math.PI * SH.hz * S.now;
    MC.cur[5] += SH.yaw * Math.sin(ph); MC.cur[0] += SH.hand * Math.sin(ph + 1.3); MC.cur[2] += SH.hand * Math.cos(ph * 1.13);
  }
  MC.w = M.ph === 2 ? 1 - ES(clamp(M.tailT / MELEE.tail, 0, 1)) : 1;
  MC.gw = MC.w * (M.conn ? ES(clamp(c / 0.4, 0, 1)) : 1); // (the gun's own snapshot leg: from the base gun to the wind-up)
  // (the guard comes up with the catch-up on a connected blow, over the first 0.15 of a whiff: at full weight on the edge
  // frame the left hand jumped from the gun to the chin in one frame)
  MC.guardW = M.long ? 0 : MC.w * (M.ph === 1 ? (M.conn ? Math.max(ES(MC.cu), ss(0, 0.15, u)) : ss(0, 0.15, u)) : 1);
  const uc = M.conn ? Math.max(0.15, u) : u;
  MC.s2Pitch = sample(MELEE.s2Pitch, uc) * MC.w; MC.lunge = sample(MELEE.lunge, uc) * MC.w;
  // the snap at the contact: the head drives in, the right shoulder drops (over the first snap.T of real time after it)
  const ct = M.conn ? Math.max(0, M.cT - TUNE.catchUp) : u * MELEE.T - 0.22 * MELEE.T;
  MC.snap = ct >= 0 ? Math.sin(Math.PI * clamp(ct / MELEE.snap.T, 0, 1)) * MC.w : 0;
}
/** The takedown's values this frame (§4.13): contact on frame 0 after the catch-up through the raised key. */
function takedownValues(st) {
  const T = st.td;
  TC.w = 0; TC.gw = 0; TC.collarW = 0;
  if (!T.ph) return;
  const K = T.long ? TAKEDOWN.long : TAKEDOWN.pistol, u = T.ph === 1 ? T.u : 1;
  TC.long = T.long; TC.cu = catchU(T.cT);
  sampleV(K.keys, u, _tk); sampleV(TAKEDOWN.body.keys, u, _tb);
  const c = TC.cu, k = c < 0.4 ? 0 : ES((c - 0.4) / 0.6);
  for (let i = 0; i < 4; i++) { TC.gun[i] = lerp(K.raised[i], _tk[i], k); TC.body[i] = lerp(TAKEDOWN.body.raised[i], _tb[i], k); }
  // the hit-stop holds the contact (the sim freezes meleeAnim): it shakes there
  if (T.ph === 1 && G.fx && G.fx.stop > 0 && c >= 1) { const SH = TAKEDOWN.shake, ph = 2 * Math.PI * SH.hz * S.now; TC.body[1] += SH.pitch * Math.sin(ph); TC.gun[1] += SH.hand * Math.sin(ph + 1.1); }
  TC.w = T.ph === 2 ? 1 - ES(clamp(T.tailT / TAKEDOWN.tail, 0, 1)) : 1;
  TC.gw = TC.w * ES(clamp(c / 0.4, 0, 1));
  // the left hand on his collar from the contact to u .5, back on the gun by 1; it hauls him back onto the blow over u 0–.2
  const cl = TAKEDOWN.collarL, pull = TAKEDOWN.collarPull * ES(clamp(u / 0.2, 0, 1));
  TC.collar[0] = cl[0] - pull; TC.collar[1] = cl[1] + 0.3 * pull; TC.collar[2] = cl[2];
  TC.collarW = T.ph === 1 ? (u < TAKEDOWN.collarTo ? 1 : 1 - ES((u - TAKEDOWN.collarTo) / (1 - TAKEDOWN.collarTo))) * ss(0, 0.6, c) : 0;
}

/* ---------------- aim distance D (§4.2): the mouse point on the y 30 plane, else the nearest enemy ahead, else 220 ---------------- */
const _ndc = V(), _camP = V();
function aimDistance(r, p, ctx) {
  const st = r.st, AD = TUNE.aimDist, cam = ctx && ctx.camera;
  let D = AD.fallback;
  if (!input.touchMode && !input.padMode && input.mouse && input.mouse.inside && cam && G.view && G.view.w > 0) {
    _ndc.set(input.mouse.x / G.view.w * 2 - 1, -(input.mouse.y / G.view.h * 2 - 1), 0.5).unproject(cam);
    _camP.setFromMatrixPosition(cam.matrixWorld); _ndc.sub(_camP);
    if (_ndc.y < -1e-6) { const t = (30 - _camP.y) / _ndc.y; D = Math.hypot(_camP.x + _ndc.x * t - p.x, _camP.z + _ndc.z * t - p.y); }
  } else {
    const E = G.enemies || [], a = p.angle || 0;
    let best = Infinity;
    for (let i = 0; i < E.length; i++) {
      const e = E[i]; if (!e || e.dead || e.gone || (e.def && e.def.vehicle)) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < 460 && d < best && Math.abs(angleDiff(a, Math.atan2(e.y - p.y, e.x - p.x))) < 1.2) best = d;
    }
    if (best < Infinity) D = best;
  }
  D = clamp(Number.isFinite(D) ? D : AD.fallback, AD.min, AD.max);
  st.aimD = S.first || !Number.isFinite(st.aimD) ? D : st.aimD + (D - st.aimD) * (1 - Math.exp(-S.liveDt / 0.1));
}

/* ---------------- 4. facing: face → chest → hips, the twist budget (§4.5) ---------------- */
/**
 * The planted feet hold the hips: never more than `lim`° off the yaw a planted foot implies (its yaw less its toe-out), so a
 * sharp cut, a reversal or a flick never twists a leg round; the feet pivot and step after the hips (frank3d-anim.js).
 * Returns true when it held them.
 */
function holdHips(st, lim, dt) {
  const PL = st.planner, L = lim * DEG;
  let lo = -Infinity, hi = Infinity, n = 0, sum = 0;
  for (let i = 0; i < 2; i++) {
    if (!PL.planted(i)) continue;
    const rel = wrap(PL.bodyYaw(i) - st.hip.x);
    lo = Math.max(lo, rel - L); hi = Math.min(hi, rel + L); sum += rel; n++;
  }
  if (!n) return false;
  // (two planted feet further apart than 2·lim: ease toward their middle instead)
  const d = lo > hi ? clamp(sum / n, -7 * dt, 7 * dt) : clamp(0, lo, hi);
  if (Math.abs(d) < 1e-9) return false;
  st.hip.x += d; if (st.hip.v * d < 0) st.hip.v = 0;
  return true;
}
/** The face yaw's target and spring rate this frame (§4.5): the aim, or an action's latched direction. */
const FACE = { yaw: 0, omega: 25 };
function faceTarget(r, p) {
  const st = r.st, aim = p.angle || 0, SPR = TUNE.springs;
  FACE.yaw = aim; FACE.omega = SPR.face;
  const D = st.dg, sf = st.stateF;
  if (sf === 'dodge' && !D.hop && D.ph === 1) {
    // the dash: the face snaps to the dash direction; a side dash keeps half of it toward the aim
    const k = DODGE.dash.chestSide * ss(30, 70, Math.abs(D.rel) / DEG);
    FACE.yaw = D.dir + k * wrap(aim - D.dir); FACE.omega = DODGE.faceOmega;
  } else if (sf === 'takedown') FACE.yaw = st.td.yaw;
  else if (sf === 'chop' || sf === 'pick' || (st.ch.ph === 2 && !st.ch.pick)) FACE.yaw = st.ch.yaw;
  else if (sf === 'repair' && st.rp.on) FACE.yaw = Math.atan2(st.rp.ty - p.y, st.rp.tx - p.x);
  return FACE;
}
function facing(r, p) {
  const st = r.st, adt = S.adt, aim = p.angle || 0, SPR = TUNE.springs;
  const FT = faceTarget(r, p);
  springAngle(st.face, FT.yaw, FT.omega, adt);
  if (S.shot) resetSpring(st.face, st.face.x + wrap(aim - st.face.x));
  if (p.dead) {
    // death (§4.16): the face, the chest and the hips rotate to the template yaw F over 0.3 s (≤ 90° by construction)
    const Dh = st.dth, k = ES(clamp(st.deathT / DEATH.turnT, 0, 1));
    st.face.x = Dh.f0 + wrap(Dh.F - Dh.f0) * k; st.chest.x = Dh.c0 + wrap(Dh.F - Dh.c0) * k; st.hip.x = Dh.h0 + wrap(Dh.F - Dh.h0) * k;
    st.face.v = st.chest.v = st.hip.v = 0; st.hipIdleT = st.hip.x; st.turning = false;
    S.faceYaw = S.chestYaw = S.hipYaw = st.hip.x; S.tau = wrap(st.chest.x - st.hip.x); S.chestRef = st.chest.x; S.chestLag = 0; S.flickK = 1; S.shotW = 0; st.mode = 'idle';
    st.hipYawPrev = S.hipYaw; st.yawRate = st.yawAcc = 0;
    return;
  }
  S.faceYaw = st.face.x;
  const bl = (S.blade + GC.blade) * DEG;
  st.bladeNow = S.blade + GC.blade;
  // aimed, a chest far behind the face (a fast flick) turns faster (TUNE.springs.chestFlick), so the shouldered gun is
  // back on the line sooner
  const lag0 = Math.abs(wrap(S.faceYaw + bl - st.chest.x)) / DEG;
  // (M5: a talk or a person glance turns the chest part of the way, LV.chestYaw)
  springAngle(st.chest, S.faceYaw + bl + LV.chestYaw * DEG * (1 - S.aimW), lerp(SPR.chest, SPR.chestFlick, ss(30, 60, lag0) * S.aimW), adt);
  if (S.shot) resetSpring(st.chest, S.faceYaw + bl);
  // hips: follow the velocity while moving (forward, strafe or backpedal), the shooting stance while still
  let hipT, mode = 'idle';
  const moving = S.gaitOn && (st.speed > 10 || S.wall);
  if (moving) {
    const my = S.wall ? S.inputYaw : st.moveYaw;
    const rel = angleDiff(S.faceYaw, my), ar = Math.abs(rel);
    if (st.backpedal ? ar > 100 * DEG : ar > 120 * DEG) {
      st.backpedal = true; mode = 'back';
      hipT = S.faceYaw + clamp(wrap(my + Math.PI - S.faceYaw), -50 * DEG, 50 * DEG);
    } else {
      st.backpedal = false;
      if (ar < 45 * DEG) { hipT = my; mode = 'fwd'; } else { hipT = S.faceYaw + clamp(rel, -70 * DEG, 70 * DEG); mode = 'strafe'; }
    }
    if (S.wall) mode = 'wall';
    st.hipIdleT = st.hip.x; st.turning = false; st.turnT = 0;
    springAngle(st.hip, hipT, SPR.hipMove, S.animDt);
  } else if (st.stateF === 'dodge' && !st.dg.hop && st.dg.ph === 1) {
    // the dash: the hips whip round to the dash direction (the legs are FK; no planted foot holds them), but never more
    // than hipCap off the aim (a side dash is a strafe-lunge: the shoulders and the gun stay near the target)
    st.backpedal = false; mode = 'dash';
    const aim = p.angle || 0, cap = DODGE.dash.hipCap * DEG;
    springAngle(st.hip, aim + clamp(wrap(st.dg.dir - aim), -cap, cap), DODGE.hipOmega, adt);
    st.hipIdleT = st.hip.x; st.turning = false; st.turnT = 0;
  } else {
    st.backpedal = false;
    // turn in place: the hips hold their stance until the aim has turned far enough off it, then the feet step round
    const want = S.faceYaw, err = wrap(want - st.hipIdleT), ae = Math.abs(err) / DEG;
    if (!st.turning) {
      st.turnT = ae > LO.turnSoft ? st.turnT + S.adt : 0;
      if (ae > LO.turnHard || st.turnT > LO.turnSoftT) { st.turning = true; st.turnSide = Math.sign(err) || 1; st.turnT = 0; }
    }
    if (st.turning) {
      st.hipIdleT = st.hipIdleT + wrap(want - st.hipIdleT);
      if (!st.planner.needTurn && Math.abs(wrap(st.hip.x - st.hipIdleT)) < 4 * DEG && st.planner.stepping === 0) st.turning = false;
      mode = 'turn';
    }
    // (a turn in place whips the hips round faster than the idle stance follows small aim changes)
    springAngle(st.hip, st.hipIdleT, st.turning ? SPR.hipTurn : SPR.hipIdle, S.adt);
  }
  const live = !p.dead && !S.teleport && S.adt > 0 && mode !== 'dash', lim = moving ? LO.hipHoldMove : LO.hipHoldIdle;
  if (live) holdHips(st, lim, S.adt);
  // the twist budget (spine1 ±35°, spine2 ±45°: 80° in all): the hips are dragged round as far as the feet allow, and
  // beyond that the chest waits for the feet (the head still leads: neck and head take up to 75° more, see writeFK)
  let tau = wrap(st.chest.x - st.hip.x);
  const TB = 80 * DEG;
  if (Math.abs(tau) > TB) {
    const sg = Math.sign(tau);
    st.hip.x = st.chest.x - sg * TB;
    if (live) holdHips(st, lim, 1e9);
    tau = wrap(st.chest.x - st.hip.x);
    if (Math.abs(tau) > TB) { st.chest.x = st.hip.x + sg * TB; if (st.chest.v * sg > 0) st.chest.v = 0; tau = sg * TB; }
    if (!moving && !st.turning) { st.turning = true; st.turnSide = sg; st.hipIdleT = st.hip.x + wrap(S.faceYaw - st.hip.x); }
  }
  S.chestYaw = st.chest.x; S.tau = tau; S.hipYaw = st.hip.x; st.mode = mode;
  // the direction the chest aims along (its yaw less the blade), and how far the face is ahead of it
  S.chestRef = st.chest.x - bl; S.chestLag = wrap(S.faceYaw - S.chestRef);
  S.flickK = 1 - ss(TUNE.flick.lowFrom, TUNE.flick.lowTo, Math.abs(S.chestLag) / DEG);
  // (D6) a long gun's shot frame and its flash: the bore is on the bullet line however far the chest lags a fast flick
  // (shouldered, not held within reach of the chest), then it comes back within reach over 0.12 s
  S.shotW = S.long ? 1 - ss(st.shotM0, st.shotM0 + 0.12, S.tShot) : 0;
  S.flickK = lerp(S.flickK, 1, S.shotW);
  // yaw rate and acceleration of the hips (the coat's turn fling)
  if (S.liveDt > 0) {
    const yr = wrap(S.hipYaw - st.hipYawPrev) / S.liveDt, k = 1 - Math.exp(-S.liveDt / 0.03);
    const ya = (yr - st.yawRate) / S.liveDt;
    st.yawAcc += (clamp(ya, -400, 400) - st.yawAcc) * k;
    st.yawRate += (yr - st.yawRate) * k;
  }
  st.hipYawPrev = S.hipYaw;
}

/* ---------------- 5. locomotion: the gait table and the world-space step planner (§4.6) ---------------- */
/** The idle stance's foot spots (world) at hip yaw hy, into PI.neutral. */
function neutralFeet(st, p, hy, key) {
  const SK = STANCES[key] || STANCES.relaxed, c = Math.cos(hy), s = Math.sin(hy);
  for (let i = 0; i < 2; i++) {
    const n = i ? SK.R : SK.L, sd = i ? 1 : -1, o = PI.neutral[i];
    o[0] = p.x + n[0] * c - n[1] * s; o[1] = p.y + n[0] * s + n[1] * c; o[2] = hy + sd * n[2] * DEG; o[3] = sd * n[2] * DEG;
  }
}
// The gait start (§4.6): the first step begins clean, with the lead foot well into a short swing and the other one in
// mid-stance under a long stance fraction (no float: both feet are down until the lead lands), whatever walkPhase the
// sim starts from. The visual phase then eases back onto the sim's step clock (cadence within ±15%), so after about a
// cycle the footfalls land on the step sound again.
const START_SIG = 0.55;
function gaitStart(st, simPhi) {
  const PL = st.planner, c0 = START_SIG + 0.55 * (1 - START_SIG);
  let lead = -1;
  for (let i = 0; i < 2; i++) if (PL.feet[i].mode === 2) lead = i; // a foot already stepping leads
  if (lead < 0) {
    // sideways: the foot on the side of the motion leads (no crossover); otherwise the one that needs the least warp
    const sy = Math.sin(wrap(S.inputYaw - st.hip.x));
    if (sy > 0.5) lead = 1; else if (sy < -0.5) lead = 0;
  }
  let best = 9, who = 0;
  for (let i = 0; i < 2; i++) {
    if (lead >= 0 && i !== lead) continue;
    const c = (simPhi - (i ? 0.5 : 0) + 2) % 1;
    let d = c0 - c; d -= Math.round(d);
    if (Math.abs(d) < Math.abs(best)) { best = d; who = i; }
  }
  st.phOff = best; st.startT = 0; PI.startLead = who;
}
function locomotion(r, p) {
  const st = r.st;
  const simPhi = ((((p.walkPhase || 0) / (2 * Math.PI)) % 1) + 1) % 1;
  const gaitHeld = st.stateF === 'dodge' && st.dg.ph === 2 && st.dg.tailT < 0.08;
  if (S.gaitOn && !gaitHeld && !st.planner.gait && !p.dead) gaitStart(st, simPhi);
  if (S.gaitOn) {
    st.startT += S.animDt;
    const k = 0.15 * st.phaseRate / (2 * Math.PI) * S.animDt;
    st.phOff = Math.abs(st.phOff) <= k ? 0 : st.phOff - Math.sign(st.phOff) * k;
  }
  S.phi = (((simPhi + st.phOff) % 1) + 1) % 1;
  S.psi = (2 * S.phi) % 1;
  S.back = st.backpedal;
  // the table speed: the sprint column only with the sprint weight; a wall push runs it at 0
  const spd = S.wall ? 0 : Math.min(st.speed, 125 + 60 * st.sprintW);
  S.gs = S.gaitOn ? spd : 0;
  // all amplitudes through a spring; a stop lets them go a little slower than a start brings them in
  springTo(st.gaitAmp, S.gaitOn ? 1 : 0, S.gaitOn ? 12 : LO.stopRelease, S.adt);
  S.amp = clamp(st.gaitAmp.x, 0, 1);
  // a start holds a long stance fraction for its first step, then eases onto the table's
  const sigT = gaitAt('sigma', Math.max(40, S.gs)), startK = 1 - ss(0.25, 0.45, st.startT);
  S.sigma = Math.max(sigT, START_SIG * startK);
  // strafe: how sideways the motion runs relative to the hips (widens the stance, damps the arm swing)
  const mrel = S.gaitOn && st.speed > 10 ? wrap(st.moveYaw - S.hipYaw) : 0;
  S.strafeK = Math.abs(Math.sin(mrel));
  // backing up reverses the arm swing and the pelvis and spine counter-swings: through a spring, so the switch reads
  // as the swing passing through zero, never a snap
  springTo(st.dirS, S.back ? -1 : 1, 12, S.adt);
  S.dirSign = clamp(st.dirS.x, -1, 1);
  // stance key: the aim stance once the gun is up; a change of stance loosens the settle thresholds for a moment
  const key = S.aimW > 0.5 ? (S.long ? 'long' : 'pistol') : 'relaxed';
  if (key !== st.stanceKey) { st.stanceKey = key; st.stanceT = 1.2; }
  st.stanceT = Math.max(0, st.stanceT - S.adt);
  // planner input
  const I = PI;
  gaitInputs(I, Math.min(st.speed, 125 + 60 * st.sprintW), S.back, S.wall);
  I.sigma = S.sigma;
  I.half += 2 * S.strafeK * (st.mode === 'strafe' ? 1 : 0);
  I.dt = S.animDt; I.gait = S.gaitOn; I.phi = S.phi; I.rate = st.phaseRate;
  // (the dodge's tail holds the gait off for its first 0.08 s: with the move key held the gait lifted the planted lead
  // foot on the tail's first frame and the skid never played)
  if (st.stateF === 'dodge' && st.dg.ph === 2 && st.dg.tailT < 0.08) I.gait = false;
  I.vx = S.wall ? 0 : st.vf[0]; I.vz = S.wall ? 0 : st.vf[1]; I.rx = p.x; I.rz = p.y; I.hipYaw = S.hipYaw;
  I.turning = st.turning; I.turnSide = st.turnSide; I.still = st.stillT; I.stanceChanged = st.stanceT > 0; I.settleT = LO.stillSettle;
  I.hipY = 37.5 + IDLE.pelvisDy * (1 - S.amp) + st.height.x * S.amp;
  neutralFeet(st, p, S.gaitOn ? S.hipYaw : st.hipIdleT, key);
  // (M5) the contrapposto stance: the free foot out and turned out by the stance weight; a switch of the loaded side is two
  // forced steps (the new loaded foot back under him, then the free one out)
  contraFeet(st, key);
  coverFeet(st);
  I.lift *= (1 - (1 - LIFE.prowl.lift) * LV.prowl) * lerp(1, LIFE.stroll.liftK, LV.stroll);
  // (M5 fix) the low-HP limp: the right leg's stance shorter and its stride shorter (§4.19)
  I.sigD[1] = LIFE.lowHp.sigD * LV.low; I.leadK[1] = 1 - (1 - LIFE.lowHp.stride) * LV.low;
  // a forced step (melee lunge, takedown, repair) keeps its foot there while the action runs (the settle brings it back)
  if (st.nOffT > 0) { for (let i = 0; i < 2; i++) { PI.neutral[i][0] += st.nOff[i][0]; PI.neutral[i][1] += st.nOff[i][1]; } st.nOffT -= S.adt; }
  // the dodge and its tail own the feet (no idle step starts; it hands them back placed, frank3d dodgeFeet)
  I.hold = st.stateF === 'dodge';
  if (I.hold) st.stillT = 0;
  // a dodge skids the feet along with the body (M4 brings the dash and back-hop clips); a shove skids all but 5 u of
  // its push and asks for a corrective step
  S.skid = !p.dead && !S.teleport && (((p.dodgeT || 0) > 0 && S.jump > 0) || S.shove);
  // (the dodge clip owns the feet: the push-off foot stays where it is, the landings are placed; never dragged)
  if (S.skid && !(st.stateF === 'dodge' && !S.shove)) {
    const k = S.shove ? S.shoveDrag : 1;
    st.planner.drag((p.x - st.prevPos[0]) * k, (p.y - st.prevPos[1]) * k);
    if (S.shove) st.planner.kick = true;
  }
  if (!p.dead) { contraSteps(st); st.planner.update(I); }
  if (st.stateF === 'dodge') dodgeFeet(r, p);
  I.startLead = -1;
  for (let i = 0; i < 2; i++) st.planted[i] = !p.dead && st.planner.planted(i);
  st.contacts = st.planner.contacts;
  st.locoAt = !S.gaitOn ? (st.turning ? 'turn' : 'idle') : S.wall ? 'wall' : st.sprintW > 0.5 ? 'sprint' : st.speed > 95 ? 'jog' : 'walk';
}

/** The contrapposto's foot offsets on the neutral stance (relaxed, idle): the free foot `fwd` out, turned out to `toe`. */
function contraFeet(st, key) {
  if (key !== 'relaxed' || LV.cFoot < 0.01 || S.gaitOn) return;
  const CO = LIFE.contra, C = st.lf.c, free = C.side > 0 ? 0 : 1, sd = free ? 1 : -1, hy = st.hipIdleT, k = LV.cFoot, n = PI.neutral[free];
  n[0] += Math.cos(hy) * CO.fwd * k; n[1] += Math.sin(hy) * CO.fwd * k;
  const dToe = sd * (CO.toe - STANCES.relaxed.L[2]) * DEG * k; n[2] += dToe; n[3] += dToe;
}
/** Low cover (M5 fix): the stance wider by cover.low.half each side and the left foot `stagger` ahead (the idle steps take him there). */
function coverFeet(st) {
  const k = LV.cover * LV.coverLow;
  if (k < 0.01 || S.gaitOn) return;
  const CL = LIFE.cover.low, hy = st.hipIdleT, c = Math.cos(hy), sn = Math.sin(hy);
  for (let i = 0; i < 2; i++) { const n = PI.neutral[i], sd = i ? 1 : -1, f = i ? -0.3 * CL.stagger : 0.7 * CL.stagger; n[0] += (-sn * sd * CL.half + c * f) * k; n[1] += (c * sd * CL.half + sn * f) * k; }
}
/** The contrapposto's switch: the new loaded foot steps back under him (if it is off its spot), then the free foot steps out. */
function contraSteps(st) {
  const C = st.lf.c, PL = st.planner, CO = LIFE.contra;
  if (!C.phase || S.gaitOn || st.stanceKey !== 'relaxed') { C.phase = 0; return; }
  const loaded = C.side > 0 ? 1 : 0, free = 1 - loaded;
  if (C.phase === 1) { if (!footOff(PL, loaded)) C.phase = 2; else if (PL.forceStep(loaded, PI.neutral[loaded], CO.stepT, CO.lift)) C.phase = 1.5; else C.phase = 0; }
  else if (C.phase === 1.5) { if (PL.planted(loaded)) C.phase = 2; }
  if (C.phase === 2) { if (!footOff(PL, free)) C.phase = 0; else if (PL.forceStep(free, PI.neutral[free], CO.stepT, CO.lift)) C.phase = 2.5; else C.phase = 0; }
  else if (C.phase === 2.5) { if (PL.planted(free)) C.phase = 0; }
}
/** Is planner foot i off its neutral spot (PI.neutral) by more than a re-plant's tolerance? */
function footOff(PL, i) { const f = PL.feet[i], n = PI.neutral[i]; return Math.hypot(f.plant[0] - n[0], f.plant[1] - n[1]) > 0.8 || Math.abs(wrap(f.plantYaw - n[2])) > 3 * DEG; }

/* ---------------- 6. layer C: locomotion and the lower body (§4.6) ---------------- */
const STOP_W = 2 * Math.PI * 2.2;
function layerC(r, p) {
  const st = r.st, amp = S.amp, sig = S.sigma, P = PB, ds = S.dirSign;
  // a wall push marches in place: its bob, crouch and arm swing come from the walk column, so the push reads
  const gs = S.wall ? LO.wallSpeed : S.gs;
  S.gsVis = gs;
  const cphi = Math.cos(2 * Math.PI * S.phi), sphi = Math.sin(2 * Math.PI * S.phi);
  // pelvis height, bob (high at mid-stance in a walk, low in a jog), hip drop, weight shift over the stance foot; a stop
  // lets the crouch out slowly (the hips settle up over about 0.35 s, never pop)
  // (M5 fix) a stroll runs upright and loose: a shallower crouch, the torso nearly upright, flatter steps (locomotion)
  const SR = LIFE.stroll, stK = LV.stroll;
  const hT = (gaitAt('height', gs) - gaitAt('height', 0)) * lerp(1, SR.heightK, stK);
  springTo(st.height, hT, hT > st.height.x ? LO.heightRise : 10, S.adt);
  const bob = gaitAt('bob', gs) * amp * (S.back ? 0.8 : 1) * Math.cos(2 * Math.PI * (S.psi - sig));
  const yawOsc = gaitAt('yawOsc', gs) * amp, rollOsc = gaitAt('roll', gs) * amp, sway = gaitAt('sway', gs) * amp;
  // the stop (the step clock just stopped at speed): the legs brake, the upper body's momentum carries on (spine2 and,
  // through it, the head pitch forward, then settle back) and the pelvis absorbs the last plant
  if (!S.gaitOn && st.movingT === 0 && st.stillT <= S.adt + 1e-6 && st.speed > 50 && !S.back && !p.dead) {
    st.stopP.v += LO.stopKick * clamp(st.speed / 125, 0.4, 1.5); st.absorbT = LO.absorbT;
  }
  springPend(st.stopP, 0, STOP_W, LO.stopZeta, S.adt, 0, -12, 14);
  st.absorbT = Math.max(0, st.absorbT - S.adt);
  const absorb = st.absorbT > 0 ? LO.absorb * Math.sin(Math.PI * (1 - st.absorbT / LO.absorbT)) : 0;
  P[PK.pel] = (S.wall ? LO.wallPush * amp : 0);
  P[PK.pel + 1] = IDLE.pelvisDy * (1 - amp) + st.height.x * amp + bob - LO.turnDip * st.planner.stepping * (st.turning ? 1 : 0.5) - absorb;
  P[PK.pel + 2] = -sway * Math.cos(2 * Math.PI * (S.phi - sig / 2));
  S.bob = bob;
  // lean: the idle stoop, the gait's torso pitch (spine1 40% / spine2 60%), leaning into acceleration and banking into curves
  const h = S.hipYaw, ch = Math.cos(h), sh = Math.sin(h);
  const aF = st.acc[0] * ch + st.acc[1] * sh, aS = -st.acc[0] * sh + st.acc[1] * ch;
  springTo(st.leanF, clamp(aF * LO.accLean, LO.accLeanMin, LO.accLeanMax) * (S.back ? -0.6 : 1) + (S.wall ? LO.wallLean : 0), 2 * Math.PI * LO.leanHz, S.adt);
  springTo(st.leanS, clamp(aS * LO.bank, -LO.bankMax, LO.bankMax) * (S.gaitOn ? 1 : 0), 2 * Math.PI * LO.leanHz, S.adt);
  const gp = gaitAt('pitch', gs) * amp * (S.back ? 0.3 : 1) * lerp(1, SR.pitchK, stK) + st.leanF.x;
  P[PK.pelRot] = IDLE.lean * 0.3;
  P[PK.pelRot + 1] = yawOsc * cphi * ds;
  P[PK.pelRot + 2] = rollOsc * sphi + st.leanS.x * 0.4;
  P[PK.s1] = IDLE.lean * 0.3 + gp * 0.4 + 0.3 * st.stopP.x;
  P[PK.s1 + 2] = -0.6 * rollOsc * sphi + st.leanS.x * 0.6 + (st.mode === 'strafe' ? 5 * Math.sign(wrap(st.moveYaw - S.hipYaw)) * S.strafeK : 0);
  P[PK.s2] = IDLE.lean * 0.4 + gp * 0.6 + (S.back ? -3 * amp : 0) + st.stopP.x;
  // relaxed arm swing against the legs (the pistol arm at half; reversed when backing up; nearly still when strafing)
  const AS = LO.arm;
  // (the stroll: nearly no swing with the hands in the pockets, a loose 0.6 swing with the elbows lower when out)
  const armA = gaitAt('armSwing', gs) * amp * ds * (1 - AS.strafeDamp * S.strafeK) * (1 - (1 - lerp(SR.armK, SR.swing, LV.pocket)) * stK);
  const elb = gaitAt('elbowBase', gs) * lerp(1, SR.elbowK, stK * (1 - LV.pocket));
  const aL = Object.assign(ARM_L, IDLE.armL), aR = Object.assign(ARM_R, IDLE.armR);
  // the swing sits back of the hang (the hand comes up to the chest in front, the elbow drives back behind); the elbow
  // closes as the arm comes forward, and in a jog the upper arm rolls in so the forearm swings across the body (a true
  // humeral twist: setArm applies it about the upper arm's own axis)
  const back = AS.back * Math.abs(armA), inW = ss(40, 125, gs) * amp;
  aL.flex += -armA * cphi - back; aL.elbow = Math.min(AS.elbowMax, lerp(aL.elbow, elb, amp) + AS.elbowFwd * amp * Math.max(0, aL.flex)); aL.twist += AS.inL * inW;
  aR.flex += (armA * cphi - back) * AS.gunArm; aR.elbow = Math.min(AS.elbowMax, lerp(aR.elbow, elb * AS.gunElbow, amp) + AS.elbowFwdGun * amp * Math.max(0, aR.flex)); aR.twist += AS.inR * inW;
  aL.abd += AS.sprintAbdL * amp * st.sprintW + AS.strafeAbd * S.strafeK * amp; aR.abd += AS.sprintAbdR * amp * st.sprintW + AS.strafeAbd * S.strafeK * amp;
  if (S.long) { const RL = IDLE.armRLong; aR.flex = RL.flex + armA * RL.swing * cphi; aR.elbow = RL.elbow; aR.wflex = RL.wflex; aR.abd = RL.abd; aR.twist = 0; }
  writeArm(P, PK.armL, aL); writeArm(P, PK.armR, aR);
  // spine2 counter-swings the pelvis (relaxed only): in a jog the shoulders turn against the hips, which reads from above;
  // the head cancels the chest's net swing (layer U)
  S.counter = (0.6 + LO.counterJog * ss(60, 160, gs)) * (1 - S.aimWb);
  P[PK.s2 + 1] = -S.counter * yawOsc * cphi * ds;
  // FK legs (used only by the IK fallback and full-body clips): a phase-driven swing
  for (let i = 0; i < 2; i++) {
    const o = i ? PK.legR : PK.legL, c = Math.cos(2 * Math.PI * (S.phi - (i ? 0.5 : 0)));
    P[o] = 25 * amp * c * ds; P[o + 3] = 10 + 40 * amp * Math.max(0, -c); P[o + 4] = 0;
  }
  P[PK.crouch] = 0;
}
function writeArm(P, o, a) { P[o] = a.flex; P[o + 1] = a.abd; P[o + 2] = a.twist; P[o + 3] = a.elbow; P[o + 4] = a.wflex; P[o + 5] = a.wdev; P[o + 6] = a.wroll; }
function readArm(P, o, a) { a.flex = P[o]; a.abd = P[o + 1]; a.twist = P[o + 2]; a.elbow = P[o + 3]; a.wflex = P[o + 4]; a.wdev = P[o + 5]; a.wroll = P[o + 6]; return a; }

/* ---------------- 6. layer U: the upper body's base, AIM/RELAXED (§4.8) ---------------- */
function layerU(r, p) {
  const st = r.st, P = PB, U = PU, w = S.aimWb, AP = AIM[S.weapon] || AIM.pistol;
  // the U layer owns spine2 and up, the clavicles, the arms and the gun; it starts from C's relaxed values. The body's
  // channels run on the body weight aimWb (a draw-fire's torso comes in under the gun); the pose's aimW is the gun's.
  U.set(P);
  U[PK.aimW] = S.aimW;
  U[PK.pel + 1] = P[PK.pel + 1] + AP.pelvisDy * w;
  U[PK.s1] = P[PK.s1] + AP.spine1Pitch * w;
  U[PK.s2] = P[PK.s2] + AP.spine2Pitch * w;
  U[PK.s2 + 2] = P[PK.s2 + 2] + AP.spine2Roll * w;
  U[PK.neck] = IDLE.neckPitch + AP.neckPitch * w; U[PK.neck + 2] = AP.neckRoll * w;
  // the head looks level down the line of travel (or the gun): it takes out the torso's lean and the chest's net yaw swing
  const lean = IDLE.lean + (P[PK.s1] - IDLE.lean * 0.3) + (P[PK.s2] - IDLE.lean * 0.4);
  const cphi = Math.cos(2 * Math.PI * S.phi), yawOsc = gaitAt('yawOsc', S.gsVis) * S.amp * S.dirSign;
  U[PK.head] = IDLE.headPitch - lean * 0.6 + AP.headPitch * w;
  U[PK.head + 1] = -(1 - S.counter) * yawOsc * cphi + AP.headYaw * w;
  U[PK.head + 2] = AP.headRoll * w;
  // the cheek weld holds at any aim distance: a gun pitched down at a near point takes the neck and head down with it
  if (S.long) { const CW = TUNE.cheek, dP = clamp(CW.refPitch - st.aimPitch / DEG, -6, 12) * w; U[PK.neck] += CW.neck * dP; U[PK.head] += CW.head * dP; }
  for (let i = 0; i < 2; i++) {
    const cp = i ? AP.clavR : AP.clavL, o = i ? PK.clavR : PK.clavL;
    U[o] = cp[1] * w; U[o + 1] = IDLE.clavProt + cp[0] * w;
  }
  // the weapon clips (M3): recoil (the chest and head kick back, the shotgun's hips give), the action's head lift, the
  // reload (looking at the gun, the chest working), the swap's cross-draw turn and dip, the dry fire's flinch
  const k = GC.rl;
  U[PK.pel] += GC.rPel; U[PK.pel + 1] += GC.pelY;
  U[PK.s1] += GC.rS1;
  U[PK.s2] += GC.rS2 + GC.s2Pitch * k; U[PK.s2 + 1] += GC.s2Yaw + GC.actS2Yaw + GC.rlS2Yaw * k; U[PK.s2 + 2] += GC.s2Roll * k;
  U[PK.head] += GC.rHead + GC.actHead + GC.headPitch * k + GC.dryHead; U[PK.head + 1] += (GC.headYaw + GC.rlHeadYaw) * k; U[PK.head + 2] += GC.dryRoll;
  // the recoil's shoulders (both shrug up and draw back), the pump's left shoulder pulling the forend
  U[PK.clavL] += GC.rClavE + GC.actClavLE; U[PK.clavL + 1] += GC.rClavP + GC.actClavLP;
  U[PK.clavR] += GC.rClavE; U[PK.clavR + 1] += GC.rClavP;
  // (M4) the melee strike (§4.12): the torso winds and whips through the blow (spine2, spine1 and the pelvis turn),
  // spine2 pitches into the contact
  if (MC.w > 0) {
    const c = MC.cur, w = MC.w;
    const kp = MC.long ? MELEE.longPitch : 1;
    U[PK.s2 + 1] += c[5] * w; U[PK.s1 + 1] += c[6] * w; U[PK.pelRot + 1] += c[7] * w; U[PK.s2] += MC.s2Pitch * kp; U[PK.s1] += 0.5 * MC.s2Pitch * kp; U[PK.pel] += MC.lunge;
    if (MC.long) U[PK.head] += MELEE.longHead * w; // (the head up on the target over the stock)
    U[PK.head + 1] -= 0.6 * c[5] * w; // (the eyes stay on the target)
    U[PK.head] += MELEE.snap.head * MC.snap; U[PK.clavR] += MELEE.snap.clavR * MC.snap;
  }
  // fade (a later U state change blends from the last output; a connected strike's catch-up runs on real time), then copy
  // the owned channels into the pose
  if (fadeApply(st.fadeU, U, st.fadeUreal ? (G.paused ? 0 : S.realDt) : S.adt) >= 1) { /* live */ }
  st.lastU.set(U);
  P.set(U);
}

/* ---------------- 8. layer F: full-body clips (§4.13, §4.14, §4.16, §4.17) ---------------- */
// Each clip starts from the composed pose (C + U) and writes the channels it owns with its own envelope weights; a switch
// between two clips crossfades from the last output (states()).
function layerF(r, p) {
  const st = r.st, F = PF, s = st.stateF;
  F.set(PB);
  FOOTW[0] = FOOTW[1] = 1;
  if (s === 'death') deathPose(r, p, F);
  else if (s === 'dodge') dodgePose(r, p, F);
  else if (s === 'takedown') takedownPose(r, p, F);
  else if (s === 'repair') repairPose(r, p, F);
  else if (s === 'chop') chopPose(r, p, F);
  else if (s === 'pick') pickPose(r, p, F);
  else if (s === 'modal') modalPose(r, p, F);
  fadeApply(st.fadeF, F, st.fadeFreal ? (G.paused ? 0 : S.realDt) : S.adt);
  st.lastF.set(F);
  PB.set(F);
}
const _v2a = [0, 0], _v4a = [0, 0, 0, 0], _v5a = [0, 0, 0, 0, 0], _cb = [0, 0, 0, 0, 0];
const mixCh = (F, o, v, w) => { F[o] = PB[o] + (v - PB[o]) * w; };
// per-foot IK weights a full-body clip sets this frame (the dash: the trail foot's push-off, the lead's plant); legs()
// multiplies them into the pose's footIKW (reset each frame in layerF)
const FOOTW = [1, 1];
const _v3b = [0, 0, 0];
/** The dash's clock: u while it runs, then on past 1 through the tail (1 + tail / T). */
const dashV = (D) => (D.ph === 1 ? D.u : 1 + D.tailT / DODGE.T);
/** The dodge (§4.14): the dash (one low stride along the dash: push-off, flight, the lead heel's plant and skid; the gun
 *  tucked) or the back-hop (a tucked hop, the gun on target). */
function dodgePose(r, p, F) {
  const st = r.st, D = st.dg, live = D.ph === 1, u = live ? D.u : 1, tt = D.ph === 2 ? D.tailT : 0, v = dashV(D);
  // in fast (the keys start at the rest pose), out over the tail: the head first, then the chest, then the hips
  const wi = ss(0, 0.1, u);
  const wH = live ? wi : 1 - ES(clamp(tt / 0.07, 0, 1)), wC = live ? wi : 1 - ES(clamp(tt / 0.11, 0, 1)), wP = live ? wi : 1 - ES(clamp(tt / DODGE.tail, 0, 1));
  F[PK.footIKW] = 1;
  if (!D.hop) {
    const K = DODGE.dash;
    mixCh(F, PK.pel + 1, sample(K.pelvisY, u) - 37.5, wP);
    mixCh(F, PK.pelRot, sample(K.pelvisPitch, u), wP); mixCh(F, PK.pelRot + 1, 0, wP); mixCh(F, PK.pelRot + 2, 0, wP);
    mixCh(F, PK.s1, IDLE.lean * 0.3 + sample(K.spine1, u), wC); mixCh(F, PK.s1 + 1, 0, wC);
    mixCh(F, PK.s2, IDLE.lean * 0.4 + sample(K.spine2, u), wC);
    // the eyes stay on the travel (the torso pitches ~48° forward)
    const lean = sample(K.pelvisPitch, u) + sample(K.spine1, u) + sample(K.spine2, u);
    mixCh(F, PK.neck, IDLE.neckPitch - 0.35 * lean, wH); mixCh(F, PK.head, -0.45 * lean + K.headPitch * ss(0.1, 0.4, u), wH);
    // the FK legs, steered toward the travel: a side dash's hips stay within hipCap of the aim, so the legs swing in a plane
    // turned by the rest (lead.flex·sin φ goes to abduction); the IK weights per foot (the trail's push-off, the lead's plant)
    // (the lead leg's plane at most ±35° off the hips: its big flex would go into an abduction past the hip's limits; the
    // trail leg, nearly straight down at its push-off, follows the travel in full, so it trails behind the line of travel
    // even while the hips are still whipping round)
    const phi0 = wrap(D.dir - S.hipYaw);
    for (let i = 0; i < 2; i++) {
      const isLead = i === D.lead, o = i ? PK.legR : PK.legL, sd = i ? 1 : -1;
      const phi = clamp(phi0, (isLead ? -35 : -80) * DEG, (isLead ? 35 : 80) * DEG), cphi = Math.cos(phi), sphi = Math.sin(phi);
      sampleV(isLead ? K.lead : K.trail, u, _v3b);
      const fl = _v3b[0];
      // (abduction is + outward for either leg: a flex toward a travel on the leg's own side abducts it)
      F[o] = fl * cphi; F[o + 1] = (isLead ? 4 : 6) - fl * sphi * sd; F[o + 2] = 0; F[o + 3] = _v3b[1]; F[o + 4] = _v3b[2];
    }
    FOOTW[D.lead] = D.ph ? 1 - ss(K.leadOff[0], K.leadOff[1], v) * (1 - ss(K.plantU, K.plantIn, v)) : 1;
    FOOTW[1 - D.lead] = D.ph ? (D.noPush ? 0 : 1 - ss(K.pushOff[0], K.pushOff[1], v)) * (1 - ss(K.trailOn, K.trailIn, v)) + ss(K.trailOn, K.trailIn, v) : 1;
    // the free arm thrown back for balance (the pistol is tucked one-handed; a long gun keeps both hands at port arms)
    if (!S.long) { const A = K.armL, wa = live ? ss(0.05, 0.25, u) : 1 - ES(clamp(tt / DODGE.tail, 0, 1)); mixCh(F, PK.armL, A[0], wa); mixCh(F, PK.armL + 1, A[1], wa); mixCh(F, PK.armL + 3, A[2], wa); }
    F[PK.crouch] = wP;
  } else {
    const K = DODGE.hop;
    mixCh(F, PK.pel + 1, sample(K.pelvisY, u) - 37.5, wP);
    const th = sample(K.thigh, u), kn = sample(K.knee, u);
    for (let i = 0; i < 2; i++) { const o = i ? PK.legR : PK.legL; F[o] = th; F[o + 1] = 5; F[o + 2] = 0; F[o + 3] = kn; F[o + 4] = -15; }
    // the chest rocks back in the air and leans in on the landing
    mixCh(F, PK.s2, IDLE.lean * 0.4 + sample(K.spine2, u) + K.landLean * ss(0.82, 1, u), wC);
    mixCh(F, PK.s1, IDLE.lean * 0.3 + 0.5 * K.landLean * ss(0.82, 1, u), wC);
    const w = live ? 1 - ss(K.ikOff[0], K.ikOff[1], u) * (1 - ss(K.ikOn, K.ikIn, u)) : 1;
    FOOTW[0] = FOOTW[1] = w;
    F[PK.crouch] = 0;
  }
}
/** The dodge's feet in the planner (before the pose): the edge freezes both where they are (the push-off foot stays put:
 *  no drag), the back-hop lands both at ±land, and the dash's skid. */
function dodgeFeet(r, p) {
  const st = r.st, D = st.dg, PL = st.planner;
  if (D.ph === 1 && !D.frozen) {
    // the edge: both feet held on the ground where they are (a swinging foot's spot below it)
    D.frozen = true;
    for (let i = 0; i < 2; i++) { const f = PL.feet[i]; if (!PL.planted(i)) PL.place(i, f.x, f.z, f.yaw, f.toeOff); }
  }
  if (D.hop) {
    const K = DODGE.hop;
    if (((D.ph === 1 && D.u >= K.ikOn) || D.ph === 2) && !D.placed) {
      // where he will be when the hop ends (the rest of the dodge at its speed), the feet ±land either side
      D.placed = true;
      const rem = Math.max(0, p.dodgeT || 0) * Math.min(st.speed, 600), x = p.x + Math.cos(D.dir) * rem, z = p.y + Math.sin(D.dir) * rem, hy = S.hipYaw, ch = Math.cos(hy), sh = Math.sin(hy);
      for (let i = 0; i < 2; i++) { const sd = i ? 1 : -1; PL.place(i, x - sh * sd * K.land, z + ch * sd * K.land, hy + sd * 8 * DEG, sd * 8 * DEG); }
      startDust(st, x, z, D.dir);
    }
    return;
  }
  // the push-off: the trail foot rolls up onto its ball (the heel rises, the ball stays put) before it leaves the ground
  if (D.ph === 1 && !D.noPush) { const t = 1 - D.lead, f = PL.feet[t], v = dashV(D); if (PL.planted(t) && v < DODGE.dash.pushOff[1]) PL._ankle(f, -DODGE.dash.toeOff * ss(0.02, DODGE.dash.pushOff[1], v), 1); }
  // the dash's brake skid: the planted lead foot slides `skid` u on along the dash (ease-out) from its plant
  if (D.placed && D.skidT < DODGE.dash.skidT) {
    const K = DODGE.dash;
    D.skidT += S.adt;
    const k = EO(clamp(D.skidT / K.skidT, 0, 1)) * K.skid, dk = k - D.skid; D.skid = k;
    if (dk > 0 && PL.planted(D.lead)) PL.slide(D.lead, Math.cos(D.dir) * dk, Math.sin(D.dir) * dk);
    S.skid = true; // (the skid is a slide, never stance drift)
  }
}
/** The dash's touchdowns (after FK, before the leg IK): the lead foot plants at its own FK heel's spot (on the ground below
 *  it), the trail foot at its FK spot but never crossed over the line of travel. */
function dodgePlace(r, p) {
  const st = r.st, D = st.dg, PL = st.planner, K = DODGE.dash, B = r.bones;
  if (D.hop || !D.ph) return;
  const v = dashV(D), c = Math.cos(D.dir), s = Math.sin(D.dir);
  // where the body will be when the dash ends (the rest of the dodge at its speed)
  const rem = D.ph === 1 ? Math.max(0, p.dodgeT || 0) * Math.min(Math.max(st.speed, 300), 600) : 0, ex = p.x + c * rem, ez = p.y + s * rem;
  if (!D.placed && v >= K.plantU) {
    D.placed = true; D.skid = 0; D.skidT = 0;
    _v1.setFromMatrixPosition(B[FEET[D.lead]].matrixWorld);
    // (at its FK spot, but kept to a stance the leg can still hold when the body arrives over it: a side dash's FK foot,
    // abducted, landed out of reach and the leg's limits sank it under the ground)
    const sd = D.lead ? 1 : -1, yaw = S.hipYaw + sd * 8 * DEG;
    const ox = _v1.x - ex, oz = _v1.z - ez, al = clamp(ox * c + oz * s, K.leadAlong[0], K.leadAlong[1]), sl = sd * clamp(sd * (-ox * s + oz * c), K.leadSide[0], K.leadSide[1]);
    _v1.x = ex + c * al - s * sl; _v1.z = ez + s * al + c * sl;
    PL.place(D.lead, _v1.x, _v1.z, yaw, sd * 8 * DEG);
    // (a heel strike: the planted foot starts at the FK foot's pitch, toe up, and the planner rolls it flat about the heel;
    // planted flat at once, the rotation's blend sank the heel under the ground)
    _v2.set(1, 0, 0).transformDirection(B[FEET[D.lead]].matrixWorld); PL.feet[D.lead].pitch = clamp(Math.asin(clamp(_v2.y, -1, 1)), 0, 0.5);
    startDust(st, _v1.x, _v1.z, D.dir);
  }
  if (!D.trailPlaced && v >= K.trailOn) {
    D.trailPlaced = true;
    const t = 1 - D.lead, sd = t ? 1 : -1;
    _v1.setFromMatrixPosition(B[FEET[t]].matrixWorld);
    // on its own side of the line of travel through the body (the travel's right is (−s, c); the hips are within 70° of
    // the travel, so the right foot's side is the travel's right), at least trailLat out
    const ox = _v1.x - ex, oz = _v1.z - ez, along = clamp(ox * c + oz * s, K.trailAlong[0], K.trailAlong[1]), side = -ox * s + oz * c;
    const lat = sd * clamp(sd * side, K.trailLat, K.trailLat + 5);
    PL.place(t, ex + c * along - s * lat, ez + s * along + c * lat, S.hipYaw + sd * 10 * DEG, sd * 10 * DEG);
  }
}
function startDust(st, x, z, dir, K = DODGE.dust, y = 1.2) { const d = st.dust; d.t = 0; d.x = x; d.z = z; d.dir = dir; d.K = K; d.y = y; }
/** The takedown (§4.13): he drops onto the blow (the hips down, the chest and head over the victim). */
function takedownPose(r, p, F) {
  const w = TC.w, b = TC.body;
  F[PK.pel + 1] += b[0] * w; F[PK.s2] += b[1] * w; F[PK.s1] += b[2] * w; F[PK.head] += b[3] * w;
  F[PK.aimW] = 0;
}
/** Repair (§4.17): squared up to the opening, hammering (the chest accents each blow), or crouched at the phone line. */
function repairPose(r, p, F) {
  const st = r.st, RP = st.rp, w = ES(RP.w);
  if (RP.kind === 'phone') {
    const P = REPAIR.phone;
    F[PK.pel + 1] += P.pelvisY * w; F[PK.s1] += 10 * w; F[PK.s2] += 18 * w; F[PK.neck] += 10 * w; F[PK.head] += 12 * w;
  } else {
    const h = (RP.t * REPAIR.rate) % 1;
    F[PK.pel + 1] += (REPAIR.pelvisY + sample(REPAIR.dip, h)) * w;
    F[PK.s2] += (REPAIR.s2Pitch + sample(REPAIR.accent, h)) * w;
    F[PK.s2 + 1] += sample(REPAIR.s2Yaw, h) * w;
    F[PK.neck] += 10 * w; F[PK.head] += (10 + sample(REPAIR.nod, h)) * w; // (looking at the nail, nodding on each blow)
  }
  F[PK.aimW] *= 1 - w;
}
// the chop's body over u: [lean, spine2 yaw, pelvis yaw, pelvis z, pelvis dy] (the knees bend as the hips drop: the knee
// angle → pelvis dy, about 0.17 u per degree)
const CK = CHOP.contact, CHOP_DY = -0.17 * CK.knee;
const CHOP_BODY = [[0, [CK.lean, CHOP.bite.s2Yaw, -4, 0, CHOP_DY]], [CHOP.bite.u, [CK.lean - 1, CHOP.bite.s2Yaw, -4, 0, CHOP_DY], 'L'],
  [CHOP.wrench.u, [CK.lean - 6, CHOP.wrench.s2Yaw, -5, 0, CHOP_DY + 1], 'O'],
  [1, [4, CHOP.windup.s2Yaw, CHOP.windup.pelvisYaw, CHOP.windup.pelvisZ, 0], 'S']];
const CHOP_WOUND = CHOP_BODY[3][1];
/** The axe (§4.17): contact on frame 0 (the catch-up from wound-up), the bite, the wind-up over the right shoulder; the tail lowers it. */
function chopPose(r, p, F) {
  const st = r.st, C = st.ch, live = C.ph === 1, u = live ? C.u : 1;
  sampleV(CHOP_BODY, u, _cb);
  if (live && C.cT < 9) { const cu = catchU(C.cT), k = cu < 0.4 ? 0 : ES((cu - 0.4) / 0.6); for (let i = 0; i < 5; i++) _cb[i] = lerp(CHOP_WOUND[i], _cb[i], k); }
  const w = live ? 1 : 1 - ES(clamp(C.tailT / CHOP.tail, 0, 1));
  const lean = _cb[0] * w;
  F[PK.pelRot] += 0.25 * lean; F[PK.s1] += 0.3 * lean; F[PK.s2] += 0.45 * lean;
  F[PK.s2 + 1] += _cb[1] * w; F[PK.pelRot + 1] += _cb[2] * w; F[PK.pel + 2] += _cb[3] * w; F[PK.pel + 1] += _cb[4] * w;
  F[PK.head] -= 0.5 * lean; F[PK.head + 1] -= 0.5 * _cb[1] * w; // (eyes on the cut)
  F[PK.aimW] *= 1 - w;
}
/** Pick (§4.17): down to the ground with the left hand (the gun stays in the right), then the rise. */
function pickPose(r, p, F) {
  const st = r.st, C = st.ch, live = C.ph === 1, u = live ? C.u : 1, w = live ? 1 : 1 - ES(clamp(C.tailT / PICK.rise, 0, 1));
  F[PK.pel + 1] += sample(PICK.pelvisY, u) * w; F[PK.pelRot] += sample(PICK.pelvisPitch, u) * w;
  F[PK.s1] += sample(PICK.spine1, u) * w; F[PK.s2] += sample(PICK.spine2, u) * w;
  F[PK.head] -= 0.4 * sample(PICK.spine2, u) * w;
  // the chest turns toward the camera (south, +y) as he reaches, so the reaching left arm swings into view: facing east
  // his left side is away from the camera
  F[PK.s2 + 1] += PICK.camYaw * Math.sign(Math.cos(st.ch.yaw) || 1) * ss(0, 0.5, u) * w;
}
/** Death's template (§4.16), entered on the death edge. */
function deathStart(r, p) {
  const st = r.st, Dh = st.dth, a = p.angle || 0;
  const hurt = G.hurtDir && G.hurtDir.t > 0 && Number.isFinite(G.hurtDir.angle) ? G.hurtDir.angle : a + Math.PI;
  Dh.variant = Math.abs(angleDiff(a, hurt)) < Math.PI / 2 ? 'back' : 'front';
  Dh.F = Dh.variant === 'back' ? hurt : hurt + Math.PI;
  Dh.f0 = st.face.x; Dh.h0 = st.hip.x; Dh.c0 = st.chest.x;
  Dh.sign = Math.cos(Dh.F) >= 0 ? 1 : -1; // his right points to sim y = cos F: the camera (south) side
  Dh.lift = 0; Dh.relOk = false; Dh.gun.on = false; Dh.fall = hurt + Math.PI;
  st.deathT = 0;
  // dying with the axe or the hammer in his hand: THAT drops as the prop (the gun stays stowed); the chop's clock stops
  st.ch.ph = 0;
  Dh.tool = st.tool === 'axe' || st.tool === 'hammer' ? st.tool : null;
  if (Dh.tool) {
    // (last frame's tool and hand: the prop leaves the hand from where it was)
    _m1.compose(TOOL.p, TOOL.q, _gw2.set(1, 1, 1)); Dh.rel.copy(r.bones.handR.matrixWorld).invert().multiply(_m1); Dh.relOk = true;
    Dh.gun.p[0] = TOOL.p.x; Dh.gun.p[1] = TOOL.p.y; Dh.gun.p[2] = TOOL.p.z; Dh.gun.v[0] = Dh.gun.v[1] = Dh.gun.v[2] = 0;
  }
  st.tool = null;
}
/** Death (§4.16): the fall rotated toward the hit, the bounce and settle, the head toward the camera; FK everywhere. */
function deathPose(r, p, F) {
  const st = r.st, Dh = st.dth, t = st.deathT, K = Dh.variant === 'front' ? DEATH.front : DEATH.back, sg = Dh.sign;
  F[PK.pel] = 0; F[PK.pel + 1] = sample(K.pelvisY, t) - 37.5; F[PK.pel + 2] = 0;
  F[PK.pelRot] = sample(K.pelvisPitch, t); F[PK.pelRot + 1] = 0; F[PK.pelRot + 2] = 0;
  const sl = sample(K.slide, t), hy = S.hipYaw;
  F[PK.root] = sl * Math.cos(hy); F[PK.root + 1] = 0; F[PK.root + 2] = sl * Math.sin(hy);
  F[PK.rootRot] = F[PK.rootRot + 1] = F[PK.rootRot + 2] = 0;
  F[PK.s1] = sample(K.spine1, t); F[PK.s1 + 1] = 0; F[PK.s1 + 2] = 0;
  F[PK.s2] = sample(K.spine2, t); F[PK.s2 + 1] = 0; F[PK.s2 + 2] = 0;
  F[PK.neck] = 0; F[PK.neck + 1] = 0; F[PK.neck + 2] = 0;
  F[PK.head] = sample(K.headPitch, t); F[PK.head + 1] = sample(K.headYaw, t) * sg; F[PK.head + 2] = sample(K.headRoll, t) * sg;
  F[PK.clavL] = F[PK.clavR] = 0; F[PK.clavL + 1] = F[PK.clavR + 1] = IDLE.clavProt;
  for (let i = 0; i < 2; i++) { const o = i ? PK.legR : PK.legL; sampleV(i ? K.legR : K.legL, t, _v5a); F[o] = _v5a[0]; F[o + 1] = _v5a[3]; F[o + 2] = _v5a[4]; F[o + 3] = _v5a[1]; F[o + 4] = _v5a[2]; }
  for (let i = 0; i < 2; i++) { const o = i ? PK.armR : PK.armL; sampleV(i ? K.armR : K.armL, t, _v4a); F[o] = _v4a[0]; F[o + 1] = _v4a[1]; F[o + 2] = _v4a[3]; F[o + 3] = _v4a[2]; F[o + 4] = -10; F[o + 5] = 0; F[o + 6] = 0; }
  // (the feet stay planted through the crumple, the knees folding over them on the IK, and the legs go FK as he topples:
  // the spec's FK from 0.12 drove the feet under the ground while the hips came down, and the clamp then held him up off
  // it, hovering)
  F[PK.footIKW] = 1 - ss(DEATH.ikOff, DEATH.ikTo, t); F[PK.aimW] = 0; F[PK.breath] = 0; F[PK.crouch] = 0;
}
// the ground clamp's tracked points (bone, body-space bind point): head top/back/face, hands, elbows, knees, heels, toes, the hips and the chest front and back
const CLAMP_PTS = [['head', 0.3, 75, 0], ['head', -5.5, 67, 0], ['head', 6.5, 66, 0], ['handL', 0.3, 29, -11], ['handR', 0.3, 29, 11], ['forearmL', -1, 44.6, -11], ['forearmR', -1, 44.6, 11],
  ['shinL', 2.5, 19.5, -4.6], ['shinR', 2.5, 19.5, 4.6], ['footL', -2.6, 2, -4.6], ['footR', -2.6, 2, 4.6], ['footL', 7, 2, -4.6], ['footR', 7, 2, 4.6],
  ['pelvis', -7, 33, 0], ['pelvis', 7, 33, 0], ['spine2', -6.8, 50, 0], ['spine2', 6.8, 50, 0], ['spine1', 0, 38, -10.5], ['spine1', 0, 38, 10.5]];
/** Death, after FK: the arms leave the IK'd aim over 0.12 s (from their last local rotations); deathClamp then lifts the hips so nothing sinks under y 1. */
function deathFK(r, p) {
  const st = r.st, B = r.bones, Dh = st.dth, t = st.deathT;
  if (st.armQok && t < 0.12) {
    const k = 1 - ES(t / 0.12), A = st.armQ, bs = [B.upperArmL, B.forearmL, B.handL, B.upperArmR, B.forearmR, B.handR];
    for (let i = 0; i < 6; i++) bs[i].quaternion.slerp(A[i], k);
    B.clavL.updateMatrixWorld(true); B.clavR.updateMatrixWorld(true);
  }
}
/** Death, after the legs: the ground clamp (the feet don't count while the IK still plants them). */
function deathClamp(r) {
  const st = r.st, B = r.bones, Dh = st.dth, ik = PB[PK.footIKW] > 0.5;
  let lo = Infinity;
  for (const c of CLAMP_PTS) { if (ik && c[0][0] === 'f') continue; const y = bonePoint(r, c[0], c[1], c[2], c[3], _v1).y; if (y < lo) lo = y; }
  const need = Math.max(0, DEATH.clampY - lo);
  Dh.lift = need >= Dh.lift ? need : Math.max(need, Dh.lift - DEATH.liftRate * S.realDt);
  if (Dh.lift > 1e-4) { B.pelvis.position.y += Dh.lift; B.pelvis.updateMatrixWorld(true); }
}

/** Dead and landed: a hand floating within snapRange of the ground is IK'd down onto it (its lowest point at snapY). */
const HAND_PTS = [[0, 0, 0], [0, -4, 0], [0, -7, 0], [1.2, -3, 0], [-1.2, -3, 0]];
function deathHands(r) {
  const st = r.st, B = r.bones, w = ss(DEATH.snapFrom, DEATH.snapTo, st.deathT);
  if (w <= 0) return;
  // (armIK blends from the FK hands: this frame's, the fall's FK arms; weapons() doesn't capture them while he is dead)
  boneFrame(B.handR, _fkRw, _fkRq); boneFrame(B.handL, _fkLw, _fkLq);
  _fkRe.setFromMatrixPosition(B.forearmR.matrixWorld); _fkLe.setFromMatrixPosition(B.forearmL.matrixWorld);
  for (let i = 0; i < 2; i++) {
    const L = i ? 'R' : 'L', hand = B[i ? 'handR' : 'handL'];
    let lo = Infinity;
    for (const q of HAND_PTS) { _v1.set(q[0], q[1], q[2]).applyMatrix4(hand.matrixWorld); if (_v1.y < lo) lo = _v1.y; }
    const drop = lo - DEATH.snapY;
    if (!(drop > 0.05 && drop < DEATH.snapRange)) continue;
    _wL.setFromMatrixPosition(hand.matrixWorld); _wL.y -= drop; worldQuat(hand, _qL);
    // (solved in full, then blended in on the joints: the solver's elbow and twist limits differ from the fall's FK arm, and
    // a small IK weight still jumped the arm to the solver's pose)
    const up = B[NM[L].up], fo = B[NM[L].fo];
    _dhq0.copy(up.quaternion); _dhq1.copy(fo.quaternion); _dhq3.copy(hand.quaternion);
    armIK(r, L, _wL, _qL, POLE_GUARD, 1, 0, 0);
    up.quaternion.slerpQuaternions(_dhq0, _dhq4.copy(up.quaternion), w); fo.quaternion.slerpQuaternions(_dhq1, _dhq5.copy(fo.quaternion), w); hand.quaternion.slerpQuaternions(_dhq3, _dhq6.copy(hand.quaternion), w);
    up.updateMatrixWorld(true);
  }
}
const _dhq0 = new THREE.Quaternion(), _dhq1 = new THREE.Quaternion(), _dhq3 = new THREE.Quaternion(), _dhq4 = new THREE.Quaternion(), _dhq5 = new THREE.Quaternion(), _dhq6 = new THREE.Quaternion();

/* ======================= M5: life (§4.7, §4.18–§4.20) ======================= */
// lifeClocks (after the weapon clocks) reads the sim and keeps the life clocks in st.lf; this frame's values go to LV,
// read by: the facing (a talk or a person glance turns the chest), the planner input (the contrapposto stance and its
// re-plants, the prowl's short steps), lifePose (the body channels, after the U layer), the head look (last), lifeArms
// (the right hand before the gun: the holster, the pockets, the knees), leftOverride (the left hand's gestures), the
// weapons (the holstered pistol, the prowl's low ready, the one-handed carry, the sway) and lifeProps (the parcel, the
// ability's hammer). Everything is a weight eased in and out on its own times, so nothing pops.
const LV = {
  cw: 0, cS: 0, cFoot: 0,      // contrapposto: body weight, eased side (+1 loaded right), stance weight (the feet)
  gYaw: 0, gPitch: 0, pYaw: 0, pW: 0, chestYaw: 0,
  fid: null, fu: 0, fw: 0,
  stroll: 0, hol: 0, carry: 0, prowl: 0, cover: 0, coverLow: 1, coverSide: 1, pop: 0, low: 0, beat: 0, hok: 0,
  reachE: 0, reachShort: '', kneel: 0, talkW: 0, talkYaw: 0, phone: 0, itemW: 0, item: 'eat', abil: '', abilT: 9, steadyK: 0,
  modal: 0, modalKind: null, swayYaw: 0, swayPitch: 0, gunW: 0, lookYaw: 0, lookPitch: 0, eye: null,
  chk: 0, chkW: 0, chkHand: 0, chkSlide: 0, // the gun check (a press-check): the gun's weight on its pose, the left hand on the slide, the slide's travel
  pocket: 1, parcelK: 0, giveW: 0, hokEx: 0, reachT: 0, kneelUp: -1, kneelT: 9, talkF: 0, talkBeat: 0, bite: 0, // (M5 fix)
};
const COVER_LOW = new Set([SO.ROCK, SO.CAR, SO.LOGS]), COVER_TALL = new Set([SO.WALL, SO.TREE]);
const MODAL_POSE = { fishing: 'rod', craft: 'work', cook: 'work', repair: 'work' };
// the quick items whose use plays a gesture (§4.2 item edge, read off the inventory: a heal from a kill boon, a supper or a
// level-up is not an item): the medical ones (a bandage to his side) and the food (to his mouth)
const QUICK_MED = ['bandage', 'medkit'], QUICK_FOOD = Object.keys(ITEMS).filter((k) => ITEMS[k] && ITEMS[k].food);
const invSum = (inv, ids) => { let n = 0; for (let i = 0; i < ids.length; i++) n += inv[ids[i]] || 0; return n; };
// the interactions that start an action of their own (the takedown, the axe, a repair, the bed, a car): no reach gesture
const NO_REACH = new Set(['TAKEDOWN', 'CHOP', 'FIX', 'REST', 'DRIVE', 'WALK', 'CAR']);
const ramp = (x, on, dt, tin, tout) => clamp(x + (on ? dt / tin : -dt / tout), 0, 1);
/** The nearest person (a present NPC, a live enemy, the dog) within range of p: the entity, or null. */
function nearestPerson(p, range) {
  let best = null, bd = range;
  const N = G.npcs || [], E = G.enemies || [];
  for (let i = 0; i < N.length; i++) { const n = N[i]; if (!n || !n.present) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd && d > 8) { bd = d; best = n; } }
  for (let i = 0; i < E.length; i++) { const e = E[i]; if (!e || e.dead || e.gone) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd && d > 8) { bd = d; best = e; } }
  const dg = G.dog; if (dg && Number.isFinite(dg.x)) { const d = Math.hypot(dg.x - p.x, dg.y - p.y); if (d < bd && d > 8) best = dg; }
  return best;
}
/** The nearest present (not scripted) NPC within range: a dialogue's partner when no TALK target was latched (§4.18). */
function nearestNpc(p, range) {
  let best = null, bd = range;
  const N = G.npcs || [];
  for (let i = 0; i < N.length; i++) { const n = N[i]; if (!n || !n.present || n.scripted) continue; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd && d > 8) { bd = d; best = n; } }
  return best;
}
/** The cover he is in (§4.19): the nearest bullet-blocking neighbour cell (the sim's own test): 1 low, 0 tall; and its side. */
function coverKind(L, p) {
  const m = G.map; if (!m || !m.getSolid) return;
  const cx = Math.floor(p.x / 32), cy = Math.floor(p.y / 32);
  let bd = Infinity, low = 1, side = 1;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    if (!ox && !oy) continue;
    const nx = cx + ox, ny = cy + oy, so = m.getSolid(nx, ny), b = m.blockerAt ? m.blockerAt(nx, ny) : null;
    const isLow = COVER_LOW.has(so) || (b && b.kind === 'cover'), isTall = COVER_TALL.has(so);
    if (!isLow && !isTall) continue;
    const rx = nx * 32 + 16, ry = ny * 32 + 16, d = Math.hypot(rx - p.x, ry - p.y);
    if (d < bd) { bd = d; low = isLow ? 1 : 0; const a = p.angle || 0; side = -Math.sin(a) * (rx - p.x) + Math.cos(a) * (ry - p.y) >= 0 ? 1 : -1; }
  }
  if (bd < Infinity) { L.coverLowT = low; L.coverSide = side; }
}
function lifeClocks(r, p) {
  const st = r.st, L = st.lf, dt = S.liveDt, adt = S.adt, rnd = L.rnd, LF = LIFE;
  L.clock = (L.clock || 0) + dt; // (the life motions' clock: it stops while paused, unlike G.time)
  LV.chestYaw = 0; LV.gunW = 0; LV.swayYaw = LV.swayPitch = 0; LV.reachE = 0; LV.kneel = 0;
  if (p.dead || S.hardReset) {
    L.stroll = L.carry = L.prowl = L.cover = L.low = L.hok = L.phone = L.modal = 0; L.hokOn = false; L.fid = null; L.fw = 0; L.c.w = L.c.fw = 0; L.c.phase = 0;
    L.g.ph = 0; L.g.yaw = L.g.pitch = 0; L.pg.ph = 0; L.pg.w = 0; L.reach.on = false; L.talk.on = false; L.talk.w = 0; L.item.t = 9; L.abil.t = 9; L.steady = 9;
    if (L.modalTool && st.tool === L.modalTool) st.tool = null; L.modalTool = null; L.modalKind = null;
    // (the item and ability baselines follow along, so an inventory restored by a respawn or a cooldown left over from the
    // last game is not read as a use on the first live frame)
    const inv0 = (G.s && G.s.inv) || null;
    L.prevMed = inv0 ? invSum(inv0, QUICK_MED) : 0; L.prevFood = inv0 ? invSum(inv0, QUICK_FOOD) : 0;
    const cd0 = G.abilityCd; if (cd0) for (const id in cd0) L.prevCd[id] = cd0[id] || 0;
    lifeOut(L); return;
  }
  // (TUNE.enable.idleLife: the isolation switch; off, no contrapposto, glances or fidgets, e.g. for the §7.4 value gate)
  const idleOn = TUNE.enable.idleLife !== false;
  const busyF = !!st.stateF && st.stateF !== 'modal', relaxed = S.aimW < 0.05, still = !S.gaitOn && !busyF && st.stillT > 0.3;
  const calm = !S.combat && (p.lastCombat ?? 99) > LF.fidget.calm && !S.threat;
  // ---- the eye (§4.2): enemies about and none sees him (prowl), any suspicious
  // (and how near the nearest one is: the prowl wants one within prowl.range, so an unaware enemy across the map doesn't
  // keep him crouching round his own yard; a quiet assault always does)
  let any = false, seen = false, sus = false, near = Infinity;
  const E = G.enemies || [];
  for (let i = 0; i < E.length; i++) { const e = E[i]; if (!e || e.dead || e.gone || (e.def && e.def.vehicle)) continue; any = true; if (e.alerted && e.canSee) seen = true; else if (!e.alerted && (e.sus || 0) > 0.12) sus = true; near = Math.min(near, Math.hypot(e.x - p.x, e.y - p.y)); }
  L.eye = any ? (seen ? 'seen' : sus ? 'sus' : 'hidden') : null;
  // ---- stroll (a tail job): the pistol goes under the coat, the hands into the pockets; a shot draws at once
  const job = G.s && G.s.job;
  const wantStroll = !!G.tail && S.weapon === 'pistol' && !S.aimWant && S.aimW < (L.stroll > 0.01 ? 0.3 : 0.1) && !busyF && !st.tool && !GC.sw && !GC.rl && !(p.reloadT > 0) && !S.lowHp;
  // (an aim wanted: the holster path plays back quickly, the pistol out of the coat into the hand, then the aim)
  L.stroll = ramp(L.stroll, wantStroll, adt, LF.stroll.in, S.aimWant ? LF.stroll.draw : LF.stroll.out);
  if (S.shot) L.stroll = 0;
  // (the hands in the pockets only while nearly still; moving, the pistol stays hidden and the arms swing loose)
  L.pocket = ramp(L.pocket ?? 1, st.speed < LF.stroll.pocketSpeed, adt, LF.stroll.pocketIn, LF.stroll.pocketOut);
  // ---- carry (a delivery parcel in hand); at the end it is handed over (the left hand out, the parcel gone at the
  // reach's peak), then the arm comes down
  // (a long gun swapped in mid-delivery needs both hands: the parcel goes down without a hand-over, and comes back after)
  const CY = LF.carry, delivering = !!job && job.type === 'delivery' && job.stage === 'deliver', wantCarry = delivering && !S.long;
  if (wantCarry) { L.giveT = 9; L.parcel = L.parcel || L.carry > CY.show; }
  else if (L.parcel && L.carry > 0.9 && L.giveT >= 9 && !busyF && !p.dead && !delivering) L.giveT = 0; // (the hand-over starts)
  if (L.giveT < 9) { L.giveT += adt; if (L.giveT >= CY.giveT) L.parcel = false; if (L.giveT > CY.giveT + 0.6) L.giveT = 9; }
  if (wantCarry && L.carry > CY.show) L.parcel = true;
  L.carry = ramp(L.carry, wantCarry || (L.giveT < CY.giveT), adt, CY.in, CY.out);
  if (L.carry <= 0) L.parcel = false;
  // ---- prowl: enemies about but unaware of him, or a quiet assault; never sprinting or fighting
  const wantProwl = (((L.eye === 'hidden' || L.eye === 'sus') && near < LF.prowl.range) || (G.assault && !G.assault.alarm)) && st.sprintW < 0.3 && !S.combat && !busyF && L.stroll < 0.5;
  L.prowl = ramp(L.prowl, wantProwl, adt, LF.prowl.in, LF.prowl.in);
  // ---- cover: in a fight, by bullet-blocking cover, nearly still
  const wantCover = S.combat && !!p.inCover && st.speed < 20 && !busyF;
  if (wantCover) { L.coverT -= adt; if (L.coverT <= 0 || L.cover <= 0) { coverKind(L, p); L.coverT = 0.25; } }
  L.cover = ramp(L.cover, wantCover, adt, LF.cover.in, LF.cover.in);
  L.coverLow += ((L.coverLowT ?? 1) - L.coverLow) * (1 - Math.exp(-adt / 0.15));
  if (S.shot && L.cover > 0.3) L.popT = 0; else if (L.popT < 9) L.popT += adt;
  // ---- low HP (blend in 0.6, out 1.0) and the heartbeat
  L.low = ramp(L.low, S.lowHp, adt, LF.lowHp.in, LF.lowHp.out);
  if (L.low > 0) { const frac = clamp(p.hp / st.maxHp, 0, 0.3), per = LF.lowHp.beat[0] + frac * LF.lowHp.beat[1]; L.beatPh += dt; if (L.beatPh >= per) L.beatPh -= per; } else L.beatPh = 0;
  // ---- hands on knees: out of breath after a sprint, stopped (long guns skip it)
  const HK = LF.hok, stam = (p.stamina ?? st.maxSt) / st.maxSt;
  if (!L.hokOn) { if (!S.gaitOn && st.stillT > HK.still && st.sinceSprint < HK.sprintAgo + HK.still && stam < HK.stam && S.aimW < 0.1 && !S.long && !busyF && !S.combat && L.carry < 0.5) { L.hokOn = true; L.hokT = 0; } }
  else { L.hokT += dt; if (S.gaitOn || S.combat || S.aimW > 0.1 || stam > HK.stamOut || L.hokT > HK.max || busyF || S.long) { L.hokOn = false; L.hokExT = 0; } }
  if (L.hokExT !== undefined && L.hokExT < 9) { L.hokExT += adt; if (L.hokExT > HK.exhaleT) L.hokExT = 9; }
  L.hok = ramp(L.hok, L.hokOn, adt, HK.in, HK.out);
  // ---- contrapposto (§4.7): the loaded side switches every U(period) s while he stands relaxed
  const C = L.c, CO = LF.contra, PL = st.planner;
  const cOk = !S.gaitOn && !busyF && !st.turning && L.hok < 0.1 && L.cover < 0.1 && st.stanceKey === 'relaxed';
  C.t -= dt;
  // (a switch waits for him to have stood quietly, both feet down and no idle step, for quietT s: he settles first)
  C.quiet = PL.stepping > 0 || !PL.planted(0) || !PL.planted(1) || S.gaitOn ? 0 : (C.quiet || 0) + dt;
  const force = DBG.contra; // (the harness's switch waits, like a natural one, for both feet down and no step running)
  if (force) C.t = 0;
  if (C.t <= 0) {
    if (cOk && (force || (st.stillT > 2.0 && C.quiet > CO.quietT)) && PL.planted(0) && PL.planted(1) && PL.stepping === 0 && C.phase === 0) {
      DBG.contra = false; C.side = -C.side; C.phase = 1; C.t = uniform(rnd, CO.period[0], CO.period[1]); }
    else C.t = 0.8;
  }
  C.x = clamp(C.x + clamp(C.side - C.x, -2 * dt / CO.T, 2 * dt / CO.T), -1, 1);
  if (S.gaitOn || busyF) C.phase = 0;
  const cWant = (idleOn ? 1 - S.amp : 0) * (busyF ? 0 : 1) * lerp(1, CO.aimK, S.aimWb) * (1 - L.hok) * (1 - L.cover);
  C.w += (cWant - C.w) * (1 - Math.exp(-adt / 0.25));
  C.fw += ((cOk && idleOn ? 1 : 0) * (1 - S.amp) - C.fw) * (1 - Math.exp(-adt / 0.3));
  // ---- glances (relaxed or lightly aimed; a person glance every U(9, 15) s)
  const GL = LF.glance, g = L.g, gOk = idleOn && S.aimW < 0.5 && !busyF && st.sprintW < 0.3 && L.hok < 0.5 && !(L.fid === 'neckRoll' || L.fid === 'gunCheck') && !L.talk.on;
  g.t += dt;
  // (one glance in GL.around.p is a look round: wider, slower, the chest more; only standing still)
  if (g.ph === 0) { g.next -= dt; if (g.next <= 0) { if (gOk) { const A = GL.around, ar = still && rnd() < A.p, Y = ar ? A.yaw : GL.yaw; g.ph = 1; g.t = 0; g.y0 = g.yaw; g.p0 = g.pitch; g.y1 = (rnd() < 0.5 ? -1 : 1) * uniform(rnd, Y[0], Y[1]); g.p1 = uniform(rnd, -GL.pitch, GL.pitch); const H = ar ? A.hold : GL.hold; g.hold = uniform(rnd, H[0], H[1]); g.tin = ar ? A.in : GL.in; g.tout = ar ? A.out : GL.out; g.chest = ar ? A.chest : GL.chest; } else g.next = 0.7; } }
  if (g.ph && !gOk && g.ph !== 3) { g.ph = 3; g.t = 0; g.y0 = g.yaw; g.p0 = g.pitch; }
  if (g.ph === 1) { const u = clamp(g.t / (g.tin || GL.in), 0, 1), e = ES(u); g.yaw = lerp(g.y0, g.y1, e); g.pitch = lerp(g.p0, g.p1, e); if (u >= 1) { g.ph = 2; g.t = 0; } }
  else if (g.ph === 2) { if (g.t >= g.hold) { g.ph = 3; g.t = 0; g.y0 = g.yaw; g.p0 = g.pitch; } }
  else if (g.ph === 3) { const u = clamp(g.t / (g.tout || GL.out), 0, 1), e = ES(u); g.yaw = lerp(g.y0, 0, e); g.pitch = lerp(g.p0, 0, e); if (u >= 1) { g.ph = 0; g.next = uniform(rnd, GL.every[0], GL.every[1]); } }
  LV.chestYaw += g.yaw * (g.chest ?? GL.chest);
  const PG = GL.person, pg = L.pg;
  pg.t += dt;
  if (pg.ph === 0) { pg.next -= dt; if (pg.next <= 0) { const who = gOk ? nearestPerson(p, PG.range) : null; if (who) { pg.ph = 1; pg.t = 0; pg.who = who; pg.hold = uniform(rnd, PG.hold[0], PG.hold[1]); } else pg.next = 2; } }
  if (pg.ph && (!gOk || !pg.who || pg.who.dead || pg.who.gone)) { if (pg.ph !== 3) { pg.ph = 3; pg.t = 0; } }
  if (pg.ph === 1) { pg.w = EO(clamp(pg.t / PG.in, 0, 1)); if (pg.t >= PG.in) { pg.ph = 2; pg.t = 0; } }
  else if (pg.ph === 2) { pg.w = 1; if (pg.t >= pg.hold) { pg.ph = 3; pg.t = 0; } }
  else if (pg.ph === 3) { pg.w = Math.min(pg.w, 1 - ES(clamp(pg.t / PG.out, 0, 1))); if (pg.w <= 0) { pg.ph = 0; pg.who = null; pg.next = uniform(rnd, PG.every[0], PG.every[1]); } }
  if (pg.who && pg.w > 0 && Number.isFinite(pg.who.x)) pg.yaw = Math.atan2(pg.who.y - p.y, pg.who.x - p.x);
  // ---- fidgets: one every U(10, 16) s, relaxed, calm, standing still
  if (DBG.fidget && FIDGETS[DBG.fidget]) { L.fid = DBG.fidget; L.fidLast = L.fid; L.fu = 0; L.fw = 1; DBG.fidget = null; }
  const FD = LF.fidget, fOk = idleOn && relaxed && calm && still && st.stillT > FD.still && L.hok <= 0 && L.low <= 0 && L.cover <= 0 && L.prowl <= 0 && !L.talk.on && L.reach.t > 1 && L.modal <= 0 && L.item.t > 0.6 && !st.tool && !G.cutscene;
  if (!L.fid) {
    L.fT -= dt;
    if (L.fT <= 0) {
      if (fOk) {
        const pool = ['neckRoll', 'shoulderRoll'];
        if (L.carry < 0.1 && L.stroll < 0.1) pool.push('lapelTug');
        if (S.weapon === 'pistol' && L.stroll < 0.1) pool.push('gunCheck');
        let pick = pool[Math.floor(rnd() * pool.length) % pool.length];
        if (pick === L.fidLast) pick = pool[(pool.indexOf(pick) + 1) % pool.length];
        L.fid = pick; L.fidLast = pick; L.fu = 0; L.fw = 1;
      } else L.fT = 1.5;
    }
  } else {
    L.fu += dt / FIDGETS[L.fid].T;
    if (!fOk || ((L.fid === 'lapelTug' || L.fid === 'gunCheck') && (L.stroll > 0.02 || L.carry > 0.02))) L.fw = Math.max(0, L.fw - adt / 0.2);
    if (L.fu >= 1 || L.fw <= 0) { L.fid = null; L.fw = 0; L.fT = uniform(rnd, FD.every[0], FD.every[1]); }
  }
  // ---- reach (§4.18): the interaction's short code, from the target the sim used
  const R = L.reach, RC = LF.reach;
  if (S.reach && !NO_REACH.has((G.interactTarget && G.interactTarget.short) || '')) {
    const tg = G.interactTarget;
    R.on = true; R.t = 0; R.short = (tg && tg.short) || ''; R.x = tg && Number.isFinite(tg.x) ? tg.x : p.x + 20 * Math.cos(p.angle || 0); R.y = tg && Number.isFinite(tg.y) ? tg.y : p.y + 20 * Math.sin(p.angle || 0);
    if (R.short === 'TALK') { const T = L.talk; T.on = true; T.x = R.x; T.y = R.y; T.t = 0; T.who = null; }
    // (the field-dress: a kneel, the right foot back a step so the right knee goes down toward the ground, the left forward)
    if (R.short === 'DRESS') { R.kneel = 0; const KN = RC.kneel, a = p.angle || 0; lungeStep(st, 1, -KN.back * Math.cos(a), -KN.back * Math.sin(a), 0.22, 2, KN.down + KN.T + 0.1); }
  }
  if (R.on) { R.t += dt || (S.presentation ? 0 : adt); if (R.t > (R.short === 'OPEN' || R.short === 'CLOSE' ? RC.open.T : RC.T) + RC.tail) R.on = false; }
  L.reachGate = ramp(L.reachGate ?? 1, !busyF && MC.w <= 0 && TC.w <= 0, adt, 0.06, 0.06); // (a full-body clip, a strike or a takedown owns the hands)
  if (R.kneel < 9) { R.kneel += dt || adt; if (R.kneel > RC.kneel.down + RC.kneel.T + RC.kneel.up) R.kneel = 9; }
  // ---- talk: face the one he talks to while the dialogue lasts (else the nearest NPC within range)
  const T = L.talk, dlg = G.modal === 'dialogue';
  if (dlg && !T.on) { const n = nearestNpc(p, RC.talk.range); if (n) { T.on = true; T.who = n; T.t = 0; } }
  if (T.on) {
    T.t += dt;
    if (T.who && Number.isFinite(T.who.x)) { T.x = T.who.x; T.y = T.who.y; }
    if (!dlg && T.t > 1.0) T.on = false;
    T.pollT -= S.realDt;
    if (T.pollT <= 0) { T.pollT = 0.25; let fr = false; try { const el = typeof document !== 'undefined' ? document.getElementById('dlg-who') : null; fr = !!el && el.textContent === 'Frank'; } catch { /* no DOM */ } T.frank = fr && dlg; }
  } else T.frank = false;
  T.w = ramp(T.w, T.on, S.realDt || adt, 0.25, 0.35);
  // (Frank speaking: the forearm up (fw) and speech beats at random intervals; listening, a head tilt)
  const TK = RC.talk, rdt = S.liveDt;
  T.fw = ramp(T.fw || 0, T.frank, rdt, 0.3, 0.45);
  if (T.frank) { T.next = (T.next ?? 0.2) - rdt; if (T.next <= 0) { T.beatT = 0; T.next = uniform(rnd, TK.beat[0], TK.beat[1]); } }
  if (T.beatT !== undefined && T.beatT < 9) { T.beatT += rdt; if (T.beatT > TK.beatIn + TK.beatOut) T.beatT = 9; }
  if (T.w > 0) {
    const rel = wrap(Math.atan2(T.y - p.y, T.x - p.x) - (st.face.x));
    LV.talkYaw = rel / DEG;
    LV.chestYaw += clamp(LV.talkYaw * RC.talk.chest, -RC.talk.chestMax, RC.talk.chestMax) * T.w;
  }
  // ---- the phone: the receiver at his ear while the call lasts
  L.phone = ramp(L.phone, (R.on && R.short === 'PHONE') || (L.phone > 0 && !!G.modal), S.realDt || adt, RC.phone.in, RC.phone.out);
  // ---- items (§4.2): a quick item used (its count dropped this frame, no menu open): a bandage or a medkit, or food
  const inv = (G.s && G.s.inv) || null, med = inv ? invSum(inv, QUICK_MED) : 0, food = inv ? invSum(inv, QUICK_FOOD) : 0;
  if (L.prevMed !== undefined && !S.first && !S.teleport && !G.modal && !G.cutscene) {
    if (med < L.prevMed) { L.item.t = 0; L.item.kind = 'bandage'; }
    else if (food < L.prevFood) { L.item.t = 0; L.item.kind = 'eat'; }
  }
  L.prevMed = med; L.prevFood = food;
  if (L.item.t < 9) { L.item.t += adt || S.realDt; if (L.item.t > (L.item.kind === 'eat' ? LF.item.eatT : LF.item.T)) L.item.t = 9; }
  // ---- abilities (the cooldown jumps): Misdirection, Controlled Fire, Emergency Repair
  const cd = G.abilityCd;
  if (cd) for (const id in cd) { const v = cd[id] || 0; if (v > (L.prevCd[id] || 0) + 0.5 && !S.first) { L.abil.id = id; L.abil.t = 0; if (id === 'controlled_fire') L.steady = 0; } L.prevCd[id] = v; }
  if (L.abil.t < 9) { L.abil.t += adt || S.realDt; if (L.abil.t > 1) L.abil.t = 9; }
  if (L.steady < 9) { L.steady += dt; if (L.steady > LF.steady.T) L.steady = 9; }
  // ---- modal poses (presentation): fishing, crafting, cooking, the repair game; the tool takes over at the blend's middle
  // with the right hand where the gun left it (toolHands), and gives the gun back there on the way out (no draw)
  // (a shot after the modal closed, inside its ramp-out, ends it at once: the gun is on the aim line for the flash, §4.4)
  if (S.shot) { L.modal = 0; L.modalKind = null; if (L.modalTool && st.tool === L.modalTool) st.tool = null; L.modalTool = null; }
  const mk = MODAL_POSE[G.modal] || null;
  if (mk) L.modalKind = mk;
  L.modal = ramp(L.modal, !!mk, S.realDt || adt, LF.modal.in, LF.modal.out);
  // (only while the modal is open: a tool cleared in the ramp-out, by a shot, is never put back)
  if (mk && L.modal >= 0.5 && L.modalKind && !st.tool) { st.tool = L.modalKind; L.modalTool = L.modalKind; st.stowed = true; st.drawStart = false; }
  if (L.modalTool && (L.modal < 0.5 || st.tool !== L.modalTool)) { if (st.tool === L.modalTool) st.tool = null; L.modalTool = null; }
  if (L.modal <= 0) L.modalKind = null;
  // ---- the gun's life: the aimed sway (faded out round a shot: the bore is on the line for the flash)
  const DR = LF.drift, sk = ((p.steadyT || 0) > 0 ? DR.steadyK : 1) * (S.tShot < 0.15 ? 0 : ss(0.15, 0.4, S.tShot)), t = L.clock;
  LV.swayYaw = DR.sway * 0.5 * (Math.sin(0.7 * t) + Math.sin(1.13 * t + 1.3)) * sk * S.aimW;
  LV.swayPitch = DR.sway * DR.swayPitch * 0.5 * (Math.sin(0.83 * t + 0.4) + Math.sin(1.37 * t + 2.1)) * sk * S.aimW;
  LV.chestYaw += pg.w > 0 ? clamp(Math.abs(wrap(pg.yaw - st.chest.x) / DEG) - PG.max, 0, PG.chest) * Math.sign(wrap(pg.yaw - st.chest.x)) * pg.w : 0;
  lifeOut(L);
}
/** LV from the life state (eased sides, weights). */
function lifeOut(L) {
  const C = L.c, CO = LIFE.contra;
  LV.cw = C.w; LV.cS = 2 * ES((C.x + 1) / 2) - 1; LV.cFoot = C.fw;
  LV.gYaw = L.g.yaw; LV.gPitch = L.g.pitch; LV.pW = L.pg.w; LV.pYaw = L.pg.yaw;
  LV.fid = L.fid; LV.fu = L.fu; LV.fw = L.fw;
  if (L.fid === 'gunCheck' && L.fw > 0) { const GK = FIDGETS.gunCheck, u = clamp(L.fu, 0, 1); LV.chk = sample(GK.w, u) * L.fw; LV.chkHand = sample(GK.hand, u) * L.fw; LV.chkSlide = sample(GK.slide, u) * L.fw; }
  else LV.chk = LV.chkHand = LV.chkSlide = 0;
  LV.stroll = L.stroll; LV.carry = ES(L.carry); LV.pocket = ES(L.pocket ?? 1);
  const CY = LIFE.carry, gt = L.giveT ?? 9;
  LV.parcelK = L.parcel ? clamp((L.carry - CY.show) / CY.showK, 0, 1) : 0; // (the parcel grows in as the forearm comes up)
  LV.giveW = gt < 9 ? (gt < CY.giveT ? EO(clamp(gt / CY.giveT, 0, 1)) : 1 - ES(clamp((gt - CY.giveT) / 0.3, 0, 1))) : 0; LV.prowl = ES(L.prowl); LV.cover = ES(L.cover); LV.coverLow = L.coverLow; LV.coverSide = L.coverSide;
  const PO = LIFE.cover.low, pt = L.popT;
  LV.pop = pt < PO.popIn ? EO(pt / PO.popIn) : pt < PO.popIn + PO.popHold ? 1 : pt < PO.popIn + PO.popHold + PO.popOut ? 1 - ES((pt - PO.popIn - PO.popHold) / PO.popOut) : 0;
  LV.low = ES(L.low); LV.beat = L.low > 0 && L.beatPh < LIFE.lowHp.beatT ? Math.sin(Math.PI * L.beatPh / LIFE.lowHp.beatT) : 0; LV.hok = ES(L.hok);
  LV.hokEx = L.hokExT !== undefined && L.hokExT < 9 ? Math.sin(Math.PI * clamp(L.hokExT / LIFE.hok.exhaleT, 0, 1)) : 0;
  const R = L.reach;
  // (OPEN / CLOSE: in 0.15 (O), held, out 0.15 (S) over open.T: the hand stays on the handle long enough to read)
  const RC = LIFE.reach, opn = R.short === 'OPEN' || R.short === 'CLOSE', OT = RC.open.T;
  LV.reachE = R.on ? (opn ? (R.t < 0.15 ? EO(R.t / 0.15) : R.t < OT - 0.15 ? 1 : 1 - ES(clamp((R.t - OT + 0.15) / 0.15, 0, 1))) : Math.sin(Math.PI * clamp(R.t / RC.T, 0, 1))) * (L.reachGate ?? 1) : 0;
  LV.reachShort = R.on ? R.short : ''; LV.reachT = R.t;
  // (the field-dress kneel: down over KN.down (S), working for KN.T, up over KN.up (S); kneelUp: the rise's progress)
  const KN = RC.kneel, kt = R.kneel;
  LV.kneel = kt < 9 ? (kt < KN.down ? ES(kt / KN.down) : kt < KN.down + KN.T ? 1 : 1 - ES(clamp((kt - KN.down - KN.T) / KN.up, 0, 1))) * (L.reachGate ?? 1) : 0;
  LV.kneelUp = kt < 9 && kt >= KN.down + KN.T ? clamp((kt - KN.down - KN.T) / KN.up, 0, 1) : -1;
  LV.kneelT = kt;
  LV.talkW = ES(L.talk.w); LV.phone = ES(L.phone);
  const T = L.talk, TK = RC.talk; LV.talkF = ES(T.fw || 0);
  LV.talkBeat = T.beatT !== undefined && T.beatT < 9 ? (T.beatT < TK.beatIn ? EO(T.beatT / TK.beatIn) : 1 - ES(clamp((T.beatT - TK.beatIn) / TK.beatOut, 0, 1))) : 0;
  const eat = L.item.kind === 'eat';
  LV.itemW = L.item.t < 9 ? sample(eat ? LIFE.item.eatW : LIFE.item.w, L.item.t / (eat ? LIFE.item.eatT : LIFE.item.T)) : 0; LV.item = L.item.kind;
  LV.bite = L.item.t < 9 && eat ? sample(LIFE.item.bites, L.item.t / LIFE.item.eatT) : 0;
  LV.abil = L.abil.t < 9 ? L.abil.id : ''; LV.abilT = L.abil.t;
  LV.steadyK = L.steady < 9 ? Math.sin(Math.PI * clamp(L.steady / LIFE.steady.T, 0, 1)) : 0;
  LV.modal = ES(L.modal); LV.modalKind = L.modalKind; LV.eye = L.eye;
  LV.hol = L.stroll;
}

/** The body channels of life (§4.7, §4.18, §4.19), on the composed C + U pose (the full-body clips start from it). */
function lifePose(r, p) {
  const st = r.st, P = PB, L = st.lf;
  if (p.dead) return;
  const relax = 1 - S.aimWb;
  // contrapposto: the loaded hip up and the hips over the loaded foot, the shoulders counter-rolled, the head righted
  if (LV.cw > 0.001) {
    const CO = LIFE.contra, k = LV.cw, s = LV.cS;
    P[PK.pel + 2] += CO.shift * s * k; P[PK.pelRot + 2] += -CO.roll * s * k; P[PK.pel + 1] -= CO.drop * k * Math.abs(s);
    P[PK.s1 + 2] += CO.s1 * s * k; P[PK.s2 + 2] += CO.s2 * s * k; P[PK.head + 2] -= CO.head * s * k;
  }
  // the relaxed gun hand's slow drift
  P[PK.armR + 4] += LIFE.drift.wrist * noise1(L.clock * LIFE.drift.hz) * relax;
  // fidgets
  if (LV.fid && LV.fw > 0) {
    const F = FIDGETS[LV.fid], u = clamp(LV.fu, 0, 1), w = LV.fw;
    if (LV.fid === 'neckRoll') { const rl = sample(F.headRoll, u) * w, pt = sample(F.headPitch, u) * w; P[PK.head + 2] += 0.6 * rl; P[PK.neck + 2] += 0.4 * rl; P[PK.head] += 0.6 * pt; P[PK.neck] += 0.4 * pt; }
    else if (LV.fid === 'shoulderRoll') { const e = sample(F.clavElev, u) * w, pr = sample(F.clavProt, u) * w; P[PK.clavL] += e; P[PK.clavR] += e; P[PK.clavL + 1] += pr; P[PK.clavR + 1] += pr; }
    else if (LV.fid === 'gunCheck') { const hp = sample(F.headPitch, u) * w; P[PK.head] += 0.6 * hp; P[PK.neck] += 0.4 * hp; P[PK.head + 1] += sample(F.headYaw, u) * w; P[PK.s2] += sample(F.s2, u) * w; } // (the gun and the hands: baseGun, lifeLeft)
    else if (LV.fid === 'lapelTug') { P[PK.head] += sample(F.headPitch, u) * w; P[PK.s2 + 2] += sample(F.spine2Roll, u) * w; }
  }
  // rain: the shoulders up and the head down against it, relaxed (eased on the wet wool's own τ 2 s)
  // (eased off as a fight starts, never switched: relax already takes it out as the gun comes up)
  L.rainK = ramp(L.rainK ?? 0, !S.combat, S.adt, 0.4, 0.4);
  const WT = TUNE.light, rk = clamp((st.wet - 0.3) / 0.5, 0, 1) * relax * ES(L.rainK);
  if (rk > 0) { P[PK.clavL] += WT.wetShrug * rk; P[PK.clavR] += WT.wetShrug * rk; P[PK.clavL + 1] += 3 * rk; P[PK.clavR + 1] += 3 * rk; P[PK.head] += WT.wetHead * rk; P[PK.s2] += 3 * rk; }
  // stroll: the shoulders up a touch with the hands in the pockets
  if (LV.stroll > 0) { const k = ES(clamp((LV.stroll - 0.3) / 0.7, 0, 1)) * LV.pocket; P[PK.clavL] += 2 * k; P[PK.clavR] += 2 * k; P[PK.clavL + 1] += 3 * k; P[PK.clavR + 1] += 3 * k; }
  // carry: the left forearm cradles the parcel (FK; aimed, the pistol goes one-handed)
  if (LV.carry > 0) {
    const a = readArm(P, PK.armL, ARM_L), c = LIFE.carry.armL, k = LV.carry;
    a.flex = lerp(a.flex, c.flex, k); a.abd = lerp(a.abd, c.abd, k); a.twist = lerp(a.twist, c.twist, k); a.elbow = lerp(a.elbow, c.elbow, k); a.wflex = lerp(a.wflex, c.wflex, k); a.wroll = lerp(a.wroll, c.wroll, k);
    writeArm(P, PK.armL, a);
  }
  // prowl: down and leaning in, the head up to see, the elbows in
  if (LV.prowl > 0) {
    const PW = LIFE.prowl, k = LV.prowl;
    P[PK.pel + 1] += PW.pelvis * k; P[PK.pelRot] += 0.3 * PW.lean * k; P[PK.s1] += (0.3 * PW.lean + PW.s1) * k; P[PK.s2] += 0.4 * PW.lean * k; P[PK.head] += PW.head * k;
    P[PK.armL + 1] += PW.abd * k; P[PK.armR + 1] += PW.abd * k;
  }
  // cover: crouched behind low cover (popping up on a shot), or leaning off tall cover
  if (LV.cover > 0) {
    const CV = LIFE.cover, k = LV.cover, lo = LV.coverLow, hi = 1 - lo;
    P[PK.pel + 1] += (CV.low.pelvis + CV.low.pop * LV.pop) * k * lo + CV.tall.pelvis * k * hi;
    P[PK.s2] += CV.low.s2 * (1 - LV.pop) * k * lo; P[PK.s1] += CV.low.s1 * (1 - LV.pop) * k * lo;
    P[PK.s1 + 2] -= CV.tall.roll * 0.5 * LV.coverSide * k * hi; P[PK.s2 + 2] -= CV.tall.roll * 0.5 * LV.coverSide * k * hi;
  }
  // low HP: hunched, the heartbeat, the limp's hip drop over the right stance
  if (LV.low > 0) {
    const LH = LIFE.lowHp, k = LV.low;
    P[PK.s2] += (LH.s2 + LH.beatPitch * LV.beat) * k; P[PK.s1] += LH.s1 * k; P[PK.neck] += LH.neck * k; P[PK.head] += LH.head * k;
    P[PK.clavL] += LH.clavElev * k; P[PK.clavR] += LH.clavElev * k; P[PK.clavL + 1] += LH.clavProt * k; P[PK.clavR + 1] += LH.clavProt * k;
    // (the limp's hip roll over the right stance, a sin envelope on its progress (0 at the contact and the toe-off: never a
    // step), and the hitch at the right heel-strike)
    // (on the gait phase, as the planner reads the right foot's cycle: continuous, so a forced lift-off never steps it)
    if (S.amp > 0.001) {
      const sg = Math.max(0.15, S.sigma + LH.sigD * k), c = (((S.phi - 0.5) % 1) + 1) % 1, u = c < sg ? c / sg : -1;
      if (u >= 0) {
        P[PK.pelRot + 2] += LH.limpRoll * k * S.amp * Math.sin(Math.PI * u);
        if (u < 0.3) P[PK.pel + 1] -= LH.hitch * k * S.amp * Math.sin(Math.PI * u / 0.3);
      }
    }
  }
  // hands on knees
  if (LV.hok > 0) {
    const HK = LIFE.hok, k = LV.hok;
    P[PK.pel + 1] += HK.pelvis * k; P[PK.pelRot] += HK.pelvisPitch * k; P[PK.s2] += HK.s2 * k; P[PK.s1] += HK.s1 * k; P[PK.neck] += HK.neck * k; P[PK.head] += HK.head * k;
    // the heave: each breath lifts the chest, the shoulders and the head (inhale +1, exhale −1)
    const hv = (st.breathA > 1e-3 ? 2 * S.breath / st.breathA - 1 : 0) * k, HV = HK.heave;
    P[PK.s2] -= HV.s2 * hv; P[PK.clavL] += HV.clav * hv; P[PK.clavR] += HV.clav * hv; P[PK.head] -= HV.head * hv;
  }
  // (coming up out of it: one exhale with a lean back)
  if (LV.hokEx > 0) P[PK.s2] -= LIFE.hok.exhale * LV.hokEx;
  // reaches (§4.18)
  const e = LV.reachE, RC = LIFE.reach;
  if (e > 0) {
    const sh = LV.reachShort;
    if (sh === 'OPEN' || sh === 'CLOSE') P[PK.s2] += RC.open.s2 * e;
    else if (sh === 'TAKE' || sh === 'PICK' || sh === 'ARM' || sh === 'GIVE' || sh === 'DROP') { P[PK.pel + 1] += RC.take.pelvis * e; P[PK.s2] += RC.take.s2 * e; P[PK.s1] += 0.3 * RC.take.s2 * e; }
    else if (sh === 'LOOK') { P[PK.s2] += RC.look.s2 * e; P[PK.head] += RC.look.head * e; }
    else if (sh === 'TALK') P[PK.head] += RC.talk.nod * e;
  }
  // the field-dress kneel: down over the carcass, the head down at the work; a forward lean to stand up (the hand: lifeLeft)
  if (LV.kneel > 0) {
    const KN = RC.kneel, k = LV.kneel;
    P[PK.pel + 1] += KN.pelvis * k; P[PK.s2] += KN.s2 * k; P[PK.s1] += KN.s1 * k; P[PK.head] += 0.6 * KN.head * k; P[PK.neck] += 0.4 * KN.head * k;
    if (LV.kneelUp >= 0) P[PK.s2] += KN.rise * Math.sin(Math.PI * Math.min(1, LV.kneelUp * 1.6));
  }
  // talking: Frank speaking raises the free (left) forearm, the palm open, and beats it on the words (a nod with each);
  // listening, the head tilts
  if (LV.talkW > 0) {
    const TK = RC.talk, k = LV.talkW * relax, kf = k * LV.talkF, b = LV.talkBeat * kf;
    if (kf > 0) {
      const a = readArm(P, PK.armL, ARM_L);
      // (each beat: the forearm lifts and the hand opens out, the shoulder with it, the head nods)
      a.flex += TK.flex * kf + TK.beatFlex * b; a.abd += TK.abd * kf + TK.beatAbd * b; a.elbow = lerp(a.elbow, TK.elbow, kf) + TK.beatElbow * b; a.wroll += TK.wroll * kf; a.wflex -= 10 * kf; a.twist += 10 * kf;
      writeArm(P, PK.armL, a);
      P[PK.head] += TK.beatNod * b; P[PK.clavL] += TK.beatClav * b;
    }
    P[PK.head + 2] += TK.listen * k * (1 - LV.talkF);
  }
  // items: food to the mouth takes the head down to it, with a nod at each bite
  if (LV.itemW > 0 && LV.item === 'eat') P[PK.head] += LIFE.item.eatHead * LV.itemW + LV.bite;
  // (the bandage: he looks down at his side as he presses it on)
  if (LV.itemW > 0 && LV.item === 'bandage') { P[PK.head] += 12 * LV.itemW; P[PK.head + 1] -= 22 * LV.itemW; P[PK.s2] += 4 * LV.itemW; P[PK.s2 + 2] -= 4 * LV.itemW; }
  // Misdirection's throw turns the chest; Controlled Fire's deep breath lifts the shoulders
  if (LV.abil === 'misdirection') { P[PK.s2 + 1] += sample(LIFE.misdirection.s2Yaw, LV.abilT); P[PK.clavL + 1] += sample(LIFE.misdirection.clavProt, LV.abilT); }
  else if (LV.abil === 'emergency_repair') P[PK.s2 + 1] += sample(LIFE.patch.s2Yaw, LV.abilT);
  if (LV.steadyK > 0) { P[PK.clavL] += LIFE.steady.clav * LV.steadyK; P[PK.clavR] += LIFE.steady.clav * LV.steadyK; P[PK.s2] -= 1.5 * LV.steadyK; }
}

/**
 * The head look (§4.20), applied last: the aim point's distance (aimed), a threat drawing a bead on him, the one he talks
 * to, the thing he reaches for or works on, the person he glances at, the idle glances. The neck takes 40%, the head 60%;
 * yaw within ±70° of the chest, pitch −30..+25; one critically damped spring per axis.
 */
function headLook(r, p) {
  const st = r.st, L = st.lf, LK = LIFE.look, P = PB;
  if (p.dead) { resetSpring(L.look.y, 0); resetSpring(L.look.p, 0); LV.lookYaw = LV.lookPitch = 0; return; } // (the fall owns the head)
  let yaw = 0, pitch = 0, abs = null;
  const on = !p.dead && (!st.stateF || st.stateF === 'modal') && TUNE.enable.headLook;
  if (on) {
    const eyeY = 68;
    if (S.aimW > 0.5) {
      if (!S.long) pitch = LK.aimK * (Math.atan2(eyeY - 30, st.aimD) / DEG - LK.aimRef);
    } else {
      // a threat within ±110° of the chest
      const E = G.enemies || [];
      let th = null, bd = 500;
      for (let i = 0; i < E.length; i++) { const e = E[i]; if (!e || e.dead || !((e.aimT || 0) > 0)) continue; const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd && Math.abs(wrap(Math.atan2(e.y - p.y, e.x - p.x) - st.chest.x)) < LK.threatArc * DEG) { bd = d; th = e; } }
      if (th) abs = Math.atan2(th.y - p.y, th.x - p.x);
      else if (LV.talkW > 0.01) { abs = Math.atan2(L.talk.y - p.y, L.talk.x - p.x); pitch = 2; }
      else if (L.reach.on && Math.hypot(L.reach.x - p.x, L.reach.y - p.y) < LK.interact) { abs = Math.atan2(L.reach.y - p.y, L.reach.x - p.x); pitch = 14; }
      else if (LV.pW > 0.01) { abs = st.face.x + wrap(LV.pYaw - st.face.x) * LV.pW; }
      else { yaw = LV.gYaw; pitch = LV.gPitch; }
      if (abs !== null) yaw = wrap(abs - st.face.x) / DEG;
      // (an interaction target he walks up to, within reach: a glance down at it)
      const tg = G.interactTarget;
      if (abs === null && S.aimW < 0.05 && tg && Number.isFinite(tg.x)) { const d = Math.hypot(tg.x - p.x, tg.y - p.y); if (d < LK.interact && d > 6) { const k = LK.idleK * (1 - ss(LK.interact * 0.6, LK.interact, d)); yaw = lerp(yaw, wrap(Math.atan2(tg.y - p.y, tg.x - p.x) - st.face.x) / DEG, k); pitch = lerp(pitch, 12, k); } }
    }
  }
  // the limits relative to the chest
  const faceRel = wrap(st.face.x - st.chest.x) / DEG;
  yaw = clamp(faceRel + yaw, -LK.yawMax, LK.yawMax) - faceRel;
  pitch = clamp(pitch, LK.pitchLo, LK.pitchHi);
  const k = S.liveDt; // (0 while paused: the head holds)
  springTo(L.look.y, yaw, LK.omega, k); springTo(L.look.p, pitch, LK.omega, k);
  if (!Number.isFinite(L.look.y.x) || !Number.isFinite(L.look.p.x)) { resetSpring(L.look.y, 0); resetSpring(L.look.p, 0); }
  LV.lookYaw = L.look.y.x; LV.lookPitch = L.look.p.x;
  P[PK.head + 1] += LV.lookYaw; P[PK.head] += 0.6 * LV.lookPitch; P[PK.neck] += 0.4 * LV.lookPitch;
}

/**
 * The right hand's life targets before the gun is placed (§4.8 stroll, §4.19 hands on knees): the relaxed pistol rides
 * the FK hand, so a hand IK'd here carries the gun with it (into the holster under the coat, onto his knee); a holstered
 * pistol leaves the hand free for the coat pocket.
 */
const _lw = V(), _lq = new THREE.Quaternion(), _lw2 = V(), _lq2 = new THREE.Quaternion();
const POLE_POCKET_R = [-0.5, -1, 0.5], POLE_KNEE_R = [0.6, -0.4, 0.8], POLE_HOL = [-0.2, -1, 0.9];
function lifeArms(r, p) {
  const st = r.st, B = r.bones;
  if (p.dead || st.tool || GC.sw || GC.rl > 0 || S.weapon !== 'pistol' || S.aimW > 0.95) return;
  const hok = LV.hok * (1 - S.aimW), hol = LV.hol;
  if (hok <= 0.001 && hol <= 0.001) return;
  boneFrame(B.handR, _fkRw, _fkRq); boneFrame(B.handL, _fkLw, _fkLq);
  _fkRe.setFromMatrixPosition(B.forearmR.matrixWorld); _fkLe.setFromMatrixPosition(B.forearmL.matrixWorld);
  if (hol > 0.001) {
    // 0 → .45: the hand carries the pistol from the carry to the holster under the coat (left armpit); the pistol slips
    // under the coat front at holHide (its muzzle still down and across), so it never sweeps sideways at chest height;
    // .45 → 1: from the holster into the right coat pocket, nearly still, or back out to the free swinging hand, moving
    // (the gun is hidden from holHide, weapons())
    namedGun(r, 'holster', GT); onFrame(GT.p, GT.q, H_GRIP, _lw, _lq);
    if (hol < 0.45) {
      const u = ES(hol / 0.45);
      bodyPath(r, _fkRw, _lw, SWAP.exit.hand, SWAP.exit.holster, u, _wR); _qR.slerpQuaternions(_fkRq, _lq, u);
      armIK(r, 'R', _wR, _qR, POLE_HOL, 1, u, 0);
    } else {
      // (the free hand: the pocket, by the pocket weight; else the FK swing, with the FK elbow)
      pocketHand(r, 1, _lw2, _lq2);
      const pk = LV.pocket; _lw2.lerpVectors(_fkRw, _lw2, pk); _lq2.slerpQuaternions(_fkRq, _lq2, pk);
      const u = ES((hol - 0.45) / 0.55);
      bodyPath(r, _lw, _lw2, SWAP.exit.holster, SWAP.exit.hand, u, _wR); _qR.slerpQuaternions(_lq, _lq2, u);
      armIK(r, 'R', _wR, _qR, lerp3(POLE_HOL, POLE_POCKET_R, u, POLE_TMP), 1, 1 - u * (1 - pk), 0);
    }
  } else if (hok > 0.001) {
    kneeHand(r, 1, _wR, _qR);
    armIK(r, 'R', _wR, _qR, POLE_KNEE_R, hok, hok, 0);
  }
}
/** A hand in its coat pocket (side +1 right, −1 left): the wrist into the pocket slit, the fingers down into it. */
function pocketHand(r, side, outP, outQ) {
  const B = r.bones, pk = side > 0 ? LIFE.stroll.pocketR : LIFE.stroll.pocketL;
  workV(S.hipYaw, 0.12, -1, -0.5 * side, _hX); workV(S.hipYaw, 0, 0, side, _hZ);
  handQW(_hX, _hZ.negate(), side > 0, outQ);
  outP.set(pk[0], pk[1], pk[2]).applyMatrix4(B.pelvis.matrixWorld);
  return outP;
}
/** A hand on its knee (hands on knees): the palm on the knee cap's top, the fingers forward and down the shin. */
function kneeHand(r, side, outP, outQ) {
  const B = r.bones, sh = B[side > 0 ? 'shinR' : 'shinL'], kt = SOCKETS.shin.kneeTop;
  _gv.set(kt[0], kt[1], kt[2] * side).applyMatrix4(sh.matrixWorld);
  _gv2.set(0.5, -1, 0).transformDirection(sh.matrixWorld); _hX.copy(_gv2); _hX.y -= 0.3;
  handQW(_hX, _hZ.set(0, -1, 0), side > 0, outQ);
  // the palm (hand-local (0.3, −2.6, ∓1.1)) on the knee
  outP.copy(_gv).sub(_gv3.set(0.3, -2.6, side > 0 ? -1.1 : 1.1).applyQuaternion(outQ));
  outP.y += 1.0;
  return outP;
}
/** One left-hand override at a world target (wrist, hand rotation): kept if it outweighs the current one. */
function setALw(w, wrist, q, pole) { if (w <= AL.w) return; AL.w = w; AL.p.copy(wrist); AL.q.copy(q); AL.pole = pole; }
const _ow = V(), _oq = new THREE.Quaternion();
const POLE_POCKET_L = [-0.5, -1, -0.5], POLE_SIDE = [-0.6, -1, -0.6], POLE_FACE = [0.2, -1, -0.9], POLE_LAPEL = [0.1, -1, -0.8], POLE_KNEE_L = [0.6, -0.4, -0.8];
/** The left hand's life gestures, as leftOverride candidates (they win over the support grip while their weight lasts). */
/** The left hand pressed to his side (the low-HP flank, the bandage), rubbing `rub` u at 3 Hz on the life clock: a left-hand override. */
function sideHand(r, w, rub) {
  const s = LIFE.lowHp.side, t = r.st.lf.clock;
  _ow.set(s[0] + rub * Math.sin(2 * Math.PI * 3 * t), s[1] + rub * Math.cos(2 * Math.PI * 3 * t), s[2]).applyMatrix4(r.bones.pelvis.matrixWorld);
  workV(S.hipYaw, 0.5, -0.6, 0.45, _hX); workV(S.hipYaw, 0, 0, 1, _hZ); handQW(_hX, _hZ, false, _oq); _ow.sub(_gv3.set(0.3, -2.6, 1.1).applyQuaternion(_oq));
  setALw(w, _ow, _oq, POLE_SIDE);
}
const FING_THROW = [0.3, 1, 0.2], PALM_THROW = [1, 0, 0.2];
/** The left hand's life gestures, as leftOverride candidates (they win over the support grip while their weight lasts). */
function lifeLeft(r, p) {
  const st = r.st, B = r.bones, yaw = S.faceYaw, o = aimOrigin(r, _tw);
  const relaxedPistol = S.weapon === 'pistol' && !st.tool;
  // (the parcel in the left arm: the gestures that would take it to his flank, his mouth, his ear or overhead wait)
  const free = 1 - LV.carry;
  // the stroll's pocket (only while nearly still), the knees, his side (low HP, relaxed pistol)
  if (LV.hol > 0.3 && relaxedPistol) { pocketHand(r, -1, _ow, _oq); setALw(ES(clamp((LV.hol - 0.3) / 0.7, 0, 1)) * (1 - S.aimW) * LV.pocket, _ow, _oq, POLE_POCKET_L); }
  // (rain, relaxed and still: the left hand into the coat pocket)
  const wetK = clamp((st.wet - 0.3) / 0.5, 0, 1) * (1 - S.aimW) * ES(st.lf.rainK ?? 0) * (S.gaitOn ? 0 : 1) * free;
  st.lf.wetHand = ramp(st.lf.wetHand ?? 0, wetK > 0.5, S.adt, 0.5, 0.35);
  if (st.lf.wetHand > 0 && relaxedPistol && LV.hol <= 0.3) { pocketHand(r, -1, _ow, _oq); setALw(ES(st.lf.wetHand) * (1 - S.aimW), _ow, _oq, POLE_POCKET_L); }
  if (LV.hok > 0 && relaxedPistol) { kneeHand(r, -1, _ow, _oq); setALw(LV.hok * (1 - S.aimW), _ow, _oq, POLE_KNEE_L); }
  if (LV.low > 0 && relaxedPistol && S.aimW < 0.5 && !GC.rl) sideHand(r, LV.low * (1 - S.aimW) * (1 - LV.hok) * free, 0);
  // the lapel tug
  if (LV.fid === 'lapelTug' && LV.fw > 0) {
    const F = FIDGETS.lapelTug, u = clamp(LV.fu, 0, 1), s = SOCKETS.spine2.lapelL, tug = sample(F.tug, u);
    _ow.set(s[0] + 0.5, s[1] - 3.2 - tug, s[2] - 1.6).applyMatrix4(B.spine2.matrixWorld);
    workV(yaw, -0.1, 1, 0.25, _hX); workV(yaw, -1, 0, 0.2, _hZ); handQW(_hX, _hZ, false, _oq);
    _ow.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_oq));
    setALw(sample(F.w, u) * LV.fw, _ow, _oq, POLE_LAPEL);
  }
  // the gun check: the left hand on the slide (it pulls it back a touch: the press-check)
  if (LV.chkHand > 0 && st.inHand === 'pistol') { wpLeft(r, WP.RACK, 'pistol', GN, _ow, _oq); setALw(LV.chkHand * (1 - S.aimW), _ow, _oq, POLE_GUARD); }
  // the parcel handed over: the left hand out in front, palm up (the parcel rides the forearm out, and goes at the peak)
  if (LV.giveW > 0) { const g = LIFE.carry.give; setAL(yaw, o, LV.giveW, g[0], g[1], g[2], FING_GIVE, PALM_GIVE, POLE_REACH); }
  // reaches: a door's handle, a pick-up low in front, any other reach at chest height
  const e = LV.reachE, RC = LIFE.reach, L = st.lf;
  if (e > 0) {
    const sh = LV.reachShort;
    if (sh === 'OPEN' || sh === 'CLOSE') {
      let dx = L.reach.x - p.x, dz = L.reach.y - p.y; const d = Math.hypot(dx, dz) || 1, cl = Math.min(d, RC.open.clamp); dx *= cl / d; dz *= cl / d;
      _ow.set(p.x + dx, RC.open.y, p.y + dz); const ry = Math.atan2(dz, dx);
      workV(ry, 1, -0.2, 0.1, _hX); workV(ry, 0, 0, 1, _hZ); handQW(_hX, _hZ, false, _oq);
      // (the handle turns: the wrist rolls over the hold)
      const tr = RC.open.roll * DEG * ss(0.1, 0.25, LV.reachT) * (1 - ss(RC.open.T - 0.2, RC.open.T - 0.05, LV.reachT));
      if (tr) _oq.multiply(_hq3.setFromAxisAngle(_gv3.set(0, 1, 0), -tr));
      _ow.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_oq));
      setALw(e, _ow, _oq, POLE_REACH);
    } else if (sh === 'TAKE' || sh === 'PICK' || sh === 'ARM' || sh === 'GIVE' || sh === 'DROP') {
      const h = RC.take.hand; workV(yaw, h[0], 0, h[2], _ow); _ow.x += p.x; _ow.z += p.y; _ow.y = h[1];
      handQW(workV(yaw, 0.6, -1, 0, _hX), workV(yaw, 0, -1, 0, _hZ), false, _oq); _ow.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_oq));
      setALw(e, _ow, _oq, POLE_REACH);
    } else if (sh !== 'TALK' && sh !== 'LOOK' && sh !== 'PHONE' && sh !== 'DRESS') {
      const h = RC.other.hand; workV(yaw, h[0], 0, h[2], _ow); _ow.x += p.x; _ow.z += p.y; _ow.y = h[1];
      handQW(workV(yaw, 1, -0.3, 0, _hX), workV(yaw, 0, 0, 1, _hZ), false, _oq); _ow.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_oq));
      setALw(e, _ow, _oq, POLE_REACH);
    }
  }
  // the field-dress: the left hand down at the carcass on the ground (absolute height), working at it while he kneels
  if (LV.kneel > 0) {
    const KN = RC.kneel, h = KN.hand, wk = KN.work * Math.sin(2 * Math.PI * KN.hz * L.clock) * ss(KN.down, KN.down + 0.15, LV.kneelT);
    workV(yaw, h[0] + wk, 0, h[2] + 0.5 * wk, _ow); _ow.x += p.x; _ow.z += p.y; _ow.y = h[1];
    handQW(workV(yaw, 0.7, -1, 0, _hX), workV(yaw, 0, -1, 0, _hZ), false, _oq); _ow.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_oq));
    setALw(LV.kneel, _ow, _oq, POLE_REACH);
  }
  // the phone's receiver at his ear; food to his mouth; the bandage to his side
  if (LV.phone > 0) { const s = SOCKETS.spine2.earL; _ow.set(s[0] + 2.5, s[1] - 4.5, s[2] - 1.5).applyMatrix4(B.spine2.matrixWorld); workV(yaw, 0.15, 1, 0, _hX); workV(yaw, 0, 0, 1, _hZ); handQW(_hX, _hZ, false, _oq); setALw(LV.phone * free, _ow, _oq, POLE_FACE); }
  if (LV.itemW > 0) {
    // (eating: the hand comes in to the mouth at each bite and drops a little away from it to chew between them)
    if (LV.item === 'eat') { const s = SOCKETS.spine2.mouth, ch = 1 - clamp(LV.bite / 4, 0, 1); _ow.set(s[0] + 3.5 + 1.6 * ch, s[1] - 5.5 - 2.6 * ch, s[2] - 0.5).applyMatrix4(B.spine2.matrixWorld); workV(yaw, -0.3, 1, 0.3, _hX); workV(yaw, -1, 0, 0.2, _hZ); handQW(_hX, _hZ, false, _oq); setALw(LV.itemW * free, _ow, _oq, POLE_FACE); }
    else sideHand(r, LV.itemW * free, 1.2);
  }
  // Misdirection: the stone thrown overhand; Emergency Repair: the hammer struck once (its frame drives the hand)
  if (LV.abil === 'misdirection') {
    const t = LV.abilT, M = LIFE.misdirection; sampleV(M.hand, t, _v3c);
    const w = (t < 0.05 ? t / 0.05 : t > M.T - 0.06 ? clamp((M.T - t) / 0.06, 0, 1) : 1) * free;
    setAL(yaw, o, w, _v3c[0], _v3c[1], _v3c[2], FING_THROW, PALM_THROW, POLE_GUARD);
  } else if (LV.abil === 'emergency_repair') {
    const t = LV.abilT, M = LIFE.patch; sampleV(M.hand, t, _v3c);
    const w = (t < 0.05 ? t / 0.05 : t > M.T - 0.08 ? clamp((M.T - t) / 0.08, 0, 1) : 1) * free;
    gunInA(r, yaw, _v3c[0], _v3c[1], _v3c[2], sample(M.pitch, t), 0, GT2);
    onFrame(GT2.p, GT2.q, H_GRIP_L, _ow, _oq);
    setALw(w, _ow, _oq, POLE_GUARD);
  }
}
const FING_GIVE = [1, -0.1, 0.1], PALM_GIVE = [0, 1, 0.1];
const _v3c = [0, 0, 0];
const H_GRIP_L_INV = new THREE.Matrix4(); let H_GRIP_L_INV_OK = false;
/** Life's props after the hands (§4.8 carry, §4.18 Emergency Repair): the parcel on the left forearm, the hammer in the left hand. */
function lifeProps(r, p) {
  const st = r.st, B = r.bones;
  if (p.dead) return;
  if (LV.parcelK > 0.001) {
    const c = LIFE.carry;
    // (on the left forearm; the carry only runs with the pistol in hand: a long gun needs the left hand on its forend; it
    // grows in as the forearm comes up, and rides the forearm out when it is handed over)
    _m1.copy(B.forearmL.matrixWorld).multiply(_m2.makeTranslation(c.parcel[0], c.parcel[1], c.parcel[2])).multiply(_m3.makeRotationZ((92 + c.tilt) * DEG));
    showPropAt(r, B.parcel, _m1); B.parcel.scale.setScalar(EO(LV.parcelK));
  } else if (LV.itemW > 0.05 && LV.item === 'eat' && LV.carry < 0.05) {
    // (a bite of food in the eating hand: the parcel prop, small; brown like bread or a ration)
    const fs = LIFE.item.food;
    _m1.copy(B.handL.matrixWorld).multiply(_m2.makeTranslation(GRIPL[0] + 0.4, GRIPL[1] + 0.2, GRIPL[2] + 0.3));
    showPropAt(r, B.parcel, _m1); B.parcel.scale.set(fs[0], fs[1], fs[2]).multiplyScalar(ss(0.05, 0.4, LV.itemW));
  }
  if (LV.abil === 'emergency_repair' && LV.abilT < LIFE.patch.hide) {
    if (!H_GRIP_L_INV_OK) { H_GRIP_L_INV.compose(H_GRIP_L.t, H_GRIP_L.q, _gw2.set(1, 1, 1)).invert(); H_GRIP_L_INV_OK = true; }
    _m1.copy(B.handL.matrixWorld).multiply(H_GRIP_L_INV); _m1.decompose(TOOL.p, TOOL.q, _s1); TOOL.q.multiply(Q_RZ90);
    _m1.compose(TOOL.p, TOOL.q, _gw2.set(1, 1, 1)); showPropAt(r, B.hammer, _m1);
  }
}
/** The modal pose (§4.18, presentation): the body over the work; the hands are the 'rod' / 'work' tools (toolHands). */
function modalPose(r, p, F) {
  const k = LV.modal, MD = LIFE.modal;
  if (LV.modalKind === 'work') { F[PK.s2] += MD.work.s2 * k; F[PK.head] += MD.work.head * k; F[PK.s1] += 3 * k; }
  else if (LV.modalKind === 'rod') { F[PK.s2] += 3 * k; F[PK.head] += 6 * k; }
}

/* ---------------- 9. additives (§4.7): breath ---------------- */
const FLX = { gunPitch: 0, gunYaw: 0, shieldW: 0, abdL: 0 };
/** The flinch envelope (§4.15): up over 0.05 s (O), then one damped overshoot that settles by ~0.35 s. */
function flinchEnv(t) {
  const FL = FLINCH;
  if (t < 0) return 0;
  if (t < FL.rise) return EO(t / FL.rise);
  const tp = t - FL.rise;
  return Math.exp(-tp / FL.tau) * Math.cos(2 * Math.PI * FL.hz * tp);
}
function additives(r, p) {
  // (M5: Controlled Fire's one deep breath: the breath's depth × (1 + (amp − 1)·the ability's envelope))
  const st = r.st, P = PB, b = S.breath * (1 + (LIFE.steady.amp - 1) * LV.steadyK), BO = IDLE.breathOut;
  P[PK.s2] += BO.spine2Pitch * b;
  P[PK.head] += BO.headPitch * b;
  P[PK.clavL] += BO.clavElev * b; P[PK.clavR] += BO.clavElev * b;
  // (the breath sways the hanging arms forward a touch, relaxed)
  const rx = BO.armFlex * b * (1 - S.aimWb); P[PK.armL] += rx; P[PK.armR] += rx;
  P[PK.breath] = b;
  FLX.gunPitch = FLX.gunYaw = FLX.shieldW = FLX.abdL = 0;
  if (p.dead) return;
  // the flinch (§4.15), read on the hit frame: by direction (front / side / back of the chest), then by kind
  const H = st.hurt;
  if (H.t < 0.6) {
    // (the gain is on the body channels only; the gun's kick uses the plain envelope, D6: the sim may fire mid-flinch)
    const e0 = flinchEnv(H.t), e = e0 * FLINCH.gain, FL = FLINCH, fire = H.kind === 'fire', A = fire ? FL.fire.amp : H.A;
    if (H.zone === 'front') {
      P[PK.s2] += FL.front.s2 * A * e; P[PK.s1] += FL.front.s1 * A * e; P[PK.head] += FL.front.head * A * e; P[PK.pel] += FL.front.pelDx * A * e;
      FLX.gunPitch = FL.front.gun * A * e0;
    } else if (H.zone === 'side') {
      // the chest and head twist and roll away from the source, the hips are knocked aside, the hit-side shoulder is driven
      // back and up, and the gun goes with the chest
      const s = H.s, FS = FL.side;
      P[PK.s2 + 1] += FS.s2Yaw * A * s * e; P[PK.s2 + 2] += FS.s2Roll * A * s * e; P[PK.head + 1] += FS.headYaw * A * s * e; P[PK.head + 2] += FS.headRoll * A * s * e;
      P[PK.pel + 2] -= FS.pelLat * A * s * e;
      const cO = s > 0 ? PK.clavR : PK.clavL; P[cO] += FS.clavElev * A * e; P[cO + 1] += FS.clavProt * A * e;
      FLX.gunYaw = FS.gunYaw * A * s * e0;
    } else {
      P[PK.s2] += FL.back.s2 * A * e; P[PK.head] += FL.back.head * A * e; P[PK.pel] += FL.back.pelDx * A * e;
    }
    // by kind: a ram stumbles (the hips roll toward the push, the left arm flies out; the shove logic steps him), a bite
    // or a bat knocks the hips aside, fire throws the left forearm up as a shield and turns the head away
    const push = H.ang + Math.PI, pr = Math.sin(wrap(push - S.hipYaw)); // + = the push toward his right
    if (H.kind === 'ram' && H.t < FL.ram.T) {
      // a ram: the hips roll toward the push, the chest is thrown back and both arms fly up for the first quarter second,
      // the left arm out (the shove logic and a second kick at ram.step2 give the two corrective steps)
      const k = Math.sin(Math.PI * H.t / FL.ram.T), kb = H.t < FL.ram.throwT ? Math.sin(Math.PI * H.t / FL.ram.throwT) : 0;
      P[PK.pelRot + 2] += FL.ram.roll * pr * k; FLX.abdL = FL.ram.abdL * k; P[PK.armL + 1] += FLX.abdL; P[PK.armL + 3] += 0.5 * FLX.abdL;
      P[PK.s2] += FL.ram.s2 * kb; P[PK.armL + 1] += FL.ram.armsUp * kb; P[PK.armR + 1] += FL.ram.armsUp * kb;
      if (!H.step2 && H.t >= FL.ram.step2) { H.step2 = true; st.planner.kick = true; }
    }
    else if (H.kind === 'bite' && H.t < FL.bite.T) P[PK.pel + 2] += FL.bite.lat * pr * (1 - ES(H.t / FL.bite.T));
    else if (fire && H.t < FL.fire.T) { const k = ss(0, 0.06, H.t) * (1 - ss(FL.fire.T - 0.12, FL.fire.T, H.t)); FLX.shieldW = k; P[PK.head + 1] -= FL.fire.headYaw * H.s * k; }
  }
  // the tremor while p.flinch lasts: the gun's yaw and pitch shake at 18 Hz
  if ((p.flinch || 0) > 0.01) { const tr = FLINCH.tremor, k = tr.deg * p.flinch; FLX.gunYaw += k * noise1(S.now * tr.hz); FLX.gunPitch += k * noise1(S.now * tr.hz + 37.7); }
  // a shot puts the gun back on the line for the flash (D6), then lets the flinch's gun kick back in
  if (S.tShot < 0.14) { const k = S.tShot < 0.06 ? 0 : ss(0.06, 0.14, S.tShot); FLX.gunPitch *= k; FLX.gunYaw *= k; }
  // the revive (§4.15): a 1 s stagger (the chest and head drop, the hips sink, the knees take it via the IK)
  if (st.rev < REVIVE.T) {
    const t = st.rev;
    P[PK.s2] += sample(REVIVE.spine2, t); P[PK.pel + 1] += sample(REVIVE.pelvisY, t); P[PK.head] += sample(REVIVE.head, t);
  }
}

/* ---------------- 10. FK from the pose buffer, with joint limits (§4.22) ---------------- */
function writeFK(r) {
  const B = r.bones, P = PB, st = r.st;
  B.root.position.set(P[PK.root], P[PK.root + 1], P[PK.root + 2]);
  B.root.rotation.set(rad(P[PK.rootRot + 2]), -S.hipYaw - rad(P[PK.rootRot + 1]), rad(-P[PK.rootRot]));
  B.pelvis.position.set(P[PK.pel], 37.5 + P[PK.pel + 1], P[PK.pel + 2]);
  setSpine(B.pelvis, P[PK.pelRot], P[PK.pelRot + 1], P[PK.pelRot + 2]);
  // the torso twist: chest minus hips, split spine1 45% / spine2 55%, inside the joint limits
  const tw = S.tau / DEG, t1 = clamp(tw * 0.45, -35, 35), t2 = clamp(tw * 0.55, -45, 45);
  setSpine(B.spine1, clamp(P[PK.s1], -15, 25), clamp(P[PK.s1 + 1] + t1, -35, 35), clamp(P[PK.s1 + 2], -10, 10));
  setSpine(B.spine2, clamp(P[PK.s2], -20, 35), clamp(P[PK.s2 + 1] + t2, -45, 45), clamp(P[PK.s2 + 2], -12, 12));
  if (B.breath) { const b = P[PK.breath], BO = IDLE.breathOut; B.breath.scale.set(1 + BO.scaleX * b, 1, 1); B.breath.position.copy(B.breath.userData.bind); B.breath.position.y += BO.posY * b; }
  // the head faces faceYaw in every mode (aimed or relaxed, moving off-axis or turning): it takes out the hips' offset from
  // the face and the torso twist, then the profile's look-down-the-gun. The neck takes 40% of that turn and the head the
  // rest (up to 75° past the chest together), so in a flick the head leads while the chest waits for the feet. The head
  // keeps only 40% of the pelvis bob (the neck takes the rest), so it rides steadier than the hips.
  const w = P[PK.aimW];
  const look = st.stateF === 'death' ? 0 : angleDiff(S.hipYaw, S.faceYaw) / DEG - (t1 + t2);
  const total = P[PK.head + 1] + look;
  let nY = clamp(0.4 * total, -35, 35);
  const hY = clamp(total - nY, -40, 40);
  nY = clamp(total - hY, -35, 35);
  setSpine(B.neck, clamp(P[PK.neck], -20, 25), clamp(P[PK.neck + 1] + nY, -35, 35), clamp(P[PK.neck + 2], -15, 15));
  B.neck.position.copy(B.neck.userData.bind); B.neck.position.y -= 0.6 * (S.bob || 0) * (st.stateF === 'death' ? 0 : 1);
  setSpine(B.head, clamp(P[PK.head], -25, 25), hY, clamp(P[PK.head + 2], -20, 20));
  B.head.scale.setScalar(TUNE.headScale);
  const aR = readArm(P, PK.armR, ARM_R), aL = readArm(P, PK.armL, ARM_L);
  applyDebugPose(r, aR, aL);
  // clavicles, with the shrug helper (§4.21: a raised arm lifts the shoulder, so the pad stays over the sleeve)
  const fkW = DBG.pose ? 1 : 1 - w;
  for (let i = 0; i < 2; i++) {
    const s = SIDES[i][1], a = s > 0 ? aR : aL, o = s > 0 ? PK.clavR : PK.clavL;
    const shrug = Math.min(15, 0.25 * Math.max(0, Math.max(a.flex, a.abd) - 60)) * fkW;
    B[NM[SIDES[i][0]].clav].rotation.set(rad(-s * (P[o] + shrug)), rad(-s * P[o + 1]), 0);
  }
  setArm(r, 'L', -1, aL); setArm(r, 'R', 1, aR);
  // FK legs (IK replaces them below by footIKW)
  for (let i = 0; i < 2; i++) {
    const L = SIDES[i][0], s = SIDES[i][1], o = i ? PK.legR : PK.legL, nm = NM[L];
    B[nm.thigh].rotation.set(rad(-s * P[o + 1]), rad(s * P[o + 2]), rad(P[o]));
    B[nm.shin].rotation.set(0, 0, rad(-clamp(P[o + 3], 0, 150)));
    B[nm.foot].rotation.set(0, 0, rad(clamp(P[o + 4], -50, 35)));
  }
}

/* ---------------- 11. legs: pelvis reach fix, two-bone IK, swivel clamp, joint limits (§4.6, §4.22) ---------------- */
const ANK = [new THREE.Vector3(), new THREE.Vector3()];
// The ankle's dorsiflexion limit. The spec's 35° is a standing value: in a jog's late stance (knee bent ~40°, the shin
// leaning well forward before the toe roll lifts the heel) a flat foot needs up to ~45°, and clamping it at 35° tipped the
// toes into the ground (measured stance drift 0.4–1.1). Plantarflexion stays at −50°.
const ANKLE_DORSI = 46;
// (a planted foot keeps its sole flat a little further: in a sprint's or a strafe's late stance the shin leans up to ~52°
// over the foot before the toe roll lifts the heel, and a clamp there tips the toes into the ground: a visible slide)
const ANKLE_DORSI_PLANTED = 56;
const _qL2 = new THREE.Quaternion(), _ftW = [new THREE.Quaternion(), new THREE.Quaternion()], _thQ = [new THREE.Quaternion(), new THREE.Quaternion()], _shQ = [new THREE.Quaternion(), new THREE.Quaternion()], _ftQ = [new THREE.Quaternion(), new THREE.Quaternion()];
function legs(r, p) {
  const st = r.st, B = r.bones, PL = st.planner, crouch = DBG.pose === 'crouch' || DBG.pose === 'deepFlex';
  const ikw = clamp(PB[PK.footIKW], 0, 1), dying = st.stateF === 'death', dodge = st.stateF === 'dodge';
  if (ikw * Math.max(FOOTW[0], FOOTW[1]) <= 0 && !dying && !dodge) { st.planted[0] = st.planted[1] = false; return; }
  // dead (§4.16): the legs are always solved, from the planted feet (the crumple) to the fall's FK legs (their ankles and
  // knees as writeFK left them), with every ankle held above the ground: the FK keys never drive a foot through it
  if (dying) {
    // (and once he has landed, a foot floating within snapRange of the ground is brought down onto it: the target allows for
    // the ground clamp's lift, which deathClamp adds after the legs)
    const Dh = st.dth, sw = ss(DEATH.snapFrom, DEATH.snapTo, st.deathT);
    for (let i = 0; i < 2; i++) {
      const foot = B[FEET[i]];
      _dA[i].setFromMatrixPosition(foot.matrixWorld); _dK[i].setFromMatrixPosition(B[SHINS[i]].matrixWorld);
      let lo = Infinity; for (const q of FOOT_PTS) { _v1.set(q[0], q[1], q[2]).applyMatrix4(foot.matrixWorld); if (_v1.y < lo) lo = _v1.y; }
      const sh = lo - (DEATH.snapFootY - Dh.lift);
      _dA[i].y -= sh < 0 ? sh : sh < DEATH.snapRange ? sh * sw : 0;
    }
  } else if (dodge) {
    // the dodge blends FK ↔ IK the same way, as an ankle TARGET from the FK ankle (held above the ground) to the planted
    // spot, solved in full: slerping the joint rotations between the two poses sank the foot through the ground mid-blend
    // (the FK target is raised until the FK shoe's lowest point, heel, sole or toe, is at y 0.5: no FK foot under the ground)
    const D = st.dg; D.lift = 0;
    for (let i = 0; i < 2; i++) {
      const foot = B[FEET[i]];
      _dA[i].setFromMatrixPosition(foot.matrixWorld); _dK[i].setFromMatrixPosition(B[SHINS[i]].matrixWorld);
      let lo = Infinity; for (const q of FOOT_PTS) { _v1.set(q[0], q[1], q[2]).applyMatrix4(foot.matrixWorld); if (_v1.y < lo) lo = _v1.y; }
      const up = Math.max(0, 1.6 - lo); _dA[i].y += up; D.need[i] = up; D.lift = Math.max(D.lift, up);
      worldQuat(foot, _ftW[i]); // (and the foot turns from its FK world rotation to the planted one: a world slerp)
    }
  }
  // the ankle targets (world) from the planner
  for (let i = 0; i < 2; i++) {
    const f = PL.feet[i];
    ANK[i].set(f.ax + (crouch ? (i ? -3 : 3) * Math.cos(S.hipYaw) : 0), f.ay, f.az + (crouch ? (i ? -3 : 3) * Math.sin(S.hipYaw) : 0));
  }
  // pelvis reach fix: drop the hips just enough that every planted (or landing) foot is within 0.985 L, on a spring (fast
  // down, slow up, never faster than 60 u/s) and never more than dropMax: a foot further off than that is flagged as
  // strained and the planner steps it instead of squatting him
  const SPR = TUNE.springs;
  let need = 0;
  for (let i = 0; i < 2; i++) {
    const f = PL.feet[i], pl = PL.planted(i);
    if (!(pl || (f.mode === 1 && f.uu > 0.75)) || FOOTW[i] < 0.5) continue; // (a clip's FK foot isn't reached for)
    _hip.setFromMatrixPosition(B[THIGHS[i]].matrixWorld);
    // a landing foot: its need at the landing spot, eased in over the last quarter of the swing, so the hips are down
    // by the contact frame (a dropRate-limited catch-up there would slide the fresh plant)
    const nd = pl ? reachDrop(_hip.x, _hip.y, _hip.z, ANK[i].x, ANK[i].y, ANK[i].z, LEG_REACH, 30)
      : reachDrop(_hip.x, _hip.y, _hip.z, f.landing[0], FOOT.h, f.landing[1], LEG_REACH, 30) * ss(0.75, 0.97, f.uu);
    if (pl && nd > SPR.dropMax - 0.5) f.strain = true;
    need = Math.max(need, nd);
  }
  need = Math.min(need, SPR.dropMax);
  // down: straight to the need (a planted foot must reach it this frame, or it slides), but never faster than dropRate;
  // up: the slow spring
  if (need > st.drop.x) { st.drop.x = Math.min(need, st.drop.x + SPR.dropRate * S.adt); st.drop.v = 0; }
  else springTo(st.drop, need, SPR.pelvisDropSlow, S.adt);
  if (dying) st.drop.x = st.drop.v = 0;
  if (st.drop.x > 1e-4) { B.pelvis.position.y -= st.drop.x; B.pelvis.updateMatrixWorld(true); }
  worldQuat(B.pelvis, _q3);
  for (let i = 0; i < 2; i++) {
    const L = SIDES[i][0], nm = NM[L], thigh = B[nm.thigh], shin = B[nm.shin], foot = B[nm.foot], f = PL.feet[i];
    const fyaw = f.yaw;
    _hip.setFromMatrixPosition(thigh.matrixWorld);
    _pole.set(30, -10, 0).applyAxisAngle(Y_AXIS, -fyaw).add(_hip);
    if (dying || dodge) {
      const k = dying ? 1 - ikw : 1 - ikw * FOOTW[i];
      ANK[i].lerp(_dA[i], k);
      _v2.addVectors(_hip, _dA[i]).multiplyScalar(0.5); _v3.subVectors(_dK[i], _v2).multiplyScalar(3).add(_dK[i]);
      _pole.lerp(_v3, k);
    }
    solveTwoBone(_hip, ANK[i], _pole, L_THIGH, L_SHIN, 1, IK);
    let ok = Number.isFinite(IK.q1.x) && Number.isFinite(IK.q2.x);
    if (ok) {
      // swivel clamp: the thigh's twist about its own axis stays within ±35° of the pelvis
      _q1.copy(_q3).invert().multiply(IK.q1);
      const tw = twistAngle(_q1, 0, 1, 0), lim = 35 * DEG;
      if (Math.abs(tw) > lim) {
        const ex = tw - Math.sign(tw) * lim;
        _ax2.subVectors(ANK[i], _hip).normalize();
        _pole.sub(_hip).applyAxisAngle(_ax2, ex).add(_hip);
        solveTwoBone(_hip, ANK[i], _pole, L_THIGH, L_SHIN, 1, IK);
        ok = Number.isFinite(IK.q1.x) && Number.isFinite(IK.q2.x);
      }
    }
    // IK fallback: non-finite, or a PLANTED foot far out of reach for 3 frames → phase-driven FK for that leg until it
    // recovers, blended in and out over 0.1 s (a swinging foot out of reach just reaches as far as the leg goes)
    const err = ok ? (PL.planted(i) && !dying && FOOTW[i] > 0.999 ? Math.max(0, _hip.distanceTo(ANK[i]) - 0.999 * (L_THIGH + L_SHIN)) : 0) : 99;
    st.ikBad[i] = err > 2 ? st.ikBad[i] + 1 : 0;
    if (st.ikBad[i] >= 3) { if (!st.fkLeg[i]) st.ikFails++; st.fkLeg[i] = true; } else if (st.ikBad[i] === 0) st.fkLeg[i] = false;
    st.fkW[i] = clamp(st.fkW[i] + (st.fkLeg[i] ? 1 : -1) * S.adt / 0.1, 0, 1);
    if (!ok) { st.ikFails++; continue; }
    const lw = dying ? 1 : dodge ? 1 - st.fkW[i] : ikw * FOOTW[i] * (1 - st.fkW[i]);
    if (lw <= 0) continue;
    // thigh local, with the hip limits (flex −40..115, abd −25..35); the knee is a pure hinge 0..150 by construction
    _thQ[i].copy(_q3).invert().multiply(IK.q1);
    _e1.setFromQuaternion(_thQ[i], 'YXZ');
    // (a planted leg may adduct to −32°: past the spec's −25° the foot is flagged as strained and the planner lifts it,
    // and the extra range holds the plant for the frames until it does, instead of sliding it)
    const s = SIDES[i][1], fl = _e1.z, ab = -s * _e1.x, plT = PL.planted(i), abLo = (plT ? -32 : -25) * DEG;
    if (plT && (fl < -40 * DEG || fl > 115 * DEG || ab < -25 * DEG || ab > 35 * DEG)) f.strain = true;
    if (fl < -40 * DEG || fl > 115 * DEG || ab < abLo || ab > 35 * DEG) {
      _e1.z = clamp(fl, -40 * DEG, 115 * DEG); _e1.x = -s * clamp(ab, abLo, 35 * DEG); _thQ[i].setFromEuler(_e1);
    }
    thigh.quaternion.slerp(_thQ[i], lw);
    thigh.updateMatrixWorld(true);
    worldQuat(thigh, _q1);
    _shQ[i].copy(_q1).invert().multiply(IK.q2);
    shin.quaternion.slerp(_shQ[i], lw);
    shin.updateMatrixWorld(true);
    // foot: yaw plus pitch (heel strike, flat, toe-off about the ball), with the ankle limits (−50..46); the ankle's roll
    // (inversion and eversion) is held to ±25° in the air but allowed ±40° on the ground, so a planted sole stays flat
    _qy.setFromAxisAngle(Y_AXIS, -fyaw);
    _q1.setFromAxisAngle(_v1.set(0, 0, 1).applyQuaternion(_qy), f.pitch);
    _q2.copy(_q1).multiply(_qy);
    if (dodge) { _qL2.copy(_q2); _q2.slerpQuaternions(_ftW[i], _qL2, ikw * FOOTW[i] * (1 - st.fkW[i])); }
    worldQuat(shin, _q4);
    _ftQ[i].copy(_q4).invert().multiply(_q2);
    _e1.setFromQuaternion(_ftQ[i], 'YXZ');
    const pl = PL.planted(i), rl = (pl ? 40 : 25) * DEG, dl = (pl ? ANKLE_DORSI_PLANTED : ANKLE_DORSI) * DEG;
    if (_e1.z < -50 * DEG || _e1.z > dl || Math.abs(_e1.x) > rl) { _e1.z = clamp(_e1.z, -50 * DEG, dl); _e1.x = clamp(_e1.x, -rl, rl); _ftQ[i].setFromEuler(_e1); }
    foot.quaternion.slerp(_ftQ[i], dying ? ikw : lw);
    foot.updateMatrixWorld(true);
  }
}
const _dA = [new THREE.Vector3(), new THREE.Vector3()], _dK = [new THREE.Vector3(), new THREE.Vector3()];
// a shoe's extreme points (foot-local: the sole's heel, ball and toe, the shoe's top at the toe and the heel)
const FOOT_PTS = [[-3.4, -3.7, 0], [8.4, -3.5, 0], [3, -3.8, 0], [8.0, -1.2, 0], [-3.2, 1.5, 0]];

/** The real stance drift (§4.6 debug): the heel and the ball of each planted foot, from the bones, never move. */
function measureDrift(r, p) {
  const st = r.st, PL = st.planner;
  // foot pops: the largest one-frame move of a foot bone beyond the body's own step and a fast swing's travel (250 u/s
  // relative to the body), teleports and skids aside; and the lowest the hips went (a squat)
  const ok = S.realDt > 0 && !S.teleport && !S.skid && !p.dead;
  for (let i = 0; i < 2; i++) {
    _v1.setFromMatrixPosition(r.bones[FEET[i]].matrixWorld);
    const fp = st.footPrev[i];
    if (ok && st.footPrevOk) st.maxFootStep = Math.max(st.maxFootStep, Math.hypot(_v1.x - fp[0], _v1.y - fp[1], _v1.z - fp[2]) - S.jump - 250 * S.realDt);
    fp[0] = _v1.x; fp[1] = _v1.y; fp[2] = _v1.z;
  }
  st.footPrevOk = !p.dead;
  if (!p.dead && !st.stateF) st.minPelvisY = Math.min(st.minPelvisY, _v2.setFromMatrixPosition(r.bones.pelvis.matrixWorld).y);
  for (let i = 0; i < 2; i++) {
    // (and never while a full-body clip still blends the leg between FK and IK: the dodge's landing, the death)
    const d = st.drift[i], on = st.planted[i] && !S.teleport && !S.skid && !st.fkLeg[i] && PB[PK.footIKW] * FOOTW[i] > 0.999 && st.stateF !== 'death';
    if (!on) { d.was = false; continue; }
    if (!d.was) { d.hasH = d.hasB = false; d.was = true; }
    const P = PL.feet[i].pitch, foot = r.bones[FEET[i]], piv = PL.feet[i].pivot;
    for (let k = 0; k < 2; k++) {
      if (k === 0 ? P < -1e-4 : P > 1e-4) continue;
      // a pivoting foot turns about its ball (1) or heel (2): only that point must stay put, the other starts over
      if ((piv === 1 && k === 0) || (piv === 2 && k === 1)) { if (k === 0) d.hasH = false; else d.hasB = false; continue; }
      const px = k === 0 ? FOOT.heel : FOOT.ball;
      _v1.set(px, -FOOT.h, 0).applyMatrix4(foot.matrixWorld);
      const ref = k === 0 ? d.heel : d.ball, has = k === 0 ? d.hasH : d.hasB;
      if (!has) { ref[0] = _v1.x; ref[1] = _v1.y; ref[2] = _v1.z; if (k === 0) d.hasH = true; else d.hasB = true; continue; }
      const dd = Math.hypot(_v1.x - ref[0], _v1.y - ref[1], _v1.z - ref[2]);
      if (dd > st.maxStanceDrift) st.maxStanceDrift = dd;
    }
  }
}

/* ---------------- weapons (§4.8–§4.11, §5): the GUN is the driver, the hands follow it ---------------- */
// Every frame the active gun's world transform is built first, from its drivers: the aim pose (per weapon: the pistol's
// Weaver grip in aim frame A, the long guns' butt in the shoulder pocket), converged onto the sim's bullet line (D6), with
// the recoil, the action (pump, bolt) and the high port on top; the relaxed carry (the pistol rides the FK hand, the long
// guns sit at low ready or port arms); the reload and swap poses. The right hand is then IK'd to the gun's grip (or the
// bolt knob) and the left hand to the support grip, the forend, or the reload's waypoints (pocket, mag well, slide,
// loading port), each travel a quadratic Bézier; casings eject from the port at the moment each weapon throws them.
const GN = { p: V(), q: new THREE.Quaternion() }, GA = { p: V(), q: new THREE.Quaternion() }, GRL = { p: V(), q: new THREE.Quaternion() };
const GT = { p: V(), q: new THREE.Quaternion() }, GT2 = { p: V(), q: new THREE.Quaternion() }, GS = { p: V(), q: new THREE.Quaternion() };
// (private scratch: baseGun's aim pose, relaxedGun's port arms, swapGun's IN target; never shared with a caller's `out`)
const GAIM = { p: V(), q: new THREE.Quaternion() }, GPORT = { p: V(), q: new THREE.Quaternion() }, GT3 = { p: V(), q: new THREE.Quaternion() };
const _eG = new THREE.Euler(0, 0, 0, 'YZX'), _gq = new THREE.Quaternion(), _gv = V(), _gv2 = V(), _gv3 = V(), _gc = V(), _gw = V(), _gw2 = V();
const _sq = new THREE.Quaternion(), _sp = V(), _pq = new THREE.Quaternion(), _hq2 = new THREE.Quaternion(), _hq3 = new THREE.Quaternion(), _gcAxis = V();
const _wA = V(), _wB = V(), _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _wR = V(), _qR = new THREE.Quaternion(), _wL = V(), _qL = new THREE.Quaternion();
const _fkRw = V(), _fkRq = new THREE.Quaternion(), _fkLw = V(), _fkLq = new THREE.Quaternion(), _fkRe = V(), _fkLe = V();
/** A gun-relative hand pose: wrist = gun.p + gun.q·t, hand = gun.q·q. */
const hp = (t, q) => ({ t: new THREE.Vector3(...t), q });
const qBasis = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(...x).normalize(), new THREE.Vector3(...y).normalize(), new THREE.Vector3(...z).normalize()));
function handOn(pt, q, grip) { const g = new THREE.Vector3(...grip).applyQuaternion(q); return hp([pt[0] - g.x, pt[1] - g.y, pt[2] - g.z], q); }
/** A basis for a hand from its finger direction (the hand's −Y) and palm normal (right hand −Z, left +Z), gun-local. */
function handBasis(fingers, palm, right) {
  const y = new THREE.Vector3(...fingers).normalize().negate(), z = new THREE.Vector3(...palm).normalize();
  if (right) z.negate();
  z.addScaledVector(y, -z.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
const GRIPR = SOCKETS.hand.grip, GRIPL = [SOCKETS.hand.grip[0], SOCKETS.hand.grip[1], -SOCKETS.hand.grip[2]];
// right hand on the grip: hand = gun × HELD⁻¹ × T(−grip)
const HELD_INV = HELD.clone().invert();
const GRIP_R = new THREE.Matrix4().makeTranslation(-SOCKETS.hand.grip[0], -SOCKETS.hand.grip[1], -SOCKETS.hand.grip[2]);
const _pd = V(), _pd2 = V();
const H_GRIP = (() => { const m = HELD_INV.clone().multiply(GRIP_R), t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(t, q, s); return { t, q }; })();
// left hand: pistol support (palm against the grip, the hand frame = the gun frame); forend (palm up)
const Q_SUPPORT = handBasis(HAND_ON.support.fingers, HAND_ON.support.palm, false), Q_FOREND = qBasis([1, 0, 0], [0, 0, -1], [0, 1, 0]);
// the spare magazine in the left hand (mag up = palm normal, mag forward = the knuckles), and seated in the grip
const MAG_IN_HAND = (() => { const q = qBasis([0, -1, 0], [0, 0, 1], [-1, 0, 0]); const t = new THREE.Vector3(...GRIPL).add(new THREE.Vector3(0, 0, 2.4)); return new THREE.Matrix4().compose(t, q, new THREE.Vector3(1, 1, 1)); })();
const MAG_SEAT = new THREE.Matrix4().makeTranslation(-0.92, -2.1, 0).multiply(new THREE.Matrix4().makeRotationZ(-17 * DEG)).multiply(new THREE.Matrix4().makeTranslation(0, 1.0, 0));
const GA_AX = SOCKETS.pistol.gripAxis;
const MAG_LOW = new THREE.Matrix4().makeTranslation(GA_AX[0] * 3, GA_AX[1] * 3, 0).multiply(MAG_SEAT);
const decompHP = (m) => { const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(t, q, s); return { t, q }; };
const MAG_IN_HAND_INV = MAG_IN_HAND.clone().invert();
const H_WELL = decompHP(MAG_SEAT.clone().multiply(MAG_IN_HAND_INV)), H_WELL_LOW = decompHP(MAG_LOW.clone().multiply(MAG_IN_HAND_INV));
// a shell or a round in the left hand: along the knuckles, at the fingertips of the curled hand
const ITEM_IN_HAND = (() => { const q = qBasis([0, -1, 0], [0, 0, 1], [-1, 0, 0]); return new THREE.Matrix4().compose(new THREE.Vector3(...GRIPL).add(new THREE.Vector3(0, -1.2, 0)), q, new THREE.Vector3(1, 1, 1)); })();
const ITEM_INV = ITEM_IN_HAND.clone().invert();
const itemAt = (x, y, z, flip) => decompHP(new THREE.Matrix4().makeTranslation(x, y, z).multiply(flip ? new THREE.Matrix4().makeRotationX(Math.PI) : new THREE.Matrix4()).multiply(ITEM_INV));
const SLP = SOCKETS.shotgun.loadPort, RLP = SOCKETS.rifle.port;
const H_PORT_LOW = itemAt(SLP[0] - 1.0, SLP[1] - 1.5, 0, false), H_PORT_IN = itemAt(SLP[0] + 0.6, SLP[1] + 1.0, 0, false);
const H_RUP = itemAt(RLP[0], RLP[1] + 1.5, 0.2, true), H_RPRESS = itemAt(RLP[0], RLP[1] - 0.2, 0.2, true);
// the rack (overhand on the pistol slide, slide-local) and the bolt knob (right hand, bolt-local)
const RK = SOCKETS.pistol.rack, H_RACK = handOn([RK[0], RK[1] - 2.3 - 0.6, 0], handBasis(HAND_ON.rack.fingers, HAND_ON.rack.palm, false), GRIPL);
const H_KNOB = handOn([0, 0, SOCKETS.rifle.boltKnob[2]], handBasis(HAND_ON.boltKnob.fingers, HAND_ON.boltKnob.palm, true), GRIPR);
const WP = { FK: 0, SUPPORT: 1, FOREND: 2, POCKET: 3, WELL_LOW: 4, WELL: 5, RACK: 6, PORT_LOW: 7, PORT_IN: 8, R_UP: 9, R_PRESS: 10, GRIP: 11, KNOB: 12, STOW: 13, SHELL: 14 };
const PROP_L = { none: 0, mag: 1, shell: 2, round: 3 };
const ES = EASE.S, EO = EASE.O, EI = EASE.I, EO3 = EASE.O3, EB = EASE.B;
const seg = (t, a, b) => (b > a ? clamp((t - a) / (b - a), 0, 1) : t >= b ? 1 : 0);

/** The gun's world rotation from sim yaw, pitch (muzzle up +) and roll (top toward his right +), radians. */
function gunQ(yaw, pitch, roll, out) { _eG.set(roll, -yaw, pitch, 'YZX'); return out.setFromEuler(_eG); }
function aimOrigin(r, out) { out.setFromMatrixPosition(r.bones.spine2.matrixWorld); out.y -= 0.6 * (S.bob || 0); return out; }
const muzzleOf = (g, w, out) => { const m = (SOCKETS[w] || SOCKETS.pistol).muzzle; return out.set(m[0], m[1], m[2]).applyQuaternion(g.q).add(g.p); };
const copyPose = (a, o) => { o.p.copy(a.p); o.q.copy(a.q); return o; };
const blendPose = (a, b, t, o) => { o.p.lerpVectors(a.p, b.p, t); o.q.slerpQuaternions(a.q, b.q, t); return o; };

/**
 * A gun yaw held within reach of the chest (a fast flick: the chest lags the face, and a shouldered or low-ready gun would
 * otherwise swing through his body): the pistol ±flick.yawPistol of the chest's aim line, a long gun ±flick.yawLong
 * shouldered, narrowing toward ±flick.yawLow as it comes off the shoulder to low ready (flickK).
 */
function flickYaw(w, want) {
  const FL = TUNE.flick, lim = LONG[w] ? lerp(lerp(FL.yawLow, FL.yawLong, S.flickK) * DEG, Math.PI, S.shotW) : FL.yawPistol * DEG;
  return S.chestRef + clamp(wrap(want - S.chestRef), -lim, lim);
}
/** The aimed gun (§4.8) for weapon w: converged yaw, aim pitch; `live` adds the recoil, the dry fire, the action roll and the high port. */
function aimGun(r, w, live, out) {
  const st = r.st, B = r.bones, AP = AIM[w] || AIM.pistol, Sk = SOCKETS[w] || SOCKETS.pistol;
  // the gun's yaw stays within reach of the chest (a fast flick: the chest lags the face; a shouldered gun otherwise swung
  // through his body): the long guns ±flickYaw.long of the chest's aim line, the pistol ±flickYaw.pistol
  // (M5: live, the aimed gun sways a little (faded out round a shot) and comes back off low cover)
  const yaw = flickYaw(w, S.faceYaw + st.conv) + (live ? (GC.rYaw + GC.rlGunYaw * GC.rl + LV.swayYaw) * DEG : 0), port = live ? st.port.x : 0, HP = LONG[w] ? TUNE.highPort.long : TUNE.highPort.pistol;
  const pitch = st.aimPitch + (live ? (GC.rPitch + GC.dryPitch + GC.actPitch + LV.swayPitch) * DEG + HP[1] * DEG * port : 0);
  gunQ(yaw, pitch, live ? (GC.gunRoll + GC.cant * ACTIONS.bolt.cantRoll) * DEG : 0, out.q);
  const back = live ? GC.rBack + GC.actBack - HP[0] * port - LIFE.cover.low.back * LV.cover * LV.coverLow * (1 - LV.pop) : 0;
  if (LONG[w]) {
    const pk = SOCKETS.spine2.pocketR, CW = TUNE.cheek, dP = clamp(CW.refPitch - st.aimPitch / DEG, -6, 12);
    _gv.set(pk[0] + CW.pocket * dP, pk[1] - HP[2] * port - CW.pocket * dP, pk[2]).applyMatrix4(B.spine2.matrixWorld);
    _gv2.set(Sk.butt[0], Sk.butt[1], Sk.butt[2]).applyQuaternion(out.q);
    out.p.subVectors(_gv, _gv2);
  } else {
    const o = aimOrigin(r, _gv), g = AP.grip, c = Math.cos(yaw), s = Math.sin(yaw);
    out.p.set(o.x + c * g[0] - s * g[2], o.y + g[1], o.z + s * g[0] + c * g[2]);
  }
  if (back) out.p.addScaledVector(_gv3.set(1, 0, 0).applyQuaternion(out.q), back);
  if (live && GC.cant) out.p.y -= ACTIONS.bolt.cantDrop * GC.cant;
  return out;
}
/**
 * Convergence (D6): the bore points at the point ON the sim line p + D·dir(p.angle) at y 30. The yaw correction is
 * measured from the muzzle (two passes: the muzzle moves as the gun turns), capped at 7° and faded out for D ≥ 400;
 * the pitch looks down from the muzzle to the same point, clamped to [−16°, +4°].
 */
function converge(r, p, w) {
  const st = r.st, a = p.angle || 0, D = st.aimD, tx = p.x + D * Math.cos(a), tz = p.y + D * Math.sin(a);
  const fade = 1 - ss(250, 400, D), cap = TUNE.convMaxDeg * DEG;
  for (let i = 0; i < 2; i++) {
    aimGun(r, w, false, GT);
    const m = muzzleOf(GT, w, _gw);
    const dx = tx - m.x, dz = tz - m.z, h = Math.hypot(dx, dz);
    st.conv = clamp(wrap(Math.atan2(dz, dx) - S.faceYaw), -cap, cap) * fade;
    st.aimPitch = clamp(Math.atan2(30 - m.y, Math.max(h, 8)), -16 * DEG, 4 * DEG);
  }
  // (debug) how far the converged rest bore (no recoil, no high port) passes from the aim point
  aimGun(r, w, false, GT); muzzleOf(GT, w, _gw);
  st.muzzleFwd = (_gw.x - p.x) * Math.cos(a) + (_gw.z - p.y) * Math.sin(a); // (the high port's reach ahead)
  _gv.set(tx, 30, tz).sub(_gw); _gv2.set(1, 0, 0).applyQuaternion(GT.q);
  st.boreMissRest = _gv.addScaledVector(_gv2, -_gv.dot(_gv2)).length();
}
/** The relaxed carry (§4.8): the pistol rides the FK hand; the long guns sit at low ready, or port arms in a sprint. */
function relaxedGun(r, w, out) {
  const B = r.bones;
  if (!LONG[w]) {
    _m1.copy(B.handR.matrixWorld).multiply(_m3.makeTranslation(GRIPR[0], GRIPR[1], GRIPR[2])).multiply(HELD);
    _m1.decompose(out.p, out.q, _s1);
    return out;
  }
  const RL = RELAXED.long, Sk = SOCKETS[w], pk = SOCKETS.spine2.pocketR;
  _gv.set(pk[0], pk[1] - RL.drop, pk[2]).applyMatrix4(B.spine2.matrixWorld);
  gunQ(flickYaw(w, S.faceYaw) + RL.yaw * DEG, RL.pitch * DEG, 0, out.q);
  out.p.subVectors(_gv, _gv2.set(Sk.butt[0], Sk.butt[1], Sk.butt[2]).applyQuaternion(out.q));
  const sw = r.st.sprintW;
  if (sw > 0.001) {
    const PO = RELAXED.port;
    worldQuat(B.spine2, _sq);
    GPORT.p.set(PO.at[0], PO.at[1], PO.at[2]).applyMatrix4(B.spine2.matrixWorld);
    _eG.set(PO.roll * DEG, -PO.yaw * DEG, PO.pitch * DEG, 'YZX'); GPORT.q.setFromEuler(_eG).premultiply(_sq);
    blendPose(out, GPORT, ss(0, 1, sw), out);
  }
  return out;
}
/** A named gun pose (GUN_POSES): frame A (relative to the converged aim yaw) or the spine2 frame. */
function namedGun(r, name, out) {
  const P = GUN_POSES[name], B = r.bones;
  if (P.frame === 'A') {
    const yaw = S.faceYaw + r.st.conv, o = aimOrigin(r, _gv), c = Math.cos(yaw), s = Math.sin(yaw);
    out.p.set(o.x + c * P.at[0] - s * P.at[2], o.y + P.at[1], o.z + s * P.at[0] + c * P.at[2]);
    gunQ(yaw + P.yaw * DEG, P.pitch * DEG, P.roll * DEG, out.q);
  } else {
    worldQuat(B.spine2, _sq);
    out.p.set(P.at[0], P.at[1], P.at[2]).applyMatrix4(B.spine2.matrixWorld);
    _eG.set(P.roll * DEG, -P.yaw * DEG, P.pitch * DEG, 'YZX'); out.q.setFromEuler(_eG).premultiply(_sq);
  }
  return out;
}
/** The back sling (§4.8): diagonal across the back, the muzzle out over the left shoulder, the top facing back; slot 1 is the second owned long gun's place beside it. */
function slingGun(r, out, slot = 0) {
  const sock = slot ? SOCKETS.spine2.backSling2 : SOCKETS.spine2.backSling, k = r.st.slingLow;
  // (while a tool is out the first slot lies flatter across his back (st.slingLow, eased): the chop's forward lean and
  // twist stood it upright behind him like a mast; the second gun is put away meanwhile, weapons())
  if (k > 0) { const L = slot ? SOCKETS.spine2.backSlingLow : SOCKETS.spine2.backSlingFlat; _v1.set(lerp(sock.dir[0], L.dir[0], k), lerp(sock.dir[1], L.dir[1], k), lerp(sock.dir[2], L.dir[2], k)).normalize(); _v4.set(lerp(sock.at[0], L.at[0], k), lerp(sock.at[1], L.at[1], k), lerp(sock.at[2], L.at[2], k)); }
  else { _v1.set(sock.dir[0], sock.dir[1], sock.dir[2]).normalize(); _v4.set(sock.at[0], sock.at[1], sock.at[2]); }
  _v2.set(-1, 0, 0); _v3.crossVectors(_v1, _v2).normalize(); _v2.crossVectors(_v3, _v1).normalize();
  _m1.makeBasis(_v1, _v2, _v3).setPosition(_v4.x, _v4.y, _v4.z);
  _m1.premultiply(r.bones.spine2.matrixWorld);
  _m1.decompose(out.p, out.q, _s1);
  return out;
}
const stowGun = (r, w, out) => (LONG[w] ? slingGun(r, out, r.st.backSlot[1] === w ? 1 : 0) : namedGun(r, 'holster', out));
/**
 * The back's two sling places (§4.8, amended: every owned long gun not in his hands rides his back; the second beside the
 * first): a gun keeps its place while it is on the back (or travelling to it, or until a swap's draw takes it off), so a
 * draw always starts from the gun the player can see.
 */
function backSlots(r) {
  const st = r.st, inv = (G.s && G.s.inv) || {}, W = st.sw, SL = st.backSlot;
  const onBack = (w) => !!w && LONG[w] && (inv[w] || 0) > 0 && (w !== S.weapon || st.stowed || (W.on && W.to === w && GC.swF < SWAP.inStart && W.from !== w));
  for (let i = 0; i < 2; i++) if (!onBack(SL[i])) SL[i] = null;
  for (const w of LONG_LIST) if (onBack(w) && SL[0] !== w && SL[1] !== w) SL[SL[0] ? 1 : 0] = w;
  st.slung = SL[0] || SL[1]; st.slung2 = SL[0] && SL[1] ? SL[1] : null;
  st.slingLow = clamp(st.slingLow + (st.stowed && st.slung ? 1 : -1) * S.adt / 0.3, 0, 1);
}
/** The base gun of weapon w: relaxed → aim by the aim weight. */
function baseGun(r, w, out) {
  // (a long gun comes off the shoulder to low ready through a fast flick and back up as the chest arrives)
  const wA = S.aimW * (LONG[w] ? S.flickK : 1);
  if (wA >= 0.999) return aimGun(r, w, true, out);
  relaxedGun(r, w, out);
  // (M5) the prowl's two-handed low ready (the pistol; the long guns are at low ready already)
  if (!LONG[w] && LV.prowl > 0.001) { const PW = LIFE.prowl; gunInA(r, S.faceYaw + r.st.conv, PW.gun[0], PW.gun[1], PW.gun[2], PW.gunPitch, PW.gunYaw, GAIM); blendPose(out, GAIM, LV.prowl, out); }
  // (M5 fix) the gun check: the pistol to its press-check pose in front of his chest (the right hand follows it)
  if (!LONG[w] && LV.chk > 0.001) { const GK = FIDGETS.gunCheck; gunInA(r, S.faceYaw, GK.at[0], GK.at[1], GK.at[2], GK.pitch, GK.yaw, GAIM, GK.roll); blendPose(out, GAIM, LV.chk, out); }
  if (wA > 0.001) { aimGun(r, w, true, GAIM); blendPose(out, GAIM, wA, out); }
  return out;
}
/** A Bézier control point for a hand or gun travel (§4.11): the midpoint, 4 u out from the torso's axis and 2 u forward. */
function bezCtrl(r, a, b, out, right = 0) {
  out.addVectors(a, b).multiplyScalar(0.5);
  const sp = _gcAxis.setFromMatrixPosition(r.bones.spine2.matrixWorld); // (never `out`: callers pass the module scratch _gc)
  let ox = out.x - sp.x, oz = out.z - sp.z; const L = Math.hypot(ox, oz) || 1; ox /= L; oz /= L;
  const f = S.chestYaw, c = Math.cos(f), s = Math.sin(f);
  // outward from the torso's axis, forward, and (a long gun's travel) out to his right: the gun swings under the right arm
  out.x += SWAP.bezOut * ox + SWAP.bezFwd * c - right * s; out.z += SWAP.bezOut * oz + SWAP.bezFwd * s + right * c;
  return out;
}
/**
 * A swap's travel between two places on the body (§4.11 hand paths): a cubic Bézier in the chest's frame, leaving A along
 * A's exit and arriving at B along B's (SWAP.exit: out of the coat front for the holster, out round the right side for the
 * sling, a little forward for a gun in the hands), so a hand or a gun crossing from the holster to the back goes round
 * the body, never through it. aW, bW: world points; exA, exB: spine2-local offsets; out: world.
 */
const _pA = V(), _pB = V(), _pC1 = V(), _pC2 = V(), _pM = new THREE.Matrix4();
function bodyPath(r, aW, bW, exA, exB, u, out) {
  const M = r.bones.spine2.matrixWorld;
  _pM.copy(M).invert();
  _pA.copy(aW).applyMatrix4(_pM); _pB.copy(bW).applyMatrix4(_pM);
  _pC1.set(exA[0], exA[1], exA[2]).add(_pA); _pC2.set(exB[0], exB[1], exB[2]).add(_pB);
  const t = clamp(u, 0, 1), k = 1 - t, a = k * k * k, b = 3 * k * k * t, c = 3 * k * t * t, d = t * t * t;
  out.set(a * _pA.x + b * _pC1.x + c * _pC2.x + d * _pB.x, a * _pA.y + b * _pC1.y + c * _pC2.y + d * _pB.y, a * _pA.z + b * _pC1.z + c * _pC2.z + d * _pB.z);
  return out.applyMatrix4(M);
}
const exitOf = (w) => (!w ? SWAP.exit.hand : LONG[w] ? SWAP.exit.sling : SWAP.exit.holster);
const gunExitOf = (w) => (LONG[w] ? SWAP.gunExit.sling : SWAP.gunExit.holster);
/** A gun-relative hand pose onto a frame (gun or sub-bone): wrist and hand rotation (world). */
function onFrame(fp, fq, h, outP, outQ) { outQ.copy(fq).multiply(h.q); outP.copy(h.t).applyQuaternion(fq).add(fp); }
function boneFrame(bone, outP, outQ) { bone.matrixWorld.decompose(outP, outQ, _s1); }
/** Left-hand waypoint → wrist and hand rotation (world), for the gun of weapon w at pose g. */
function wpLeft(r, id, w, g, outP, outQ) {
  const B = r.bones;
  switch (id) {
    case WP.SUPPORT: { const s = SOCKETS.pistol.support, o = AIM.pistol.support; outQ.copy(g.q).multiply(Q_SUPPORT); outP.set(s[0] + o[0], s[1] + o[1], s[2] + o[2]).applyQuaternion(g.q).add(g.p); outP.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(outQ)); return; }
    case WP.FOREND: {
      const o = (AIM[w] || AIM.shotgun).forend;
      if (w === 'shotgun') { boneFrame(B.shotgunForend, _sp, _pq); outQ.copy(_pq).multiply(Q_FOREND); outP.set(o[0], o[1], o[2]).applyQuaternion(_pq).add(_sp); }
      else { const f = SOCKETS.rifle.forend; outQ.copy(g.q).multiply(Q_FOREND); outP.set(f[0] + o[0], f[1] + o[1], f[2] + o[2]).applyQuaternion(g.q).add(g.p); }
      outP.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(outQ));
      // the hand may slide back along the forend (up to 4 u) when the arm can't reach its spot (low ready, port arms)
      _sp.setFromMatrixPosition(B.upperArmL.matrixWorld);
      const ex = outP.distanceTo(_sp) - 0.97 * (ARM1 + ARM2);
      if (ex > 0) outP.addScaledVector(_gv3.set(1, 0, 0).applyQuaternion(g.q), -Math.min(4, ex * 1.3));
      return;
    }
    case WP.POCKET: {
      // the left coat pocket, 1 u out from the coat, the hand hanging into it
      const pk = SOCKETS.pelvis.pocketL;
      worldQuat(B.pelvis, outQ); outQ.multiply(_hq3.setFromAxisAngle(_gv3.set(0, 0, 1), -12 * DEG));
      outP.set(pk[0], pk[1] + 2.0, pk[2] - 1.0).applyMatrix4(B.pelvis.matrixWorld);
      outP.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(outQ)); return;
    }
    case WP.SHELL: {
      // the shell loops on the left hip (outside the coat): the hand comes down and back to them, palm in
      const pk = SOCKETS.pelvis.shellBelt;
      worldQuat(B.pelvis, outQ); outQ.multiply(_hq3.setFromAxisAngle(_gv3.set(0, 0, 1), -25 * DEG));
      outP.set(pk[0], pk[1], pk[2]).applyMatrix4(B.pelvis.matrixWorld);
      outP.sub(_gv3.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(outQ)); return;
    }
    case WP.WELL_LOW: onFrame(g.p, g.q, H_WELL_LOW, outP, outQ); return;
    case WP.WELL: onFrame(g.p, g.q, H_WELL, outP, outQ); return;
    case WP.RACK: boneFrame(B.pistolSlide, _sp, _pq); onFrame(_sp, _pq, H_RACK, outP, outQ); return;
    case WP.PORT_LOW: onFrame(g.p, g.q, H_PORT_LOW, outP, outQ); return;
    case WP.PORT_IN: onFrame(g.p, g.q, H_PORT_IN, outP, outQ); return;
    case WP.R_UP: onFrame(g.p, g.q, H_RUP, outP, outQ); return;
    case WP.R_PRESS: onFrame(g.p, g.q, H_RPRESS, outP, outQ); return;
    default: outP.copy(_fkLw); outQ.copy(_fkLq);
  }
}
/** Right-hand waypoint (the grip, the bolt knob, the stowed gun's grip for a swap). */
function wpRight(r, id, w, g, outP, outQ) {
  if (id === WP.KNOB) { boneFrame(r.bones.rifleBolt, _sp, _pq); onFrame(_sp, _pq, H_KNOB, outP, outQ); return; }
  if (id === WP.FK) { outP.copy(_fkRw); outQ.copy(_fkRq); return; }
  onFrame(g.p, g.q, H_GRIP, outP, outQ);
}
/** A hand travelling from waypoint pose A to B (eased u), on a Bézier. */
function travel(r, pA, qA, pB, qB, u, outP, outQ, bez = true, right = 0) {
  if (bez && u > 0 && u < 1) { bezCtrl(r, pA, pB, _gc, right); qbez(pA, _gc, pB, u, outP); } else outP.lerpVectors(pA, pB, u);
  outQ.slerpQuaternions(qA, qB, u);
}

/* -------- clip values of this frame (time only; no bones): recoil, actions, reload, swap -------- */
const GC = {
  rPitch: 0, rBack: 0, rSlide: 0, rS2: 0, rS1: 0, rHead: 0, rPel: 0, forendX: 0, gunRoll: 0, boltRot: 0, boltX: 0, knobW: 0, actHead: 0,
  dryPitch: 0, dryRoll: 0, slideX: 0, rl: 0, rlGun: 0, rlPose: null, rlJy: 0, rlJp: 0, jig: 0, lA: 0, lB: 0, lU: 0, lProp: 0, magX: 0, magVis: true,
  rA: 11, rB: 11, rU: 0, s2Pitch: 0, s2Yaw: 0, s2Roll: 0, headPitch: 0, headYaw: 0, headRoll: 0, pelY: 0, blade: 0, eject: null, dropMag: false,
  rYaw: 0, rClavE: 0, rClavP: 0, actBack: 0, actPitch: 0, actClavLP: 0, actClavLE: 0, actS2Yaw: 0, cant: 0, dryHead: 0, dryTap: 0, rlS2Yaw: 0, rlHeadYaw: 0, rlGunYaw: 0,
  sw: false, swF: 0, swFrom: 'pistol', swTo: 'pistol',
};
const RC_CH = ['gunPitch', 'gunBack', 'spine2Pitch', 'spine1Pitch', 'headPitch', 'pelvisDx', 'clavElev', 'clavProt'];
const RC_PEAK = {};
for (const w of ['pistol', 'shotgun', 'rifle']) { RC_PEAK[w] = {}; for (const c of RC_CH) { const tr = RECOIL[w][c]; RC_PEAK[w][c] = tr ? Math.max(...tr.map((k) => Math.abs(k[1]))) : 0; } }
const RCV = { gunPitch: 0, gunBack: 0, spine2Pitch: 0, spine1Pitch: 0, headPitch: 0, pelvisDx: 0, clavElev: 0, clavProt: 0 };
/** A shot's variation in [0, 1) from the shot count (deterministic: the same shot always looks the same). */
const shotHash = (n, k) => { const x = Math.sin(n * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };
function recoilAt(w, t, carry, out) {
  const R = RECOIL[w] || RECOIL.pistol;
  for (const c of RC_CH) {
    const tr = R[c]; let v = tr && t < R.T + 0.05 ? sample(tr, t) : 0;
    if (carry) { const k = Math.max(0, 1 - t / 0.12); v += (carry[c] || 0) * k; const pk = 1.3 * RC_PEAK[w][c]; v = clamp(v, -pk, pk); }
    out[c] = v;
  }
  return out;
}
function gunClips(r, p) {
  const st = r.st, A = ACTIONS, w = S.weapon;
  for (const k in GC) if (typeof GC[k] === 'number') GC[k] = 0;
  GC.rA = GC.rB = WP.GRIP; GC.magVis = true; GC.rlPose = null; GC.eject = null; GC.dropMag = false; GC.sw = false;
  // ---- recoil (keyed on tShot, sim seconds; restarts from the current value on every shot edge)
  const tS = S.tShot, sw = st.shotWeapon || w;
  if (S.shot) { if (st.prevShotWeapon === sw && st.rcT < 0.4) { recoilAt(sw, st.rcT, st.rcCarry, RCV); for (const c of RC_CH) st.rcCarry[c] = RCV[c]; } else for (const c of RC_CH) st.rcCarry[c] = 0; }
  st.rcT = tS;
  if (S.shot) { const VY = RECOIL.vary; st.rcAmp = lerp(VY.lo, VY.hi, shotHash(st.shots, 1)); st.rcYaw = (2 * shotHash(st.shots, 2) - 1) * VY.yaw; }
  if (tS < 0.4 && sw === w) {
    recoilAt(w, tS, st.rcCarry, RCV);
    const k = st.rcAmp || 1, pk = RC_PEAK[w].gunPitch || 1;
    GC.rPitch = RCV.gunPitch * k; GC.rBack = RCV.gunBack * k; GC.rS2 = RCV.spine2Pitch * k; GC.rS1 = RCV.spine1Pitch * k; GC.rHead = RCV.headPitch * k; GC.rPel = RCV.pelvisDx * k;
    GC.rClavE = RCV.clavElev * k; GC.rClavP = RCV.clavProt * k;
    GC.rYaw = (st.rcYaw || 0) * clamp(RCV.gunPitch / pk, -0.3, 1.3); // (the sideways throw rides the muzzle flip's envelope)
  }
  // pistol slide: the recoil cycle; locked back after the last round (cleared by the reload's rack, or a mag with no reload)
  if (w === 'pistol') {
    if (S.shot && (p.mag || 0) === 0) st.slideLocked = true;
    if ((p.mag || 0) > 0 && !((p.reloadT || 0) > 0)) st.slideLocked = false;
    const sl = tS < 0.2 && sw === 'pistol' ? sample(RECOIL.pistol.slide, tS) : 0;
    GC.slideX = st.slideLocked ? (tS < 0.015 ? sl : A.lockX) : sl;
  }
  // ---- the action: pump / bolt after a shot with rounds left (cancelled by a swap or a reload start)
  if (S.shot) st.act = (p.mag || 0) > 0 && !S.reloadStart ? (w === 'shotgun' ? 'pump' : w === 'rifle' ? 'bolt' : null) : null;
  if ((S.swapStart || S.reloadStart) && st.act && !st.actEj) { st.actEj = true; GC.eject = st.act === 'pump' ? 'shotgun' : 'rifle'; }
  if (S.swapStart || S.reloadStart || st.act && st.act !== (w === 'shotgun' ? 'pump' : 'bolt')) st.act = null;
  if (st.act === 'pump') {
    const P = A.pump, c = sample(P.counter, tS);
    GC.forendX = sample(P.forend, tS); GC.gunRoll = sample(P.roll, tS);
    GC.actBack = P.back * c; GC.actPitch = P.pitch * c; GC.actClavLP = P.clavProtL * c; GC.actClavLE = P.clavElevL * c; GC.actS2Yaw = P.s2Yaw * c;
    if (tS >= A.pump.eject && !st.actEj) { st.actEj = true; GC.eject = 'shotgun'; }
    if (tS > A.pump.end) st.act = null;
  } else if (st.act === 'bolt') {
    GC.knobW = sample(A.bolt.handW, tS); GC.boltRot = sample(A.bolt.rot, tS); GC.boltX = sample(A.bolt.x, tS); GC.actHead = sample(A.bolt.headPitch, tS); GC.cant = sample(A.bolt.cant, tS);
    if (tS >= A.bolt.eject && !st.actEj) { st.actEj = true; GC.eject = 'rifle'; }
    if (tS > A.bolt.end) st.act = null;
  }
  if (S.shot) st.actEj = false;
  if (GC.knobW > 0) { GC.rA = WP.GRIP; GC.rB = WP.KNOB; GC.rU = GC.knobW; }
  // ---- dry fire
  if (S.dryFire) st.dryT = 0; else st.dryT += S.adt;
  if (st.dryT < A.dry.end) { GC.dryPitch = sample(A.dry.gunPitch, st.dryT); GC.dryRoll = sample(A.dry.headRoll, st.dryT); GC.dryHead = sample(A.dry.headPitch, st.dryT); GC.dryTap = w === 'pistol' ? sample(A.dry.tap, st.dryT) : 0; }
  reloadClip(r, p);
  swapClip(r, p);
}

/* -------- reloads (§4.10): tactical vs empty, chain guards, the rack only on a natural finish -------- */
function reloadClip(r, p) {
  const st = r.st, R = st.rl, w = S.weapon, rT = p.reloadT || 0, rM = p.reloadMax || 0;
  if (S.swapStart || S.hardReset || p.dead) { R.on = false; R.tail = 0; R.out = 0; }
  // a shot during the reload (a hold-fire interrupt of the shell chain, or a click during a render tail): the gun is on the
  // aim line THAT frame (the recoil hides the cut); only the left hand keeps its 0.06 s fade, and its waypoints ride the gun
  if (S.shot && R.on && !S.reloadStart) { R.gunCut = true; if (R.kind !== 'out') { R.kind = 'out'; R.out = 0; } }
  // a reload that was running when he went down: the sim only froze its timer, so no start edge will come after the
  // recovery; pick the clip up from the live timer on the first alive frame
  const resume = S.hardReset && !S.first && !p.dead && rT > 0;
  if ((S.reloadStart || resume) && rM > 0) {
    R.on = true; R.gunCut = false; R.weapon = w; R.empty = (p.mag || 0) === 0; R.cycle = 0; R.tail = 0; R.tailT = 0; R.out = 0; R.entry = 0; R.dropped = false; R.ejected = false;
    R.hold = S.shot || S.tShot < 0.08 ? 0.08 - Math.min(0.08, Math.max(0, S.tShot)) : 0;
    // (a fresh key object per reload or shell: an event, not a frame; the rifle presses one round per round it needs)
    R.need = w === 'rifle' ? Math.max(0, Math.min(WEAPONS.rifle.mag - (p.mag || 0), (G.s && G.s.inv && G.s.inv.rifle_ammo) ?? 99)) : 0;
    R.kind = 'live'; R.K = reloadKeys(w, rM, R.empty, {}, R.need); R.w = 0;
  }
  if (S.reloadCycle && R.on && w === 'shotgun') { R.cycle++; R.K = reloadKeys(w, rM, R.empty, {}); }
  if (S.reloadEndNat && R.on) {
    R.kind = 'tail'; R.tailT = 0;
    R.tail = R.weapon === 'shotgun' ? (R.empty ? 0.25 : 0.2) : R.weapon === 'rifle' ? 0.3 : 0.12;
    R.rack = R.weapon === 'shotgun' && R.empty;
  }
  if (S.reloadInterr && R.on && R.kind === 'live') { R.kind = 'out'; R.out = 0; }
  if (!R.on || R.weapon !== w) { R.on = false; return; }
  // the time base: τ while live (frozen once it ends), and the tail clock (sim time)
  if (R.kind === 'live') { R.f = rM > 0 && rT > 0 ? clamp(1 - rT / rM, 0, 1) : R.f; R.tau = R.f * R.K.D; R.entry += S.adt; }
  else if (R.kind === 'tail') { R.tailT += S.adt; if (R.tailT >= R.tail) { R.on = false; return; } }
  else { R.out += S.adt; if (R.out >= 0.06) { R.on = false; return; } }
  // the layer weight: in over TUNE.reloadIn (held at 0 for 0.08 s after a same-frame shot), out 0.06 s on an interrupt
  if (R.hold > 0) { R.hold -= S.adt; R.w = 0; } else R.w = Math.min(1, R.w + S.adt / TUNE.reloadIn);
  GC.rl = R.kind === 'out' ? R.w * (1 - ES(R.out / 0.06)) : R.w;
  if (w === 'pistol') pistolReload(st, R, R.K);
  else if (w === 'shotgun') shotgunReload(st, R, R.K);
  else rifleReload(st, R, R.K);
  // a shot cut the reload: the gun (and the right hand) are already back on the aim line; the reload's gun motion is gone
  // (and the chest channels that carry a shouldered gun's pocket snap back with it: the recoil's own kick hides the cut)
  if (R.gunCut) { GC.rlGun = 0; GC.rlJy = GC.rlJp = 0; GC.jig = 0; GC.rU = 0; GC.rA = GC.rB = WP.GRIP; GC.blade = 0; GC.s2Pitch = GC.s2Roll = GC.rlS2Yaw = GC.rlGunYaw = GC.rlHeadYaw = 0; }
  GC.blade *= GC.rl;
}
function pistolReload(st, R, K) {
  const t = R.tau + (R.kind === 'tail' ? R.tailT : 0), PW = TUNE.pistolWait;
  GC.rlPose = 'pistolReload';
  // the gun: into the reload pose, held while the magazine goes in; then, while he waits on the sim's reload, up to a
  // high ready (tactical: it can't fire yet, so not the full aim) or held up by the chest for the rack (empty); the rest
  // of the way back over the last 0.12 s
  const back = Math.min(K.gunOut, K.seat + 0.12), half = Math.min(K.gunOut, K.seat + 0.30), hold = R.empty ? PW.emptyHold : PW.highReady;
  GC.rlGun = t < K.gunIn ? EO(seg(t, 0, K.gunIn)) : t < back ? 1 : t < K.gunOut ? lerp(1, hold, ES(seg(t, back, half))) : hold * (1 - ES(seg(t, K.gunOut, K.end)));
  // the magazine: out 1.5 along the grip axis, dropped (debris), the new one seated at τS
  if (t < K.magDrop) GC.magX = 1.5 * ES(seg(t, 0, K.magOut));
  else if (t < K.seat) GC.magVis = false;
  if (t >= K.magDrop && !R.dropped) { R.dropped = true; GC.dropMag = true; }
  // the support hand: support → pocket → under the well → the well → back to the support at once; an empty gun's rack
  // comes over the top at ρR0 (pull, release on the 'reloadDone' click), then the hand settles back on the support; a
  // tactical reload with time to spare press-checks the slide (a touch on the rack and back)
  let a = WP.SUPPORT, b = WP.POCKET, u = ES(seg(t, 0, K.pocket));
  if (t >= K.pocket) { a = WP.POCKET; b = WP.WELL_LOW; u = ES(seg(t, K.pocket, K.well)); }
  if (t >= K.well) { a = WP.WELL_LOW; b = WP.WELL; u = EO3(seg(t, K.well, K.seat)); }
  if (t >= K.seat) {
    const ret = Math.min(K.seat + 0.22, R.empty ? K.rackOn : K.support);
    if (R.empty) {
      // (always by way of the support grip, outside the gun: a short reload's straight well → slide trip swung the hand
      // in under the gun, into the coat)
      const a0 = Math.max(ret, K.rackOn - 0.15), r1 = a0 > ret ? ret : 0.5 * (K.seat + K.rackOn), r2 = a0 > ret ? a0 : r1;
      if (t < r1) { a = WP.WELL; b = WP.SUPPORT; u = ES(seg(t, K.seat, r1)); }
      else if (t < r2) { a = b = WP.SUPPORT; u = 1; }
      else if (t < K.rackOn) { a = WP.SUPPORT; b = WP.RACK; u = ES(seg(t, r2, K.rackOn)); }
      else if (t < K.release) { a = b = WP.RACK; u = 1; }
      else { a = WP.RACK; b = WP.SUPPORT; u = ES(seg(t, K.release, K.end + 0.12)); }
    } else {
      a = WP.WELL; b = WP.SUPPORT; u = ES(seg(t, K.seat, ret));
      const pc = K.seat + PW.checkAt;
      if (t >= ret && pc + PW.checkT < K.gunOut - 0.05 && t >= pc && t < pc + PW.checkT) { a = WP.SUPPORT; b = WP.RACK; u = Math.sin(Math.PI * seg(t, pc, pc + PW.checkT)); }
    }
  }
  GC.lA = a; GC.lB = b; GC.lU = u;
  GC.lProp = t >= K.pocket && t < K.seat ? PROP_L.mag : PROP_L.none;
  // the slide: locked back, pulled (lockX − 0.4), released home on the 'reloadDone' click
  if (R.empty) {
    const pullX = ACTIONS.lockX - 0.4;
    GC.slideX = t < K.rackOn ? ACTIONS.lockX : t < K.pull ? lerp(ACTIONS.lockX, pullX, EO(seg(t, K.rackOn, K.pull))) : t < K.release ? pullX : pullX * (1 - EI(seg(t, K.release, K.end)));
    if (t >= K.release) st.slideLocked = false;
  }
  // the seat's jolt
  const js = jolt(t - K.seat, 30); GC.rlJy = -0.8 * js; GC.rlJp = 3 * js;
  // looking at the gun, the chest working; while he waits he looks up and scans left and right (the head comes off the gun)
  const ws = t - K.seat - PW.scanFrom, scan = ws > 0 && t < K.gunOut ? ss(0, 0.12, ws) * (1 - ss(K.gunOut - 0.12, K.gunOut, t)) : 0;
  const hw = ss(K.headOn - 0.05, K.headOn, t) * (1 - ss(K.headOff, K.end, t)) * (1 - 0.85 * scan);
  GC.headPitch = 10 * hw;
  // (the wait: the gun and the chest sweep with the eyes, a scan the high camera can read; an empty one sweeps less and is
  // still again before the rack)
  const sweep = scan ? Math.sin(2 * Math.PI * ws / PW.scanT) * scan : 0;
  const gs = R.empty ? PW.scanEmpty * (1 - ss(K.rackOn - 0.25, K.rackOn - 0.1, t)) : 1;
  GC.rlHeadYaw = PW.scanYaw * sweep; GC.rlGunYaw = PW.scanGun * sweep * gs; GC.rlS2Yaw = PW.scanChest * sweep * gs;
  GC.s2Pitch = t < K.pocket ? 4 * ES(seg(t, 0, K.pocket)) : t < K.seat ? lerp(4, -2, EO(seg(t, K.pocket, K.seat))) : -2 * (1 - ES(seg(t, K.seat, K.end)));
  GC.blade = GUN_POSES.pistolReload.blade * GC.rlGun;
}
function shotgunReload(st, R, K) {
  const f = R.f, tail = R.kind === 'tail', SP = GUN_POSES.shotgunReload;
  GC.rlPose = 'shotgunReload';
  GC.rlGun = tail ? 1 - EO(seg(R.tailT, 0, R.tail)) : EO(seg(R.entry, 0, 0.1));
  if (tail) {
    // the remount (and on an empty chain, the rack: the forend back and home, the pending hull out at .08)
    GC.lA = WP.PORT_LOW; GC.lB = WP.FOREND; GC.lU = ES(seg(R.tailT, 0, 0.10));
    if (R.rack) {
      GC.forendX = sample(ACTIONS.rack, R.tailT);
      if (R.tailT >= 0.08 && !R.ejected) { R.ejected = true; GC.eject = 'shotgun'; }
    }
  } else {
    // every shell: the thumb pushes it into the port (the gun nods), the hand drops to the shell loops on the left hip
    // (the chest and the head turn to it), and comes back up with the next one
    let a = WP.PORT_LOW, b = WP.PORT_IN, u = EI(seg(f, 0, K.push));
    if (f >= K.push) { a = WP.PORT_IN; b = WP.SHELL; u = ES(seg(f, K.push, K.fetch)); }
    if (f >= K.fetch) { a = WP.SHELL; b = WP.PORT_LOW; u = ES(seg(f, K.fetch, K.end)); }
    // the first shell: the hand comes off the forend to the port within 0.06 s
    if (R.cycle === 0 && R.entry < 0.06 && f < K.push) { a = WP.FOREND; b = WP.PORT_LOW; u = ES(seg(R.entry, 0, 0.06)); }
    GC.lA = a; GC.lB = b; GC.lU = u;
    GC.lProp = f < K.push || f >= K.fetch ? PROP_L.shell : PROP_L.none;
    GC.jig = K.jigTrack ? sample(K.jigTrack, f) : 0;
    const fw = sample(SP.fetch, f) * GC.rlGun;
    GC.s2Roll = SP.fetchS2Roll * fw; GC.rlS2Yaw = SP.fetchS2Yaw * fw; GC.rlHeadYaw = SP.fetchHeadYaw * fw;
  }
  GC.headPitch = SP.headPitch * GC.rlGun;
  GC.blade = (SP.blade - TUNE.blade.shotgun) * GC.rlGun;
}
function rifleReload(st, R, K) {
  const tail = R.kind === 'tail', t = tail ? K.end : R.tau, BA = ACTIONS.bolt;
  GC.rlPose = 'rifleReload';
  GC.rlGun = t < K.gunIn ? EO(seg(t, 0, K.gunIn)) : t < K.boltDown ? 1 : 1 - ES(seg(t, K.boltDown, K.end));
  // the right hand: grip → bolt knob → grip
  GC.rA = WP.GRIP; GC.rB = WP.KNOB; GC.rU = t < K.knob ? ES(seg(t, 0, K.knob)) : t < K.boltLock ? 1 : 1 - ES(seg(t, K.boltLock, K.end));
  // the bolt: up (on the release click), back (the brass out at .11), forward, down (locked on 'reloadDone')
  GC.boltRot = t < K.boltUp ? BA.rotMax * EO(seg(t, K.knob, K.boltUp)) : t < K.boltDown ? BA.rotMax : BA.rotMax * (1 - EI(seg(t, K.boltDown, K.boltLock)));
  GC.boltX = t < K.boltUp ? 0 : t < K.boltBack ? BA.xMax * EO(seg(t, K.boltUp, K.boltBack)) : t < K.boltFwd ? BA.xMax : BA.xMax * (1 - EI(seg(t, K.boltFwd, K.boltDown)));
  if (t >= K.eject && !R.ejected) { R.ejected = true; GC.eject = 'rifle'; }
  // round presses (one per round he needs, as many as the time allows): forend → pocket (the round shown) → over the port
  // → press (hidden) → back to the forend
  let a = WP.FOREND, b = WP.FOREND, u = 0;
  GC.lProp = PROP_L.none;
  for (let i = 0; i < (K.rounds || 0); i++) {
    const ka = K.press[i * 3], kb = K.press[i * 3 + 1], kc = K.press[i * 3 + 2], k0 = kc - (kc - ka) / 0.6;
    if (t >= k0 && t < ka) { a = WP.FOREND; b = WP.POCKET; u = ES(seg(t, k0, ka)); }
    else if (t >= ka && t < kb) { a = WP.POCKET; b = WP.R_UP; u = ES(seg(t, ka, kb)); }
    else if (t >= kb && t < kc) { a = WP.R_UP; b = WP.R_PRESS; u = EI(seg(t, kb, kc)); }
    else if (t >= kc && t < kc + 0.15) { a = WP.R_PRESS; b = WP.FOREND; u = ES(seg(t, kc, kc + 0.15)); }
    if (t >= ka && t < kc) GC.lProp = PROP_L.round;
  }
  GC.lA = a; GC.lB = b; GC.lU = u;
  const hw = ss(K.headOn - 0.04, K.headOn, t) * (1 - ss(K.headOff, K.headOff + 0.08, t));
  GC.headPitch = 12 * hw + (tail ? sample(ACTIONS.rifleTailHead, R.tailT) : 0); GC.headYaw = -10 * hw;
  GC.blade = (GUN_POSES.rifleReload.blade - TUNE.blade.rifle) * GC.rlGun;
}

/* -------- swap (§4.11): out to the holster or the sling, in from it; cross-draw body; Bézier hands -------- */
function swapClip(r, p) {
  const st = r.st, W = st.sw, sT = p.swapT || 0;
  if (S.swapStart) {
    // from: the gun actually in his hand last frame (a second swap edge mid-swap may find the first swap's source still
    // travelling to its holster, or no gun at all between the out and the in: then there is no OUT, only the draw)
    W.on = true; W.from = st.inHand || null; W.to = S.weapon;
    W.snapOk = st.gunLOk && st.gunLW === W.from; W.snapP.copy(st.gunLP); W.snapQ.copy(st.gunLQ); // the gun as it was (spine2-local)
    W.relOk = false;
  }
  if (S.swapStart) W.render = false;
  // (M4) the draw back after a tool (the hammer, the axe): a swap from empty hands on render time, so the right hand
  // travels from where it let go of the tool to the holster or the sling and draws on the swap's own paths; a shot
  // cancels it (the gun is on the aim line that frame)
  if (st.drawStart) {
    st.drawStart = false;
    if (!W.on) { W.on = true; W.render = true; W.rT = 0; W.from = null; W.to = S.weapon; W.snapOk = false; W.relOk = false; }
  }
  if (W.on && W.render) { W.rT += S.adt; if (W.rT >= st.drawT || p.dead || S.hardReset || W.to !== S.weapon || S.shot || st.tool) W.on = false; }
  else if (W.on && (!(sT > 0) || p.dead || S.hardReset || W.to !== S.weapon)) W.on = false;
  // a swap that was running when he went down resumes from the live timer on the first alive frame (the gun was dropped:
  // only the draw)
  if (!W.on && S.hardReset && !S.first && !p.dead && sT > 0) { W.on = true; W.render = false; W.from = null; W.to = S.weapon; W.snapOk = false; W.relOk = false; }
  if (!W.on) return;
  const f = W.render ? clamp(W.rT / st.drawT, 0, 1) : clamp(1 - sT / SWAP.T, 0, 1);
  GC.sw = true; GC.swF = f; GC.swFrom = W.from; GC.swTo = W.to;
  const cross = W.from === 'pistol' || W.to === 'pistol';
  GC.s2Yaw = sample(cross ? SWAP.crossYaw : SWAP.longYaw, f); GC.pelY = sample(SWAP.pelvisY, f);
}
/** The swap's out timings: a cross swap (pistol ↔ long gun) puts the first gun away sooner, so the hand can cross. */
const swapTimes = (W) => ((W.from === 'pistol') !== (W.to === 'pistol') ? SWAP.cross : SWAP);
/** The gun (and which weapon it is) during a swap; returns the weapon in hand or null (between the out and the in). */
function swapGun(r, out) {
  const st = r.st, W = st.sw, f = GC.swF, B = r.bones, TM = swapTimes(W);
  if (!W.from) return f < SWAP.inStart ? null : drawGun(r, W, f, out);
  if (f < TM.outEnd) {
    const w = W.from;
    if (w === 'pistol' && f >= TM.pistolHide) return null;
    // from the gun as it was (spine2-local snapshot), to the holster or the sling (O3), on a Bézier
    if (W.snapOk) { worldQuat(B.spine2, _sq); GT.p.copy(W.snapP).applyMatrix4(B.spine2.matrixWorld); GT.q.copy(_sq).multiply(W.snapQ); }
    else baseGun(r, w, GT);
    stowGun(r, w, GT2);
    // (eased in and out: from the aim the gun starts at rest; the spec's O3 started at full speed and popped a frame)
    const u = ES(f / TM.outEnd);
    bodyPath(r, GT.p, GT2.p, SWAP.gunExit.hand, gunExitOf(w), u, out.p); out.q.slerpQuaternions(GT.q, GT2.q, u);
    return w;
  }
  if (f < SWAP.inStart) return null;
  return drawGun(r, W, f, out);
}
function drawGun(r, W, f, out) {
  // (the hand has just closed on it: the draw starts from rest, then the long gun settles (O3), the pistol snaps out
  // with a little overshoot (back-out))
  const w = W.to, x = (f - SWAP.inStart) / (1 - SWAP.inStart), u = ES(x), e = LONG[w] ? lerp(u, EO(x), 0.35) : EB(u);
  stowGun(r, w, GT); baseGun(r, w, GT3);
  bodyPath(r, GT.p, GT3.p, gunExitOf(w), SWAP.gunExit.hand, Math.min(1, e), out.p);
  if (e > 1) out.p.addScaledVector(_gv.subVectors(GT3.p, GT.p), e - 1); // the back-out overshoot
  out.q.slerpQuaternions(GT.q, GT3.q, clamp(e, 0, 1));
  return w;
}

/* -------- M4: the actions' gun, the tools in hand, the left hand's overrides, the dropped gun -------- */
// the left hand on a handle (the axe): the right hand's grip mirrored across the gun's XY plane (thumb toward the head)
const H_GRIP_L = { t: new THREE.Vector3(H_GRIP.t.x, H_GRIP.t.y, -H_GRIP.t.z), q: new THREE.Quaternion(-H_GRIP.q.x, -H_GRIP.q.y, H_GRIP.q.z, H_GRIP.q.w) };
const Q_RZ90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2), Q_RZM90 = Q_RZ90.clone().invert();
const Q_RYM90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const _hX = V(), _hY = V(), _hZ = V(), _hM = new THREE.Matrix4(), _tw = V(), _tw2 = V(), _tq = new THREE.Quaternion(), _tq2 = new THREE.Quaternion(), _tq3 = new THREE.Quaternion();
const TOOL = { p: V(), q: new THREE.Quaternion() }, GR_ = { p: V(), q: new THREE.Quaternion() }, GL_ = { p: V(), q: new THREE.Quaternion() }, _tw3 = V();
/** A hand's world rotation from its finger direction (the hand's −Y) and palm normal (right hand −Z, left +Z), world vectors. */
function handQW(f, palm, right, out) {
  _hY.copy(f).normalize().negate(); _hZ.copy(palm); if (right) _hZ.negate();
  _hZ.addScaledVector(_hY, -_hZ.dot(_hY)).normalize(); _hX.crossVectors(_hY, _hZ);
  return out.setFromRotationMatrix(_hM.makeBasis(_hX, _hY, _hZ));
}
/** A work-frame vector (fwd, up, right at yaw y) to world, into out (added to `base` if given). */
function workV(y, f, u, rt, out, base = null) {
  const c = Math.cos(y), s = Math.sin(y);
  out.set(c * f - s * rt, u, s * f + c * rt);
  if (base) out.add(base);
  return out;
}
/** A gun pose in frame A (origin spine2, yaw `yaw`): origin (fwd, up, right), pitch and yaw (rel.) in degrees. */
function gunInA(r, yaw, f, u, rt, pitchD, yawD, out, rollD = 0) {
  const o = aimOrigin(r, _gv); workV(yaw, f, u, rt, out.p, o);
  gunQ(yaw + yawD * DEG, pitchD * DEG, rollD * DEG, out.q);
  return out;
}
/** The dash's tuck (§4.14): the pistol up at the chest (spine2 frame), a long gun at port arms. */
function tuckGun(r, w, out) {
  const B = r.bones;
  worldQuat(B.spine2, _sq);
  if (LONG[w]) { const PO = RELAXED.port; out.p.set(PO.at[0], PO.at[1], PO.at[2]).applyMatrix4(B.spine2.matrixWorld); _eG.set(PO.roll * DEG, -PO.yaw * DEG, PO.pitch * DEG, 'YZX'); }
  else { const T = DODGE.dash.pistol; out.p.set(T.at[0], T.at[1], T.at[2]).applyMatrix4(B.spine2.matrixWorld); _eG.set(T.roll * DEG, -T.yaw * DEG, T.pitch * DEG, 'YZX'); }
  out.q.setFromEuler(_eG).premultiply(_sq);
  return out;
}
/** The hammer's virtual gun frame (the fist at its grip, pitched like a pistol) at hammer phase h, and the hammer itself in TOOL. */
function hammerFrames(r, p, h, out) {
  const st = r.st, RP = st.rp, yaw = S.faceYaw, tilt = REPAIR.tilt;
  const Hx = clamp(RP.dist - REPAIR.faceBack, 11, 20), Hy = REPAIR.y[RP.kind] || 44;
  // the fist at the contact: the face of the head (hammer-local (11.3, −1.5, 0)) on the strike point
  gunQ(yaw, -tilt * DEG, 0, _tq); _tq2.copy(_tq).multiply(Q_RZ90);
  _tw.set(11.3, -1.5, 0).applyQuaternion(_tq2);
  workV(yaw, Hx, Hy, REPAIR.z, _tw2); _tw2.x += p.x; _tw2.z += p.y; _tw2.sub(_tw);
  sampleV(REPAIR.fist, h, _v3a); workV(yaw, _v3a[0], _v3a[1], _v3a[2], out.p); out.p.add(_tw2);
  gunQ(yaw, (sample(REPAIR.pitch, h) - tilt) * DEG, 0, out.q);
  TOOL.p.copy(out.p); TOOL.q.copy(out.q).multiply(Q_RZ90);
  return out;
}
const _v3a = [0, 0, 0];
// the axe's keys in the work frame: the right hand's grip, the handle direction (to the head), the edge's facing
const AXE_K = {
  contact: { h: CHOP.contact.hands, d: [0.35, -0.25, -0.9], e: [1, -0.3, 0] },
  windup: { h: CHOP.windup.hands, d: CHOP.windup.dir, e: [1, 0.2, -0.3] },
  lowered: { h: CHOP.lowered.hands, d: CHOP.lowered.dir, e: [1, 0, 0] },
};
const AXQ = { contact: new THREE.Quaternion(), windup: new THREE.Quaternion(), lowered: new THREE.Quaternion() }, _axH = { contact: V(), windup: V(), lowered: V(), wrench: V() };
/** One axe key → its world rotation (X the handle toward the head, −Y the edge) and the right hand's grip point. */
function axeKey(yaw, k, outQ, outH, p, Hfix = null) {
  workV(yaw, k.d[0], k.d[1], k.d[2], _hX).normalize();
  workV(yaw, k.e[0], k.e[1], k.e[2], _hZ); _hZ.addScaledVector(_hX, -_hZ.dot(_hX)).normalize(); // the edge
  _hY.copy(_hZ).negate(); _hZ.crossVectors(_hX, _hY);
  outQ.setFromRotationMatrix(_hM.makeBasis(_hX, _hY, _hZ));
  if (Hfix) outH.copy(Hfix); else { workV(yaw, k.h[0], k.h[1], k.h[2], outH); outH.x += p.x; outH.z += p.y; }
}
/** The axe this frame (§4.17): TOOL (the axe), and the right/left hands' virtual gun frames on the handle. */
function axeFrames(r, p) {
  const st = r.st, C = st.ch, yaw = S.faceYaw, live = C.ph === 1, u = live ? C.u : 1;
  axeKey(yaw, AXE_K.windup, AXQ.windup, _axH.windup, p);
  axeKey(yaw, AXE_K.lowered, AXQ.lowered, _axH.lowered, p);
  // the contact: the head on the tree's near side (the hands where that puts them, kept in front of him)
  axeKey(yaw, AXE_K.contact, AXQ.contact, _axH.contact, p);
  const reach = CHOP.headAt - CHOP.gripR, tx = clamp(C.dist - CHOP.trunk, 16, 36);
  _hX.set(AXE_K.contact.d[0], AXE_K.contact.d[1], AXE_K.contact.d[2]).normalize();
  workV(yaw, clamp(tx - _hX.x * reach, 10, 26), CHOP.contact.hands[1], clamp(-2 - _hX.z * reach, 2, 12), _axH.contact); _axH.contact.x += p.x; _axH.contact.z += p.y;
  // the wrench: the hands pull back and up while the head is still in the wood
  const WR = CHOP.wrench.hands; workV(yaw, WR[0], WR[1], WR[2], _axH.wrench).add(_axH.contact);
  let qa = AXQ.windup, ha = _axH.windup, qb = AXQ.windup, hb = _axH.windup, k = 0;
  if (C.ph === 1 || (C.ph === 2 && C.tailT <= 0)) {
    const B = CHOP.bite.u, W = CHOP.wrench.u;
    if (u < B) { qa = qb = AXQ.contact; ha = hb = _axH.contact; }
    else if (u < W) { qa = qb = AXQ.contact; ha = _axH.contact; hb = _axH.wrench; k = EO((u - B) / (W - B)); }
    else { qa = AXQ.contact; ha = _axH.wrench; k = ES((u - W) / (1 - W)); }
    // the catch-up: wound-up → contact in 35 ms
    if (live && C.cT < 9 && catchU(C.cT) < 1) { const cu = catchU(C.cT); qb = qa; hb = ha; qa = AXQ.windup; ha = _axH.windup; k = ES(cu); }
  } else if (C.ph === 2) { qa = AXQ.windup; ha = _axH.windup; qb = AXQ.lowered; hb = _axH.lowered; k = ES(clamp(C.tailT / CHOP.tail, 0, 1)); }
  else { qa = qb = AXQ.lowered; ha = hb = _axH.lowered; }
  TOOL.q.slerpQuaternions(qa, qb, k);
  GR_.p.lerpVectors(ha, hb, k);
  if (live && u < CHOP.bite.u && catchU(C.cT) >= 1) { const t = u * CHOP.T, dk = Math.exp(-t / 0.03); GR_.p.y += CHOP.bite.amp * Math.sin(2 * Math.PI * CHOP.bite.hz * t) * dk; }
  _hX.set(1, 0, 0).applyQuaternion(TOOL.q);
  TOOL.p.copy(GR_.p).addScaledVector(_hX, -CHOP.gripR);
  GR_.q.copy(TOOL.q).multiply(Q_RZM90); GL_.q.copy(GR_.q);
  GL_.p.copy(TOOL.p).addScaledVector(_hX, CHOP.gripL);
}
/**
 * The actions on the gun (after the base, reload and swap gun): the draw back after a tool, the dash's tuck, the melee
 * strike, the takedown, the flinch's kick and tremor; a tool in hand puts the gun away (returns null). GN is the right
 * hand's carrier either way.
 */
function actionGun(r, p, held) {
  const st = r.st, w = S.weapon;
  if (st.tool) return null;
  if (!held) return held;
  // (M5) a modal pose's first half: a long gun goes to the sling (it changes for the tool at the middle); the pistol stays
  // in the relaxed hand, which takes the tool at the middle
  if (LV.modal > 0 && !GC.sw && LONG[held]) { stowGun(r, held, GT); blendPose(GN, GT, ES(clamp(LV.modal * 2, 0, 1)), GN); }
  // the repair's in-blend: the gun goes where the hammer will be (it changes hands at the midpoint)
  if (st.rp.on && st.rp.w > 0 && st.rp.kind !== 'phone') { hammerFrames(r, p, (st.rp.t * REPAIR.rate) % 1, GT); blendPose(GN, GT, ES(clamp(st.rp.w / 0.5, 0, 1)), GN); }
  const D = st.dg;
  if (st.stateF === 'dodge' && !D.hop) {
    const live = D.ph === 1, u = live ? D.u : 1, wt = live ? ss(0, 0.14, u) : 1 - ES(clamp(D.tailT / DODGE.tail, 0, 1));
    if (wt > 0) { tuckGun(r, w, GT); blendPose(GN, GT, wt, GN); }
  } else if (st.stateF === 'dodge' && D.hop) {
    // the back-hop's landing gives in the arms: the gun dips and comes back a little, then recovers over the tail
    const K = DODGE.hop, k = D.ph === 1 ? ss(K.ikOn, 1, D.u) : 1 - ES(clamp(D.tailT / DODGE.tail, 0, 1));
    if (k > 0) { GN.p.addScaledVector(_gv.set(-1, 0, 0).applyQuaternion(GN.q), K.gunBack * k); GN.q.multiply(_hq2.setFromAxisAngle(_gv.set(0, 0, 1), K.gunDip * k * DEG)); }
  }
  if (MC.w > 0) { const c = MC.cur; gunInA(r, S.faceYaw, c[0], c[1], c[2], c[3], c[4], GT, c[8]); blendPose(GN, GT, MC.gw, GN); }
  if (TC.w > 0) { const c = TC.gun; gunInA(r, S.faceYaw, c[0], c[1], c[2], c[3], 0, GT); blendPose(GN, GT, TC.gw, GN); }
  if (FLX.gunPitch || FLX.gunYaw) {
    GN.q.multiply(_hq2.setFromAxisAngle(_gv.set(0, 0, 1), FLX.gunPitch * DEG));
    GN.q.premultiply(_hq2.setFromAxisAngle(Y_AXIS, -FLX.gunYaw * DEG));
  }
  return held;
}
/** The left hand's override this frame (melee guard, takedown collar grab, dash support, fire shield, the pick's reach), or w 0. */
const AL = { w: 0, p: V(), q: new THREE.Quaternion(), pole: [0, -1, -0.6] };
const POLE_GUARD = [0.2, -1, -0.5], POLE_REACH = [0.3, -0.4, -1];
/** One left-hand override candidate at weight w (frame A: origin o, yaw); kept if it outweighs the current one. */
function setAL(yaw, o, w, f, u, rt, fing, palm, pole) {
  if (w <= AL.w) return;
  AL.w = w; workV(yaw, f, u, rt, AL.p, o);
  handQW(workV(yaw, fing[0], fing[1], fing[2], _hX), workV(yaw, palm[0], palm[1], palm[2], _hZ), false, AL.q);
  AL.p.sub(_tw2.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(AL.q)); AL.pole = pole;
}
const FING_GUARD = [0.25, 1, 0.3], PALM_GUARD = [0.2, 0, 1], FING_COLLAR = [1, -0.4, 0.1], PALM_COLLAR = [0, -1, 0.2], FING_SHIELD = [0.1, 1, 0.3], PALM_SHIELD = [1, 0, 0.2];
function leftOverride(r, p, held) {
  const st = r.st, yaw = S.faceYaw, o = aimOrigin(r, _tw);
  AL.w = 0;
  if (MC.guardW > 0) { const g = MELEE.guardL; setAL(yaw, o, MC.guardW, g[0], g[1], g[2], FING_GUARD, PALM_GUARD, POLE_GUARD); }
  if (TC.collarW > 0) { const g = TC.collar; setAL(yaw, o, TC.collarW, g[0], g[1], g[2], FING_COLLAR, PALM_COLLAR, POLE_REACH); }
  if (FLX.shieldW > 0) { const g = FLINCH.fire.shieldL; setAL(yaw, o, FLX.shieldW, g[0], g[1], g[2], FING_SHIELD, PALM_SHIELD, POLE_GUARD); }
  if (st.stateF === 'pick') {
    const C = st.ch, u = C.ph === 1 ? C.u : 1, w = (C.ph === 1 ? ss(0.05, 0.5, u) : 1 - ES(clamp(C.tailT / PICK.rise, 0, 1)));
    if (w > AL.w) {
      // the ground spot in the work frame (absolute height), not frame A
      AL.w = w; workV(st.ch.yaw, PICK.handL[0], 0, PICK.handL[2] + PICK.camSide * Math.sign(Math.cos(st.ch.yaw) || 1), AL.p); AL.p.x += p.x; AL.p.z += p.y; AL.p.y = PICK.handL[1];
      handQW(workV(st.ch.yaw, 0.6, -1, 0, _hX), workV(st.ch.yaw, 0, -1, 0, _hZ), false, AL.q);
      AL.p.sub(_tw2.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(AL.q)); AL.pole = POLE_REACH;
    }
  }
  if (!p.dead) lifeLeft(r, p); // (M5: the pockets, the knees, his side, the lapel, the reaches, the phone, the items, the abilities)
  return AL;
}
const POLE_AXE_R = [-0.3, -1, 0.7], POLE_HAM_R = [-0.4, -1, 0.5], POLE_AXE_L = [0.1, -1, -0.4], POLE_HAM_L = [0.2, -1, -0.6];
/** A tool in hand (§4.17): the hammer and the plank, the phone splice, the axe (chop, bite, wind-up, lowered, held). Both arms IK'd; the props placed. */
function toolHands(r, p) {
  const st = r.st, B = r.bones, tool = st.tool, RP = st.rp, yaw = S.faceYaw;
  // (the repair's out-blend: the hammer comes down to his side, the hands stay on it; the splice's hands let go)
  const wOut = tool === 'splice' && !RP.on ? clamp(RP.w * 2 - 1, 0, 1) : tool === 'rod' || tool === 'work' ? ES(clamp(LV.modal * 2 - 1, 0, 1)) : 1;
  let haveL = false;
  if (tool === 'hammer') {
    hammerFrames(r, p, (RP.t * REPAIR.rate) % 1, GR_);
    if (!RP.on) {
      // lowered: the fist by his right hip, the head down
      const k = ES(clamp(2 - 2 * RP.w, 0, 1));
      workV(yaw, 5, 31, 9, _tw); _tw.x += p.x; _tw.z += p.y; gunQ(yaw, -75 * DEG, 0, _tq);
      GR_.p.lerp(_tw, k); GR_.q.slerp(_tq, k); TOOL.p.copy(GR_.p); TOOL.q.copy(GR_.q).multiply(Q_RZ90);
    }
    _m1.compose(TOOL.p, TOOL.q, _gw2.set(1, 1, 1)); showPropAt(r, B.hammer, _m1);
    // the plank across the opening, the left palm pressing it flat
    const Hx = clamp(RP.dist - REPAIR.faceBack, 11, 20), Hy = REPAIR.y[RP.kind] || 44, door = RP.kind !== 'window', pk = door ? REPAIR.plankDoor : REPAIR.plank, pl = door ? REPAIR.plankLDoor : REPAIR.plankL;
    workV(yaw, Hx + pk[0], Hy + pk[1], REPAIR.z + pk[2], _tw); _tw.x += p.x; _tw.z += p.y;
    gunQ(yaw, 0, 0, _tq).multiply(Q_RYM90);
    _m1.compose(_tw, _tq, _gw2.set(1, 1, 1)); showPropAt(r, B.plank, _m1);
    workV(yaw, Hx + pl[0], Hy + pl[1], REPAIR.z + pl[2], _wL); _wL.x += p.x; _wL.z += p.y;
    handQW(workV(yaw, 0.1, 1, 0, _hX), workV(yaw, 1, 0, 0, _hZ), false, _qL);
    _wL.sub(_tw2.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_qL)); haveL = true;
    onFrame(GR_.p, GR_.q, H_GRIP, _wR, _qR);
  } else if (tool === 'splice') {
    // the phone line: both hands at the cut (y 30), twisting the wire
    const Hx = clamp(RP.dist - 7, 12, 20), PH = REPAIR.phone, tw = PH.twist * Math.sin(2 * Math.PI * PH.hz * S.now) * DEG;
    workV(yaw, Hx, PH.y, 2.5, _wR); _wR.x += p.x; _wR.z += p.y;
    handQW(workV(yaw, 1, -0.4, -0.2, _hX), workV(yaw, 0, 0, -1, _hZ), true, _qR); _qR.multiply(_tq.setFromAxisAngle(_gv.set(0, 1, 0), tw));
    _wR.sub(_tw2.set(GRIPR[0], GRIPR[1], GRIPR[2]).applyQuaternion(_qR));
    workV(yaw, Hx, PH.y, -2.5, _wL); _wL.x += p.x; _wL.z += p.y;
    handQW(workV(yaw, 1, -0.4, 0.2, _hX), workV(yaw, 0, 0, 1, _hZ), false, _qL); _qL.multiply(_tq.setFromAxisAngle(_gv.set(0, 1, 0), -tw));
    _wL.sub(_tw2.set(GRIPL[0], GRIPL[1], GRIPL[2]).applyQuaternion(_qL)); haveL = true;
  } else if (tool === 'rod') {
    // (M5) fishing: the rod in both hands, pitched up, swaying gently. Over the blend's second half it rides the right hand
    // up from where the gun left it (lowered at his side, or off the sling), and back down on the way out
    const MD = LIFE.modal.rod, sw = MD.sway * Math.sin(2 * Math.PI * MD.hz * st.lf.clock);
    gunInA(r, yaw, MD.gripR[0], MD.gripR[1], MD.gripR[2], MD.pitch + sw, -6 + 0.5 * sw, GR_);
    if (wOut < 1) {
      modalBaseHand(r, _wA, _qA);
      gunQ(yaw - 6 * DEG, MD.low * DEG, 0, GT3.q); GT3.p.copy(_wA).sub(_tw2.copy(H_GRIP.t).applyQuaternion(GT3.q)); // (the rod lowered, its grip in that hand)
      travel(r, GT3.p, GT3.q, GR_.p, GR_.q, wOut, _wB, _qB); GR_.p.copy(_wB); GR_.q.copy(_qB); // (never aliased: slerpQuaternions copies qA first)
    }
    _m1.compose(GR_.p, GR_.q, _gw2.set(1, 1, 1)); showPropAt(r, B.rod, _m1);
    onFrame(GR_.p, GR_.q, H_GRIP, _wR, _qR);
    GL_.q.copy(GR_.q); GL_.p.copy(GR_.p).addScaledVector(_hX.set(1, 0, 0).applyQuaternion(GR_.q), MD.gripL);
    onFrame(GL_.p, GL_.q, H_GRIP_L, _wL, _qL); haveL = true;
  } else if (tool === 'work') {
    // (M5) crafting, cooking: both hands working at the bench, alternately, palms down (the right hand comes there from
    // where the gun left it)
    const MD = LIFE.modal.work, ph = 2 * Math.PI * MD.hz * st.lf.clock, o = aimOrigin(r, _tw3), h = MD.hands;
    workV(yaw, h[0] + MD.amp * Math.sin(ph), h[1] + 0.6 * Math.cos(ph), h[2], _wR, o);
    handQW(workV(yaw, 1, -0.6, -0.1, _hX), _hZ.set(0, -1, 0), true, _qR); _wR.sub(_tw2.set(0.3, -2.6, -1.1).applyQuaternion(_qR));
    if (wOut < 1) { modalBaseHand(r, _wA, _qA); travel(r, _wA, _qA, _wR, _qR, wOut, _wB, _qB); _wR.copy(_wB); _qR.copy(_qB); }
    workV(yaw, h[0] + MD.amp * Math.sin(ph + Math.PI), h[1] + 0.6 * Math.cos(ph + Math.PI), -h[2], _wL, o);
    handQW(workV(yaw, 1, -0.6, 0.1, _hX), _hZ.set(0, -1, 0), false, _qL); _wL.sub(_tw2.set(0.3, -2.6, 1.1).applyQuaternion(_qL)); haveL = true;
  } else if (tool === 'axe') {
    axeFrames(r, p);
    _m1.compose(TOOL.p, TOOL.q, _gw2.set(1, 1, 1)); showPropAt(r, B.axe, _m1);
    onFrame(GR_.p, GR_.q, H_GRIP, _wR, _qR); onFrame(GL_.p, GL_.q, H_GRIP_L, _wL, _qL); haveL = st.ch.ph !== 3; // (held at his side: one hand)
  }
  st.lastRw = true; st.lastRwP.copy(_wR); st.lastRwQ.copy(_qR);
  let poleR = tool === 'axe' ? POLE_AXE_R : POLE_HAM_R;
  if (tool === 'hammer' && RP.on) { const h = (RP.t * REPAIR.rate) % 1, k = ss(0.25, 0.65, h) * (1 - ss(0.82, 0.97, h)); poleR = lerp3(POLE_HAM_R, REPAIR.poleApex, k, POLE_TMP); }
  // (a modal's right hand stays on: the tool travels from the base hand, above)
  armIK(r, 'R', _wR, _qR, poleR, tool === 'rod' || tool === 'work' ? 1 : wOut, 1, tool === 'axe' ? 40 * DEG : 15 * DEG);
  const wL = tool === 'hammer' && !RP.on ? clamp(RP.w * 2 - 1, 0, 1) : wOut; // (the plank stays on the opening as he lets go)
  if (haveL && wL > 0.001) armIK(r, 'L', _wL, _qL, tool === 'axe' ? POLE_AXE_L : POLE_HAM_L, wL, 1, tool === 'axe' ? 40 * DEG : 0);
}
/** A modal's base right hand (where the gun leaves it and takes it back): the relaxed hand (the pistol), or the slung long gun's grip. */
function modalBaseHand(r, outP, outQ) {
  const w = S.weapon;
  if (LONG[w]) { stowGun(r, w, GT2); onFrame(GT2.p, GT2.q, H_GRIP, outP, outQ); } else { outP.copy(_fkRw); outQ.copy(_fkRq); }
}
/** Dead (§4.16): the gun rides the right hand until 0.12 s, then flies off as a physics prop (one bounce, rests flat) until the recovery. */
const _dg = V(), _dq3 = new THREE.Quaternion();
function deadGun(r, p) {
  const st = r.st, B = r.bones, Dh = st.dth, Gd = Dh.gun, t = st.deathT, w = Gd.on ? Gd.w : (Dh.tool || S.weapon), gb = B[w];
  const dt = G.paused ? 0 : S.realDt, GD = DEATH.gun;
  // the long guns still on his back ride it down (on his face: across his back; on his back: under him)
  for (let i = 0; i < 2; i++) {
    const sl = st.backSlot[i]; if (!sl || sl === w) continue;
    slingGun(r, GT, i);
    // on his back the slung gun would go under him (8 u into the ground): it slides off and lies beside him, flat along
    // his body on the camera side; either way both its ends stay above the ground
    if (Dh.variant === 'back') {
      const k = ES(ss(DEATH.slungFrom, DEATH.slungTo, t)), F = Dh.F, sg = Dh.sign, rx = -Math.sin(F) * sg, rz = Math.cos(F) * sg, off = DEATH.slungOff + 5 * i;
      _gv.setFromMatrixPosition(B.spine1.matrixWorld); GT2.p.set(_gv.x + rx * off - Math.cos(F) * 6, 1.2, _gv.z + rz * off - Math.sin(F) * 6);
      gunQ(F + Math.PI, 0, 90 * DEG * sg, GT2.q); blendPose(GT, GT2, k, GT);
    }
    const ends = DROP_ENDS[sl], lo = dropLow(GT.q, ends); if (GT.p.y + lo < 2) GT.p.y = 2 - lo;
    _m1.compose(GT.p, GT.q, _gw2.set(1, 1, 1)); showPropAt(r, B[sl], _m1);
  }
  if (!gb || st.tool) return;
  if (!Gd.on) {
    if (!Dh.relOk) {
      // the gun as it was (spine2-local, last frame), relative to the right hand now
      if (!st.gunLOk || st.gunLW !== w) return;
      worldQuat(B.spine2, _sq); _dg.copy(st.gunLP).applyMatrix4(B.spine2.matrixWorld); _dq3.copy(_sq).multiply(st.gunLQ);
      _m1.compose(_dg, _dq3, _gw2.set(1, 1, 1)); Dh.rel.copy(B.handR.matrixWorld).invert().multiply(_m1); Dh.relOk = true;
      Gd.p[0] = _dg.x; Gd.p[1] = _dg.y; Gd.p[2] = _dg.z; Gd.v[0] = Gd.v[1] = Gd.v[2] = 0;
    }
    _m1.copy(B.handR.matrixWorld).multiply(Dh.rel); _m1.decompose(_dg, _dq3, _s1);
    if (dt > 0) { Gd.v[0] = (_dg.x - Gd.p[0]) / dt; Gd.v[1] = (_dg.y - Gd.p[1]) / dt; Gd.v[2] = (_dg.z - Gd.p[2]) / dt; }
    Gd.p[0] = _dg.x; Gd.p[1] = _dg.y; Gd.p[2] = _dg.z;
    if (t >= DEATH.gunAt) {
      // let go: a little of the hand's velocity (the arm's swing and the turn to F throw the hand at 150–230 u/s, which flung
      // the gun three tiles, often toward the killer), out along the fall, out to the camera side (his right × sign(cos F):
      // clear of his body, where it is seen landing) and up; a spin about the gun's side axis tilted up
      Gd.on = true; Gd.w = w; Gd.t = 0; Gd.bounced = false; Gd.rest = false;
      let hx = Gd.v[0] * GD.handK, hz = Gd.v[2] * GD.handK; const hl = Math.hypot(hx, hz); if (hl > GD.handMax) { hx *= GD.handMax / hl; hz *= GD.handMax / hl; }
      const sx = -Math.sin(Dh.F) * Dh.sign, sz = Math.cos(Dh.F) * Dh.sign; // his right, to the camera's side
      Gd.v[0] = hx + Math.cos(Dh.fall) * GD.fwd + sx * GD.side; Gd.v[2] = hz + Math.sin(Dh.fall) * GD.fwd + sz * GD.side;
      Gd.v[1] = clamp(Gd.v[1], -40, 40) + GD.up;
      Gd.q.copy(_dq3); Gd.ax.set(0, 0, 1).applyQuaternion(_dq3).addScaledVector(Y_AXIS, 0.6).normalize();
    } else { _m1.compose(_dg, _dq3, _gw2.set(1, 1, 1)); showPropAt(r, gb, _m1); return; }
  }
  // the flight: gravity, a spin, a wall stops it (bounces back off a solid cell), one bounce at 0.3 on whichever END hits the
  // ground first (the muzzle, the butt or the grip: the grip alone let the muzzle dig in and the gun stand on it like a
  // cane), then it lies flat on its side, the ends kept above the ground as it settles
  const restY = LONG[w] ? 1.0 : 0.8, ends = DROP_ENDS[w] || DROP_ENDS.pistol;
  if (dt > 0 && !Gd.rest) {
    Gd.t += dt; Gd.v[1] -= GD.g * dt;
    const nx = Gd.p[0] + Gd.v[0] * dt, nz = Gd.p[2] + Gd.v[2] * dt, m = G.map;
    if (m && m.getSolid && PORT_SOLID.has(m.getSolid(Math.floor(nx / 32), Math.floor(nz / 32)))) { Gd.v[0] *= -0.3; Gd.v[2] *= -0.3; }
    else { Gd.p[0] = nx; Gd.p[2] = nz; }
    Gd.p[1] += Gd.v[1] * dt;
    Gd.q.premultiply(_dq3.setFromAxisAngle(Gd.ax, GD.spin * (Gd.bounced ? 0.4 : 1) * dt));
    const lo = dropLow(Gd.q, ends);
    if (Gd.p[1] + lo < END_Y || Gd.p[1] < restY) {
      Gd.p[1] = Math.max(restY, END_Y - lo);
      if (!Gd.bounced && Gd.v[1] < -60) { Gd.bounced = true; Gd.v[1] *= -GD.rest; Gd.v[0] *= 0.45; Gd.v[2] *= 0.45; }
      else {
        Gd.rest = true; Gd.restT = 0; Gd.q0.copy(Gd.q); Gd.y0 = Gd.p[1];
        // flat on whichever side is nearer, the bore level at its heading
        _gv.set(1, 0, 0).applyQuaternion(Gd.q); const hd = Math.atan2(_gv.z, _gv.x); _gv2.set(0, 0, 1).applyQuaternion(Gd.q);
        gunQ(hd, 0, (_gv2.y >= 0 ? -90 : 90) * DEG, Gd.qRest);
      }
    }
  } else if (dt > 0) Gd.restT += dt;
  if (Gd.rest) {
    const k = ES(clamp(Gd.restT / GD.settleT, 0, 1));
    Gd.q.slerpQuaternions(Gd.q0, Gd.qRest, k);
    // it tips over onto its side about its lowest end: the origin comes down as the ends level out, never through the ground
    Gd.p[1] = Math.max(END_Y - dropLow(Gd.q, ends), restY, lerp(Gd.y0, restY, k));
  }
  _m1.compose(_dg.set(Gd.p[0], Gd.p[1], Gd.p[2]), Gd.q, _gw2.set(1, 1, 1)); showPropAt(r, gb, _m1);
  resetSubBones(r);
}
// the dropped prop's end points (its local frame): the muzzle, the butt (the pistol's grip base), and the origin; the axe's
// head and handle end, the hammer's head and handle end
const DROP_ENDS = {
  pistol: [[SOCKETS.pistol.muzzle[0], 0, 0], [-1.6, -4.6, 0], [SOCKETS.pistol.slideRear[0], 2.3, 0]],
  shotgun: [SOCKETS.shotgun.muzzle, SOCKETS.shotgun.butt, [0, -3, 0], [4, 1, 0.9], [4, 1, -0.9]],
  rifle: [SOCKETS.rifle.muzzle, SOCKETS.rifle.butt, [0, -3, 0], SOCKETS.rifle.boltKnob, [0, 5, 0], [4, 1, 0.9], [4, 1, -0.9]],
  axe: [[-6, 0, 0], [26, 1.2, 0], [26, -6.9, 0]], hammer: [[-3, 0, 0], [11.5, 3.7, 0], [11.5, -1.5, 0]],
};
const _de = V(), END_Y = 0.15; // (the prop's end points come to rest just above the ground; its origin at restY)
/** The lowest Y offset of a dropped prop's end points (and its origin) at rotation q. */
function dropLow(q, ends) { let lo = 0; for (let i = 0; i < ends.length; i++) { const e = ends[i]; const y = _de.set(e[0], e[1], e[2]).applyQuaternion(q).y; if (y < lo) lo = y; } return lo; }

/* -------- per frame, after FK and the legs: gun → hands → props → casings -------- */
function weapons(r, p) {
  const st = r.st, B = r.bones;
  for (let i = 0; i < PROP_NAMES.length; i++) hideProp(B[PROP_NAMES[i]]);
  resetSubBones(r);
  st.gunDriver = 'none'; st.inHand = null;
  if (p.dead) { deadGun(r, p); st.gunLOk = false; return; }
  const w = S.weapon;
  // the FK hands (the relaxed pose the IK blends from)
  boneFrame(B.handR, _fkRw, _fkRq); boneFrame(B.handL, _fkLw, _fkLq);
  _fkRe.setFromMatrixPosition(B.forearmR.matrixWorld); _fkLe.setFromMatrixPosition(B.forearmL.matrixWorld);
  backSlots(r);
  // aim distance and convergence (D6), the high port
  converge(r, p, w);
  highPort(r, p, w);
  // 1. the gun: base (relaxed → aim), the reload pose, the swap
  let held = w;
  if (GC.sw) held = swapGun(r, GN);
  else {
    baseGun(r, w, GN);
    if (GC.rl > 0 && GC.rlPose && GC.rlGun > 0) { namedGun(r, GC.rlPose, GT); if (GC.jig) { GT.p.addScaledVector(_gv.set(1, 0, 0).applyQuaternion(GT.q), GC.jig); GT.q.multiply(_hq2.setFromAxisAngle(_gv.set(0, 0, 1), GC.jig * GUN_POSES.shotgunReload.jigPitch * DEG)); } blendPose(GN, GT, GC.rl * GC.rlGun, GN); }
    if (GC.rl > 0 && (GC.rlJy || GC.rlJp)) { GN.p.y += GC.rlJy * GC.rl; GN.q.multiply(_hq2.setFromAxisAngle(_gv.set(0, 0, 1), GC.rlJp * GC.rl * DEG)); }
  }
  // (M4) the actions on the gun: the draw back after a tool, the dash's tuck, the strike, the takedown, the flinch; a tool
  // in hand puts it away
  held = actionGun(r, p, held);
  // (M5) the stroll: the pistol under the coat once the hand has put it there (lifeArms carried it)
  LV.gunW = !LONG[w] && held === w ? LV.prowl * (1 - S.aimW) : 0;
  LV.chkW = !LONG[w] && held === w ? LV.chk * (1 - S.aimW) : 0;
  if (held === 'pistol' && LV.hol >= LIFE.stroll.holHide && S.aimW < 0.05 && !GC.sw && !GC.rl) held = null;
  st.inHand = held;
  const acting = MC.w > 0.5 || TC.w > 0.5 || (st.stateF === 'dodge' && !st.dg.hop);
  st.gunDriver = !held ? (st.tool ? 'tool' : LV.hol >= LIFE.stroll.holHide ? 'holster' : 'none') : GC.sw ? 'swap' : acting ? 'action' : S.aimW > 0.5 ? 'aim' : LONG[w] ? 'chest' : 'hand';
  if (held) {
    const gb = B[held];
    _m1.compose(GN.p, GN.q, _gw2.set(1, 1, 1)); showPropAt(r, gb, _m1);
    subBones(r, held);
    gb.updateMatrixWorld(true);
    // the gun in spine2-local, for a swap's snapshot next time
    _m2.copy(B.spine2.matrixWorld).invert(); st.gunLP.copy(GN.p).applyMatrix4(_m2); worldQuat(B.spine2, _sq); st.gunLQ.copy(_sq).invert().multiply(GN.q); st.gunLOk = true; st.gunLW = held;
  } else st.gunLOk = false;
  // 2. the hands (on the gun, or on a tool)
  if (st.tool) toolHands(r, p); else handsOnGun(r, p, held);
  // 3. props in the hands, the sling, the dropped magazine, casings, the beam
  propsInHands(r, p, held);
  if (GC.dropMag && held === 'pistol') dropMag(r);
}
function subBones(r, w) {
  const B = r.bones;
  if (w === 'pistol') {
    const s = B.pistolSlide; s.position.copy(s.userData.bind); s.position.x += GC.slideX + LV.chkSlide * (1 - S.aimW);
    const m = B.pistolMag; m.position.copy(m.userData.bind);
    if (!GC.magVis) { m.scale.set(0, 0, 0); } else if (GC.magX) m.position.addScaledVector(_gv.set(GA_AX[0], GA_AX[1], 0), GC.magX);
  } else if (w === 'shotgun') { const f = B.shotgunForend; f.position.copy(f.userData.bind); f.position.x += GC.forendX; }
  else if (w === 'rifle') { const b = B.rifleBolt; b.position.copy(b.userData.bind); b.position.x += GC.boltX; b.quaternion.setFromAxisAngle(_gv.set(1, 0, 0), -GC.boltRot * DEG); }
}
/**
 * High port (§4.8): a live enemy's body right at the muzzle (its radius counts: the gun would sit inside him), or the muzzle
 * in a bullet-blocking solid (a wall, a rock, a car, a tree, a log pile; furniture, fences and counters let bullets through,
 * so a gun over a table stays level): the pistol comes back to the chest, a long gun tips up (ω 20). The muzzle's reach
 * ahead is the live converged rest muzzle (st.muzzleFwd, from converge()).
 */
const PORT_SOLID = new Set([SO.WALL, SO.ROCK, SO.CAR, SO.TREE, SO.LOGS]);
function highPort(r, p, w) {
  const st = r.st, a = p.angle || 0, c = Math.cos(a), s = Math.sin(a), fwd = Number.isFinite(st.muzzleFwd) ? st.muzzleFwd : 30;
  let want = 0;
  if (S.aimW > 0.3) {
    const E = G.enemies || [];
    for (let i = 0; i < E.length; i++) {
      const e = E[i]; if (!e || e.dead || e.gone) continue;
      const dx = e.x - p.x, dy = e.y - p.y, f = dx * c + dy * s, l = -dx * s + dy * c, er = e.radius || 10;
      if (f > 0 && f - er < fwd + 4 && Math.abs(l) < 12 + er) { want = 1; break; }
    }
    const m = G.map;
    if (!want && m && m.getSolid) { const so = m.getSolid(Math.floor((p.x + c * fwd) / 32), Math.floor((p.y + s * fwd) / 32)); if (PORT_SOLID.has(so)) want = 1; }
  }
  if (S.shot) want = Math.min(want, 1);
  springTo(st.port, want, 20, S.adt);
  st.port.x = clamp(st.port.x, 0, 1);
}
const POLE_TMP = [0, 0, 0], POLE_R = [0, 0, 0], POLE_L = [0, 0, 0], POLE_K = [0, 0, 0], POLE_L2 = [0, 0, 0];
const lerp3 = (a, b, t, o) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; };
function handsOnGun(r, p, held) {
  const st = r.st, w = S.weapon, AP = AIM[held || w] || AIM.pistol;
  // the right hand: on the gun's grip (or travelling in a swap, or on the bolt knob)
  let rw = 0;
  if (GC.sw) {
    const f = GC.swF, W = st.sw, TM = swapTimes(W), rel = W.from === 'pistol' ? TM.pistolHide : TM.longRelease;
    if (held && (f < rel || f >= SWAP.inStart)) { wpRight(r, WP.GRIP, held, GN, _wR, _qR); rw = 1; }
    else {
      // released: from where it let go (held in the chest frame) to the stowed gun it will draw
      worldQuat(r.bones.spine2, _sq);
      if (!W.relOk) {
        W.relOk = true; _m2.copy(r.bones.spine2.matrixWorld).invert();
        if (st.lastRw) { W.relP.copy(st.lastRwP).applyMatrix4(_m2); W.relQ.copy(_sq).invert().multiply(st.lastRwQ); } else { W.relP.copy(_fkRw).applyMatrix4(_m2); W.relQ.copy(_sq).invert().multiply(_fkRq); }
      }
      _wA.copy(W.relP).applyMatrix4(r.bones.spine2.matrixWorld); _qA.copy(_sq).multiply(W.relQ);
      stowGun(r, W.to, GT); onFrame(GT.p, GT.q, H_GRIP, _wB, _qB);
      const u = ES(seg(f, rel, SWAP.inStart));
      bodyPath(r, _wA, _wB, exitOf(W.from), exitOf(W.to), u, _wR); _qR.slerpQuaternions(_qA, _qB, u); rw = 1;
    }
  } else if (held) {
    wpRight(r, GC.rA, held, GN, _wA, _qA);
    if (GC.rU > 0 && GC.rB !== GC.rA) { wpRight(r, GC.rB, held, GN, _wB, _qB); travel(r, _wA, _qA, _wB, _qB, GC.rU, _wR, _qR); } else { _wR.copy(_wA); _qR.copy(_qA); }
    rw = !LONG[held] && S.aimW <= 0.001 && GC.rl <= 0 && GC.rU <= 0 && st.port.x <= 0.001 && st.gunDriver !== 'action' && !(st.rp.w > 0) && LV.gunW <= 0.001 && LV.chkW <= 0.001 && !(LV.modal > 0) ? 0 : 1;
  }
  st.lastRw = rw > 0; if (rw > 0) { st.lastRwP.copy(_wR); st.lastRwQ.copy(_qR); }
  // (the long guns' elbow poles blend relaxed → aimed with the aim weight: a switch at 0.5 popped the elbows mid-raise)
  let poleR = LONG[held || w] ? lerp3(RELAXED.long.poleR, AP.poleR, S.aimW, POLE_R) : AP.poleR;
  // reaching back to the sling (a long gun going onto it or coming off it): the elbow back and down, not winged out
  if (GC.sw) {
    const f = GC.swF, W = st.sw, TM = swapTimes(W);
    const ks = Math.max(LONG[W.from] ? ss(0.1, TM.outEnd, f) * (f < SWAP.inStart ? 1 : 0) : 0, LONG[W.to] ? (f < SWAP.inStart ? ss(TM.outEnd - 0.1, SWAP.inStart, f) : 1 - ss(SWAP.inStart, 0.8, f)) : 0);
    if (ks > 0) { _pd.set(poleR[0], poleR[1], poleR[2]).lerp(_pd2.set(SWAP.slingPole[0], SWAP.slingPole[1], SWAP.slingPole[2]), ks); POLE_TMP[0] = _pd.x; POLE_TMP[1] = _pd.y; POLE_TMP[2] = _pd.z; poleR = POLE_TMP; }
  }
  // on the bolt knob (the bolt action, the rifle's reload): the elbow stays down by the ribs, the forearm never crosses the face
  if (GC.rB === WP.KNOB && GC.rU > 0) poleR = lerp3(poleR, ACTIONS.bolt.pole, GC.rU, POLE_K);
  // (the grip roll of the gun the hand is on or reaching for: a long gun's stock wrist lets the hand turn 40°)
  const gripW = held || (GC.sw ? st.sw.to : w);
  const rollR = lerp(LONG[gripW] ? TUNE.gripRoll.long : TUNE.gripRoll.pistol, TUNE.gripRoll.knob, GC.rB === WP.KNOB ? GC.rU : 0) * DEG;
  if (rw > 0) armIK(r, 'R', _wR, _qR, poleR, 1, LONG[held] || GC.sw || st.gunDriver === 'action' ? 1 : Math.max(S.aimW, GC.rl, GC.rU, LV.gunW, LV.chkW), rollR);
  // the left hand: the support grip (pistol, aimed) or the forend (long guns), the reload's waypoints, the swap's drop
  let lw = 0, lb = WP.FK;
  // (M5: the prowl's low ready is two-handed; carrying the parcel, the pistol is one-handed)
  if (held === 'pistol') { lb = WP.SUPPORT; lw = Math.max(S.aimW * S.supW, LV.gunW) * (1 - LV.carry); }
  else if (held) { lb = WP.FOREND; lw = 1 - (LV.modal > 0 ? ES(clamp(LV.modal * 2, 0, 1)) : 0); } // (off the forend as it goes onto the sling for a modal)
  if (st.port.x > 0.01 && held === 'pistol') lw *= 1 - TUNE.highPort.pistolSupportOff * st.port.x;
  // (M4) the dash: the pistol is tucked one-handed and the free arm thrown back (its FK, dodgePose); a ram's stumble
  // throws the left arm out (its FK)
  if (held === 'pistol' && st.stateF === 'dodge' && !st.dg.hop) lw *= 1 - (st.dg.ph === 1 ? ss(0, 0.2, st.dg.u) : 1 - ES(clamp(st.dg.tailT / DODGE.tail, 0, 1)));
  if (FLX.abdL > 0) lw *= 1 - 0.8 * FLX.abdL / FLINCH.ram.abdL;
  const ALo = leftOverride(r, p, held);
  if (lw > 0 || GC.rl > 0 || GC.sw || ALo.w > 0) {
    if (lw > 0) wpLeft(r, lb, held, GN, _wL, _qL); else { _wL.copy(_fkLw); _qL.copy(_fkLq); }
    if (GC.sw) {
      const f = GC.swF, W = st.sw;
      // (off a long gun early: its forend swings back over his shoulder, and a hand still on it would cross his chest)
      if (f < swapTimes(W).outEnd) lw *= 1 - ss(0, LONG[W.from] ? SWAP.leftOffLong : 0.43, f);
      else if (held) lw = W.to === 'pistol' ? ss(SWAP.supportFrom, 1, f) * S.aimW : ss(SWAP.forendFrom, SWAP.forendTo, f);
      else lw = 0;
    } else if (GC.rl > 0 && held) {
      wpLeft(r, GC.lA, held, GN, _wA, _qA); wpLeft(r, GC.lB, held, GN, _wB, _qB);
      travel(r, _wA, _qA, _wB, _qB, GC.lU, _wA, _qA);
      if (lw > 0) { _wL.lerp(_wA, GC.rl); _qL.slerp(_qA, GC.rl); } else { _wL.copy(_wA); _qL.copy(_qA); }
      lw = Math.max(lw, GC.rl);
    }
    // a dry fire: the support hand taps the magazine's base
    if (GC.dryTap > 0 && held === 'pistol' && lw > 0 && !GC.sw && GC.rl <= 0) { wpLeft(r, WP.WELL_LOW, held, GN, _wA, _qA); _wL.lerp(_wA, GC.dryTap); _qL.slerp(_qA, GC.dryTap); }
    // the overrides: the melee guard, the collar grab, the fire shield, the pick's reach
    if (ALo.w > 0) { if (lw > 0) { _wL.lerp(ALo.p, ALo.w); _qL.slerp(ALo.q, ALo.w); } else { _wL.copy(ALo.p); _qL.copy(ALo.q); } lw = Math.max(lw, ALo.w); }
    let poleL = LONG[held || w] ? lerp3(RELAXED.long.poleL, AP.poleL, S.aimW, POLE_L) : AP.poleL;
    if (ALo.w > 0) poleL = lerp3(poleL, ALo.pole, ALo.w, POLE_L2);
    // the shell chain: the elbow out to the side, so the hand passes outside the coat on its way to the belt
    if (GC.rlPose === 'shotgunReload' && GC.rl > 0) poleL = lerp3(poleL, GUN_POSES.shotgunReload.poleL, GC.rl, POLE_L2);
    const rollL = (lb === WP.FOREND ? TUNE.gripRoll.forend : lb === WP.SUPPORT ? TUNE.gripRoll.support : 0) * DEG * (1 - GC.rl) * (1 - ALo.w);
    if (lw > 0.001) armIK(r, 'L', _wL, _qL, poleL, lw, lw, rollL);
  }
}
/**
 * IK one arm onto a wrist target and hand rotation (§4.22), blended by w from its FK pose. The elbow pole is the FK elbow
 * direction blended toward `pole` (aim frame: fwd, up, right) by pw. The elbow stays within 0..145° (the target is
 * held out of the chest), the upper arm's twist about its own axis within ±45° of bind (the pole swivels, one re-solve).
 */
const ARM1 = 13.2, ARM2 = 11.6, ELBOW_MIN_D = Math.sqrt(ARM1 * ARM1 + ARM2 * ARM2 + 2 * ARM1 * ARM2 * Math.cos(145 * DEG));
const _hole = V(), _hax = V(), _fy = V(), _hy = V(), _gx2 = V(), _rq2 = new THREE.Quaternion();
const _wl = new THREE.Quaternion(), _wtw = new THREE.Quaternion(), _wsw = new THREE.Quaternion(), _wq0 = new THREE.Quaternion();
/** The swing part of a hand's local rotation (the wrist's bend, degrees): the twist about the forearm (Y) is forearm roll. */
function swingDeg(q) { const L = Math.hypot(q.y, q.w) || 1, tw = _rq2.set(0, q.y / L, 0, q.w / L); const s = _q4.copy(q).multiply(tw.invert()); return 2 * Math.acos(clamp(Math.abs(s.w), 0, 1)) / DEG; }
/** Solve the arm with the pole swung by angle a about the shoulder→wrist axis (_gx2 = the pole − shoulder); returns the twist. */
function swivelTwist(a, B, n) {
  _pole.copy(_gx2).applyAxisAngle(_ax2, a).add(_hip);
  solveTwoBone(_hip, _ank, _pole, ARM1, ARM2, -1, IK);
  return twistAngle(_q1.copy(_q3).invert().multiply(IK.q1), 0, 1, 0);
}
function solveArm(r, n, L) {
  const st = r.st, B = r.bones;
  const d = _ank.distanceTo(_hip);
  // the elbow limit: never folded past 145° (the wrist target is held out from the shoulder)
  if (d < ELBOW_MIN_D) { _tmp.subVectors(_ank, _hip); if (d > 1e-4) _ank.copy(_hip).addScaledVector(_tmp, ELBOW_MIN_D / d); st.elbowClamps++; }
  solveTwoBone(_hip, _ank, _pole, ARM1, ARM2, -1, IK);
  if (!Number.isFinite(IK.q1.x) || !Number.isFinite(IK.q2.x)) return false;
  // the swivel clamp: the upper arm's twist about its own axis stays within armTwistMax of bind (the pole swings round
  // the shoulder→wrist axis; whichever way reduces it)
  worldQuat(B[n.clav], _q3);
  _q1.copy(_q3).invert().multiply(IK.q1);
  const tw = twistAngle(_q1, 0, 1, 0), lim = TUNE.armTwistMax * DEG;
  if (Math.abs(tw) > lim) {
    // (the pole swings round the shoulder→wrist axis until the twist sits at the limit: a probe of the excess each way,
    // then secant steps, at most four solves; the twist is smooth and monotonic in the swing near the solution)
    _ax2.subVectors(_ank, _hip).normalize();
    _gx2.copy(_pole).sub(_hip);
    const tgt = Math.sign(tw) * lim, ex = tw - tgt;
    let a0 = 0, t0 = tw, a1 = ex, t1 = swivelTwist(a1, B, n);
    if (Math.abs(t1) > Math.abs(t0)) { a1 = -ex; t1 = swivelTwist(a1, B, n); }
    for (let it = 0; it < 3 && Math.abs(t1 - tgt) > 0.3 * DEG && Math.abs(t1 - t0) > 1e-6; it++) {
      const a2 = clamp(a1 - (t1 - tgt) * (a1 - a0) / (t1 - t0), -2.4, 2.4);
      a0 = a1; t0 = t1; a1 = a2; t1 = swivelTwist(a1, B, n);
    }
    if (Math.abs(t1) > Math.abs(tw)) swivelTwist(0, B, n); // (no better: the plain solve)
    if (DBG.twistLog && Math.abs(t1) > lim + 0.01) DBG.twistLog.push([+(tw / DEG).toFixed(1), +(t1 / DEG).toFixed(1), +(a1 / DEG).toFixed(0), n.up]);
    if (!Number.isFinite(IK.q1.x) || !Number.isFinite(IK.q2.x)) return false;
    st.swivels++;
  }
  return true;
}
/**
 * IK one arm onto a wrist target and hand rotation (§4.22), blended by w from its FK pose. The elbow pole is the FK elbow
 * direction blended toward `pole` (aim frame: fwd, up, right) by pw. The elbow stays within 0..145°, the upper arm's
 * twist within ±armTwistMax. `roll` (radians, > 0): the hand may turn about its grip hole's axis (its own X: the curled
 * fingers slide round a forend or a grip, the hole's centre stays put) by up to that much, whichever way keeps the wrist
 * straightest over the forearm; then it solves once more.
 */
function armIK(r, L, wrist, handQ, pole, w, pw, roll = 0) {
  const st = r.st, B = r.bones, n = NM[L], up = B[n.up], fo = B[n.fo], hd = B[n.hand];
  const fkW = L === 'R' ? _fkRw : _fkLw, fkQ = L === 'R' ? _fkRq : _fkLq, fkE = L === 'R' ? _fkRe : _fkLe, GR = L === 'R' ? GRIPR : GRIPL;
  _hip.setFromMatrixPosition(up.matrixWorld);
  _pd.subVectors(fkE, _hip).normalize();
  const yaw = S.faceYaw, cy = Math.cos(yaw), sy = Math.sin(yaw);
  _pd2.set(cy * pole[0] - sy * pole[2], pole[1], sy * pole[0] + cy * pole[2]).normalize();
  _pole.copy(_pd).lerp(_pd2, clamp(pw, 0, 1)).normalize().multiplyScalar(10).add(_hip);
  _ank.copy(fkW).lerp(wrist, w);
  _q2.copy(fkQ).slerp(handQ, w);
  if (!solveArm(r, n, L)) { st.ikFails++; return; }
  if (roll > 0 && w > 0.01) {
    // the forearm's +Y (toward the elbow) and the hand's +Y, both seen along the grip hole's axis
    _hole.set(GR[0], GR[1], GR[2]).applyQuaternion(_q2).add(_ank);
    _hax.set(1, 0, 0).applyQuaternion(_q2);
    _fy.set(0, 1, 0).applyQuaternion(IK.q2); _fy.addScaledVector(_hax, -_fy.dot(_hax));
    _hy.set(0, 1, 0).applyQuaternion(_q2); _hy.addScaledVector(_hax, -_hy.dot(_hax));
    if (_fy.lengthSq() > 1e-6 && _hy.lengthSq() > 1e-6) {
      _fy.normalize(); _hy.normalize();
      const th = clamp(Math.atan2(_gx2.crossVectors(_hy, _fy).dot(_hax), _hy.dot(_fy)), -roll, roll) * clamp(w, 0, 1);
      if (Math.abs(th) > 1e-4) {
        _q2.premultiply(_rq2.setFromAxisAngle(_hax, th));
        _ank.copy(_hole).sub(_gx2.set(GR[0], GR[1], GR[2]).applyQuaternion(_q2));
        _pole.copy(_pd).lerp(_pd2, clamp(pw, 0, 1)).normalize().multiplyScalar(10).add(_hip);
        if (!solveArm(r, n, L)) { st.ikFails++; return; }
      }
    }
  }
  // the wrist's soft limit (§4.22, ±70°): a hand bent further than the knee turns about its grip hole toward the forearm's
  // line (the hole stays on the gun, the mag, the shell: the hand meets it at a slightly different angle), then one re-solve
  if (w > 0.01) {
    const WL = TUNE.wristLimit;
    _wl.copy(IK.q2).invert().multiply(_q2);
    const sw0 = swingDeg(_wl);
    if (sw0 > WL.knee) {
      const tgt = WL.knee + (WL.max - WL.knee) * Math.tanh((sw0 - WL.knee) / (WL.max - WL.knee));
      const L = Math.hypot(_wl.y, _wl.w) || 1;
      _wtw.set(0, _wl.y / L, 0, _wl.w / L);
      _wsw.copy(_wl).multiply(_wq0.copy(_wtw).invert());
      _wsw.slerpQuaternions(_wq0.identity(), _wsw, tgt / sw0);
      _wl.copy(_wsw).multiply(_wtw);
      _hole.set(GR[0], GR[1], GR[2]).applyQuaternion(_q2).add(_ank);
      _q2.copy(IK.q2).multiply(_wl);
      _ank.copy(_hole).sub(_gx2.set(GR[0], GR[1], GR[2]).applyQuaternion(_q2));
      _pole.copy(_pd).lerp(_pd2, clamp(pw, 0, 1)).normalize().multiplyScalar(10).add(_hip);
      if (!solveArm(r, n, L)) { st.ikFails++; return; }
      st.wristSoft++;
    }
  }
  up.quaternion.copy(_q3).invert().multiply(IK.q1); up.updateMatrixWorld(true);
  fo.quaternion.copy(IK.q1).invert().multiply(IK.q2); fo.updateMatrixWorld(true);
  hd.quaternion.copy(IK.q2).invert().multiply(_q2); hd.updateMatrixWorld(true);
  // (debug) how far short of its target the wrist fell (out of reach)
  st.reach[L === 'R' ? 0 : 1] = Math.max(0, _gx2.setFromMatrixPosition(hd.matrixWorld).distanceTo(_ank)); // (raw numbers: frankDebug rounds them)
  // the wrist (hand relative to the forearm), for the debug read-out: its roll (forearm pronation, hidden by the cuff)
  // and its swing (the visible bend); the hand stays on the gun
  const sw = swingDeg(hd.quaternion), wr = twistAngle(hd.quaternion, 0, 1, 0) / DEG;
  if (w > 0.5 && sw > st.wristMax) st.wristMax = sw;
  const WD = st.wrist[L === 'R' ? 0 : 1]; WD[0] = wr; WD[1] = sw; WD[2] = twistAngle(_q1.copy(_q3).invert().multiply(IK.q1), 0, 1, 0) / DEG;
}
const _pm = new THREE.Matrix4();
// the seated magazine's centre and long axis (its Y): the debris prism's long axis is its X, so it turns 90° about Z
const MAG_CENTER = new THREE.Matrix4().makeTranslation(-0.92, -2.1, 0).multiply(new THREE.Matrix4().makeRotationZ(-17 * DEG)).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
function propsInHands(r, p, held) {
  const st = r.st, B = r.bones;
  // the left hand's spare magazine, shell or round
  if (GC.lProp && GC.rl > 0.3 && held) {
    const name = GC.lProp === PROP_L.mag ? 'spareMag' : GC.lProp === PROP_L.shell ? 'shellHand' : 'roundHand';
    _pm.copy(B.handL.matrixWorld).multiply(GC.lProp === PROP_L.mag ? MAG_IN_HAND : ITEM_IN_HAND);
    showPropAt(r, B[name], _pm);
    if (GC.lProp === PROP_L.shell) B[name].scale.setScalar(TUNE.shellHandScale); // (reads at the game's zoom)
  }
  // the back sling: every owned long gun not in hand, each in its place (never the one travelling in a swap's out, nor
  // the one a swap has drawn)
  for (let i = 0; i < 2; i++) {
    const sl = st.backSlot[i];
    if (sl && sl !== held && !(GC.sw && sl === st.sw.from && GC.swF < swapTimes(st.sw).outEnd) && !(GC.sw && sl === st.sw.to && GC.swF >= SWAP.inStart)) {
      // (the second gun is put away while a tool is out: two long guns on a man chopping or hammering stood up over his
      // head like antennas, whatever their angle)
      if (i === 1 && st.slingLow > 0.5 && sl !== st.sw.to) continue;
      slingGun(r, GT, i); _m1.compose(GT.p, GT.q, _gw2.set(1, 1, 1)); showPropAt(r, B[sl], _m1);
    }
  }
}

/* -------- debris: casings that land where the 2D sim puts them, dropped magazines (§5.5) -------- */
const SIM_HULL = '#c0392b'; // (the 2D sim's shotgun hull colour, player.js: how a casing seen late is told apart)
const CAS = new WeakMap(), DEB_COL = { pistol: new THREE.Color(CASING.color.pistol), shotgun: new THREE.Color(CASING.color.shotgun), rifle: new THREE.Color(CASING.color.rifle), mag: new THREE.Color(CASING.color.mag) };
const _dc = new THREE.Color(), _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dq2 = new THREE.Quaternion(), _dp = V(), _ds = V(), _dax = V();
function dropMag(r) {
  const st = r.st, B = r.bones;
  let d = null;
  for (const m of st.mags) if (!m.on) { d = m; break; }
  if (!d) d = st.mags[0];
  B.pistolMag.updateMatrixWorld(true);
  // the magazine's centre and orientation as it leaves the grip
  _dm.copy(B.pistol.matrixWorld).multiply(_pm.makeTranslation(GA_AX[0] * 1.5, GA_AX[1] * 1.5, 0)).multiply(MAG_CENTER);
  _dm.decompose(_dp, _dq, _ds);
  d.on = true; d.t = 0; d.p[0] = _dp.x; d.p[1] = _dp.y; d.p[2] = _dp.z; d.bounced = false; d.rest = false;
  // v0 is gun-space (0, −v0, 0): straight down out of the mag well (the centre frame _dq carries the rake and the prism's
  // 90° roll, so it only orients the magazine)
  B.pistol.matrixWorld.decompose(_ds, _dq2, _dax);
  _dax.set(0, -CASING.mag.v0, 0).applyQuaternion(_dq2);
  d.v[0] = _dax.x + (st.vf[0] || 0); d.v[1] = _dax.y; d.v[2] = _dax.z + (st.vf[1] || 0);
  d.q[0] = _dq.x; d.q[1] = _dq.y; d.q[2] = _dq.z; d.q[3] = _dq.w;
}
function debrisUpdate(r, p) {
  // (the anim clock: sim seconds, frozen in a pause, slowed by hit-stop, as §5.5 asks)
  const st = r.st, D = r.debris, cap = r.q ? 16 : 48, CA = CASING, now = Number.isFinite(st.animClock) ? st.animClock : 0, dt = S.animDt;
  let n = 0;
  const port = r.fx.valid ? r.fx.port : null;
  // force-eject: the next shot, a swap, or 1.5 s after the shot (an empty shotgun chain holds its hull until the rack, 4 s at most)
  const force = S.shot || S.swapStart || S.teleport;
  const Cs = G.casings || [];
  const chain = st.rl.on && st.rl.weapon === 'shotgun';
  for (let i = Cs.length - 1; i >= 0; i--) {
    const c = Cs[i];
    let rec = CAS.get(c);
    if (!rec) {
      rec = { w: c.t > 0.5 ? (c.color === SIM_HULL ? 'shotgun' : 'pistol') : st.shotWeapon || S.weapon, shotT: now, te: -1, p0: [0, 0, 0] };
      if (c.t > 0.5 || !port) rec.te = -99; // seen late (after classic view or a reload of the map): at rest at once
      CAS.set(c, rec);
      if (rec.te === -1 && rec.w === 'pistol') ejectRec(rec, port, now);
    } else if (rec.te === -1) {
      const age = now - rec.shotT;
      if ((GC.eject === rec.w) || (force && age > 1e-4) || age > (chain && rec.w === 'shotgun' ? CA.forceChain : CA.force)) ejectRec(rec, port, now);
    }
  }
  for (let i = Cs.length - 1; i >= 0 && n < cap; i--) {
    const c = Cs[i], rec = CAS.get(c);
    if (!rec || rec.te === -1 || !TUNE.enable.casings) continue;
    const sc = CA.scale[rec.w] || CA.scale.pistol, rest = sc[1] * 0.5, fadeK = clamp((CA.life - (c.t || 0)) / CA.fade, 0, 1);
    if (fadeK <= 0) continue;
    const u = rec.te === -99 ? 1 : clamp((now - rec.te) / CA.arcT, 0, 1);
    const ul = 1 - CA.bounceT / CA.arcT;
    if (u < 1) {
      const k = EO(clamp(u / ul, 0, 1));
      _dp.set(lerp(rec.p0[0], c.x, k), 0, lerp(rec.p0[2], c.y, k));
      const top = rec.p0[1] + CA.peak;
      _dp.y = u < CA.peakAt ? lerp(rec.p0[1], top, 1 - (1 - u / CA.peakAt) ** 2)
        : u < ul ? lerp(top, rest, ((u - CA.peakAt) / (ul - CA.peakAt)) ** 2)
          : rest + CA.bounce * Math.sin(Math.PI * (u - ul) / (1 - ul));
      const sp = (now - rec.te) * CA.spin;
      _dq.setFromAxisAngle(_dax.set(0.3, 0.8, 0.52).normalize(), sp);
    } else {
      _dp.set(c.x, rest, c.y);
      _dq.setFromAxisAngle(_dax.set(0, 1, 0), -(c.rot || 0));
    }
    _ds.set(sc[0], sc[1], sc[2]).multiplyScalar(fadeK);
    // the glint: bright while airborne, fading over glintT after it lands
    const gk = rec.te === -99 ? 0 : u < 1 ? 1 : clamp(1 - (now - rec.te - CA.arcT) / CA.glintT, 0, 1);
    _dc.copy(DEB_COL[rec.w] || DEB_COL.pistol).multiplyScalar(1 + (CA.glint - 1) * gk);
    _dm.compose(_dp, _dq, _ds); D.setMatrixAt(n, _dm); D.setColorAt(n, _dc); n++;
  }
  // dropped magazines: fall (gravity 900, one 0.25 bounce), rest 1 s, shrink over 0.2 s
  const M = CA.mag;
  for (const d of st.mags) {
    if (!d.on) continue;
    d.t += dt;
    if (!d.rest) {
      d.v[1] -= M.g * dt; d.p[0] += d.v[0] * dt; d.p[1] += d.v[1] * dt; d.p[2] += d.v[2] * dt;
      const fl = CA.scale.mag[1] * 0.5;
      if (d.p[1] < fl) { d.p[1] = fl; if (!d.bounced && d.v[1] < -60) { d.bounced = true; d.v[1] *= -M.rest; d.v[0] *= 0.5; d.v[2] *= 0.5; } else { d.rest = true; d.restT = d.t; d.v[0] = d.v[1] = d.v[2] = 0; d.yaw = Math.atan2(d.q[1], d.q[3]) * 2; } }
    }
    if (d.rest && d.t - d.restT > M.restT + M.shrinkT) { d.on = false; continue; }
    if (n >= cap) continue;
    const shrink = d.rest ? 1 - clamp((d.t - d.restT - M.restT) / M.shrinkT, 0, 1) : 1;
    if (!d.rest) { _dq.set(d.q[0], d.q[1], d.q[2], d.q[3]).premultiply(_dq2.setFromAxisAngle(_dax.set(0.4, 0, 0.9).normalize(), M.spin * dt)); d.q[0] = _dq.x; d.q[1] = _dq.y; d.q[2] = _dq.z; d.q[3] = _dq.w; }
    else _dq.setFromAxisAngle(_dax.set(0, 1, 0), d.yaw);
    const s = CA.scale.mag;
    _dm.compose(_dp.set(d.p[0], d.p[1], d.p[2]), _dq, _ds.set(s[0] * shrink, s[1] * shrink, s[2] * shrink));
    D.setMatrixAt(n, _dm); D.setColorAt(n, DEB_COL.mag); n++;
  }
  D.count = n; D.visible = n > 0;
  if (n) { D.instanceMatrix.needsUpdate = true; if (D.instanceColor) D.instanceColor.needsUpdate = true; }
  st.debrisN = n;
}
function ejectRec(rec, port, now) {
  rec.te = now;
  if (port) { rec.p0[0] = port.x; rec.p0[1] = port.y; rec.p0[2] = port.z; } else rec.te = -99;
}

/* ---------------- effect anchors (§5.3), the beam and the lens (§5.6) ---------------- */
function fxAnchors(r, p, weapon) {
  const st = r.st, fx = r.fx, gun = r.bones[weapon] || r.bones.pistol, Sk = SOCKETS[weapon] || SOCKETS.pistol;
  fx.weapon = weapon;
  fx.aimed = st.gunDriver === 'aim';
  // valid: this weapon is in his hand (aimed, at his side, at low ready), never mid-swap or dead
  fx.valid = !p.dead && st.inHand === weapon && (st.gunDriver === 'aim' || st.gunDriver === 'hand' || st.gunDriver === 'chest') && gun.scale.x > 0.5;
  if (!fx.valid) return;
  const M = gun.matrixWorld;
  fx.muzzle.set(Sk.muzzle[0], Sk.muzzle[1], Sk.muzzle[2]).applyMatrix4(M);
  fx.bore.set(1, 0, 0).transformDirection(M);
  fx.flashPos.copy(fx.muzzle).addScaledVector(fx.bore, 2);
  fx.flashSize = Sk.flash || 18;
  fx.lightOrigin.copy(fx.muzzle).addScaledVector(fx.bore, 1.5); fx.lightOrigin.y -= 0.6;
  fx.port.set(Sk.port[0], Sk.port[1], Sk.port[2]).applyMatrix4(M);
  if (!(Number.isFinite(fx.muzzle.x) && Number.isFinite(fx.muzzle.y) && Number.isFinite(fx.muzzle.z) && Number.isFinite(fx.bore.x))) fx.valid = false;
}
/** The flashlight's beam (HQ cone) and the gun's lens: from the gun when it's up, else from the old spot ahead of him. */
const _cq = new THREE.Quaternion();
function beam(r, p, ctx) {
  const fx = r.fx, dk = ctx && Number.isFinite(ctx.dk) ? ctx.dk : 0, on = dk > 0.25 && !p.dead, k = on ? Math.min(1, (dk - 0.25) * 2) : 0;
  // (the lens glows whenever the beam comes from it: relaxed too, M5 fix)
  fx.lensOn = on && fx.valid;
  FRANK_U.uLens.value = fx.lensOn ? k : 0;
  FRANK_U.uLensGun.value = (fx.weapon === 'shotgun' ? 253 : fx.weapon === 'rifle' ? 254 : 252) / 255; // (each gun's lens has its id in aSurf.z's lens band)
  const c = r.cone;
  if (!c) return;
  c.visible = on && TUNE.enable.cone && fx.valid;
  if (!c.visible) return;
  const a = p.angle || 0;
  // (from the gun's lens, aimed or relaxed (M5 fix: relaxed it came from a fixed point at his chest, a 'chest lamp' through
  // his forearm); onto the ground ahead either way)
  _v1.copy(fx.lightOrigin);
  _v2.set(p.x + Math.cos(a) * 200, 0, p.y + Math.sin(a) * 200).sub(_v1).normalize();
  c.position.copy(_v1); c.quaternion.setFromUnitVectors(_v3.set(1, 0, 0), _v2);
  c.material.opacity = 0.09 * k; // (0.05 read as a barely visible grey wedge at night)
}

/* ---------------- 13. the coat skirt's pendulums (§4.21) ---------------- */
// Chain k hangs from the pelvis at loft angle θk. In the pelvis frame n_k = (cosθk, 0, sinθk) points out and
// t_k = (−sinθk, 0, cosθk) along the hem: +α (about t_k) swings the hem out along n_k, +β (about n_k) moves it toward −t_k,
// γ (High) bends the lower panel further about t_k. Targets: the resting flare, speed drag (the back trails, the front
// presses in), the turn fling (a fast turn bells the coat and shows the lining), the sprint's flutter and the storm;
// the springs then lag and overshoot (acceleration and yaw acceleration feed them), the knees and shins push the panels
// out (a hard lower clamp: the front panels kick on every stride), and nothing passes through the legs or the ground.
const _cP = new THREE.Vector3(), _cK = new THREE.Vector3(), _cA = new THREE.Vector3(), _cQ = new THREE.Quaternion(), _cN = new THREE.Vector3(), _cT = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _axN = new THREE.Vector3(), _axT = new THREE.Vector3();
const CNX = new Float64Array(6), CNZ = new Float64Array(6), CTX = new Float64Array(6), CTZ = new Float64Array(6), AHI_DEG = 78;
const KNEE_CONE = Math.cos(60 * DEG);
function coatSim(r, p) {
  if (!TUNE.enable.coat) return;
  const st = r.st, B = r.bones, hq = !r.q, th = hq ? SKIRT6 : SKIRT4, n = th.length;
  if (st.coat.n !== n) { st.coat = coatState(); st.coat.n = n; }
  const cs = st.coat, C = SC, dt = S.liveDt;
  worldQuat(B.pelvis, _cQ);
  const vx = st.vf[0], vz = st.vf[1], spd = st.speed, vhx = spd > 1 ? vx / spd : 0, vhz = spd > 1 ? vz / spd : 0;
  const ax = st.acc[0], az = st.acc[1];
  // (the dash's hip whip to the dash direction is not a turn the coat should bell out for: its fling is capped)
  const dashing = st.stateF === 'dodge' && !st.dg.hop;
  const rest = C.rest * DEG, fling = Math.min((dashing ? 10 : C.flingMax) * DEG, Math.atan(C.fling * st.yawRate * st.yawRate));
  const t = S.now, rain = G.rainLevel || 0;
  const flutter = st.sprintW > 0 ? C.flutter * (Math.sin(2 * Math.PI * 6 * t) + 0.5 * Math.sin(2 * Math.PI * 11 * t)) * clamp((spd - 130) / 50, 0, 1) * st.sprintW : 0;
  const twistK = 0.5 * C.twist * DEG * Math.pow(Math.min(1, spd / 185), 1.2);
  // the dash (§4.14): α* += dash (50–70° in all, the lining showing) through the dash and out over its tail; a side dash or
  // one toward the camera (south, +y) flares less and each panel is capped (they belled into a disc or a dome over the
  // legs), and a ripple runs round the hem so the skirt never moves as one rigid sheet
  const Dg = st.dg, KD = DODGE.dash, dashOn = st.stateF === 'dodge' && !Dg.hop;
  const dashSide = dashOn ? Math.max(ss(30, 60, Math.abs(Dg.rel) / DEG), ss(0.3, 0.7, Math.sin(Dg.dir))) : 0;
  const dash = dashOn ? lerp(KD.flare, KD.flareSide, dashSide) * (Dg.ph === 1 ? ss(0, 0.25, Dg.u) : 1 - ES(clamp(Dg.tailT / DODGE.tail, 0, 1))) : 0;
  const flareCap = dashOn ? lerp(AHI_DEG, KD.flareCap, dashSide) * DEG : 9;
  for (let k = 0; k < n; k++) {
    const a = th[k] * DEG;
    _cN.set(Math.cos(a), 0, Math.sin(a)).applyQuaternion(_cQ); _cT.set(-Math.sin(a), 0, Math.cos(a)).applyQuaternion(_cQ);
    let L = Math.hypot(_cN.x, _cN.z) || 1; CNX[k] = _cN.x / L; CNZ[k] = _cN.z / L;
    L = Math.hypot(_cT.x, _cT.z) || 1; CTX[k] = _cT.x / L; CTZ[k] = _cT.z / L;
    // speed drag (the back trails, the front presses in); the two front panels are loose flaps at the opening, so their
    // trailing (backing up, strafing) is capped: uncapped they swung out edge-on as thin lining-coloured blades
    const front = k === 0 || k === n - 1;
    const drag = clamp(-(vx * CNX[k] + vz * CNZ[k]) / 185 * C.drag, C.dragFront, front ? C.dragBackFront : C.drag);
    const storm = rain > 0.7 ? C.storm * noise1(1.3 * t + k * 7.1) : 0;
    // (the dash's flare is mostly on the trailing panels: the whole skirt at +20° read as a round cape from above)
    const dk = dash ? dash * (0.3 + 0.7 * Math.max(0, -(vhx * CNX[k] + vhz * CNZ[k]))) + KD.ripple * (dash / KD.flare) * Math.sin(2 * Math.PI * (KD.rippleHz * t - k / n)) : 0;
    cs.aT[k] = p.dead ? 0 : Math.min(flareCap, rest + (drag + flutter + storm + dk) * DEG + fling);
    // β: the side panels trail the motion. (Sign note: the spec writes β* ∝ dot(t_k, −v̂), −accGain·dot(a, t_k) and
    // −yawAccGain·ψ''; with its own convention, +β moves the hem toward −t_k, and +yaw moves n_k toward +t_k, so the signs
    // here, +dot(t_k, v̂), +dot(a, t_k), +ψ'', are the ones that make the hem lag: the spec text has them flipped.)
    cs.bT[k] = p.dead ? 0 : twistK * (CTX[k] * vhx + CTZ[k] * vhz);
  }
  // neighbour coupling, never across the front opening (the first and last chains face each other there)
  for (let k = 0; k < n; k++) {
    if (k === 0) cs.aT2[k] = C.edgeOwn * cs.aT[0] + (1 - C.edgeOwn) * cs.aT[1];
    else if (k === n - 1) cs.aT2[k] = C.edgeOwn * cs.aT[k] + (1 - C.edgeOwn) * cs.aT[k - 1];
    else cs.aT2[k] = C.own * cs.aT[k] + C.neighbour * (cs.aT[k - 1] + cs.aT[k + 1]);
  }
  // collision lower bounds: the knees against each upper panel, the shin middles against each lower panel, the ground.
  // A front panel's knee bound is capped at kneeMax (half the excess goes to its side neighbour), and while a knee holds
  // an upper panel out its lower panel bends back in, so the hem drapes over the knee instead of continuing the plane.
  const gap = C.gap;
  for (let k = 0; k < n; k++) cs.xs[k] = 0;
  for (let k = 0; k < n; k++) {
    const up = B[hq ? SKU[k] : SK4[k]];
    _cP.setFromMatrixPosition(up.matrixWorld);
    let lo = -15 * DEG, loG = -10 * DEG;
    const nx = CNX[k], nz = CNZ[k];
    if (!p.dead) for (let j = 0; j < 2; j++) {
      _cK.setFromMatrixPosition(B[SHINS[j]].matrixWorld);
      const dx = _cK.x - _cP.x, dz = _cK.z - _cP.z, hl = Math.hypot(dx, dz), d = dx * nx + dz * nz;
      if (hl > 1e-3 && d >= KNEE_CONE * hl) lo = Math.max(lo, Math.atan2(d + gap, Math.max(6, _cP.y - _cK.y)));
      if (hq) {
        // the lower panel's pivot, carried out by the upper panel's swing (10 below the upper pivot)
        const al = cs.a[k], plx = _cP.x + 10 * Math.sin(al) * nx, ply = _cP.y - 10 * Math.cos(al), plz = _cP.z + 10 * Math.sin(al) * nz;
        _cA.setFromMatrixPosition(B[FEET[j]].matrixWorld).add(_cK).multiplyScalar(0.5);
        const mx = _cA.x - plx, mz = _cA.z - plz, ml = Math.hypot(mx, mz), md = mx * nx + mz * nz, hM = ply - _cA.y;
        if (hM > 1 && hM < 14 && ml > 1e-3 && md >= KNEE_CONE * ml) loG = Math.max(loG, Math.atan2(md + gap * 0.7, Math.max(4, hM)) - al);
      }
    }
    if ((k === 0 || k === n - 1) && lo > C.kneeMax * DEG) {
      const ex = lo - C.kneeMax * DEG; lo = C.kneeMax * DEG;
      cs.xs[k === 0 ? 1 : n - 2] = Math.max(cs.xs[k === 0 ? 1 : n - 2], 0.5 * ex);
    }
    if (k === 0 || k === n - 1) loG = Math.min(loG, C.loGFront * DEG);
    // the ground: the hem (about 20 below the pivot) never dips under y 0.8
    if (_cP.y < 20.8) lo = Math.max(lo, Math.acos(clamp((_cP.y - 0.8) / 20, -1, 1)));
    cs.lo[k] = lo; cs.loG[k] = loG;
  }
  for (let k = 0; k < n; k++) if (cs.xs[k] > 0) cs.lo[k] = Math.max(cs.lo[k], cs.xs[k]);
  // a long gun's kick: the front panels swing out, the back ones in (§4.9 coat impulse, rad/s)
  if (S.shot && LONG[S.weapon]) { const ci = RECOIL[S.weapon].coat || 0; for (let k = 0; k < n; k++) cs.va[k] += ci * Math.cos(th[k] * DEG); }
  // the dash's landing: the panels facing the travel swing on (3 rad/s); a hit: the panels facing the push (1.4 rad/s)
  if (Dg.ph === 2 && Dg.tailT <= S.adt + 1e-6 && !Dg.hop) for (let k = 0; k < n; k++) cs.va[k] += 3 * Math.max(0, CNX[k] * Math.cos(Dg.dir) + CNZ[k] * Math.sin(Dg.dir));
  if (S.hit && !p.dead) { const pa = st.hurt.ang + Math.PI; for (let k = 0; k < n; k++) cs.va[k] += FLINCH.coat * Math.max(0, CNX[k] * Math.cos(pa) + CNZ[k] * Math.sin(pa)); }
  // integrate at 120 Hz (semi-implicit Euler), clamps zero the velocity
  const hz = rain > 0.3 ? C.hzRain : C.hz, w = 2 * Math.PI * hz, wL = 2 * Math.PI * C.lowerHz, zL = C.lowerZeta;
  const ns = dt > 0 ? Math.min(8, Math.ceil(dt / SPRING_H - 1e-9)) : 0, h = ns ? dt / ns : 0;
  const ALO = -15 * DEG, AHI = 78 * DEG, GLO = -10 * DEG, GHI = 40 * DEG;
  // (a side dash or one toward the camera: the pendulums themselves stop at the flare cap + 8°, not just their targets:
  // they overshot into one flat trailing 'wing'; the lower panels don't curl on past it)
  const aHi = Math.min(AHI, flareCap + 8 * DEG), gHi = dashSide > 0.5 ? 15 * DEG : GHI;
  for (let k = 0; k < n; k++) {
    const front = k === 0 || k === n - 1, z = front ? C.frontZeta : C.zeta, BLIM = (front ? C.bLimFront : hq ? C.bLim : C.bLimLow) * DEG;
    const accN = ax * CNX[k] + az * CNZ[k], accT = ax * CTX[k] + az * CTZ[k];
    let a = cs.a[k], va = cs.va[k], b = cs.b[k], vb = cs.vb[k], g = cs.g[k], vg = cs.vg[k];
    const aT = cs.aT2[k], bT = cs.bT[k], lo = Math.max(ALO, cs.lo[k]);
    // the lower panel curls out with the upper's flare (a bell), but bends back in while a knee holds the upper one out,
    // and droops (its weight) once the upper panel flies out past droopAt, so a big flare never reads as a flat board
    const gT = cs.lo[k] > aT + 1e-3 ? -0.5 * (cs.lo[k] - aT)
      : C.lowerGain * Math.min(Math.max(0, aT - rest), C.lowerCap * DEG) - C.droop * Math.max(0, a - C.droopAt * DEG);
    for (let s = 0; s < ns; s++) {
      const aa = -w * w * (a - aT) - 2 * z * w * va - C.accGain * accN;
      va += aa * h; a += va * h;
      if (a < lo) { a = lo; if (va < 0) va = 0; } else if (a > aHi) { a = aHi; if (va > 0) va = 0; }
      const bb = -w * w * (b - bT) - 2 * z * w * vb + C.accGain * accT + C.yawAccGain * st.yawAcc;
      vb += bb * h; b += vb * h;
      if (b < -BLIM) { b = -BLIM; if (vb < 0) vb = 0; } else if (b > BLIM) { b = BLIM; if (vb > 0) vb = 0; }
      if (hq) {
        const gg = -wL * wL * (g - gT) - 2 * zL * wL * vg - C.lowerAcc * aa;
        vg += gg * h; g += vg * h;
        const glo = Math.max(front ? C.gloFront * DEG : GLO, cs.loG[k]);
        if (g < glo) { g = glo; if (vg < 0) vg = 0; } else if (g > gHi) { g = gHi; if (vg > 0) vg = 0; }
      }
    }
    // a frame without time still honours this frame's collisions
    if (a < lo) a = lo;
    if (hq && g < cs.loG[k]) g = Math.min(GHI, cs.loG[k]);
    if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(g) && Number.isFinite(va) && Number.isFinite(vb) && Number.isFinite(vg))) { a = rest; b = g = va = vb = vg = 0; }
    cs.a[k] = a; cs.va[k] = va; cs.b[k] = b; cs.vb[k] = vb; cs.g[k] = g; cs.vg[k] = vg;
  }
  // the skirt is one piece of cloth: neighbouring panels never shear apart by more than pairA (α) / pairB (β); both move
  // half the excess and share their velocity (never across the front opening, where the first and last chains meet)
  const pairA = (hq ? C.pairA : C.pairALow) * DEG, pairB = C.pairB * DEG;
  for (let it = 0; it < 2; it++) {
    for (let k = 0; k + 1 < n; k++) {
      const j = k + 1, da = cs.a[j] - cs.a[k];
      if (Math.abs(da) > pairA) {
        const ex = 0.5 * (da - Math.sign(da) * pairA);
        cs.a[k] += ex; cs.a[j] -= ex; const vm = 0.5 * (cs.va[k] + cs.va[j]); cs.va[k] = cs.va[j] = vm;
      }
      const db = cs.b[j] - cs.b[k];
      if (Math.abs(db) > pairB) {
        const ex = 0.5 * (db - Math.sign(db) * pairB);
        cs.b[k] += ex; cs.b[j] -= ex; const vm = 0.5 * (cs.vb[k] + cs.vb[j]); cs.vb[k] = cs.vb[j] = vm;
      }
    }
    // the collisions win (a panel is never pulled into a leg)
    for (let k = 0; k < n; k++) { const lo = Math.max(ALO, cs.lo[k]); if (cs.a[k] < lo) { cs.a[k] = lo; if (cs.va[k] < 0) cs.va[k] = 0; } }
  }
  // write: skU = Q(t, α)·Q(n, β) in the pelvis frame; skL = Q(t, γ)
  for (let k = 0; k < n; k++) {
    const ang = th[k] * DEG;
    _axT.set(-Math.sin(ang), 0, Math.cos(ang)); _axN.set(Math.cos(ang), 0, Math.sin(ang));
    _qa.setFromAxisAngle(_axT, cs.a[k]); _qb.setFromAxisAngle(_axN, cs.b[k]);
    B[hq ? SKU[k] : SK4[k]].quaternion.copy(_qa).multiply(_qb);
    if (hq) B[SKL[k]].quaternion.setFromAxisAngle(_axT, cs.g[k]);
  }
  if (p.dead) coatOnGround(r, hq, th, n);
}
/**
 * Dead (§4.16, §4.21): the skirt falls with gravity and spreads on the ground. Each panel's hem is aimed (world) from its
 * pivot down to the ground and out away from the body (the upper panel slopes to the ground, the lower one lies flat),
 * then blended in from the live pendulums as he lands.
 */
const _gP = V(), _gL = V(), _gD = V(), _gO = V(), _gA = V(), _gB = V(), _gO2 = V(), _gP2 = V(), _gQ = new THREE.Quaternion(), _gQ2 = new THREE.Quaternion(), _gQ3 = new THREE.Quaternion(), _gQ4 = new THREE.Quaternion();
const SK_BIND = new Map(), _gQ5 = new THREE.Quaternion(), _gQ6 = new THREE.Quaternion();
/** A panel blended from q0 (live) toward qG (on the ground) by w: if its hem would end under y 1.6 the blend goes on just as
 *  far as it must (bisection) toward the ground pose, so the hem never digs in and never snaps across in one frame. */
function hemTipY(bone, q0, qG, k, dir, len, piv) { bone.quaternion.slerpQuaternions(q0, qG, k); bone.updateMatrixWorld(true); return _gO2.set(dir.x * len, dir.y * len, dir.z * len).applyQuaternion(worldQuat(bone, _gQ6)).y + piv.y; }
function groundBlend(bone, q0, qG, w, dir, len, piv, Y = 1.6) {
  if (hemTipY(bone, q0, qG, w, dir, len, piv) >= Y) return;
  let a = w, b = 1;
  if (hemTipY(bone, q0, qG, 1, dir, len, piv) < Y) return; // (the ground pose itself: nothing better to do)
  for (let it = 0; it < 5; it++) { const m = (a + b) / 2; if (hemTipY(bone, q0, qG, m, dir, len, piv) < Y) a = m; else b = m; }
  hemTipY(bone, q0, qG, b, dir, len, piv);
}
function skBind(r, hq, k) {
  // the panels' bind directions in their parent's frame (pivot → lower pivot / hem), cached per quality
  const key = (hq ? 'h' : 'l') + k;
  let v = SK_BIND.get(key);
  if (!v) {
    const th = (hq ? SKIRT6 : SKIRT4)[k] * DEG, a = coatSurface(38, th, 0.5), b = coatSurface(hq ? 28 : 18, th, 0.5), c = coatSurface(18, th, 0.5);
    v = { up: new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), lo: new THREE.Vector3(c[0] - b[0], c[1] - b[1], c[2] - b[2]) };
    v.lenU = v.up.length(); v.lenL = v.lo.length(); v.up.normalize(); v.lo.normalize();
    SK_BIND.set(key, v);
  }
  return v;
}
function coatOnGround(r, hq, th, n) {
  const st = r.st, B = r.bones, t = st.deathT, w = ss(DEATH.coatFrom, DEATH.coatTo, t);
  if (w <= 0) return;
  worldQuat(B.pelvis, _gQ);
  // the body's line along the legs (pelvis −Y in world, flattened) and the pelvis centre
  _gD.set(0, -1, 0).applyQuaternion(_gQ); _gD.y = 0; if (_gD.lengthSq() < 1e-4) _gD.set(Math.cos(S.hipYaw), 0, Math.sin(S.hipYaw)); _gD.normalize();
  _gO.setFromMatrixPosition(B.pelvis.matrixWorld);
  for (let k = 0; k < n; k++) {
    const up = B[hq ? SKU[k] : SK4[k]], bd = skBind(r, hq, k);
    _gP.setFromMatrixPosition(up.matrixWorld);
    // outward: from the body's centre line to the pivot, flattened; the spread blends it with the line along the legs
    _gA.subVectors(_gP, _gO); _gA.y = 0; _gA.addScaledVector(_gD, -_gA.dot(_gD));
    if (_gA.lengthSq() < 1e-4) _gA.set(0, 0, 0); else _gA.normalize();
    _gB.copy(_gD).addScaledVector(_gA, DEATH.spread * 1.6).normalize(); // the horizontal direction this panel lies along
    // (the hem aimed 2 u up: the panels' corners and cloth thickness reach below their centre line)
    const L1 = bd.lenU, h = Math.max(0, _gP.y - 2.0), drop = Math.min(h, 0.97 * L1), flat = Math.sqrt(Math.max(0, L1 * L1 - drop * drop));
    _gL.copy(_gB).multiplyScalar(flat); _gL.y = -drop; _gL.normalize(); // the upper panel's world direction
    // into the pelvis frame, the rotation from its bind direction
    _gA.copy(_gL).applyQuaternion(_gQ2.copy(_gQ).invert());
    _gQ3.setFromUnitVectors(bd.up, _gA);
    // (from coatFrom on, a panel whose hem would go under the ground takes its ground pose in full, whatever the blend: at
    // the impact the skirt went 9–12 u into the ground)
    _gQ2.copy(up.quaternion); up.quaternion.slerp(_gQ3, w);
    if (w < 1) groundBlend(up, _gQ2, _gQ3, w, bd.up, L1, _gP);
    if (hq) {
      up.updateMatrixWorld(true);
      // (the lower panel lies flat: no 0.97 cap, the rear vent stood up as a fin)
      const lo = B[SKL[k]], h2 = Math.max(0, _gP.y + _gL.y * L1 - 3.0), d2 = Math.min(h2, bd.lenL), f2 = Math.sqrt(Math.max(0, bd.lenL * bd.lenL - d2 * d2));
      _gL.copy(_gB).multiplyScalar(f2); _gL.y = -d2; _gL.normalize();
      worldQuat(up, _gQ2); _gA.copy(_gL).applyQuaternion(_gQ2.invert());
      _gQ3.setFromUnitVectors(bd.lo, _gA);
      _gQ5.copy(lo.quaternion); lo.quaternion.slerp(_gQ3, w);
      if (w < 1) { _gP2.setFromMatrixPosition(lo.matrixWorld); groundBlend(lo, _gQ5, _gQ3, w, bd.lo, bd.lenL, _gP2, 2.9); } // (the lower panels are wide: their corners sit ~3 under the centre line)
    }
  }
}

/* ---------------- 15. the dodge's dust puff (§3.7, §4.14): 8 points, 0.35 s ---------------- */
const DUST_R = [0.9, 0.62, 1.0, 0.75, 0.95, 0.58, 0.85, 0.7], DUST_U = [0.6, 1.0, 0.7, 0.9, 0.5, 1.0, 0.8, 0.65];
function dustUpdate(r) {
  const st = r.st, d = st.dust, P = r.dust, DU = d.K || DODGE.dust;
  if (!P) return;
  if (d.t >= DU.T) { if (P.visible) P.visible = false; return; }
  d.t += G.paused ? 0 : (S.adt || S.realDt);
  const u = clamp(d.t / DU.T, 0, 1), e = EO(u), pos = P.geometry.attributes.position, c = Math.cos(d.dir), s = Math.sin(d.dir);
  for (let i = 0; i < DU.n; i++) {
    // a low ring thrown out from the skidding foot, pushed on along the skid
    const a = d.dir + (i / DU.n) * 2 * Math.PI, rr = DU.r * e * DUST_R[i];
    pos.setXYZ(i, d.x + Math.cos(a) * rr + c * 4 * e, (d.y || 1.2) + DU.rise * e * DUST_U[i] - (d.y > 5 ? 9 * u * u : 0), d.z + Math.sin(a) * rr + s * 4 * e);
  }
  pos.needsUpdate = true; P.visible = true;
  P.material.opacity = 0.8 * (1 - u * u); P.material.size = DU.size * (0.6 + 0.9 * e);
}

/* ---------------- 13. forelocks (HQ): two 2-DOF springs on the strands (§4.21) ---------------- */
const FL_BONES = ['forelockA', 'forelockB'];
const _hq = new THREE.Quaternion(), _hv = new THREE.Vector3();
function forelocks(r, p) {
  const B = r.bones;
  if (r.q || !B.forelockA || !TUNE.enable.forelocks) { r.st.headOk = 0; return; } // (a later High frame restarts the velocity history)
  const st = r.st, dt = S.liveDt, FL = TUNE.forelock;
  // the head's world acceleration (second difference, EMA 30 ms) and yaw acceleration
  _hv.setFromMatrixPosition(B.head.matrixWorld);
  worldQuat(B.head, _hq);
  _v1.set(1, 0, 0).applyQuaternion(_hq);
  const yaw = Math.atan2(_v1.z, _v1.x), pitchW = Math.asin(clamp(_v1.y, -1, 1));
  if (dt > 0) {
    const hp = st.headP, hv = st.headV, ha = st.headA;
    if (st.headOk >= 1) {
      const vx = (_hv.x - hp[0]) / dt, vy = (_hv.y - hp[1]) / dt, vz = (_hv.z - hp[2]) / dt;
      if (st.headOk >= 2) {
        const k = 1 - Math.exp(-dt / 0.03);
        ha[0] += (clamp((vx - hv[0]) / dt, -4000, 4000) - ha[0]) * k; ha[1] += (clamp((vy - hv[1]) / dt, -4000, 4000) - ha[1]) * k; ha[2] += (clamp((vz - hv[2]) / dt, -4000, 4000) - ha[2]) * k;
        const yr = wrap(yaw - st.headYaw) / dt;
        st.headYawA += (clamp((yr - st.headYawV) / dt, -600, 600) - st.headYawA) * k; st.headYawV = yr;
      } else st.headYawV = wrap(yaw - st.headYaw) / dt;
      hv[0] = vx; hv[1] = vy; hv[2] = vz;
    }
    hp[0] = _hv.x; hp[1] = _hv.y; hp[2] = _hv.z; st.headYaw = yaw; st.headOk = Math.min(2, st.headOk + 1);
  }
  // the acceleration in the head's frame
  _v2.set(st.headA[0], st.headA[1], st.headA[2]).applyQuaternion(_q1.copy(_hq).invert());
  // (the dash streams them back, §4.14)
  const Dg = st.dg, stream = st.stateF === 'dodge' && !Dg.hop ? (Dg.ph === 1 ? ss(0, 0.3, Dg.u) : 1 - ES(clamp(Dg.tailT / DODGE.tail, 0, 1))) : 0;
  const lim = FL.max * DEG, tgtP = -FL.hang * pitchW - 35 * DEG * stream;
  const ns = dt > 0 ? Math.min(8, Math.ceil(dt / SPRING_H - 1e-9)) : 0, h = ns ? dt / ns : 0;
  for (let i = 0; i < 2; i++) {
    const f = st.fl[i], w = 2 * Math.PI * FL.hz * (1 + 0.12 * i), z = FL.zeta;
    for (let s = 0; s < ns; s++) {
      const ap = -w * w * (f.p - tgtP) - 2 * z * w * f.vp - FL.acc * _v2.x;
      f.vp += ap * h; f.p += f.vp * h;
      const ar = -w * w * f.r - 2 * z * w * f.vr + FL.acc * _v2.z + FL.angAcc * st.headYawA;
      f.vr += ar * h; f.r += f.vr * h;
      if (f.p < -lim) { f.p = -lim; if (f.vp < 0) f.vp = 0; } else if (f.p > lim) { f.p = lim; if (f.vp > 0) f.vp = 0; }
      if (f.r < -lim) { f.r = -lim; if (f.vr < 0) f.vr = 0; } else if (f.r > lim) { f.r = lim; if (f.vr > 0) f.vr = 0; }
    }
    if (!(Number.isFinite(f.p) && Number.isFinite(f.r))) f.p = f.vp = f.r = f.vr = 0;
    B[FL_BONES[i]].rotation.set(f.r, 0, f.p);
  }
}

function finiteRig(r) {
  const bp = r.body.position;
  if (!(Number.isFinite(bp.x) && Number.isFinite(bp.z))) return false;
  for (const b of r.skeleton.bones) {
    const p = b.position, q = b.quaternion;
    if (!(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z) && Number.isFinite(q.w))) return false;
  }
  return true;
}

/* ---------------- decal (§3.6) ---------------- */
const SHADOW_DIR = [0.63, 0.78];
function chevPt(pos, i0, i, f, s, ca, sa) { pos.setXYZ(i0 + i, f * ca - s * sa, 0.85, f * sa + s * ca); }
function updateDecal(r, p, ctx) {
  const d = r.decal, Lo = d.userData.layout, pos = d.geometry.attributes.position, col = d.geometry.attributes.color, q = r.q;
  d.position.set(p.x, 0, p.y);
  const dead = !!p.dead, a = p.angle || 0, ca = Math.cos(a), sa = Math.sin(a);
  // blob: offset along the sun-shadow direction (Low: longer and stronger)
  // (the back-hop: the blob shrinks as he rises, so the shadow visibly leaves him)
  const rise = r.st.stateF === 'dodge' && r.st.dg.hop ? ss(0, 6, (PB[PK.pel + 1] || 0)) : 0;
  const cr = clamp(PB[PK.crouch] || 0, 0, 1), off = q ? 8 : 3, stretch = q ? 1.4 : 1, wide = dead ? 1.3 : (1 - 0.2 * cr) * lerp(1, DODGE.hop.blobMin, rise), bA = (q ? 0.5 : 0.35) * (1 + 0.3 * cr) * lerp(1, 0.7, rise);
  for (let i = 0; i <= DECAL.blobSeg; i++) {
    if (i === 0) { pos.setXYZ(Lo.blob0, SHADOW_DIR[0] * off, 0.5, SHADOW_DIR[1] * off); col.setW(Lo.blob0, bA); continue; }
    const t = (i - 1) / DECAL.blobSeg * Math.PI * 2;
    let x = Math.cos(t) * DECAL.blobX * wide, z = Math.sin(t) * DECAL.blobZ * wide;
    const along = x * SHADOW_DIR[0] + z * SHADOW_DIR[1];
    x += SHADOW_DIR[0] * along * (stretch - 1); z += SHADOW_DIR[1] * along * (stretch - 1);
    pos.setXYZ(Lo.blob0 + i, x + SHADOW_DIR[0] * off, 0.5, z + SHADOW_DIR[1] * off);
  }
  // rings and chevron fade out on death
  const ringA = dead ? 0 : 1;
  for (let i = 0; i < DECAL.seg * 2; i++) { col.setW(Lo.ring0 + i, 0.9 * ringA); col.setW(Lo.under0 + i, 0.45 * ringA); }
  const R0 = DECAL.chevR, tip = R0 + DECAL.chevLen, notch = R0 + 1.1, w = DECAL.chevW / 2;
  chevPt(pos, Lo.chev0, 0, tip, 0, ca, sa); chevPt(pos, Lo.chev0, 1, R0, -w, ca, sa); chevPt(pos, Lo.chev0, 2, notch, 0, ca, sa); chevPt(pos, Lo.chev0, 3, R0, w, ca, sa);
  for (let i = 0; i < 4; i++) col.setW(Lo.chev0 + i, 0.9 * ringA);
  // foot patches (HQ): soft contact shadows under each shoe
  if (Lo.feet0 >= 0) {
    for (let f = 0; f < 2; f++) {
      const foot = r.bones[FEET[f]];
      _v1.set(3.0, -3.6, 0).applyMatrix4(foot.matrixWorld);
      _v2.set(1, 0, 0).transformDirection(foot.matrixWorld); _v2.y = 0; _v2.normalize();
      const lift = Math.max(0, _v1.y), al = dead ? 0 : 0.45 * clamp(1 - lift / 3, 0, 1);
      const fx = _v2.x, fz = _v2.z, sx = -fz, sz = fx, hl = DECAL.footL, hw = DECAL.footW, cx = _v1.x - p.x, cz = _v1.z - p.y;
      const base = Lo.feet0 + f * 4;
      pos.setXYZ(base, cx + fx * hl - sx * hw, 0.55, cz + fz * hl - sz * hw);
      pos.setXYZ(base + 1, cx + fx * hl + sx * hw, 0.55, cz + fz * hl + sz * hw);
      pos.setXYZ(base + 2, cx - fx * hl + sx * hw, 0.55, cz - fz * hl + sz * hw);
      pos.setXYZ(base + 3, cx - fx * hl - sx * hw, 0.55, cz - fz * hl - sz * hw);
      for (let k = 0; k < 4; k++) col.setW(base + k, al);
    }
  }
  pos.needsUpdate = true; col.needsUpdate = true;
}

/* ---------------- lighting uniforms (§3.8) ---------------- */
const LT = TUNE.light;
const FILL_D = new THREE.Color(LT.fillDay[1]).multiplyScalar(LT.fillDay[0]), FILL_N = new THREE.Color(LT.fillNight[1]).multiplyScalar(LT.fillNight[0]);
const RIM_D = new THREE.Color(LT.rimDay[1]).multiplyScalar(LT.rimDay[0]), RIM_N = new THREE.Color(LT.rimNight[1]).multiplyScalar(LT.rimNight[0]);
const SHEEN = new THREE.Color(LT.sheenCol);
function updateUniforms(r, p, ctx, realDt) {
  const dk = clamp(ctx && Number.isFinite(ctx.dk) ? ctx.dk : 0, 0, 1);
  FRANK_U.uFill.value.copy(FILL_D).lerp(FILL_N, dk);
  FRANK_U.uRim.value.copy(RIM_D).lerp(RIM_N, dk);
  FRANK_U.uRimFloor.value = lerp(LT.rimFloorDay, LT.rimFloorNight, dk);
  FRANK_U.uSheen.value.copy(SHEEN).multiplyScalar(lerp(LT.sheenDay, LT.sheenNight, dk));
  if (ctx && ctx.sun && ctx.camera) {
    _v1.subVectors(ctx.sun.position, ctx.sun.target.position).normalize();
    FRANK_U.uKeyDirV.value.copy(_v1).transformDirection(ctx.camera.matrixWorldInverse);
  }
  FRANK_U.uFlash.value = Math.min(LT.flash, r.st.uFlash);
  const wetT = G.rainLevel || 0;
  r.st.wet += (wetT - r.st.wet) * (1 - Math.exp(-realDt / LT.wetTau));
  FRANK_U.uWet.value = r.st.wet;
}

/* ---------------- debug poses (harness only) ---------------- */
function applyDebugPose(r, aR, aL) {
  const B = r.bones, P = DBG.pose;
  if (!P) return;
  if (P === 'armsUp') { for (const a of [aR, aL]) { a.flex = 165; a.abd = 25; a.elbow = 15; a.twist = 0; } }
  if (P === 'deepFlex') { for (const a of [aR, aL]) { a.flex = 60; a.abd = 10; a.elbow = 140; } B.pelvis.position.y -= 14; }
  if (P === 'twist80') { setSpine(B.spine1, 0, 35, 0); setSpine(B.spine2, 0, 45, 0); for (const a of [aR, aL]) { a.flex = 35; a.abd = 30; a.elbow = 60; } }
  if (P === 'crouch') { B.pelvis.position.y -= 9; setSpine(B.spine2, 12, 0, 0); for (const a of [aR, aL]) { a.flex = 30; a.elbow = 50; } }
}
/** Harness only: small axes at every socket (hands, head, chest, pelvis, knees, gun muzzles). Never created otherwise. */
function gizmos(r, on) {
  if (!on) { for (const h of r.gizmos || []) { h.removeFromParent(); h.dispose(); } r.gizmos = null; return; }
  r.gizmos = [];
  const add = (bone, o) => { const b = r.bones[bone]; if (!b) return; const h = new THREE.AxesHelper(2.5); h.position.set(o[0], o[1], o[2]); b.add(h); r.gizmos.push(h); };
  add('handR', SOCKETS.hand.grip); add('handL', [SOCKETS.hand.grip[0], SOCKETS.hand.grip[1], -SOCKETS.hand.grip[2]]);
  add('head', SOCKETS.head.eye); add('head', SOCKETS.head.top);
  for (const o of Object.values(SOCKETS.spine2)) add('spine2', Array.isArray(o) ? o : o.at);
  for (const o of Object.values(SOCKETS.pelvis)) add('pelvis', o);
  add('shinL', [SOCKETS.shin.kneeTop[0], SOCKETS.shin.kneeTop[1], -SOCKETS.shin.kneeTop[2]]); add('shinR', SOCKETS.shin.kneeTop);
  for (const g of ['pistol', 'shotgun', 'rifle']) { add(g, [0, 0, 0]); add(g, SOCKETS[g].muzzle); }
}
export function setFrankDebug(opts = {}) {
  if ('pose' in opts) DBG.pose = opts.pose || null;
  if (opts.resetStats) DBG.resetStats = true; // harness: zero the drift statistics on the next frame
  if ('gizmos' in opts) DBG.gizmos = !!opts.gizmos;
  if ('twistLog' in opts) DBG.twistLog = opts.twistLog; // (harness: an array the swivel clamp logs its misses into)
  if (opts.fidget) DBG.fidget = opts.fidget; // (harness: play this fidget now, if he may fidget)
  if (opts.contra) DBG.contra = true; // (harness: switch the contrapposto's loaded side now)
  if ('idleLife' in opts) TUNE.enable.idleLife = !!opts.idleLife; // (harness: the idle life's isolation switch)
  if ('perfLog' in opts) DBG.perfLog = opts.perfLog; // (harness: an array every poseFrank's ms is pushed into, §6)
  return { ...DBG };
}

/* ---------------- effect anchors, tracers, pips ---------------- */
export function frankFx(r) { return r.fx; }
const TRACE = new WeakMap();
function convPt(rec, sx, sy, out) {
  const k = 1 - ss(0, 120, Math.hypot(sx - rec.b0x, sy - rec.b0y));
  return out.set(sx + rec.ox * k, 30 + rec.oy * k, sy + rec.oz * k);
}
/** A player bullet → converged drawn head and tail (§5.4). Returns false to skip it this frame. */
export function frankTracer(r, b, outHead, outTail) {
  let rec = TRACE.get(b);
  const fx = r.fx;
  if (!rec) {
    rec = { b0x: b.x, b0y: b.y, ox: 0, oy: 0, oz: 0 };
    if (fx.valid) { rec.ox = fx.muzzle.x - b.x; rec.oy = fx.muzzle.y - 30; rec.oz = fx.muzzle.z - b.y; }
    TRACE.set(b, rec);
  }
  const dx = b.x - (b.px ?? b.x), dy = b.y - (b.py ?? b.y);
  convPt(rec, b.x, b.y, outHead);
  // the tail never starts behind the first sighting (the muzzle)
  let tx = b.x - dx * 2.2, ty = b.y - dy * 2.2;
  const along = (tx - rec.b0x) * dx + (ty - rec.b0y) * dy;
  if (along < 0 && (dx || dy)) { tx = rec.b0x; ty = rec.b0y; }
  convPt(rec, tx, ty, outTail);
  if (fx.valid && outHead.distanceTo(fx.muzzle) < 2) return false;
  return true;
}
export function frankPipY(r) { return Number.isFinite(r.st.pipY) ? r.st.pipY : 82; }

/* ---------------- prewarm ---------------- */
export function prewarmFrank(R, scene, camera, q) {
  try {
    const r = frankRig({ q: !!q, young: !!G.prequel, carry: null });
    const holder = new THREE.Group(); holder.add(r.g); r.body.position.set(0, -9999, 0); r.body.updateMatrixWorld(true);
    const done = () => { try { r.dispose(); } catch { /* ignore */ } };
    if (R && R.compileAsync) R.compileAsync(holder, camera, scene).then(done, done); else done();
    // the Low key is built in idle time now, not synchronously on the first autoLow flip (when the device already struggles)
    if (!q) {
      const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback : (f) => setTimeout(f, 3000);
      idle(() => { try { frankAssets(true, !!G.prequel); } catch { /* built on demand instead */ } });
    }
  } catch (e) { /* never throws */ }
}

/* ---------------- debug snapshot (§7.3) ---------------- */
const _dbA = V(), _dbB = V(), _dbC = V(), _dbQ = new THREE.Quaternion();
/** The lowest of the ground clamp's tracked points (world y). */
function lowestPoint(r) { let lo = Infinity; for (const c of CLAMP_PTS) { const y = bonePoint(r, c[0], c[1], c[2], c[3], _dbA).y; if (y < lo) lo = y; } return round2(lo); }
/** The eye (head socket) against the held gun's bore line: [lateral (+ = right of the bore), up (above it), along]. */
function eyeToBore(r, w) {
  const B = r.bones, g = B[w], Sk = SOCKETS[w];
  if (!g || !Sk || g.scale.x < 0.5 || r.st.inHand !== w) return null;
  const e = SOCKETS.head.eye;
  bonePoint(r, 'head', 1.0 + e[0], 63 + e[1], e[2], _dbA);
  g.matrixWorld.decompose(_dbB, _dbQ, _s1);
  _dbC.set(0, Sk.bore, 0).applyQuaternion(_dbQ).add(_dbB); // a point on the bore line
  _dbA.sub(_dbC);
  const along = _dbA.dot(_v1.set(1, 0, 0).applyQuaternion(_dbQ)), up = _dbA.dot(_v2.set(0, 1, 0).applyQuaternion(_dbQ)), lat = _dbA.dot(_v3.set(0, 0, 1).applyQuaternion(_dbQ));
  return [round2(lat), round2(up), round2(along)];
}
/** How far the bore line passes from the sim's aim point (p + D·dir(p.angle) at y 30): ~0 when converged. */
function boreMiss(r, p, w) {
  const fx = r.fx, st = r.st;
  if (!fx.valid || fx.weapon !== w) return null;
  const a = p.angle || 0;
  _dbA.set(p.x + st.aimD * Math.cos(a), 30, p.y + st.aimD * Math.sin(a)).sub(fx.muzzle);
  const along = _dbA.dot(fx.bore);
  return round2(_dbA.addScaledVector(fx.bore, -along).length());
}
/** The hands against the gun: the right grip point to the gun's grip, the left grip point to the support/forend socket. */
function handErr(r, w) {
  const B = r.bones, g = B[w];
  if (!g || g.scale.x < 0.5 || r.st.inHand !== w) return null;
  bonePoint(r, 'handR', 0.3 + GRIPR[0], 33 + GRIPR[1], 11 + GRIPR[2], _dbA);
  _dbB.setFromMatrixPosition(g.matrixWorld);
  const eR = _dbA.distanceTo(_dbB);
  bonePoint(r, 'handL', 0.3 + GRIPL[0], 33 + GRIPL[1], -11 + GRIPL[2], _dbA);
  if (w === 'pistol') { const s = SOCKETS.pistol.support, o = AIM.pistol.support; _dbB.set(s[0] + o[0], s[1] + o[1], s[2] + o[2]).applyMatrix4(g.matrixWorld); }
  else if (w === 'shotgun') { const o = AIM.shotgun.forend; _dbB.set(o[0], o[1], o[2]).applyMatrix4(B.shotgunForend.matrixWorld); }
  else { const f = SOCKETS.rifle.forend, o = AIM.rifle.forend; _dbB.set(f[0] + o[0], f[1] + o[1], f[2] + o[2]).applyMatrix4(g.matrixWorld); }
  return [round2(eR), round2(_dbA.distanceTo(_dbB))];
}
function subState(r) {
  const B = r.bones, b = (n) => B[n].position.x - B[n].userData.bind.x;
  return { slide: round2(b('pistolSlide')), mag: B.pistolMag.scale.x > 0.5, forend: round2(b('shotgunForend')), boltX: round2(b('rifleBolt')), boltRot: round2(2 * Math.asin(clamp(Math.abs(B.rifleBolt.quaternion.x), 0, 1)) / DEG) };
}
// Read-only: it never changes the rig's state. maxStanceDrift is measured on the bones (the heel and the ball of every
// planted foot, after IK); eyeToBore arrives with M3's cheek weld.
const round2 = (v) => +v.toFixed(2);
export function frankDebug(r) {
  const st = r.st, p = G.player || {}, B = r.bones;
  const P = (name, x, y, z) => bonePoint(r, name, x, y, z, _v1).toArray().map(round2);
  const feet = FEET.map((n) => { _v1.set(0, -3.6, 0).applyMatrix4(B[n].matrixWorld); return _v1.toArray().map(round2); });
  const pel = _v2.setFromMatrixPosition(B.pelvis.matrixWorld);
  const weapon = st.weaponHeld || 'pistol', gun = B[weapon] || B.pistol, soc = SOCKETS[weapon] || SOCKETS.pistol;
  const mz = _v3.set(soc.muzzle[0], soc.muzzle[1], soc.muzzle[2]).applyMatrix4(gun.matrixWorld);
  const a = p.angle || 0, rx = mz.x - (p.x || 0), rz = mz.z - (p.y || 0);
  // the left hand in the root frame (so walking or turning is not "moving the hand"), against its idle-FK spot
  _m1.copy(B.root.matrixWorld).invert();
  const handL = bonePoint(r, 'handL', 0.3, 30, -11, _v4).applyMatrix4(_m1).toArray(), hl0 = r.handLRef;
  const ps = patchState(), ht = r.assets.hairTop;
  const loco = st.locoAt || 'idle', cs = st.coat, d3 = (v) => +(v / DEG).toFixed(1);
  return {
    kind: r.kind, skinned: !!r.mesh.isSkinnedMesh, q: r.q, young: r.young, serial: r.serial, bones: r.skeleton.bones.length, tris: r.assets.tris, verts: r.assets.verts,
    draws: [r.mesh, r.decal, r.debris, r.dust, r.cone].filter((o) => o && o.visible && (o !== r.debris || r.debris.count > 0)).length,
    patched: ps.ok && ps.compiled, full: st.stateF || 'none', upper: st.mel.ph ? 'melee' : st.sw.on ? 'swap' : st.rl.on ? 'reload' : st.act ? 'action' : st.aimW > 0.5 ? 'aim' : 'relaxed', loco, locoAt: loco,
    aimW: +st.aimW.toFixed(3), weapon, gunDriver: st.gunDriver || 'hand',
    muzzleWorld: mz.toArray().map(round2), muzzleRel: [round2(rx * Math.cos(a) + rz * Math.sin(a)), round2(mz.y), round2(-rx * Math.sin(a) + rz * Math.cos(a))],
    flashExpect: r.fx.valid ? r.fx.flashPos.toArray().map(round2) : null, lightOrigin: r.fx.valid ? r.fx.lightOrigin.toArray().map(round2) : null,
    headTop: round2(bonePoint(r, 'head', ht[0], ht[1], ht[2], _v4).y), pelvisY: round2(pel.y), feet, planted: [!!st.planted[0], !!st.planted[1]], contacts: st.contacts,
    maxStanceDrift: +st.maxStanceDrift.toFixed(3), plannerDrift: +st.planner.maxStanceDrift.toFixed(4), mode: st.mode, speed: round2(st.speed), drop: round2(st.drop.x),
    hipYaw: round2(st.hip.x / DEG), chestYaw: round2(st.chest.x / DEG), yawRate: round2(st.yawRate), turning: !!st.turning,
    coat: { a: Array.from(cs.a.slice(0, cs.n || 6), d3), b: Array.from(cs.b.slice(0, cs.n || 6), d3), g: Array.from(cs.g.slice(0, cs.n || 6), d3) },
    resets: st.resets, ikFails: st.ikFails, maxFootStep: round2(Math.max(0, st.maxFootStep)), minPelvisY: round2(st.minPelvisY), shoves: st.shoves, forced: st.planner.forced, pivots: st.planner.pivots,
    chestYawErr: round2(angleDiff(a + (st.bladeNow || 0) * DEG, st.chest.x) / DEG),
    handLMoved: round2(Math.hypot(handL[0] - hl0[0], handL[1] - hl0[1], handL[2] - hl0[2])), eyeToBore: eyeToBore(r, weapon), cpuMs: +st.cpuMs.toFixed(3),
    // M3: the gun and the hands on it
    inHand: st.inHand, slung: st.slung && B[st.slung] && B[st.slung].scale.x > 0.5 ? st.slung : null, conv: round2(st.conv / DEG), aimPitch: round2(st.aimPitch / DEG), aimD: round2(st.aimD),
    slung2: st.slung2 && B[st.slung2] && B[st.slung2].scale.x > 0.5 ? st.slung2 : null, faceYaw: round2(st.face.x / DEG), chestLag: round2(S.chestLag / DEG), flickK: round2(S.flickK), aimWb: round2(st.aimWb),
    port: round2(st.port.x), slideLocked: !!st.slideLocked, act: st.act, reload: st.rl.on ? { kind: st.rl.kind, weapon: st.rl.weapon, empty: st.rl.empty, f: round2(st.rl.f), tau: round2(st.rl.tau), cycle: st.rl.cycle, w: round2(GC.rl) } : null,
    swap: st.sw.on ? { from: st.sw.from, to: st.sw.to, f: round2(GC.swF) } : null, boreMiss: r.fx.valid ? round2(st.boreMissRest || 0) : null, boreMissLive: boreMiss(r, p, weapon), handErr: handErr(r, weapon),
    recoil: { pitch: round2(GC.rPitch), back: round2(GC.rBack), slide: round2(GC.slideX) }, sub: subState(r), lProp: GC.lProp,
    // M4: the actions
    actions: { dodge: st.dg.ph ? { variant: st.dg.hop ? 'hop' : 'dash', u: round2(st.dg.u), tail: st.dg.ph === 2 ? round2(st.dg.tailT) : null, lead: st.dg.lead } : null,
      melee: st.mel.ph ? { conn: st.mel.conn, u: round2(st.mel.u), cu: round2(MC.cu), w: round2(MC.w) } : null, takedown: st.td.ph ? { u: round2(st.td.u), cu: round2(TC.cu) } : null,
      chop: st.ch.ph ? { pick: st.ch.pick, ph: st.ch.ph, u: round2(st.ch.u) } : null, repair: st.rp.w > 0 ? { kind: st.rp.kind, w: round2(st.rp.w), dist: round2(st.rp.dist) } : null,
      tool: st.tool, stowed: st.stowed, draw: st.sw.on && st.sw.render ? round2(GC.swF) : null, hurt: st.hurt.t < 1 ? { zone: st.hurt.zone, kind: st.hurt.kind, s: st.hurt.s, A: round2(st.hurt.A), t: round2(st.hurt.t) } : null,
      revive: st.rev < 2 ? round2(st.rev) : null, sinceRevive: round2(Math.min(99, st.sinceRevive)), visible: r.body.visible,
      death: p.dead ? { variant: st.dth.variant, F: round2(st.dth.F / DEG), t: round2(st.deathT), lift: round2(st.dth.lift), gun: st.dth.gun.on ? { rest: st.dth.gun.rest, p: st.dth.gun.p.map(round2) } : null } : null },
    lowest: lowestPoint(r),
    // M5: life
    life: { contra: [round2(LV.cw), round2(LV.cS), st.lf.c.phase], glance: [round2(LV.gYaw), round2(LV.gPitch), round2(LV.pW)], fid: LV.fid ? [LV.fid, round2(LV.fu), round2(LV.fw)] : null,
      stroll: round2(LV.stroll), carry: round2(LV.carry), prowl: round2(LV.prowl), cover: LV.cover > 0 ? [round2(LV.cover), round2(LV.coverLow), round2(LV.pop)] : 0, low: round2(LV.low), hok: round2(LV.hok),
      reach: LV.reachShort ? [LV.reachShort, round2(LV.reachE)] : null, kneel: round2(LV.kneel), talk: round2(LV.talkW), phone: round2(LV.phone), item: LV.itemW > 0 ? [LV.item, round2(LV.itemW)] : null,
      abil: LV.abil || null, modal: LV.modal > 0 ? [LV.modalKind, round2(LV.modal)] : null, look: [round2(LV.lookYaw), round2(LV.lookPitch)], eye: LV.eye, chestYaw: round2(LV.chestYaw) },
    reachErr: st.reach.map(round2), debris: st.debrisN, debrisPts: Array.from({ length: Math.min(4, r.debris.count) }, (_, i) => { r.debris.getMatrixAt(i, _m1); return _v1.setFromMatrixPosition(_m1).toArray().map(round2); }), wrist: st.wrist.map((w) => w.map((v) => +v.toFixed(1))), wristMax: round2(st.wristMax), swivels: st.swivels, elbowClamps: st.elbowClamps, shots: st.shots,
    samples: {
      coatFront: P('spine1', 6.05, 41.6, 4.4), coatSide: P('pelvis', -3, 30, 10.6), trouser: P('shinR', 2.7, 6.5, 4.6), shirt: P('spine2', 6.2, 55.0, 0.4),
      face: P('head', 5.6, 66.6, 2.7), shoe: P('footR', 6.0, 2.3, 4.6), temple: P('head', 3.0, 70.4, 4.2), crown: P('head', -1.5, 74.4, 0),
    },
  };
}
