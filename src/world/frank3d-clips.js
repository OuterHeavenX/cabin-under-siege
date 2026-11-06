// Frank's look-and-feel numbers and clip data (3D view). PURE DATA plus tiny
// builders: no DOM, no game state. Every value that is a matter of taste lives in
// TUNE so it can be tuned without touching the systems. Tracks are arrays of keys
// [t, value, ease] (see frank3d-anim.js sample()); angles are in degrees.

export const TUNE = {
  enable: { coat: true, forelocks: true, idleLife: true, headLook: true, casings: true, cone: true }, // isolation switches
  colors: {
    // the portrait's coat is a near-black charcoal: a cool grey that stays neutral under the warm noon fill
    coat: '#4f4f56', coatHem: '#2e2c30', lining: '#6a2428', coatInside: '#2c2624', shirt: '#e8dcc8', skin: '#d9aa8c', skinWarm: '#d99a80',
    lips: '#b8765e', skinAO: '#8a5a44', trousers: '#3a4050', shoes: '#50301f', sole: '#2a1c15', hair: '#3f2d25', hairRoot: '#2a1c16',
    hairHi: '#6e4e3e', grey0: '#a49690', grey1: '#c4b6ae', hairYoung: '#3a2820', cuffInside: '#141110', button: '#2a2420', buttonRim: '#7a6a5e',
    steel: '#3c3e44', steelWorn: '#6a6e76', walnut: '#5a3420', brass: '#c9a43a', shell: '#c0392b',
    stubbleLow: '#a8907f', browLow: '#3a2a22',
  },
  // Night: a less saturated, lower fill keeps the coat blue-charcoal (not navy) and lets the moon-side rim do the reading.
  // (M2: the fill a little less blue again, '#c4cce6' → '#c8cad4', about the same luminance: in motion the navy coat merged
  // with the navy trousers and the stride stopped reading)
  light: { fillDay: [1.25, '#fff0e0'], fillNight: [1.5, '#c8cad4'], rimDay: [0.045, '#ffe0b8'], rimNight: [0.40, '#8fa8ff'],
           rimFloorDay: 0.20, rimFloorNight: 0.30, sheenDay: 0.30, sheenNight: 0.30, sheenCol: '#9a948e', fillSkin: '#ffe6d6', flash: 0.6, flashT: 0.08, wetTau: 2 },
  // Surfaces: (roughness, metalness, cloth/sheen, skin); the hair's slick lives in its painted highlight band, not a specular hotspot.
  surf: {
    wool: [0.95, 0, 0.55, 0], lining: [0.55, 0, 0, 0], trousers: [0.85, 0, 0.25, 0], shirt: [0.80, 0, 0.10, 0.3],
    skin: [0.58, 0, 0, 1], hair: [0.62, 0, 0, 0], shoes: [0.35, 0, 0, 0], sole: [0.80, 0, 0, 0], steel: [0.36, 0.35, 0, 0],
    wood: [0.50, 0, 0, 0], rubber: [0.60, 0, 0, 0], brass: [0.30, 0.60, 0, 0], scope: [0.08, 0.20, 0, 0], edge: [0.30, 0.35, 0, 0],
    lens: [0.2, 0, 1.0, 0], button: [0.45, 0, 0, 0],
  },
  blade: { pistol: 20, shotgun: 30, rifle: 38, relaxedLong: 10 },
  aimSocket: { pistolGrip: [21.5, 3.0, 1.0], pocketR: [3.0, 11.3, 6.0] },
  // high port (§4.8) [back along the bore, pitch up °, pocket drop]: the pistol comes back to the chest; a long gun keeps
  // its butt near the shoulder (12 u back put the grip out of the right hand's reach) and tips its muzzle up steeply, the
  // butt dropping off the shoulder, so a man 30 u ahead has the muzzle over his head, not through it
  highPort: { pistol: [12, 20, 0], long: [11, 70, 8], pistolSupportOff: 0 },
  // a draw-fire (a shot from the relaxed carry): the gun is on the line at once, the body comes in under it over T (O),
  // the support hand arrives over `support`
  drawSnap: { T: 0.15, support: 0.10 },
  // the long guns' cheek weld at any aim distance: per degree the gun pitches below refPitch (the 220 u aim), the neck and
  // head pitch down neck/head degrees and the shoulder pocket slides −pocket u forward (back) and +pocket up (measured:
  // the review's forward-and-down left the eye 4.2 u over the bore at 80 u; back-and-up keeps it 3.6–3.8 from 80 to 400)
  cheek: { refPitch: -7.3, neck: 0.6, head: 0.4, pocket: -0.1 },
  // a fast flick: the gun's yaw stays within yaw* (°) of the chest's aim line (a shouldered gun turns with the torso, the
  // head leads); a long gun fades to low ready as the chest
  // lags from lowFrom to lowTo (°) behind the face
  flick: { yawLong: 15, yawLow: 8, yawPistol: 60, lowFrom: 30, lowTo: 70 },
  convMaxDeg: 7, aimDist: { min: 60, max: 400, fallback: 220 },
  // pelvisDrop*: the reach fix (fast down, slow up ω); dropMax: the most it squats him (a foot further off steps instead);
  // dropRate: the fastest it drops (u/s). (The spec's ω 30 spring for the way down lagged the need by a few frames, and
  // a planted foot the leg can't reach slides: down is immediate, but rate-limited and capped.)
  springs: { face: 25, chest: 30, chestFlick: 55, head: 40, hipMove: 14, hipIdle: 12, hipTurn: 20, dashFace: 60, pelvisDropFast: 30, pelvisDropSlow: 8, dropMax: 4, dropRate: 150 },
  // rest: the resting flare (3°: the portrait's coat hangs straight; stride clearance is the knee clamp's and M2's job).
  // knee clamp: a panel pushed by a bent knee is capped (High/Low), half its excess goes to its neighbours, and on High the
  // lower panel counter-rotates so it drapes over the knee instead of continuing the plane.
  // The skirt pendulums (§4.21; angles in degrees, gains per u/s²). rest: the resting flare (3°: the portrait's coat hangs
  // straight). own/neighbour: the target coupling (spec 0.7/0.15; stronger so the back bells as one skirt, not two tails).
  // fling: the turn's centrifugal bell, atan(fling·ψ'²) up to flingMax (the skirt's radius over the pendulum's g·L). The
  // spec's linear 6°/(rad/s) belled the coat 30° through any ordinary 90° turn; this keeps a 90° turn near 10° and gives the
  // 180° flick its full bell for the moment it lasts. lowerGain: how far the lower panel curls out with the upper's flare; collision: the gap kept off the knees
  // and shins.
  // yawAccGain: the spec's 0.7 (per rad/s²) against the 400 rad/s² clamp saturated β at its limit on all six chains in any
  // flick (an equilibrium of 2.2 rad): 0.07 gives about 10°. bLim/bLimLow/bLimFront: β's clamps (spec ±30°: the twist
  // opened tears at the Low waist seam and turned the front flaps edge-on); pairA/pairALow/pairB: neighbouring panels never
  // shear apart further than this (one skirt, never single paper blades). dragBackFront: the front flaps' trailing drag cap.
  // Front panels (the flaps at the opening): more damping (frontZeta; the spec's 0.30 sat near resonance with the 1.6 Hz
  // stride and flapped them like wings), a smaller knee gap (spec 3.0), their knee bound capped at kneeMax (half the excess
  // flares the side neighbour; the knee comes forward through the opening instead), their lower panel's shin bound at
  // loGFront, and their lower panel may bend back in to gloFront (spec −10°) so the hem drapes over the knee.
  coat: { hz: 1.8, hzRain: 1.5, zeta: 0.30, frontZeta: 0.5, lowerHz: 2.6, lowerZeta: 0.35, rest: 3, drag: 38, dragFront: -10, dragBackFront: 14,
          fling: 0.004, flingMax: 30, accGain: 0.012, yawAccGain: 0.07, gap: 1.5, dash: 20, twist: 38, lowerGain: 0.35, lowerAcc: 0.5,
          flutter: 4, storm: 6, own: 0.56, neighbour: 0.22, edgeOwn: 0.6, bLim: 14, bLimLow: 10, bLimFront: 8, pairA: 16, pairALow: 20, pairB: 8,
          kneeMax: 28, loGFront: 15, gloFront: -18, lowerCap: 25, droop: 0.6, droopAt: 32 },
  // Forelocks (HQ): 2-DOF springs on the two strands; hang: how much of the head's pitch gravity takes back out of them.
  // (the spec's gains, acc 0.01 and angAcc 0.05, moved them about 0.3° in a jog: invisible. These give a stop or a flick
  // about 10–15°, settling within 0.4 s)
  forelock: { hz: 4, zeta: 0.3, max: 30, acc: 0.06, angAcc: 0.25, hang: 0.35 },
  // Locomotion feel beyond the gait table: acceleration lean (degrees per u/s², clamped: only a little back lean while
  // braking, the stop's momentum is the pendulum's job), banking into curves, the turn-in-place dip and triggers
  // (degrees, seconds). counterJog: the extra spine2 counter-swing in a jog (spine2 −(0.6 + this)·yawOsc: the shoulders
  // turn against the hips). hipHold*: how far the hips may turn off a planted foot (moving / idle) before they wait for
  // the feet. stillSettle: how long he stands in a split stance before the settle step (spec 0.25: it read as a freeze).
  // The wall push marches in place with the walk column's body (wallSpeed) and leans and presses into the input.
  // The stop: the amplitudes and the crouch let go on slower springs (stopRelease, heightRise ω), the upper body pitches
  // on with its momentum (a pendulum ω 2π·2.2, kicked by stopKick °/s at 125 u/s) and the pelvis absorbs the last plant.
  // dodge*: the M2 placeholder (duck and lean into the dash) until M4's dash and back-hop clips.
  loco: { counterJog: 0.9, accLean: 0.0035, accLeanMin: -1.5, accLeanMax: 7, bank: 0.003, bankMax: 7, leanHz: 1.6, turnDip: 0.6,
          turnHard: 55, turnSoft: 25, turnSoftT: 0.4, stillSettle: 0.12, hipHoldMove: 55, hipHoldIdle: 50,
          wallLean: 12, wallSpeed: 70, wallPush: 1.5, stopRelease: 7, heightRise: 5, stopKick: 170, stopZeta: 0.45, absorb: 1.5, absorbT: 0.16,
          dodgeDrop: 4, dodgeLean: 10,
          // relaxed arm swing on top of the gait table: the swing sits back of the hang by `back`×amplitude, the elbow closes
          // in front, the upper arms roll in (a true twist, °) in a jog so the forearms swing across the body; the gun arm
          // swings at half with a more open elbow; strafing all but stops the swing and keeps the arms in by the body
          arm: { back: 0.3, elbowFwd: 2.0, elbowFwdGun: 0.8, elbowMax: 115, inL: 32, inR: 16, gunArm: 0.5, gunElbow: 0.75, sprintAbdL: 4, sprintAbdR: 3, strafeDamp: 0.85, strafeAbd: -4 } },
  // the upper arm's twist about its own axis (the arm IK's swivel clamp; the spec's 45° fought the Weaver's across-the-body
  // support arm, whose hand is fixed by the gun: the wrist then took the excess)
  armTwistMax: 45,
  // the wrist's soft limit (§4.22 ±70): past `knee`° of bend the hand turns about its grip toward the forearm, toward `max`
  wristLimit: { knee: 58, max: 70 },
  // how far (°) a hand may turn about its grip hole's axis to keep the wrist straight over the forearm (the fingers slide
  // round a forend or a stock's grip; a pistol grip barely allows it)
  // (support 20, not 30: the pistol's support wrist bends 17° instead of 49°; the forend keeps 70: less let the left forearm
  // roll past 130° to hold the forend)
  gripRoll: { pistol: 10, long: 40, forend: 70, support: 20, knob: 45 },
  headScale: 1.06, // the head bone's scale about its pivot (Y 63): reads at phone size; the hair top stays under 76
  catchUp: 0.035, blinkHz: 20, blinkHurtWindow: 1.0, reviveBlink: 2.5,
  pipLowPass: 0.25, shellHandScale: 2.0,
  // the reload layer's fade in (s): the spec's 0.1 left the hand's first trip (support → pocket, 0.12 s on a fast reload)
  // mostly inside the fade, so the mag-out read late
  reloadIn: 0.06,
  // the pistol's wait between the seat and the sim's reload end: the gun up to a high ready (tactical) or held by the chest
  // for the rack (empty), the head up and scanning ±scanYaw° (period scanT) from scanFrom after the seat, and with time to
  // spare a press-check (the support hand touches the slide for checkT) at checkAt after the seat
  // (the tactical scan sweeps the gun scanGun° and the chest scanChest° with the head: a head-only ±12° scan was invisible
  // from the high camera and the wait read as a stall)
  pistolWait: { highReady: 0.25, emptyHold: 0.6, scanFrom: 0.15, scanYaw: 20, scanGun: 9, scanChest: 6, scanEmpty: 0.6, scanT: 0.9, checkAt: 0.32, checkT: 0.18 },
};

