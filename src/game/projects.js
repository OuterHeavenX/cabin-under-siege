// Home projects: things you build at your place over several days — a
// workshop, a watchtower, a scanner, a smokehouse, a generator, a garden, a
// kennel for Duke, a hidden supply cache, a home that feels like one — plus
// restoring your car, which comes with you from home to home. Each needs
// materials up front and a day's work (the hammer minigame) per stage. Nothing
// decays: stop whenever you like and pick it back up later, or cancel for half
// the materials back. Each changes how the place looks and what you can do.
import { G, hasSkill } from './state.js';
import { TILE } from '../config.js';
import { SO, GR } from '../world/map.js';
import { count, removeItem, addItem } from './inventory.js';
import { addMoney, addXP, addJP } from './progression.js';
import { openRepairGame, openActions } from '../ui/menus.js';
import { toast, banner } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { homeMap, atHome, chapter } from './chapters.js';
import { hasPerk } from './perks.js';
import { stepAtLeast } from './life.js';

const ALL = ['cabin', 'house', 'farm', 'estate', 'watchhouse'];
export const PROJECTS = {
  workshop: { name: 'Workshop', icon: '🔨', days: 2, cost: { wood: 12, money: 40 }, desc: 'A real bench and a pegboard of tools. Board kits cost 1 less wood, and you can build steel shutters and bear traps yourself.' },
  watchtower: { name: 'Watchtower', icon: '🗼', days: 3, cost: { wood: 20 }, desc: 'A lookout over the treeline. Attackers are marked the moment they arrive, and you see farther at night.' },
  radio: { name: 'Police Scanner', icon: '📻', days: 1, cost: { wood: 2, money: 80 }, desc: 'A scanner wired to an antenna on the roof. You hear trouble coming an hour sooner — and you hear other things too.' },
  smokehouse: { name: 'Smokehouse', icon: '🏚', days: 2, cost: { wood: 10 }, desc: 'Smoke venison into jerky: light, keeps forever, sells well (2 venison → 3 jerky).' },
  // ---- The Longer Life ----
  generator: { name: 'Backup Generator', icon: '⚡', days: 2, cost: { wood: 6, money: 120 }, size: [2, 1], desc: 'If someone cuts your power during an attack, the generator brings the porch light and floodlight back after a few seconds.' },
  garden: { name: 'Kitchen Garden', farmName: 'Greenhouse', icon: '🥕', days: 2, cost: { wood: 8, money: 20 }, size: [3, 2], desc: 'Every morning there are fresh vegetables to pick (2 a day) — for cooking, gifts or the co-op.' },
  kennel: { name: 'Kennel & Training Yard', icon: '🐕', days: 3, cost: { wood: 10, money: 40 }, size: [2, 2], needsDog: true, desc: 'A day of training with Duke per stage. A trained Duke spots attackers from farther away, bites harder and pins them longer.' },
  cache: { name: 'Hidden Supply Cache', icon: '📦', days: 1, cost: { wood: 4, money: 30 }, size: [1, 1], desc: 'A dry box buried behind the house. It restocks a bandage and 8 rounds every 3 days, and if you black out at home, the cash you hid there means you lose nothing.' },
  comfort: { name: 'Make It a Home', icon: '🛋', days: 2, cost: { wood: 8, money: 60 }, size: [1, 1], desc: 'A proper chair, a rug, a photo on the wall. A full night\'s sleep at home leaves you well rested (faster stamina for a while).' },
};
// Car restoration lives in the save's `life.car` and travels with you.
export const CAR = { name: 'Restore the Car', icon: '🚗', days: 3, cost: { wood: 4, money: 150 }, desc: 'An engine rebuild, new hoses, new tires. No more breakdowns, long drives to old towns are 40% shorter, and gas is free (you know a guy).' };

