// Inventory helpers and consumable use.
import { G } from './state.js';
import { ITEMS } from '../data/items.js';
import { derived, addJP } from './progression.js';
import { toast } from '../ui/hud.js';
import { sfx } from '../audio.js';

export const count = (id) => G.s.inv[id] || 0;

/** Adds up to n units (respecting the carry cap). Returns how many were added. */
export function addItem(id, n = 1, quiet = false) {
  const def = ITEMS[id];
  if (!def) return 0;
  const have = count(id);
  const add = Math.max(0, Math.min(n, def.cap - have));
  if (add > 0) G.s.inv[id] = have + add;
  if (!quiet && add > 0) toast(`+${add} ${def.name}`, 'item');
  if (!quiet && add < n) toast(`Can't carry more ${def.name} (max ${def.cap})`, 'warn');
  return add;
}

export function removeItem(id, n = 1) {
  const have = count(id);
  if (have < n) return false;
  G.s.inv[id] = have - n;
  if (G.s.inv[id] <= 0) delete G.s.inv[id];
  return true;
}

export function quickItem() {
  if (G.s.quick && count(G.s.quick) > 0) return G.s.quick;
  // Fall back to the first available healing/food item.
  for (const id of ['bandage', 'medkit', 'stew', 'sandwich']) if (count(id) > 0) return id;
  return null;
}

/** Use a consumable (healing or food). Returns true on success. */
export function useConsumable(id) {
  const def = ITEMS[id];
  const p = G.player;
  if (!def || !def.quick || count(id) <= 0) return false;
  const d = derived();
  if (p.hp >= d.maxHp && (!def.stamina || p.stamina >= d.maxStamina) && !def.regenBuff) {
    toast('Already at full health.', 'warn');
    return false;
  }
  removeItem(id, 1);
  const heal = Math.round((def.heal || 0) * d.healMult);
  p.hp = Math.min(d.maxHp, p.hp + heal);
  if (def.stamina) p.stamina = d.maxStamina;
  if (def.regenBuff) p.regenBuff = def.regenBuff;
  if (def.wellFed) { p.wellFed = def.wellFed; toast('Well Fed: +10% max health, +25 stamina for a while.', 'good', 3); }
  sfx(def.food ? 'eat' : 'heal');
  toast(`Used ${def.name}: +${heal} HP`, 'heal');
  addJP('survivor', 2, 'consume', 5);
  return true;
}