/* ---------------- sockets (§2.3): offsets from a bone's pivot in its local frame ---------------- */
export const SOCKETS = {
  // pocketR: the long guns' butt out on the shoulder (the review: at y 12.1 it sat in the collarbone hollow and the face
  // hid behind the stock); the head comes to the stock instead (AIM neck/head roll 12, head pitch 9)
  spine2: { pocketR: [3.0, 11.3, 6.0], holster: [1.5, 10.0, -6.0],
            // the slung long gun's grip point and bore direction: diagonal across the back, the muzzle out over the LEFT
            // shoulder, flat enough that from the high camera it never stands up behind his head like an antenna
            // (the grip low at the right kidney, so the draw is a reach down and back like a back-pocket draw, not up behind
            // the neck; the muzzle still out over the left shoulder, steeper). backSling2: a second owned long gun rides
            // beside the first, 2.8 further out and a little lower, both grips at the right kidney (each draw starts from the
            // gun it takes)
            // (dir 49° off vertical: the review's 37° stood the gun up behind him like a mast from the high camera)
            backSling: { at: [-7.0, -11.0, 6.6], dir: [-0.12, 0.66, -0.74] }, backSling2: { at: [-9.6, -12.2, 5.8], dir: [-0.08, 0.68, -0.73] },
            lapelL: [6.2, 9.5, -3.0],
            mouth: [6.4, 15.5, -1.0], earL: [2.0, 18.0, -5.0], chestPocket: [6.0, 8.0, -4.0] },
  // shellBelt: the shotgun reload's fetch spot on the left hip, 1 u out from the coat
  pelvis: { pocketL: [4.0, -1.0, -8.8], pocketR2: [4.0, -1.0, 8.8], sideL: [2.0, 7.5, -8.5], shellBelt: [6.5, 3.0, -9.5] },
  shin: { kneeTop: [2.5, 1.0, 1.0] },
  // Hand-local (pivot = wrist). The held gun's frame relative to the hand: gun +X = hand −Y, gun +Y = hand +X,
  // gun +Z = hand +Z, then the rake about gun Z. The grip sits in the curled fingers, palm-side of the palm.
  hand: { grip: [0.45, -3.65, -1.25], rakeDeg: 17 }, // the centre of the hole the curled mitten closes round (frank3d-geo buildHand)
  head: { eye: [5.4, 4.8, 0], top: [0.3, 12.0, 0] },
  pistol: { bore: 2.3, muzzle: [7.6, 2.3, 0], slideRear: [-2.9, 2.3, 0], support: [0.3, -0.4, -1.7], rack: [-2.4, 2.6, 0],
            magWell: [-0.9, -2.6, 0], gripAxis: [-0.29, -0.96, 0], lens: [5.6, 0.9, 0], port: [1.2, 3.0, 0.8], flash: 18 },
  shotgun: { bore: 2.8, muzzle: [32.0, 2.8, 0], butt: [-10.0, 1.0, 0], forend: [15.0, 1.4, 0], loadPort: [3.5, 1.2, 0],
             port: [3.0, 3.4, 0.9], lens: [30.5, 1.6, 0], flash: 32 },
  rifle: { bore: 2.6, muzzle: [34.0, 2.6, 0], butt: [-12.0, 0.6, 0], forend: [13.0, 1.2, 0], boltKnob: [-2.0, 2.4, 2.3],
           port: [1.0, 3.4, 0.9], scopeY: 4.5, lens: [22.0, 1.0, 0], flash: 26 },
};