const homeId = () => (G.s.home && G.s.home.id) || 'cabin';
const recs = () => (G.s.home.projects || (G.s.home.projects = {}));
export const projectDone = (id) => !!(G.s && G.s.home && G.s.home.projects && G.s.home.projects[id] && G.s.home.projects[id].done);
export const projectName = (id, hid = homeId()) => (hid === 'farm' && PROJECTS[id].farmName) || PROJECTS[id].name;
const costText = (c) => [c.wood ? `${c.wood} wood` : '', c.money ? `$${c.money}` : ''].filter(Boolean).join(' + ');

/** What a project costs now (Efficient Construction takes a quarter off). */
export function projectCost(base) {
  const k = hasSkill('efficient_construction') ? 0.75 : 1;
  return { wood: base.wood ? Math.ceil(base.wood * k) : 0, money: base.money ? Math.round(base.money * k) : 0 };
}
/** What was actually paid (older saves didn't record it: assume the list price). */
export const paidOf = (r, P) => r.paid || { wood: P.cost.wood || 0, money: P.cost.money || 0 };
const daysOf = (id) => (id === 'car' ? CAR.days - (hasPerk('mechanic') ? 1 : 0) : PROJECTS[id].days);
const defOf = (id) => (id === 'car' ? CAR : PROJECTS[id]);

/** Can this project be built at this home at all? */
export function projectAvailable(id) {
  const P = PROJECTS[id];
  if (!P) return false;
  if (P.needsDog && !(G.s.companion && G.s.companion.dog && G.s.companion.dog.owned)) return false;
  return true;
}

/* ---------------- build sites ---------------- */
/** New projects get a site picked near the house: open ground, off paths and points of interest. */
export function ensureProjectSpots(m, avoid = [], projects = null) {
  if (!m || !m.homeInfo) return;
  const spots = m.homeInfo.projectSpots || (m.homeInfo.projectSpots = {});
  // A site that's already been built on stays where it is, whatever else changes.
  for (const [id, r] of Object.entries(projects || {})) if (r && Array.isArray(r.spot) && r.spot.length === 4 && !spots[id]) spots[id] = r.spot;
  const b = m.buildings.find((x) => x.isHome);
  if (!b) return;
  const cx0 = b.x + b.w / 2, cy0 = b.y + b.h / 2;
  const taken = (x, y, w, h) => Object.values(spots).some(([sx, sy, sw, sh]) => x < sx + sw + 1 && x + w + 1 > sx && y < sy + sh + 1 && y + h + 1 > sy);
  const pts = [...Object.values(m.points || {}), ...Object.values(m.spawns || {})].filter((p) => p && isFinite(p.x));
  for (const [ax, ay] of avoid) pts.push({ x: ax * TILE, y: ay * TILE });
  const nearPoint = (x, y, w, h) => pts.some((p) => p.x / TILE > x - 1.5 && p.x / TILE < x + w + 1.5 && p.y / TILE > y - 1.5 && p.y / TILE < y + h + 1.5);
  const ok = (x, y, w, h) => {
    for (let cy = y - 1; cy <= y + h; cy++) for (let cx = x - 1; cx <= x + w; cx++) {
      if (!m.inBounds(cx, cy)) return false;
      const inner = cx >= x && cx < x + w && cy >= y && cy < y + h;
      const g = m.ground[m.idx(cx, cy)];
      if (g === GR.ROAD || g === GR.WATER || g === GR.FLOOR || g === GR.PORCH || g === GR.TILEFLOOR || g === GR.ROADLINE || g === GR.GARDEN || g === GR.SIDEWALK) return false;
      if (m.blockerAt(cx, cy)) return false;
      const so = m.getSolid(cx, cy);
      if (inner && so !== SO.NONE && so !== SO.TREE) return false;
      if (!inner && so === SO.WALL) return false;
    }
    return true;
  };
  for (const id of Object.keys(PROJECTS)) {
    if (spots[id] || !PROJECTS[id].size) continue;
    const [w, h] = PROJECTS[id].size;
    let best = null;
    for (let r = Math.max(b.w, b.h) / 2 + 2; r < 16 && !best; r++) {
      for (let a = 0; a < 48 && !best; a++) {
        const ang = (a / 48) * Math.PI * 2;
        const x = Math.round(cx0 + Math.cos(ang) * r - w / 2), y = Math.round(cy0 + Math.sin(ang) * r - h / 2);
        if (ok(x, y, w, h) && !taken(x, y, w, h) && !nearPoint(x, y, w, h)) best = [x, y, w, h];
      }
    }
    if (best) spots[id] = best;
  }
}

