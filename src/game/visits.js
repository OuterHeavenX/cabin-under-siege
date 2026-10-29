// Going back: day trips (or longer stays) to towns Frank has already left.
// The active home stays where it is — it can still be attacked, its projects
// wait, and the main story only moves there. A visit loads the old town's maps
// next to the active ones; that town's shop, job board, card table, people
// and side stories work again (see `here()` in chapters.js).
import { G, newHome } from './state.js';
import { TILE } from '../config.js';
import { CHAPTERS, chapter, visiting, hereN, homeMapId, LAST_CHAPTER } from './chapters.js';
import { advanceMinutes } from './time.js';
import { absNow } from './siege.js';
import { addMoney, addRel, relOf, addXP, dailyAllow } from './progression.js';
import { saveGame } from './save.js';
import { playDialogue, dialogueActive } from '../ui/dialogue.js';
import { banner, toast } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { NPCS } from '../data/npcs.js';
import { inCombat } from './player.js';
import { REUNIONS, ARRIVALS } from '../data/reunions.js';
import { hasPerk } from './perks.js';
import { onVisitStart, onVisitEnd } from './away.js';

let hooks = {};
/** main.js hands over map building and loading. */
export function setVisitHooks(h) { hooks = h; }

const HOME_OF = { 1: 'cabin', 2: 'house', 3: 'farm', 4: 'estate', 5: 'watchhouse' };
export const homeIdOf = (ch) => HOME_OF[ch];

/** Who looks after an old home now, and whether Frank can go inside. */
export function oldHomeStatus(ch) {
  const s = G.s, c = s.choices || {};
  const ruthStayed = !(s.companion && s.companion.ruth && s.companion.ruth.joined);
  switch (ch) {
    case 1: return ruthStayed
      ? { open: true, keeper: 'ruth', text: 'Ruth keeps the key and airs the cabin out on Sundays. It\'s still yours to sleep in.' }
      : { open: true, keeper: 'gus', text: 'Gus Okafor bought the cabin from the bank "to keep it out of strangers\' hands." The key is under the woodpile.' };
    case 2: return { open: false, keeper: 'marcus', text: 'A young couple, the Nguyens, own the house on Larch Street now. Marcus says they\'re "acceptable." You can\'t go in.' };
    case 3: return (c.marcusHelp || relOf('ingrid') >= 2)
      ? { open: true, keeper: 'ingrid', text: 'Ingrid works the fields and keeps the farmhouse aired out. "Your bed\'s made. Don\'t get used to it."' }
      : { open: false, keeper: 'ingrid', text: 'Ingrid leased the land to the co-op. The farmhouse is locked up and the keys are in Eau Claire.' };
    case 4: return { open: true, keeper: 'eleanor', text: 'Eleanor keeps the manor ready "for a caretaker who may come back and be boring." The guest room is yours.' };
    default: return { open: false, keeper: null, text: '' };
  }
}

/** Defense records for an old home on a visit: inert, like a neighbor's house. */
export function pastHomeRecord(ch) {
  const h = newHome(HOME_OF[ch]);
  const st = oldHomeStatus(ch);
  for (const o of Object.values(h.openings)) {
    o.npc = true;
    if (o.kind === 'door' && !o.gate && !st.open) { o.locked = true; o.lockedMsg = st.text; }
    if (o.gate) o.open = true;
  }
  h.projects = ((G.s.pastHomes || {})[HOME_OF[ch]] || {}).projects || {};
  h.porchLight = st.open;
  return h;
}

/** Hours on the road between two chapters' towns. A restored car is faster. */
export function travelHours(from, to) {
  // Neighbouring chapters: the drive between those two towns; farther: roughly 3 h a state.
  const leg = { 2: 9, 3: 6, 4: 7, 5: 5 };
  const d = Math.abs(from - to);
  let h = d === 1 ? leg[Math.max(from, to)] : 4 + d * 3;
  if (G.s.life && G.s.life.car && G.s.life.car.done) h = Math.round(h * 0.6);
  if (hasPerk('mechanic')) h -= 1;
  return Math.max(2, h);
}
export const gasCost = (hours) => (G.s.life && G.s.life.car && G.s.life.car.done ? 0 : 4 * hours);

/** Why Frank can't drive off to another town right now (null if he can). */
export function travelBlocker() {
  const s = G.s, w = s.world;
  if (G.siegeActive || inCombat() || G.enemies.some((e) => !e.dead && !e.gone)) return 'Not with attackers around.';
  if (G.assault) return 'Not now.';
  if (G.tail) return 'You\'re in the middle of following someone.';
  if (w.siege) {
    const left = (w.siege.day * 1440 + w.siege.minute) - absNow();
    if (w.siege.warned || left < 36 * 60) return 'Trouble is coming to your home soon (see the Journal). Stay and get ready.';
  }
  if (/_siege$|^first_siege$|^probe$|_probe$|^phone_call$|_assault$/.test(s.story.step) && !visiting()) return 'Not now — the story needs you at home (see your objective).';
  return null;
}

/** Towns Frank can go back to: everything he's already left behind. */
export function visitableChapters() {
  const out = [];
  for (let n = 1; n < Math.min(G.s.chapter, LAST_CHAPTER); n++) out.push(n);
  return out;
}

/** Options for the car while living in the active chapter (on the home or town map). */
export function visitOptions() {
  const opts = [];
  if (G.endless || G.prequel) return opts;
  for (const n of visitableChapters()) {
    const h = travelHours(G.s.chapter, n), g = gasCost(h);
    opts.push({ label: `Drive back to ${CHAPTERS[n].place} (${h} h on the road${g ? `, $${g} gas` : ''})`, action: () => askVisit(n) });
  }
  return opts;
}