/* ---------------- stances (§4.6): neutral foot plants in the root frame [x, z, toe-out°] ---------------- */
export const STANCES = {
  relaxed: { L: [0.8, -4.4, 7], R: [-0.4, 4.4, 7] },
  pistol: { L: [2.5, -5.0, 15], R: [-2.5, 5.2, 35] },
  long: { L: [5.0, -5.0, 15], R: [-4.0, 5.0, 40] },
};

/* ---------------- gait table (§4.6), piecewise-linear in measured speed ---------------- */
export const GAIT = {
  speed: [0, 40, 70, 125, 185],
  sigma: [0.58, 0.58, 0.50, 0.34, 0.30],
  height: [-0.2, -1.2, -2.5, -3.5, -4.5],
  bob: [0, 0.4, 0.5, -1.0, -1.3],
  yawOsc: [0, 4, 5, 7, 9],
  roll: [0, 2, 3, 3, 4],
  pitch: [0, 1, 2, 6, 14],
  toeOut: [7, 6, 5, 3, 0],
  halfWidth: [4.4, 4.2, 4.0, 3.4, 2.8],
  heel: [8, 8, 12, 12, 4],
  toeOff: [-18, -18, -22, -28, -35],
  armSwing: [0, 8, 14, 24, 45],
  // (the spec's jog 40° read as a straight-armed reach from the high camera: a jogging elbow sits near 65°)
  elbowBase: [12, 14, 18, 65, 85],
  // where the foot lands, as a fraction of the stance travel ahead of the hip (0.5 = centred): a jog lands nearer under
  // the body and pushes off further behind, so the late swing never over-reaches
  land: [0.5, 0.5, 0.5, 0.42, 0.40],
  // the pelvis shifts over the stance foot (weight shift), most in a walk
  sway: [0, 1.3, 1.2, 0.8, 0.5],
};
/** Swing trajectories over swing progress u: [u, X progress, Y lift, P pitch ('toe' / 'heel' = gait value)]. */
export const SWING = {
  walk: [[0, 0, 1.5, 'toe'], [0.25, 0.15, 4.0, -20], [0.5, 0.50, 2.5, -5], [0.75, 0.82, 1.2, 5], [0.92, 0.97, 0.4, 'heel'], [1, 1, 0, 'heel']],
  jog: [[0, 0, 2.0, 'toe'], [0.25, 0.18, 9.0, -25], [0.5, 0.50, 6.0, -5], [0.75, 0.84, 3.0, 8], [0.92, 0.98, 0.8, 12], [1, 1, 0, 12]],
  run: [[0, 0, 3.0, 'toe'], [0.25, 0.12, 16, -35], [0.5, 0.52, 12, -10], [0.75, 0.90, 5, 5], [0.92, 1.0, 1.5, 4], [1, 1, 0, 4]],
  // backing up is a walk run backwards: the toes land first (−5) and the heel leaves last, so the stance ends rolled back
  // onto the heel (toes up: gaitInputs sets 'toe' to +10 for this set) instead of a toe-off pushing the foot further ahead
  back: [[0, 0, 1.0, 'toe'], [0.30, 0.25, 5.0, -5], [0.55, 0.55, 5.5, 0], [0.80, 0.88, 2.5, -8], [1, 1, 0, -5]],
};
/** Piecewise-linear lookup in the gait table. */
export function gaitAt(key, speed) {
  const S = GAIT.speed, V = GAIT[key];
  if (speed <= S[0]) return V[0];
  for (let i = 1; i < S.length; i++) if (speed <= S[i]) return V[i - 1] + (V[i] - V[i - 1]) * (speed - S[i - 1]) / (S[i] - S[i - 1]);
  return V[V.length - 1];
}

