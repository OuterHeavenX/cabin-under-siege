// Perks: lasting rewards from the people you help. Each storyline ends with one.
import { G } from './state.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';

// eff: pay (job pay ×), heal (healing ×), spread (aim spread ×), warn (+minutes of
// attack warning), stam (+max stamina), shop (owner id: 10% off there).
export const PERKS = {
  field_medic: { icon: '🩹', name: 'Field Medic', from: 'Ruth', desc: 'Bandages and first-aid kits heal 50% more.', eff: { heal: 1.5 } },
  store_tab: { icon: '🧾', name: 'Dee\'s Tab', from: 'Dee', desc: '10% off at Marsh General, and Dee passes on what she hears.', eff: { shop: 'dee' } },
  mill_hand: { icon: '🪚', name: 'Mill Hand', from: 'Gus', desc: 'Repairs cost 1 less wood and job pay is 10% higher.', eff: { pay: 1.1 } },
  card_sharp: { icon: '🃏', name: 'Card Sharp', from: 'Old Man Tibbs', desc: 'You read the table: see one opponent card at poker.' },
  tracker: { icon: '🦌', name: 'Tracker', from: 'Mr. Henderson', desc: 'Animals and footprints show up from farther away; deer spook less.' },
  marksman: { icon: '🎯', name: 'Marksman', from: 'the county fair', desc: 'Tighter aim with every gun.', eff: { spread: 0.85 } },
  // Chapter 2
  ham_radio: { icon: '📡', name: 'Plate Log', from: 'Marcus', desc: 'Marcus radios you when strange cars come through: 45 more minutes of warning before an attack.', eff: { warn: 45 } },
  rosas_account: { icon: '🔧', name: 'Rosa\'s Account', from: 'Rosa', desc: '10% off at Delgado Hardware.', eff: { shop: 'rosa' } },
  strong_back: { icon: '📦', name: 'Strong Back', from: 'Pete', desc: '+15 max stamina and 10% better job pay.', eff: { stam: 15, pay: 1.1 } },
  // Chapter 3
  farm_hands: { icon: '🐄', name: 'Farm Hands', from: 'Ingrid', desc: '+20 max stamina. Ingrid works you like her father worked her.', eff: { stam: 20 } },
  feed_store_credit: { icon: '🌾', name: 'Feed Store Credit', from: 'Bo', desc: '10% off at Lindqvist Feed & Supply.', eff: { shop: 'bo' } },
  back_roads: { icon: '🚚', name: 'Back Roads', from: 'Tess', desc: 'Tess\'s shortcuts: 10% better job pay.', eff: { pay: 1.1 } },
  // Chapter 4
  navy_drill: { icon: '⚓', name: 'Navy Drill', from: 'Walt', desc: 'Walt\'s range lessons: tighter aim.', eff: { spread: 0.9 } },
  marina_tab: { icon: '🛥', name: 'Marina Tab', from: 'Theo', desc: '10% off at Park\'s Marina.', eff: { shop: 'theo' } },
  old_money: { icon: '💍', name: 'Old Money', from: 'Mrs. Whitcombe', desc: 'Eleanor\'s friends pay well: 15% better job pay.', eff: { pay: 1.15 } },
  // Chapter 5
  corner_man: { icon: '🥊', name: 'Corner Man', from: 'Father Dom', desc: 'Dom taught you to take a punch: healing 25% stronger.', eff: { heal: 1.25 } },
  family_discount: { icon: '🥪', name: 'Family Discount', from: 'Angie', desc: '10% off at Marchetti\'s.', eff: { shop: 'angie' } },
  cop_eyes: { icon: '🚨', name: 'Cop\'s Eyes', from: 'Mickey', desc: 'Mickey\'s old scanner codes: 30 more minutes of warning before an attack.', eff: { warn: 30 } },
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

/** Combined effect of owned perks: multiplies for ×-effects, adds for the rest. */
export function perkEff(key) {
  const mult = key === 'pay' || key === 'heal' || key === 'spread';
  let v = mult ? 1 : 0;
  for (const id of Object.keys(PERKS)) {
    const e = PERKS[id].eff;
    if (!e || e[key] == null || !hasPerk(id)) continue;
    v = mult ? v * e[key] : v + e[key];
  }
  return v;
}
export const perkShop = (owner) => Object.keys(PERKS).some((id) => PERKS[id].eff && PERKS[id].eff.shop === owner && hasPerk(id));