/** Props for the build sites on the home map. */
export function projectProps(mapId) {
  const m = G.maps[mapId];
  if (!m || mapId !== homeMap()?.id || !m.homeInfo || !m.homeInfo.projectSpots) return [];
  return Object.entries(m.homeInfo.projectSpots).filter(([id]) => PROJECTS[id] && (projectAvailable(id) || recs()[id])).map(([id, [x, y, w, h]]) => ({ id: 'proj_' + id, kind: 'project', project: id, x: (x + w / 2) * TILE, y: (y + h + 0.4) * TILE, r: 46, label: projectName(id) }));
}

export function projectAction(pr) {
  const id = pr.project, P = PROJECTS[id];
  const r = recs()[id];
  const name = projectName(id);
  if (r && r.done) {
    if (id === 'smokehouse') return { label: count('venison') >= 2 ? 'Smoke venison into jerky (2 → 3)' : 'Smokehouse (needs 2 venison)', short: 'SMOKE', action: () => smoke() };
    if (id === 'radio') return { label: 'Listen to the scanner', short: 'LISTEN', action: () => G.events.emit('scanner') };
    if (id === 'garden') { const n = G.s.home.gardenReady || 0; return { label: n ? `Pick vegetables (${n})` : `${name} (more tomorrow)`, short: n ? 'PICK' : 'LOOK', prio: n ? 1 : -1, action: () => pickGarden() }; }
    if (id === 'cache') return { label: cacheReadyIn() ? `Supply cache (restocks in ${cacheReadyIn()} day${cacheReadyIn() > 1 ? 's' : ''})` : 'Open the supply cache', short: 'OPEN', prio: cacheReadyIn() ? -1 : 1, action: () => openCache() };
    if (id === 'kennel') return { label: `${P.icon} ${name} — Duke is trained`, short: 'LOOK', action: () => toast(P.desc, 'info', 4) };
    return { label: `${P.icon} ${name} (built)`, short: 'LOOK', action: () => toast(P.desc, 'info', 4) };
  }
  const c = projectCost(P.cost);
  if (!r) return { label: `Build: ${name} — ${costText(c)}, ${P.days} day${P.days > 1 ? 's' : ''} of work`, short: 'BUILD', action: () => begin(id) };
  const today = r.lastDay === G.s.time.day;
  return { label: today ? `${name}: done for today (${r.progress}/${P.days})` : `Work on the ${name} (day ${r.progress + 1} of ${P.days})`, short: today ? 'LOOK' : 'BUILD', prio: today ? 0 : 1, action: () => openActions(`${P.icon} ${name} — ${r.progress}/${P.days} days`, [
    { label: today ? 'Done for today — come back tomorrow' : `Put in a day's work (day ${r.progress + 1})`, disabled: today, action: () => work(id) },
    { label: `Cancel the project (get back ${Math.floor(paidOf(r, P).wood / 2)} wood and $${Math.floor(paidOf(r, P).money / 2)})`, action: () => cancel(id) },
  ]) };
}

function canPay(c, need) {
  if (count('toolkit') < 1) { toast('You need a Toolkit to build anything.', 'warn', 3); return false; }
  if (count('wood') < c.wood) { toast(`You need ${c.wood} wood (you have ${count('wood')}).`, 'warn', 3); return false; }
  if (G.s.money < c.money) { toast(`You need $${c.money}.`, 'warn', 3); return false; }
  return need();
}

