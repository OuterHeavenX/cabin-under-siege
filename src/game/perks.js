// Perks: lasting rewards from the people you help. Each storyline ends with one.
import { G } from './state.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';

export const PERKS = {
  field_medic: { icon: '🩹', name: 'Field Medic', from: 'Ruth', desc: 'Bandages and first-aid kits heal 50% more.' },
  store_tab: { icon: '🧾', name: 'Dee\'s Tab', from: 'Dee', desc: '10% off at Marsh General, and Dee passes on what she hears.' },
  mill_hand: { icon: '🪚', name: 'Mill Hand', from: 'Gus', desc: 'Repairs cost 1 less wood and job pay is 10% higher.' },
  card_sharp: { icon: '🃏', name: 'Card Sharp', from: 'Old Man Tibbs', desc: 'You read the table: see one opponent card at poker.' },
  tracker: { icon: '🦌', name: 'Tracker', from: 'Mr. Henderson', desc: 'Animals and footprints show up from farther away; deer spook less.' },
  marksman: { icon: '🎯', name: 'Marksman', from: 'the county fair', desc: 'Tighter aim with every gun.' },
};

export const hasPerk = (id) => !!(G.s && G.s.perks && G.s.perks[id]);

export function grantPerk(id) {
  const p = PERKS[id];
  if (!p || hasPerk(id)) return false;
  (G.s.perks || (G.s.perks = {}))[id] = G.s.time.day;
  sfx('chime');
  toast(`${p.icon} New perk — ${p.name}: ${p.desc}`, 'good', 5);
  G.events.emit('perk', id);
  return true;
}

export const ownedPerks = () => Object.keys(PERKS).filter(hasPerk).map((id) => ({ id, ...PERKS[id] }));
