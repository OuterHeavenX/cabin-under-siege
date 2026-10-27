// Character XP / levels, attributes, JP and skills, relationships and the
// derived stats every other system reads.
import { G, hasSkill } from './state.js';
import { ATTRIBUTES, ATTR_POINTS_PER_LEVEL, MAX_ATTR, PATHS, SKILLS, xpForLevel } from '../data/skills.js';
import { NPCS, relLevel } from '../data/npcs.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';

export function derived() {
  const a = G.s.stats.attrs;
  const sk = hasSkill;
  const lvlBonus = (n) => n - 1;
  return {
    maxHp: 100 + 12 * lvlBonus(a.vit),
    maxStamina: 100 + 10 * lvlBonus(a.end),
    staminaMult: 1 - 0.04 * lvlBonus(a.end),
    spreadMult: (1 - 0.06 * lvlBonus(a.pre)) * (sk('steady_hands') ? 0.7 : 1),
    moveSpreadMult: sk('steady_hands') ? 0.5 : 1,
    reloadTime: 1.45 * (sk('quick_reload') ? 0.7 : 1),
    healMult: (1 + 0.05 * lvlBonus(a.res)) * (sk('field_recovery') ? 1.35 : 1),
    regenCap: 0.3 + 0.05 * lvlBonus(a.res),
    graceTime: 0.55 + 0.05 * lvlBonus(a.res),
    seeRadius: 170 + 20 * lvlBonus(a.awa) + (sk('keen_eye') ? 60 : 0),
    warnLead: 15 + 4 * lvlBonus(a.awa) + (sk('watchful') ? 30 : 0) + (G.s.home.upgrades.alarm ? 45 : 0),
    showDirections: sk('watchful') || G.s.home.upgrades.alarm,
    noticeMult: sk('quiet_steps') ? 0.6 : 1,
    dodgeSpeed: 400 * (sk('escape_artist') ? 1.3 : 1),
    dodgeTime: 0.22,
    dodgeIframes: sk('escape_artist') ? 0.4 : 0.25,
    dodgeCost: 28 * (sk('escape_artist') ? 0.6 : 1),
    repairSpeed: sk('quick_fix') ? 1.6 : 1,
    woodBonus: sk('resourceful') ? 1 : 0,
    flinchMult: sk('composure') ? 0.25 : 1,
    magSize: G.s.home.upgrades.extMag ? 12 : 8,
    jobPayMult: sk('good_reputation') ? 1.15 : 1,
  };
}

export function shopDiscount(owner) {
  let d = 0;
  if (hasSkill('local_discount')) d += 0.1;
  if (owner === 'dee') {
    const lv = relLevel(G.s.rel.dee);
    if (lv >= 4) d += 0.1; else if (lv >= 2) d += 0.05;
  }
  return d;
}

/* ---------------- daily anti-farming counters ---------------- */
function ensureDaily() {
  if (G.s.daily.day !== G.s.time.day) { G.s.daily.day = G.s.time.day; G.s.daily.c = {}; }
}
/** Increment a per-day counter. Returns true if still under `cap`. */
export function dailyAllow(key, cap = 1) {
  ensureDaily();
  const c = G.s.daily.c[key] || 0;
  if (c >= cap) return false;
  G.s.daily.c[key] = c + 1;
  return true;
}
export function dailyCount(key) { ensureDaily(); return G.s.daily.c[key] || 0; }

/* ---------------- XP & levels ---------------- */
export function addXP(n, reason) {
  if (n <= 0) return;
  const st = G.s.stats;
  st.xp += n;
  toast(`+${n} XP${reason ? ' · ' + reason : ''}`, 'xp');
  let leveled = false;
  while (st.xp >= xpForLevel(st.level)) {
    st.xp -= xpForLevel(st.level);
    st.level++;
    st.attrPoints += ATTR_POINTS_PER_LEVEL;
    leveled = true;
  }
  if (leveled) {
    sfx('levelup');
    toast(`LEVEL UP! Level ${st.level} — +${ATTR_POINTS_PER_LEVEL} attribute points (open Menu › Character)`, 'level', 5);
    G.events.emit('levelup', st.level);
  }
}

export function spendAttr(key) {
  const st = G.s.stats;
  if (st.attrPoints <= 0 || !ATTRIBUTES[key] || st.attrs[key] >= MAX_ATTR) return false;
  const before = derived();
  st.attrs[key]++;
  st.attrPoints--;
  const after = derived();
  // Raising max HP/stamina also grants the difference immediately.
  G.player.hp += Math.max(0, after.maxHp - before.maxHp);
  G.player.stamina += Math.max(0, after.maxStamina - before.maxStamina);
  sfx('blip');
  return true;
}

/* ---------------- JP & skills ---------------- */
/**
 * Award JP to a path. Optional `dailyKey`/`cap` limit how many times per day a
 * given source can pay out, so repeating trivial actions can't be farmed.
 */
export function addJP(path, n, dailyKey = null, cap = 1) {
  if (!PATHS[path] || n <= 0) return false;
  if (dailyKey && !dailyAllow('jp:' + dailyKey, cap)) return false;
  G.s.jp[path] += n;
  G.s.jpEarned[path] += n;
  toast(`+${n} ${PATHS[path].name} JP`, 'jp:' + path);
  return true;
}

export function canBuySkill(id) {
  const sk = SKILLS[id];
  return sk && !hasSkill(id) && G.s.jp[sk.path] >= sk.cost;
}

export function buySkill(id) {
  if (!canBuySkill(id)) return false;
  const sk = SKILLS[id];
  G.s.jp[sk.path] -= sk.cost;
  G.s.skills.push(id);
  sfx('levelup');
  toast(`Learned ${sk.name}!`, 'level', 3);
  G.events.emit('skill', id);
  return true;
}

/* ---------------- relationships ---------------- */
export function addRel(id, n) {
  if (!(id in G.s.rel) || n <= 0) return;
  const mult = hasSkill('familiar_face') ? 1.5 : 1;
  const before = relLevel(G.s.rel[id]);
  G.s.rel[id] = Math.min(100, G.s.rel[id] + Math.round(n * mult));
  const after = relLevel(G.s.rel[id]);
  if (after > before) {
    toast(`${NPCS[id].name.split(' ')[0]} likes you more (♥ ${after})`, 'rel', 4);
    addJP('neighbor', 8);
    sfx('chime');
    G.events.emit('rel', id, after);
  }
}

export function relOf(id) { return relLevel(G.s.rel[id] || 0); }

/* ---------------- money ---------------- */
export function addMoney(n, why) {
  G.s.money = Math.max(0, Math.round(G.s.money + n));
  if (n > 0) toast(`+$${Math.round(n)}${why ? ' · ' + why : ''}`, 'money');
}
