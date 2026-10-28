// Bullets, damage resolution, pickups and lightweight visual effects.
import { G } from './state.js';
import { animalBulletCheck } from './hunting.js';
import { galleryBulletCheck } from './townlife.js';
import { dogBulletCheck } from './dog.js';
import { TILE } from '../config.js';
import { dist, rand, randInt } from '../util.js';
import { sfx } from '../audio.js';
import { damagePlayer } from './player.js';
import { addItem, count } from './inventory.js';
import { addMoney } from './progression.js';
import { toast } from '../ui/hud.js';
import { allyBulletCheck } from './ally.js';
import { ITEMS } from '../data/items.js';

const MAX_PARTICLES = 220;

export function shake(amount) {
  const m = G.settings.screenShake === 'off' ? 0 : G.settings.screenShake === 'reduced' ? 0.35 : 1;
  G.camera.shake = Math.max(G.camera.shake, amount * m);
}

export function spawnBullet({ x, y, angle, speed, dmg, owner, range, source = null, pierce = 0, knock = 90, weapon = null }) {
  G.bullets.push({
    x, y, px: x, py: y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
    dmg, owner, range, travelled: 0, lastCell: -1, dead: false, source, pierce, knock, weapon, hit: null,
  });
}

export function spawnParticles(x, y, color, n, speed = 120, life = 0.4, size = 2.5) {
  for (let i = 0; i < n; i++) {
    if (G.particles.length >= MAX_PARTICLES) G.particles.shift();
    const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
    G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size });
  }
}

export function addFloater(x, y, text, color = '#fff', life = 0.9) {
  if (!G.settings.showDamageNumbers && /^-?\d/.test(text)) return;
  G.floaters.push({ x, y, text, color, life, max: life });
}

/** Attackers sometimes carry something worth taking: their gun, its ammo, or a part. */
function dropGear(e) {
  const t = e.type, owns = (id) => count(id) > 0;
  const drop = (item, n) => addPickup('item', e.x + rand(-12, 12), e.y + rand(-12, 12), n, { item });
  if (t === 'sniper') { if (!owns('rifle') && Math.random() < 0.35) drop('rifle', 1); else if (Math.random() < 0.55) drop('rifle_ammo', 4); }
  else if (t === 'lieutenant') { if (!owns('shotgun') && Math.random() < 0.6) drop('shotgun', 1); else drop('shells', 6); }
  else if (t === 'gunman' && owns('rifle') && Math.random() < 0.15) drop('rifle_ammo', 3);
  else if (t === 'enforcer' && owns('shotgun') && Math.random() < 0.15) drop('shells', 4);
  if (Math.random() < 0.03) {
    const parts = ['suppressor', 'ext_mag', 'scope', 'choke'].filter((id) => !owns(id) && !(G.s.weaponMods || {})[ITEMS[id].install]);
    if (parts.length) drop(parts[Math.floor(Math.random() * parts.length)], 1);
  }
}

export function addPickup(kind, x, y, amount, extra = {}) {
  G.pickups.push({ kind, x, y, amount, t: 0, ...extra });
}

/** Damage an enemy. `src` is 'bullet' or 'melee'. */
export function damageEnemy(e, dmg, angle, src, knock = 90) {
  if (e.dead) return;
  if (e.armor) dmg *= e.armor;
  e.hp -= dmg;
  e.hitT = 0.15;
  e.lastHit = 0;
  if (!e.def.vehicle) { e.kx += Math.cos(angle) * knock; e.ky += Math.sin(angle) * knock; }
  if (!e.alerted && src !== 'takedown') G.events.emit('enemyAlert', e, src);
  spawnParticles(e.x, e.y, '#b0302a', 5, 110);
  addFloater(e.x + rand(-6, 6), e.y - 20, `${Math.round(dmg)}`, '#ffd166');
  sfx('hit', { x: e.x, y: e.y, vol: 0.9 });
  G.events.emit('enemyHit', e, src);
  if (e.hp <= 0) {
    e.hp = 0;
    e.dead = true;
    e.deadT = 0;
    const def = e.def;
    if (def.vehicle) {
      spawnParticles(e.x, e.y, '#ff9f1c', 18, 200); shake(6); sfx('explode', { x: e.x, y: e.y });
      G.events.emit('enemyKilled', e);
      return;
    }
    const cash = randInt(def.cash[0], def.cash[1]);
    addPickup('cash', e.x + rand(-8, 8), e.y + rand(-8, 8), cash);
    if (Math.random() < 0.85) addPickup('ammo', e.x + rand(-10, 10), e.y + rand(-10, 10), randInt(def.ammoDrop[0], def.ammoDrop[1]));
    if (Math.random() < 0.2) addPickup('bandage', e.x + rand(-10, 10), e.y + rand(-10, 10), 1);
    if (!def.dog) dropGear(e);
    if (e.carriesNote) G.events.emit('bossDropped', e);
    G.events.emit('enemyKilled', e);
  }
}