const DEG = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** The step planner's per-frame input (one object, reused; frank3d.js and the unit test fill it the same way). */
export function makePlannerInput() {
  return { dt: 0, gait: false, phi: 0, rate: 10, vx: 0, vz: 0, rx: 0, rz: 0, hipYaw: 0, hipY: 34, sigma: 0.5, land: 0.5, half: 4.4, toeOut: 0, lift: 1,
    toe: 0, heel: 0, setA: SWING.walk, setB: null, setW: 0, pitchScale: 1, neutral: [[0, 0, 0, 0], [0, 0, 0, 0]],
    turning: false, turnSide: 1, still: 0, stanceChanged: false, settleT: 0.25, startLead: -1 };
}
/**
 * The gait table's inputs for a measured speed (u/s): stance fraction, stance half-width, toe-out, heel and toe-off
 * pitches, the swing set (walk → jog → run, or 'back' for the backpedal) and the lift scale. A wall push runs the
 * table at speed 0: he marches in place, in step with the sim's footsteps.
 */
export function gaitInputs(I, speed, back = false, wall = false) {
  const s = wall ? 0 : speed;
  I.sigma = gaitAt('sigma', Math.max(40, s)); I.land = gaitAt('land', s); I.half = gaitAt('halfWidth', s); I.toeOut = gaitAt('toeOut', s) * DEG;
  I.heel = gaitAt('heel', Math.max(40, s)) * DEG; I.toe = gaitAt('toeOff', Math.max(40, s)) * DEG;
  if (back) { I.setA = SWING.back; I.setB = null; I.setW = 0; I.toe = 10 * DEG; }
  else if (s <= 70) { I.setA = SWING.walk; I.setB = null; I.setW = 0; }
  else if (s <= 125) { I.setA = SWING.walk; I.setB = SWING.jog; I.setW = (s - 70) / 55; }
  else { I.setA = SWING.jog; I.setB = SWING.run; I.setW = clamp01((s - 125) / 60); }
  // (a wall push marches with clear lifts: the spec's 0.3 read as standing still)
  I.lift = (wall ? 0.7 : Math.min(1, Math.max(0.3, speed / 60))) * (back ? 0.8 : 1);
  I.pitchScale = wall ? 0.4 : Math.min(1, Math.max(0.35, speed / 50));
  return I;
}

/* ---------------- idle posture and breath (§4.7) ---------------- */
export const IDLE = {
  pelvisDy: -0.6, lean: 2, clavProt: 5, neckPitch: 8, headPitch: -6,
  armR: { flex: 8, abd: 9, twist: 0, elbow: 18, wflex: -14, wdev: 0, wroll: 0 },
  armL: { flex: 4, abd: 9, twist: 0, elbow: 12, wflex: 4, wdev: 0, wroll: 0 },
  // relaxed with a long gun in hand (low ready, the muzzle down and forward): the right arm's FK
  armRLong: { flex: 14, swing: 0.3, abd: 12, elbow: 34, wflex: 44 },
  // Breath: inhale over 40% of the period (S), exhale over 60% (S).
  breath: { calm: 4.5, combat: 2.4, winded: 1.4, steady: 6.0, lowHpDiv: 1.6, amp: { calm: 1, exerted: 2, lowHp: 2, steady: 0.5 } },
  breathOut: { scaleX: 0.03, posY: 0.15, spine2Pitch: -0.8, clavElev: 1.5, headPitch: 0.4 },
};
/* ---------------- aim profiles (§4.8): pose numbers per weapon ---------------- */
// boreY: the expected bore height (the aim pitch looks down to the y = 30 mouse plane from it; M3 measures it on the
// live muzzle). grip: the pistol's grip point in aim frame A (fwd, up, right); pocket: the long guns' butt sits in the
// spine2 socket pocketR. Poles are in A (fwd, up, right). The head keeps the face readable from the high camera: the long
// guns bring the stock up to the cheek (the pocket sits high) and the head drops onto it (the cheek weld: frankDebug
// eyeToBore measures it).
export const AIM = {
  pistol: { stance: 'pistol', boreY: 50.8, pelvisDy: -1.5, spine1Pitch: 2, spine2Pitch: 4, spine2Roll: 0, neckPitch: 0, neckRoll: 0, headPitch: 2, headYaw: 0, headRoll: 0,
            grip: [21.5, 3.0, 1.0], clavR: [6, 2], clavL: [10, 2], poleR: [-0.3, -1, 0.6], poleL: [0.2, -1, -0.8], support: [0.4, -1.0, 1.1] },
  shotgun: { stance: 'long', boreY: 58, pelvisDy: -2, spine1Pitch: 3, spine2Pitch: 7, spine2Roll: 5, neckPitch: 19, neckRoll: 12, headPitch: 9, headYaw: 6, headRoll: 12,
             clavR: [4, 4], clavL: [10, 2], poleR: [-0.3, -0.2, 1.0], poleL: [0, -1, -0.3], forend: [0, -0.9, 0] },
  rifle: { stance: 'long', boreY: 58, pelvisDy: -2, spine1Pitch: 3, spine2Pitch: 8, spine2Roll: 6, neckPitch: 18, neckRoll: 12, headPitch: 9, headYaw: 6, headRoll: 12,
           clavR: [4, 4], clavL: [10, 2], poleR: [-0.3, -0.2, 1.0], poleL: [0, -1, -0.3], forend: [0, -0.9, 0] },
};
AIM.long = AIM.shotgun;
/**
 * Relaxed carry (§4.8). Pistol: the gun rides the FK hand. Long guns at low ready: the shouldered constraint with the
 * pocket lowered `drop` and the muzzle down `pitch` about the butt, both hands on the gun (poles in A). Sprinting with a
 * long gun: port arms, the gun in the spine2 frame at `at`, pitch/yaw (muzzle up-left across the chest).
 */
