// Ruth as a companion. Once she trusts you (♥3) she runs over to help during
// attacks with Harold's old shotgun, can patch you up once per attack, and —
// if you ask her — moves with you to every new home.
import { G } from './state.js';
import { TILE } from '../config.js';
import { angleTo, dist } from '../util.js';
import { relOf } from './progression.js';
import { homeMapId } from './chapters.js';
import { spawnBullet, spawnParticles, addFloater } from './combat.js';
import { derived } from './progression.js';
import { sfx } from '../audio.js';
import { banner, toast } from '../ui/hud.js';
import { isNight } from './state.js';

export const ALLY_MAX_HP = 140;
export const TRUST_LEVEL = 3;

const comp = () => G.s.companion || (G.s.companion = { ruth: { joined: false, declined: false } });

/** Has Ruth moved with you (chapter 2+)? */
export function ruthJoined() { return !!comp().ruth.joined; }

/** Is Ruth on your side in fights on the current map? */
export function allyAvailable() {
  if (!G.s || !G.map) return false;
  if (G.s.chapter === 1) return relOf('ruth') >= TRUST_LEVEL && G.map.id === 'cabin';
  return ruthJoined() && G.map.id === homeMapId();
}

export function allyEntity() { return G.npcs.find((n) => n.id === 'ruth') || null; }

/** Called at the start of a siege. */
export function allyStartSiege() {
  const r = allyEntity();
  G.allyState = { revived: false };
  if (!allyAvailable() || !r) return;
  r.ally = true; r.hp = ALLY_MAX_HP; r.downed = false; r.fireCd = 1.5; r.aimT = 0; r.path = null;
  banner(G.s.chapter === 1 ? 'Ruth is coming over with Harold\'s shotgun!' : 'Ruth grabs Harold\'s shotgun. "Not on my watch."', 'good', 3.5);
}

export function allyEndSiege() {
  const r = allyEntity();
  if (r) { r.ally = false; r.aimT = 0; if (r.downed) toast('Ruth is hurt, but she\'ll be all right by morning.', 'info', 3.5); r.downed = false; r.hp = ALLY_MAX_HP; r.path = null; }
}

/** Once per attack, Ruth pulls you back from the brink instead of a defeat. */
export function tryAllyRevive() {
  if (!G.siegeActive || !allyAvailable()) return false;
  const r = allyEntity();
  if (!r || !r.ally || r.downed || (G.allyState && G.allyState.revived)) return false;
  G.allyState.revived = true;
  const p = G.player;
  p.hp = Math.round(derived().maxHp * 0.45);
  p.invuln = 2.5;
  p.dead = false;
  r.x = p.x + 18; r.y = p.y + 6;
  G.map.pushOut(r, r.radius, 'npc');
  sfx('heal');
  banner('Ruth drags you behind cover and patches you up! (once per attack)', 'good', 4);
  return true;
}

/** Enemy bullets can hit Ruth. Returns true if the bullet was absorbed. */
export function allyBulletCheck(b) {
  const r = allyEntity();
  if (!r || !r.ally || r.downed || !r.present) return false;
  if ((r.x - b.x) ** 2 + (r.y - b.y) ** 2 > (r.radius + 1) ** 2) return false;
  r.hp -= b.dmg * 0.8;
  r.hitT = 0.15;
  spawnParticles(r.x, r.y, '#c0392b', 4, 80);
  if (r.hp <= 0) {
    r.hp = 0; r.downed = true;
    toast('Ruth is down! She\'s hurt but alive.', 'danger', 3);
  }
  return true;
}

function allyPost() {
  const m = G.map;
  const hi = m.homeInfo;
  return hi && hi.allyPost ? hi.allyPost : null;
}

/** Combat behaviour during sieges. Returns true if it handled Ruth this frame. */
export function updateAlly(dt) {
  const r = allyEntity();
  if (!r || !r.ally || !G.siegeActive) return false;
  r.present = true;
  r.hitT = (r.hitT || 0) - dt;
  if (r.downed) return true;
  r.fireCd -= dt;
  const m = G.map;
  // Target: nearest visible attacker within shotgun range.
  let best = null, bd = 290;
  for (const e of G.enemies) {
    if (e.dead || e.gone) continue;
    const d = dist(r.x, r.y, e.x, e.y);
    if (d < bd && m.los(r.x, r.y, e.x, e.y)) { bd = d; best = e; }
  }
  if (r.aimT > 0) {
    r.aimT -= dt;
    if (best) r.angle = angleTo(r.x, r.y, best.x, best.y);
    if (r.aimT <= 0) {
      for (let i = 0; i < 6; i++) {
        const a = r.angle + (i / 5 - 0.5) * 0.36 + (Math.random() - 0.5) * 0.05;
        spawnBullet({ x: r.x + Math.cos(a) * 14, y: r.y + Math.sin(a) * 14, angle: a, speed: 740, dmg: 11, owner: 'ally', range: 260, knock: 140 });
      }
      sfx('shotgun', { x: r.x, y: r.y });
      r.muzzle = 0.09;
      r.fireCd = 2.1 + Math.random() * 0.5;
    }
    return true;
  }
  if (best && r.fireCd <= 0) { r.aimT = 0.3; r.angle = angleTo(r.x, r.y, best.x, best.y); return true; }
  // Move to her post (by a front window) unless she's already there.
  const post = allyPost();
  if (post && dist(r.x, r.y, post.x, post.y) > 8) {
    if (!r.path || r.pathT <= 0) {
      r.pathT = 1;
      r.path = m.findPath(Math.floor(r.x / TILE), Math.floor(r.y / TILE), Math.floor(post.x / TILE), Math.floor(post.y / TILE), (cx, cy) => {
        if (m.getSolid(cx, cy) !== 0) return Infinity;
        const b = m.blockerAt(cx, cy);
        if (b && b.kind !== 'door') return Infinity;
        return 0;
      }, 4000) || [];
    }
    r.pathT -= dt;
    const n = r.path[0];
    const tx = n ? n.cx * TILE + 16 : post.x, ty = n ? n.cy * TILE + 16 : post.y;
    if (dist(r.x, r.y, tx, ty) < 5 && n) r.path.shift();
    else {
      const a = Math.atan2(ty - r.y, tx - r.x);
      m.moveCircle(r, Math.cos(a) * 95 * dt, Math.sin(a) * 95 * dt, 'npc');
      r.angle = a; r.walkPhase += dt * 10;
    }
  } else if (best) r.angle = angleTo(r.x, r.y, best.x, best.y);
  return true;
}

/** Where Ruth spends her day once she's moved in with you (chapter 2+). */
export function companionSchedule(minute) {
  if (minute >= 7 * 60 && minute < 17 * 60) return 'ruth_c_day';
  if (minute >= 17 * 60 && minute < 21 * 60) return 'ruth_c_eve';
  return 'ruth_c_home';
}

export const COMPANION_LINES = [
  'New town, same old me. I found the hardware store already. Prices are criminal.',
  'I\'ve got the shotgun cleaned and the coffee on. One of those is for you.',
  'Harold always wanted to see the country. I suppose he\'s seeing it with us.',
  'I keep a bag packed by the camper door. Old habit from the hospital. Don\'t look at me like that.',
  'You sleep. I\'ll watch the road for an hour. My knees won\'t let me sleep anyway.',
];

export function companionNightNote() { return isNight(); }