export function updateBullets(dt) {
  const map = G.map;
  for (const b of G.bullets) {
    if (b.dead) continue;
    const sp = Math.hypot(b.vx, b.vy);
    const total = sp * dt;
    const steps = Math.max(1, Math.ceil(total / 6));
    const sx = (b.vx * dt) / steps, sy = (b.vy * dt) / steps;
    b.px = b.x; b.py = b.y;
    for (let s = 0; s < steps && !b.dead; s++) {
      b.x += sx; b.y += sy;
      b.travelled += total / steps;
      if (b.travelled > b.range) { b.dead = true; break; }
      const cx = Math.floor(b.x / TILE), cy = Math.floor(b.y / TILE);
      if (!map.inBounds(cx, cy)) { b.dead = true; break; }
      const ci = cy * map.w + cx;
      if (ci !== b.lastCell) {
        b.lastCell = ci;
        if (map.bulletCell(cx, cy, b)) {
          b.dead = true;
          spawnParticles(b.x - sx, b.y - sy, '#d8c7a0', 4, 80, 0.25, 2);
          if (map.getSolid(cx, cy) !== 0 || map.blockerAt(cx, cy)) G.events.emit('bulletWall', b.x - sx, b.y - sy);
          const pd = G.player ? dist(b.x, b.y, G.player.x, G.player.y) : 999;
          if (pd < 500 && Math.random() < 0.6) sfx(Math.random() < 0.5 ? 'ricochet' : 'impact', { x: b.x, y: b.y });
          break;
        }
      }
      if (b.owner === 'player' && (animalBulletCheck(b) || galleryBulletCheck(b))) { b.dead = true; break; }
      if (b.owner === 'player' || b.owner === 'ally') {
        for (const e of G.enemies) {
          if (e.dead || e.gone) continue;
          const r = e.radius + 2;
          if ((e.x - b.x) ** 2 + (e.y - b.y) ** 2 < r * r) {
            if (b.hit && b.hit.includes(e)) continue;
            damageEnemy(e, b.dmg, Math.atan2(b.vy, b.vx), 'bullet', b.knock);
            if (b.pierce > 0) { b.pierce--; b.dmg *= 0.6; (b.hit = b.hit || []).push(e); continue; }
            b.dead = true;
            break;
          }
        }
      } else if (b.owner === 'enemy') {
        if (allyBulletCheck(b) || dogBulletCheck(b)) { b.dead = true; break; }
        const p = G.player;
        const r = p.radius + 1;
        if (!p.dead && (p.x - b.x) ** 2 + (p.y - b.y) ** 2 < r * r) {
          // Dodging players let bullets pass through.
          if (p.invuln > 0 && p.dodgeT > 0) continue;
          damagePlayer(b.dmg, b.x - b.vx * 0.05, b.y - b.vy * 0.05, 'bullet');
          b.dead = true;
        }
      }
    }
  }
  G.bullets = G.bullets.filter((b) => !b.dead);
}

export function updateEffects(dt) {
  for (const pt of G.particles) {
    pt.x += pt.vx * dt; pt.y += pt.vy * dt;
    pt.vx *= 0.9; pt.vy *= 0.9;
    pt.life -= dt;
  }
  G.particles = G.particles.filter((p) => p.life > 0);
  for (const c of G.casings || []) {
    if (c.t < 0.35) { c.x += c.vx * dt; c.y += c.vy * dt; c.rot += dt * 20; c.vx *= 0.9; c.vy *= 0.9; }
    c.t += dt;
  }
  if (G.casings) G.casings = G.casings.filter((c) => c.t < 12);
  for (const f of G.floaters) { f.y -= 28 * dt; f.life -= dt; }
  G.floaters = G.floaters.filter((f) => f.life > 0);

  const p = G.player;
  for (const pk of G.pickups) {
    pk.t += dt;
    const d = dist(p.x, p.y, pk.x, pk.y);
    if (d < 70 && pk.t > 0.35) { // gentle magnet
      pk.x += ((p.x - pk.x) / d) * 160 * dt;
      pk.y += ((p.y - pk.y) / d) * 160 * dt;
    }
    if (d < 20 && pk.t > 0.35) collect(pk);
  }
  G.pickups = G.pickups.filter((pk) => !pk.taken);
}

function collect(pk) {
  if (pk.kind === 'ammo') {
    const got = addItem('ammo', pk.amount, true);
    if (got <= 0) return; // full: leave it on the ground
    toast(`+${got} rounds`, 'item', 1.2);
  } else if (pk.kind === 'cash') {
    addMoney(pk.amount, 'picked up');
  } else if (pk.kind === 'bandage') {
    if (addItem('bandage', 1, true) <= 0) return;
    toast('+1 Bandage', 'item', 1.2);
  } else if (pk.kind === 'note' || pk.kind === 'burner') {
    addItem(pk.kind, 1, true);
    G.events.emit(pk.kind === 'note' ? 'noteFound' : 'burnerFound');
  } else if (pk.kind === 'item') {
    const got = addItem(pk.item, pk.amount, true);
    if (got <= 0) return;
    toast(`Taken from the body: ${ITEMS[pk.item].name}${got > 1 ? ' ×' + got : ''}`, 'item', 2.5);
  } else if (pk.kind === 'ledger' || pk.kind === 'signet' || pk.kind === 'blueprint' || pk.kind === 'study_key') {
    addItem(pk.kind, 1, true);
    G.events.emit(`${pk.kind}Found`);
  }
  pk.taken = true;
  sfx(pk.kind === 'cash' ? 'coin' : 'pickup');
}