export const RELAXED = {
  // (the spec's −35° put the forend 3 u out of the support hand's reach: −28° and turned 14° across the body)
  long: { drop: 4, pitch: -28, yaw: -14, poleR: [-0.4, -1, 0.5], poleL: [0.1, -1, -0.5] },
  port: { at: [7.0, 2.0, 5.0], pitch: 45, yaw: -75, roll: 0, poleR: [-0.4, -1, 0.6], poleL: [0.3, -0.6, -1] },
};
/**
 * Gun poses for reloads and swaps (§4.10, §4.11): frame 'A' (aim frame: fwd, up, right; angles relative to the aim yaw)
 * or 'spine2' (the chest bone's frame). at: the gun origin (= the right-hand grip point); yaw/pitch/roll in degrees
 * (+yaw turns the muzzle to his right, +pitch muzzle up, +roll the top toward his right); blade: the extra chest turn.
 */
export const GUN_POSES = {
  // (2.5 further out than the spec's A(13, −1, −1.5): the rack's overhand grip on the slide's rear sat inside the coat)
  pistolReload: { frame: 'A', at: [15.5, -1.0, -1.5], yaw: -10, pitch: 12, roll: -25, blade: 10 },
  // (up at the sternum, rolled 60° so the loading port faces up and out to the high camera, the muzzle turned across his
  // front, instead of the spec's belly pose, which read as a static low-ready hold from above; every shell's push nods
  // the gun: jigPitch° per unit of the jiggle; the chest and head turn to each fetch from the belt)
  // (at spine2 y +3.5: the review's −1.5 still sat at the belt line, where the hand's trip to the hip was a few units
  // behind the gun)
  shotgunReload: { frame: 'spine2', at: [12.0, 3.5, 2.5], yaw: -30, pitch: 8, roll: 60, blade: 5, jig: -2.2, jigPitch: 12, headPitch: 10,
                   fetch: [[0.15, 0], [0.55, 1, 'S'], [1.0, 0, 'S']], fetchS2Roll: -7, fetchS2Yaw: -12, fetchHeadYaw: -18, poleL: [0.3, -0.6, -1] },
  // (further out than the spec's A(10, −6, 4): with the bolt open and back 4.5 the knob and the right hand sat in his belly)
  rifleReload: { frame: 'A', at: [16.5, -5.5, 4.5], yaw: 0, pitch: 10, roll: -20, blade: 10 },
  // the shoulder holster under the left armpit (under the coat): muzzle down and back, the grip forward for a cross draw
  // (the gun goes in along the forearm that reaches across the chest for it, muzzle forward-left and up into the left
  // side of the coat, top up: a search over the pose put the drawing wrist's bend at ~35°, against ~115° for muzzle-back)
  holster: { frame: 'spine2', at: [1.5, 10.0, -6.0], yaw: -60, pitch: 30, roll: 0 },
};
/** Hand poses on gun parts (gun-local unless stated): fingers dir (the hand's −Y), palm normal (right hand −Z / left +Z). */
export const HAND_ON = {
  // the pistol's support hand (left): palm against the grip's left panel, the knuckles forward and down over the strong
  // hand's fingers, the thumb forward along the frame
  support: { fingers: [0.75, -0.66, 0], palm: [0, 0, 1] },
  // the rifle's bolt knob, right hand palm down, the knuckles across the action
  // (the knuckles continue the forearm's line forward and across, so the wrist stays near straight)
  boltKnob: { fingers: [0.35, 0.1, -0.93], palm: [0, -1, 0.1] },
  // overhand on the pistol slide (left hand): palm down on the slide, fingers wrapping its right side
  rack: { fingers: [0, -0.4, 1], palm: [0, -1, 0] },
};