function askVisit(n) {
  const why = travelBlocker();
  if (why) { toast(why, 'warn', 3.5); return; }
  if (G.s.job) { toast('Finish or abandon your current job first (Journal).', 'warn', 3); return; }
  const h = travelHours(G.s.chapter, n), g = gasCost(h);
  if (G.s.money < g) { toast(`Gas for the trip is $${g}. You don't have it.`, 'warn', 3); return; }
  hooks.confirm(`Drive back to ${CHAPTERS[n].place}? About ${h} hours on the road${g ? ` and $${g} in gas` : ''}. Your home in ${chapter().place} stays as it is — come back whenever you like.${G.s.companion && G.s.companion.dog && G.s.companion.dog.owned ? ' Duke stays home and guards the place.' : ''}`, 'Drive', () => startVisit(n), 'Not now');
}

export function startVisit(n) {
  if (G.transition || visiting() || n >= G.s.chapter) return false;
  const h = travelHours(G.s.chapter, n), g = gasCost(h);
  sfx('car');
  G.transition = {
    t: 0, fade: 0, phase: 'out', text: `The long road back to ${CHAPTERS[n].place}…`,
    mid: () => {
      if (g) addMoney(-g);
      advanceMinutes(h * 60);
      G.s.visit = { ch: n, since: absNow(), met: {} };
      onVisitStart();
      const lv = G.s.life.visits;
      lv[n] = (lv[n] || 0) + 1;
      hooks.buildMaps();
      const arrive = CHAPTERS[n].workMap;
      hooks.loadMap(arrive, G.maps[arrive].points.car);
      saveGame('visit', { force: true });
    },
    done: () => arrival(n),
  };
  return true;
}

function arrival(n) {
  const first = G.s.life.visits[n] === 1;
  const lines = (first ? ARRIVALS[n] && ARRIVALS[n](G.s) : null) || [{ who: 'Frank', text: `${CHAPTERS[n].place}. It looks smaller than you remember. It always will.` }];
  playDialogue(lines, () => banner(`Visiting ${CHAPTERS[n].place}. Your home is in ${chapter().place} — drive back from your car whenever you like.`, 'objective', 6));
  if (first) addXP(20, `Back in ${CHAPTERS[n].place}`);
  G.events.emit('visitStart', n);
}

/** Options for the car while visiting. */
export function visitCarOptions() {
  const n = hereN(), ch = CHAPTERS[n];
  const opts = [];
  if (ch.maps.length > 1) {
    const other = ch.maps.find((id) => id !== G.map.id);
    if (other) opts.push({ label: `Drive to ${G.maps[other].name} (20 min)`, action: () => hooks.travel(other, 'car') });
  }
  const h = travelHours(n, G.s.chapter);
  opts.push({ label: `Drive home to ${chapter().place} (${h} h)`, action: () => endVisit() });
  const st = oldHomeStatus(n);
  const host = st.keeper && NPCS[st.keeper] && relOf(st.keeper) >= 2 ? NPCS[st.keeper].name.split(' ')[0].replace(/"/g, '') : null;
  if (!st.open) opts.push({ label: host ? `Stay the night at ${host}'s (sleep until morning)` : 'Get a motel room ($20, sleep until morning)', action: () => overnight(host) });
  return opts;
}

function overnight(host) {
  if (!host && G.s.money < 20) { toast('A room is $20.', 'warn'); return; }
  if (!host) addMoney(-20);
  if (hooks.sleep('night')) toast(host ? `${host} makes up the couch. "Shoes off."` : 'The Starlite has a vacancy. It always has a vacancy.', 'info', 3);
}

export function endVisit() {
  if (!visiting() || G.transition) return false;
  if (G.s.job) { toast('Finish or abandon the job you took here first (Journal).', 'warn', 3); return false; }
  const n = G.s.visit.ch, v = G.s.visit;
  const h = travelHours(n, G.s.chapter);
  sfx('car');
  G.transition = {
    t: 0, fade: 0, phase: 'out', text: `Heading home to ${chapter().place}…`,
    mid: () => {
      advanceMinutes(h * 60);
      G.s.visit = null;
      onVisitEnd(v);
      hooks.buildMaps();
      const m = G.maps[homeMapId()];
      hooks.loadMap(m.id, m.points.car);
      saveGame('visit', { force: true });
    },
    done: () => { banner(`Home again — ${chapter().place}.`, 'info', 3); G.events.emit('visitEnd', n); },
  };
  return true;
}

/** Is this map an old town Frank is only visiting? */
export const isVisitMap = (mapId = G.map && G.map.id) => visiting() && CHAPTERS[G.s.visit.ch].maps.includes(mapId);

/** The first time Frank talks to an old friend on a visit, they react to his return. */
export function reunionTalk(id) {
  if (!visiting() || !NPCS[id]) return false;
  const v = G.s.visit;
  v.met = v.met || {};
  if (v.met[id]) return false;
  const f = REUNIONS[id];
  const lines = f && f(G.s, G.s.life.visits[v.ch] || 1);
  if (!lines || !lines.length) return false;
  v.met[id] = true;
  playDialogue(lines, () => { if (dailyAllow('reunion:' + id)) addRel(id, 4); G.events.emit('reunion', id); });
  return true;
}

export { dialogueActive };