function begin(id) {
  const P = PROJECTS[id], c = projectCost(P.cost);
  if (!canPay(c, () => true)) return;
  if (c.wood) removeItem('wood', c.wood);
  if (c.money) addMoney(-c.money);
  const site = homeMap() && homeMap().homeInfo && homeMap().homeInfo.projectSpots && homeMap().homeInfo.projectSpots[id];
  recs()[id] = { progress: 0, lastDay: -1, done: false, paid: c, started: G.s.time.day, spot: site ? [...site] : null };
  toast(`${P.icon} Materials laid out for the ${projectName(id)}. Time to build.`, 'info', 3);
  G.events.emit('projectsChanged');
  work(id);
}

function cancel(id) {
  const r = recs()[id];
  if (!r || r.done) return;
  const paid = paidOf(r, PROJECTS[id]);
  const back = { wood: Math.floor(paid.wood / 2), money: Math.floor(paid.money / 2) };
  if (back.wood) addItem('wood', back.wood, true);
  if (back.money) addMoney(back.money, 'refund');
  delete recs()[id];
  toast(`${projectName(id)} cancelled. You salvaged ${costText(back) || 'nothing'}.`, 'info', 3);
  G.events.emit('projectsChanged');
  saveGame('project');
}

/** A day's work (the hammer minigame). Kennel days are training sessions with Duke. */
export function work(id, { free = false } = {}) {
  const P = defOf(id);
  const r = id === 'car' ? G.s.life.car : recs()[id];
  if (!r) return;
  const finish = () => {
    r.progress++; r.lastDay = G.s.time.day;
    addJP('handyman', 6, 'project', 18);
    if (r.progress >= daysOf(id)) {
      r.done = true;
      sfx('jobDone');
      addXP(50, P.name);
      banner(`${P.icon} ${id === 'car' ? P.name.replace('Restore the', 'Restored:') : projectName(id)} finished! ${P.desc}`, 'good', 6);
      G.events.emit('projectDone', id);
    } else { sfx('hammer'); toast(`${id === 'car' ? 'The car' : projectName(id)}: ${r.progress}/${daysOf(id)} days of work.${free ? '' : ' Come back tomorrow.'}`, 'info', 3); }
    G.events.emit('projectsChanged');
    saveGame('project');
  };
  if (free) { finish(); return; }
  if (count('toolkit') < 1) { toast('You need a Toolkit.', 'warn'); return; }
  const title = id === 'kennel' ? `🐕 Training Duke — session ${r.progress + 1} of ${daysOf(id)}` : `${P.icon} ${id === 'car' ? 'The car' : projectName(id)} — day ${r.progress + 1} of ${daysOf(id)}`;
  openRepairGame({ title, hits: 4, onDone: finish });
}

/** A friend's help (Trusted Friend): a day of progress on whatever you're building. */
export function helpOnProject() {
  const open = Object.entries(recs()).find(([, r]) => r && !r.done);
  if (open) { work(open[0], { free: true }); return projectName(open[0]); }
  const car = G.s.life.car;
  if (car.started && !car.done) { work('car', { free: true }); return 'the car'; }
  return null;
}

function smoke() {
  if (count('venison') < 2) { toast('Hunt a deer first: you need 2 venison.', 'warn', 3); return; }
  removeItem('venison', 2); addItem('jerky', 3, true);
  sfx('fire'); toast('A few hours in the smoke: 3 strips of jerky.', 'item', 3);
}