/* ---------------- recoil actions (§4.9): pump, bolt, dry fire; keyed on tShot (sim seconds) ---------------- */
export const ACTIONS = {
  // the pump (after the recoil has settled at .20): the forend comes back 5 (it slides over the receiver's front, the
  // stroke readable from the high camera), the gun rolls in, and the whole left side works it: the gun pushes forward
  // against the pull (counter: back +1.0, pitch −3), the left shoulder draws back and the chest turns into it
  pump: { forend: [[0.20, 0], [0.29, -5.0, 'O'], [0.34, -5.0], [0.43, 0, 'I']], roll: [[0.20, 0], [0.29, -12, 'O'], [0.43, 0, 'S']],
          counter: [[0.20, 0], [0.29, 1, 'O'], [0.43, 0, 'S']], back: 1.0, pitch: -3, clavProtL: -8, clavElevL: 3, s2Yaw: -3, eject: 0.29, end: 0.45 },
  // the bolt: the rifle cants (roll −15°, drops 1.5) so the knob comes down to the hand, the right elbow stays down by the
  // ribs (pole), the bolt lifts 75° and runs back 4.5 (readable from above)
  bolt: { handW: [[0.30, 0], [0.38, 1, 'S'], [0.71, 1], [0.80, 0, 'S']], rot: [[0.38, 0], [0.44, 75, 'O'], [0.66, 75], [0.71, 0, 'I']],
          x: [[0.44, 0], [0.56, -4.5, 'O'], [0.66, 0, 'I']], headPitch: [[0.30, 0], [0.40, -4, 'S'], [0.85, 0, 'S']],
          cant: [[0.30, 0], [0.38, 1, 'S'], [0.71, 1], [0.80, 0, 'S']], cantRoll: -15, cantDrop: 1.5, pole: [-0.2, -1.0, 0.5],
          rotMax: 75, xMax: -4.5, eject: 0.55, end: 0.85 },
  // dry fire: the gun dips, he glances down at it, the support hand taps the magazine (pistol)
  dry: { gunPitch: [[0, 0], [0.04, -4, 'O'], [0.18, 0, 'S']], headRoll: [[0, 0], [0.04, 2, 'O'], [0.2, 0, 'S']],
         headPitch: [[0, 0], [0.05, 0], [0.12, 10, 'S'], [0.24, 10], [0.36, 0, 'S']], tap: [[0.04, 0], [0.10, 1, 'S'], [0.16, 0, 'S']], end: 0.36 },
  // the shotgun's rack at the end of an empty shell chain (render tail seconds; the hull out at .08)
  rack: [[0, 0], [0.08, -5.0, 'O'], [0.18, 0, 'I']],
  // the rifle's render tail: the cheek resettles on the stock
  rifleTailHead: [[0, 3], [0.15, -2, 'O'], [0.3, 0, 'S']],
  // pistol slide lock: the slide stays back at lockX after the last round (−3: the bare barrel reads from above)
  lockX: -3.0,
};

/* ---------------- reload timelines (§4.10): built per reload, monotonic, audio-anchored ---------------- */
// Keys are in seconds from the reload start (τ) for the pistol and rifle, and in f (0..1 of one shell) for the shotgun.
// Keys keyed back from the end are written as reloadMax − ρ. Every list is made monotonic and clamped into [0, reloadMax]
// (k_i = clamp(max(k_i, k_{i−1} + gap), 0, reloadMax)); the seat (pistol) and the closure (the last key = reloadMax) are
// exact. A very short reload compresses the keys before the seat instead of pushing the seat late.
const RIFLE_PRESS_MAX = 6;
const KEY_ORDER = {
  pistol: ['gunIn', 'magOut', 'magDrop', 'leave', 'headOn', 'pocket', 'well', 'seat', 'rackOn', 'pull', 'release', 'support', 'headOff', 'gunOut', 'end'],
  rifle: ['knob', 'gunIn', 'boltUp', 'eject', 'boltBack', 'headOn', ...Array.from({ length: RIFLE_PRESS_MAX }, (_, i) => ['a', 'b', 'c'].map((x) => 'c' + (i + 1) + x)).flat(), 'boltFwd', 'headOff', 'boltDown', 'boltLock', 'end'],
  shotgun: ['push', 'jig0', 'jig1', 'jig2', 'fetch', 'end'],
};
/** The rifle's round presses for reloadMax D: one per round needed, as many 0.34 s cycles as fit after the bolt opens (0.5 s). */
export const riflePresses = (D, need = Infinity) => Math.max(0, Math.min(RIFLE_PRESS_MAX, need, Math.floor((D - 0.5) / 0.34)));
/**
 * Every key list is built per reload (or per shell): a fresh object each time is the intended use (an event, never a
 * frame). roundsNeeded: the rifle's rounds to press (its magazine less what's in it; the presses fill the reload instead
 * of the old two and a long static hold).
 */
