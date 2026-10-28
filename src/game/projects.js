// Home projects: things you build at your place over several days — a
// workshop, a watchtower, a police scanner, a smokehouse. Each needs
// materials up front and a day's work (the hammer minigame) per stage, and
// each changes how the place looks and what you can do there.
import { G } from './state.js';
import { TILE } from '../config.js';
import { SO } from '../world/map.js';
import { count, removeItem, addItem } from './inventory.js';
import { addMoney, addXP, addJP } from './progression.js';
import { openRepairGame } from '../ui/menus.js';
import { toast, banner } from '../ui/hud.js';
import { sfx } from '../audio.js';
import { saveGame } from './save.js';
import { homeMap, atHome } from './chapters.js';

export const PROJECTS = {
  workshop: { name: 'Workshop', icon: '🔨', days: 2, cost: { wood: 12, money: 40 }, desc: 'A real bench and a pegboard of tools. Board kits cost 1 less wood, and you can build steel shutters and bear traps yourself.' },
  watchtower: { name: 'Watchtower', icon: '🗼', days: 3, cost: { wood: 20 }, desc: 'A lookout over the treeline. Attackers are marked the moment they arrive, and you see farther at night.' },
  radio: { name: 'Police Scanner', icon: '📻', days: 1, cost: { wood: 2, money: 80 }, desc: 'A scanner wired to an antenna on the roof. You hear trouble coming an hour sooner — and you hear other things too.' },
  smokehouse: { name: 'Smokehouse', icon: '🏚', days: 2, cost: { wood: 10 }, desc: 'Smoke venison into jerky: light, keeps forever, sells well (2 venison → 3 jerky).' },
};

const recs = () => (G.s.home.projects || (G.s.home.projects = {}));
export const projectDone = (id) => !!(G.s.home && G.s.home.projects && G.s.home.projects[id] && G.s.home.projects[id].done);
const costText = (c) => [c.wood ? `${c.wood} wood` : '', c.money ? `$${c.money}` : ''].filter(Boolean).join(' + ');

/** Props for the build sites on the home map. */
export function projectProps(mapId) {
  const m = G.maps[mapId];
  if (!m || mapId !== homeMap()?.id || !m.homeInfo || !m.homeInfo.projectSpots) return [];
  return Object.entries(m.homeInfo.projectSpots).map(([id, [x, y, w, h]]) => ({ id: 'proj_' + id, kind: 'project', project: id, x: (x + w / 2) * TILE, y: (y + h + 0.4) * TILE, r: 46, label: PROJECTS[id].name }));
}

export function projectAction(pr) {
  const id = pr.project, P = PROJECTS[id];
  const r = recs()[id];
  if (r && r.done) {
    if (id === 'smokehouse') return { label: count('venison') >= 2 ? 'Smoke venison into jerky (2 → 3)' : 'Smokehouse (needs 2 venison)', short: 'SMOKE', action: () => smoke() };
    if (id === 'radio') return { label: 'Listen to the scanner', short: 'LISTEN', action: () => G.events.emit('scanner') };
    return { label: `${P.icon} ${P.name} (built)`, short: 'LOOK', action: () => toast(P.desc, 'info', 4) };
  }
  if (!r) return { label: `Build a ${P.name} — ${costText(P.cost)}, ${P.days} day${P.days > 1 ? 's' : ''} of work`, short: 'BUILD', action: () => begin(id) };
  if (r.lastDay === G.s.time.day) return { label: `${P.name}: done for today (${r.progress}/${P.days})`, short: 'LOOK', action: () => toast('That\'s enough for today. Come back tomorrow.', 'info') };
  return { label: `Work on the ${P.name} (day ${r.progress + 1} of ${P.days})`, short: 'BUILD', prio: 1, action: () => work(id) };
}

function begin(id) {
  const P = PROJECTS[id];
  if (count('toolkit') < 1) { toast('You need a Toolkit to build anything.', 'warn', 3); return; }
  if (count('wood') < (P.cost.wood || 0)) { toast(`You need ${P.cost.wood} wood (you have ${count('wood')}).`, 'warn', 3); return; }
  if (G.s.money < (P.cost.money || 0)) { toast(`You need $${P.cost.money}.`, 'warn', 3); return; }
  if (P.cost.wood) removeItem('wood', P.cost.wood);
  if (P.cost.money) addMoney(-P.cost.money);
  recs()[id] = { progress: 0, lastDay: -1, done: false };
  toast(`${P.icon} Materials laid out for the ${P.name}. Time to build.`, 'info', 3);
  work(id);
}

function work(id) {
  const P = PROJECTS[id], r = recs()[id];
  if (count('toolkit') < 1) { toast('You need a Toolkit.', 'warn'); return; }
  openRepairGame({ title: `${P.icon} ${P.name} — day ${r.progress + 1} of ${P.days}`, hits: 4, onDone: () => {
    r.progress++; r.lastDay = G.s.time.day;
    addJP('handyman', 6, 'project', 18);
    if (r.progress >= P.days) {
      r.done = true;
      sfx('jobDone');
      addXP(50, P.name);
      banner(`${P.icon} ${P.name} finished! ${P.desc}`, 'good', 6);
      G.events.emit('projectDone', id);
    } else { sfx('hammer'); toast(`${P.name}: ${r.progress}/${P.days} days of work. Come back tomorrow.`, 'info', 3); }
    G.events.emit('projectsChanged');
    saveGame('project');
  } });
}

function smoke() {
  if (count('venison') < 2) { toast('Hunt a deer first: you need 2 venison.', 'warn', 3); return; }
  removeItem('venison', 2); addItem('jerky', 3, true);
  sfx('fire'); toast('A few hours in the smoke: 3 strips of jerky.', 'item', 3);
}

/** Put built (and half-built) projects on the home map. */
export function applyProjects(m) {
  if (!m || !m.homeInfo || !m.homeInfo.projectSpots) return;
  m.decor = m.decor.filter((d) => !d.project);
  for (const [id, [x, y, w, h]] of Object.entries(m.homeInfo.projectSpots)) {
    const r = recs()[id];
    if (!r) continue;
    for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) {
      const i = m.idx(cx, cy);
      if (m.trees.has(i)) m.trees.delete(i);
      m.solid[i] = SO.FURN;
    }
    m.decor.push({ kind: r.done ? id : 'scaffold', x, y, w, h, project: id, stage: r.progress / PROJECTS[id].days });
  }
}

export const homeHasProject = (id) => atHome() && projectDone(id);