/* ---------------- benefits ---------------- */
function pickGarden() {
  const n = G.s.home.gardenReady || 0;
  if (!n) { toast('Nothing ripe today. Tomorrow.', 'info'); return; }
  G.s.home.gardenReady = 0;
  addItem('vegetables', n, true);
  sfx('pickup');
  toast(`Picked ${n} vegetables.`, 'item', 2);
  G.events.emit('cropPicked', n);
}
const cacheReadyIn = () => Math.max(0, ((G.s.home.cacheDay ?? -99) + 3) - G.s.time.day);
function openCache() {
  if (cacheReadyIn()) { toast(`It restocks every 3 days. (${cacheReadyIn()} to go.)`, 'info', 2.5); return; }
  G.s.home.cacheDay = G.s.time.day;
  addItem('bandage', 1, true); addItem('ammo', 8, true);
  sfx('pickup');
  toast('From the cache: a bandage and 8 rounds.', 'item', 3);
}
export const dogTrained = () => projectDone('kennel');
export const cacheProtects = () => projectDone('cache');

/** Morning chores the projects do for you. */
export function projectsMorning() {
  if (!G.s || !G.s.home) return;
  if (projectDone('garden')) G.s.home.gardenReady = 2;
}

/* ---------------- the car ---------------- */
export function carProjectOption() {
  const car = G.s.life.car;
  if (car.done || G.endless || G.prequel || !atHome()) return null;
  // Offered once Frank has settled into a routine (a job, a few days in), not on arrival.
  if (G.s.chapter === 1 && !stepAtLeast('ch1_life')) return null;
  const c = projectCost(CAR.cost);
  if (!car.started) return { label: `${CAR.icon} Start restoring the car — ${costText(c)}, ${daysOf('car')} days`, action: () => {
    if (!canPay(c, () => true)) return;
    if (c.wood) removeItem('wood', c.wood);
    if (c.money) addMoney(-c.money);
    Object.assign(car, { started: true, progress: 0, lastDay: -1, paid: c });
    work('car');
  } };
  if (car.lastDay === G.s.time.day) return { label: `${CAR.icon} The car: done for today (${car.progress}/${daysOf('car')})`, disabled: true, action: () => {} };
  return { label: `${CAR.icon} Work on the car (day ${car.progress + 1} of ${daysOf('car')})`, action: () => work('car') };
}

/** Put built (and half-built) projects on a home map. */
export function applyProjects(m, projects = null) {
  if (!m || !m.homeInfo || !m.homeInfo.projectSpots) return;
  const all = projects || recs();
  m.decor = m.decor.filter((d) => !d.project);
  for (const [id, [x, y, w, h]] of Object.entries(m.homeInfo.projectSpots)) {
    const r = all[id];
    if (!r || !PROJECTS[id]) continue;
    for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) {
      const i = m.idx(cx, cy);
      if (m.trees.has(i)) m.trees.delete(i);
      m.solid[i] = id === 'garden' && r.done ? SO.NONE : SO.FURN;
    }
    m.decor.push({ kind: r.done ? (id === 'garden' && m.homeInfo && m.id === 'farm' ? 'greenhouse_p' : id) : 'scaffold', x, y, w, h, project: id, stage: r.progress / PROJECTS[id].days });
  }
}

/** Home tab / Journal: every project at this home and the car. */
export function projectList() {
  const out = [];
  for (const [id, P] of Object.entries(PROJECTS)) {
    const r = recs()[id];
    if (!projectAvailable(id) && !r) continue;
    const site = !!(homeMap() && homeMap().homeInfo && homeMap().homeInfo.projectSpots && homeMap().homeInfo.projectSpots[id]);
    out.push({ id, icon: P.icon, name: projectName(id), desc: P.desc, cost: costText(projectCost(P.cost)), days: P.days, progress: r ? r.progress : 0, done: !!(r && r.done), started: !!r, today: !!(r && r.lastDay === G.s.time.day), site, home: chapter().place });
  }
  const car = G.s.life.car;
  out.push({ id: 'car', icon: CAR.icon, name: CAR.name, desc: CAR.desc, cost: costText(projectCost(CAR.cost)), days: daysOf('car'), progress: car.progress || 0, done: !!car.done, started: !!car.started, today: car.lastDay === G.s.time.day, site: true, home: 'Travels with you (work on it at your car)' });
  return out;
}

export const homeHasProject = (id) => atHome() && projectDone(id);