export function reloadKeys(weapon, reloadMax, magWasEmpty, out = {}, roundsNeeded = Infinity) {
  const D = Math.max(0.05, reloadMax || 0.05), K = out;
  for (const k in K) delete K[k];
  K.weapon = weapon; K.D = D; K.empty = !!magWasEmpty;
  if (weapon === 'shotgun') {
    // per shell, in f: push (the thumb lands at about the +0.05 s click), the gun jiggles along the bore, then fetch
    Object.assign(K, { push: 0.15, jig0: 0.12, jig1: 0.15, jig2: 0.25, fetch: 0.55, end: 1.0 });
    K.jig0 = Math.min(K.jig0, K.push); // (jig0 ≤ push: the jiggle starts as the push lands)
    K.order = ['jig0', 'push', 'jig2', 'fetch', 'end']; K.unit = 'f';
    monotonic(K, 1, 0.005);
    // the push's nod along the bore, built once per shell (sampled every frame)
    K.jigTrack = [[K.jig0, 0], [K.push, GUN_POSES.shotgunReload.jig, 'O'], [K.jig2, 0, 'S']];
    return K;
  }
  if (weapon === 'rifle') {
    const n = riflePresses(D, roundsNeeded), s = Math.min(1, D / 0.6);
    Object.assign(K, { knob: 0.04 * s, gunIn: 0.06 * s, boltUp: 0.08 * s, eject: 0.11 * s, boltBack: 0.12 * s, headOn: 0.04 * s });
    K.rounds = n;
    // the first press on the knock (τ1), the rest spread evenly up to ρ 0.22; each cycle 40/40/20 (fetch / over the port /
    // press), at most 0.36 s, never starting before the previous press is done
    const t1 = Math.min(0.50, 0.45 * D), last = D - 0.22, cyc = 0.36;
    let prevEnd = 0.12 * s;
    for (let i = 0; i < n; i++) {
      const press = n === 1 ? t1 : t1 + (last - t1) * i / (n - 1);
      const len = Math.max(0.02, Math.min(cyc, press - prevEnd));
      K['c' + (i + 1) + 'a'] = press - len * 0.6; K['c' + (i + 1) + 'b'] = press - len * 0.2; K['c' + (i + 1) + 'c'] = press;
      prevEnd = press + 0.02;
    }
    const e = Math.min(1, D / 0.6);
    Object.assign(K, { boltFwd: D - 0.16 * e, headOff: D - 0.10 * e, boltDown: D - 0.08 * e, boltLock: D - 0.03 * e, end: D });
    K.order = KEY_ORDER.rifle.filter((k) => k in K); K.unit = 's';
    monotonic(K, D, 0.005);
    // the presses as one flat array [a, b, c, a, b, c, ...] (read every frame)
    K.press = [];
    for (let i = 0; i < n; i++) K.press.push(K['c' + (i + 1) + 'a'], K['c' + (i + 1) + 'b'], K['c' + (i + 1) + 'c']);
    return K;
  }
  // pistol (whole magazine)
  const seat = Math.min(0.50, 0.72 * D);
  let pocket = Math.max(0.12, seat - 0.22), well = Math.max(pocket + 0.04, seat - 0.08);
  let magOut = 0.04, magDrop = 0.05, leave = 0.10, gunIn = 0.08, headOn = 0.05;
  if (well > seat - 0.02) { // a short reload: compress what comes before the seat into [0, seat]
    const k = seat / 0.5;
    magOut = 0.04 * k; magDrop = 0.05 * k; gunIn = 0.08 * k; headOn = 0.05 * k; leave = 0.10 * k; pocket = 0.28 * k; well = 0.42 * k;
  }
  Object.assign(K, { gunIn, magOut, magDrop, leave, headOn, pocket, well, seat });
  const after = D - seat;
  if (magWasEmpty) {
    // the rack, keyed back from the end: overhand on the slide at ρR0, the pull 0.10 later, the release at ρ 0.03 (so the
    // slide snaps home on the 'reloadDone' click); a short reload scales the three with the time left after the seat
    const r0 = Math.max(0, Math.min(0.22, after - 0.04));
    K.rackOn = D - r0; K.pull = D - r0 * (0.12 / 0.22); K.release = D - r0 * (0.03 / 0.22);
  } else K.support = D - Math.min(0.10, after * 0.5);
  K.headOff = D - Math.min(0.10, after * 0.4); K.gunOut = D - Math.min(0.12, after * 0.6); K.end = D;
  K.order = KEY_ORDER.pistol.filter((k) => k in K); K.unit = 's';
  return monotonic(K, D, 0.005, 'seat');
}
/**
 * k_i = clamp(max(k_i, k_{i−1} + gap), 0, max), in time order (the raw keys sorted, stable; 'end' last). `fixed` keeps
 * its value exactly: keys before it are capped at it, the ones after start from it.
 */
function monotonic(K, max, gap, fixed = null) {
  const o = K.order.filter((k) => k !== 'end').sort((a, b) => K[a] - K[b]); o.push('end'); K.order = o;
  const n = o.length, g = Math.min(gap, max / (2 * n)), fi = fixed ? o.indexOf(fixed) : -1;
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    const k = o[i];
    let v = K[k];
    if (i === fi) { K[k] = Math.min(max, Math.max(0, v)); prev = K[k]; continue; }
    v = Math.max(v, prev + (prev === -Infinity ? 0 : g));
    if (fi >= 0 && i < fi) v = Math.min(v, K[fixed]);
    K[k] = Math.min(max, Math.max(0, v)); prev = K[k];
  }
  K[o[n - 1]] = max; // the closure lands exactly on the end
  return K;
}
/** Every reload key list for reloadMax D and the empty flag, in order (for the unit test). */
export function reloadKeyList(K) { return K.order.map((k) => [k, K[k]]); }

/* ---------------- swap (§4.11): f = 1 − swapT/0.35 ---------------- */
export const SWAP = {
  // (the support hand comes back over f 0.6–1.0 / 0.55–0.95: the spec's 0.85–1.0 is 0.05 s, the hand flew 20 u in three frames)
  T: 0.35, outEnd: 0.45, pistolHide: 0.42, longRelease: 0.40, inStart: 0.50, supportFrom: 0.6, forendFrom: 0.55, forendTo: 0.95, leftDrop: 0.15,
  crossYaw: [[0, 0], [0.25, -12, 'S'], [0.6, -12], [1, 0, 'S']], longYaw: [[0, 0], [0.3, 10, 'S'], [1, 0, 'S']], pelvisY: [[0, 0], [0.5, -1.0, 'S'], [1, 0, 'S']],
  bezOut: 4, bezFwd: 2,
  // a cross swap (pistol ↔ long gun): the right hand must cross from the holster to the back sling (or back) before it can
  // draw at f 0.5; the spec's out (hidden at 0.42) left it one frame for 20 u, a teleport, so the out ends earlier
  cross: { outEnd: 0.32, pistolHide: 0.30, longRelease: 0.28 },
  // the right elbow's pole (aim frame) while the hand reaches back to the sling: back and down, out to the side; long-gun
  // travel bows bezRight u to his right (the gun swings forward under the right arm)
  slingPole: [-0.5, -1.0, 0.6], bezRight: 6,
  // the swap's body paths (spine2-local exits, fwd/up/right): out of the coat front from the holster, out round the right
  // side from the sling, a little forward from a gun in the hands
  exit: { holster: [15, -4, 13], sling: [6, 8, 14], hand: [3, 0, 3] }, gunExit: { holster: [7, -2, 4], sling: [6, 7, 12], hand: [4, 0, 4] },
  // the support hand lets go of a long gun's forend by f leftOffLong (it swings back over the shoulder)
  leftOffLong: 0.22,
};

/* ---------------- casings and debris (§5.5) ---------------- */
export const CASING = {
  // (peak 11: the arc clears the hand's silhouette; the brighter brass and red read against the autumn leaf litter, and a
  // casing glints (instanceColor × glint, fading over glintT) while airborne and as it lands)
  arcT: 0.35, peak: 11, peakAt: 0.3, bounce: 2, bounceT: 0.1, spin: 25, force: 1.5, forceChain: 4, glint: 1.8, glintT: 0.15,
  // (about twice the spec's true-to-life sizes, near the 2D view's 4 × 2 casing: at the game's zoom a 1-unit case was
  // invisible, and the point of the brass is to be seen flying); they shrink away over the last 0.6 s before the sim drops them
  scale: { pistol: [2.2, 0.9, 0.9], shotgun: [3.6, 1.3, 1.3], rifle: [3.4, 0.9, 0.9], mag: [4.2, 1.1, 1.3] }, life: 12, fade: 0.6,
  color: { pistol: '#f2d36b', shotgun: '#e0302a', rifle: '#f2d36b', mag: '#3c3e44' },
  mag: { g: 900, rest: 0.25, restT: 1.0, shrinkT: 0.2, v0: 40, spin: 6 },
};

/** The breath curve b(phase) in [0, 1] for phase in [0, 1). */
export function breathCurve(ph) {
  const s = (t) => t * t * (3 - 2 * t);
  return ph < 0.4 ? s(ph / 0.4) : 1 - s((ph - 0.4) / 0.6);
}

/* ---------------- recoil (§4.9), keyed on tShot in sim seconds ---------------- */
// (every channel starts at ≥ 55% of its peak on the flash frame: the spec's pistol 6/11 and shotgun 7/13 were 54.5% and
// 53.8%, so their first keys are 6.2 and 7.2)
export const RECOIL = {
  // (the pistol kicks well past the spec's 11° / 1.6 u / 1.5°: at the default zoom (Frank ~70 px tall) the spec's flip moved
  // the muzzle 1–2 px. Here the kick lives in the silhouette: the elbows fold (the gun comes back 3.8), the shoulders
  // shrug up and back, the chest and head rock back)
  pistol: { T: 0.24, gunPitch: [[0, 10], [0.035, 18, 'O'], [0.10, 3, 'S'], [0.16, -1.2, 'S'], [0.24, 0, 'S']],
            gunBack: [[0, -2.1], [0.03, -3.8, 'O'], [0.12, -0.5, 'S'], [0.24, 0, 'S']],
            slide: [[0, -1.0], [0.015, -1.6, 'L'], [0.05, -1.6, 'H'], [0.09, 0, 'I']],
            spine2Pitch: [[0, -2.2], [0.04, -4, 'O'], [0.20, 0, 'S']], headPitch: [[0, -1.7], [0.05, -3, 'O'], [0.2, 0, 'S']],
            clavElev: [[0, 2.2], [0.035, 4, 'O'], [0.20, 0, 'S']], clavProt: [[0, -2.2], [0.035, -4, 'O'], [0.20, 0, 'S']] },
  // (the shotgun's gun channels settle by 0.20, before the pump starts: a pump stroke during the recoil's recovery
  // cancelled out in world space and never read)
  shotgun: { T: 0.30, gunBack: [[0, -2.0], [0.04, -3.5, 'O'], [0.14, -0.3, 'S'], [0.20, 0, 'S']],
             gunPitch: [[0, 7.2], [0.05, 13, 'O'], [0.13, 2.5, 'S'], [0.20, 0, 'S']],
             spine2Pitch: [[0, -4.5], [0.05, -8, 'O'], [0.20, -1.5, 'S'], [0.30, 0, 'S']], spine1Pitch: [[0, -3.3], [0.06, -6, 'O'], [0.3, 0, 'S']],
             headPitch: [[0, -2.2], [0.06, -4, 'O'], [0.3, 0, 'S']], pelvisDx: [[0, -1.1], [0.08, -2.0, 'O'], [0.3, 0, 'S']],
             clavElev: [[0, 1.7], [0.04, 3, 'O'], [0.25, 0, 'S']], clavProt: [[0, -1.7], [0.04, -3, 'O'], [0.25, 0, 'S']], coat: 2.0 },
  rifle: { T: 0.28, gunBack: [[0, -1.4], [0.04, -2.5, 'O'], [0.28, 0, 'S']], gunPitch: [[0, 4.5], [0.05, 8, 'O'], [0.28, 0, 'S']],
           spine2Pitch: [[0, -3.3], [0.05, -6, 'O'], [0.28, 0, 'S']], headPitch: [[0, -1.7], [0.05, -3, 'O'], [0.28, 0, 'S']],
           clavElev: [[0, 1.4], [0.05, 2.5, 'O'], [0.25, 0, 'S']], clavProt: [[0, -1.4], [0.05, -2.5, 'O'], [0.25, 0, 'S']], coat: 0.5 },
  // every shot differs a little (a hash of the shot count): the amplitude × [lo, hi], the muzzle thrown ±yaw° sideways
  vary: { lo: 0.85, hi: 1.2, yaw: 2.5 },
};

/* ---------------- fidgets (§4.7) ---------------- */
export const FIDGETS = {
  neckRoll: { T: 1.4, headRoll: [[0, 0], [0.25, 9, 'S'], [0.5, 0, 'S'], [0.75, -9, 'S'], [1, 0, 'S']], headPitch: [[0, 0], [0.5, 8, 'S'], [1, 0, 'S']] },
  shoulderRoll: { T: 0.8, clavElev: [[0, 0], [0.4, 6, 'S'], [1, 0, 'S']], clavProt: [[0, 0], [0.4, 0], [0.7, -6, 'S'], [1, 0, 'S']] },
  gunCheck: { T: 1.2, shoulderFlex: [[0, 0], [0.3, 35, 'S'], [0.67, 35, 'H'], [1, 0, 'S']], elbow: [[0, 0], [0.3, 70, 'S'], [0.67, 70, 'H'], [1, 0, 'S']],
              headPitch: [[0, 0], [0.3, 14, 'S'], [0.67, 14, 'H'], [1, 0, 'S']], headYaw: [[0, 0], [0.3, 10, 'S'], [1, 0, 'S']] },
};

/** Every keyed track in this module (for the unit test of sortedness and easing ids). */
export function allTracks() {
  const out = [];
  const walk = (o, path) => {
    if (Array.isArray(o) && o.length && Array.isArray(o[0])) { out.push([path, o]); return; }
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const k of Object.keys(o)) walk(o[k], path + '.' + k);
  };
  walk(RECOIL, 'RECOIL'); walk(FIDGETS, 'FIDGETS'); walk(ACTIONS, 'ACTIONS'); walk(SWAP, 'SWAP'); walk(GUN_POSES, 'GUN_POSES');
  return out;
}
