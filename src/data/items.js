// Item definitions. `cap` is the carry limit. `price` is the shop price for one
// purchase (which yields `qty` units). Items with `oneTime` are permanent upgrades.

export const ITEMS = {
  ammo: {
    name: '9mm Rounds', icon: '•', cat: 'Ammunition', cap: 144, sell: 0.4,
    desc: 'Handgun ammunition. Reload with R or the RELOAD button.',
  },
  shells: {
    name: 'Shotgun Shells', icon: '▮', cat: 'Ammunition', cap: 48, sell: 0.8,
    desc: '12-gauge buckshot for the pump shotgun.',
  },
  rifle_ammo: {
    name: 'Rifle Rounds', icon: '❘', cat: 'Ammunition', cap: 40, sell: 1,
    desc: '.30-06 rounds for the hunting rifle.',
  },
  shotgun: {
    name: 'Pump Shotgun', icon: '💥', cat: 'Weapon', cap: 1, sell: 0, weapon: true,
    desc: 'Seven pellets per shell. Devastating at doorways, useless at range. Switch with 1/2/3, Tab, the mouse wheel or the SWAP button.',
  },
  rifle: {
    name: 'Hunting Rifle', icon: '🎯', cat: 'Weapon', cap: 1, sell: 0, weapon: true,
    desc: 'Huge damage at long range and punches through the first attacker. Slow to cycle and reload.',
  },
  bandage: {
    name: 'Bandage', icon: '✚', cat: 'Healing', cap: 10, heal: 30, sell: 4, quick: true,
    desc: 'Restores 30 health. Quick to apply.',
  },
  medkit: {
    name: 'First-Aid Kit', icon: '⛑', cat: 'Healing', cap: 4, heal: 75, sell: 14, quick: true,
    desc: 'Restores 75 health.',
  },
  sandwich: {
    name: 'Sandwich', icon: '🥪', cat: 'Food', cap: 8, heal: 12, stamina: 100, sell: 2, quick: true, food: true,
    desc: 'Restores 12 health and refills stamina.',
  },
  stew: {
    name: 'Canned Stew', icon: '🥫', cat: 'Food', cap: 8, heal: 25, stamina: 100, regenBuff: 90, sell: 4, quick: true, food: true,
    desc: 'Restores 25 health, refills stamina and boosts stamina regeneration for 90 seconds.',
  },
  wood: {
    name: 'Wood', icon: '🪵', cat: 'Materials', cap: 30, sell: 2,
    desc: 'Chopped from trees or bought. Used for repairs, crafting and woodcutting jobs.',
  },
  toolkit: {
    name: 'Toolkit', icon: '🧰', cat: 'Tools', cap: 1, sell: 10,
    desc: 'Hammer, nails and pliers. Required for repair jobs and fixing the phone line.',
  },
  board_kit: {
    name: 'Window Board Kit', icon: '▤', cat: 'Defense', cap: 6, sell: 10,
    desc: 'Board up a cabin window. Boards absorb damage before the window breaks and stop most bullets.',
  },
  door_brace: {
    name: 'Door Brace Kit', icon: '⛨', cat: 'Defense', cap: 2, sell: 30,
    desc: 'Reinforce a cabin door with steel brackets. Adds a lot of durability.',
  },
  shutter_kit: {
    name: 'Steel Shutter Kit', icon: '▥', cat: 'Defense', cap: 6, sell: 25,
    desc: 'Bolt steel shutters over a window (160 HP). Stops 90% of bullets and takes a beating before boards or glass give way.',
  },
  bear_trap: {
    name: 'Bear Trap', icon: '⚙', cat: 'Defense', cap: 6, sell: 12, place: 'trap',
    desc: 'Place on your property. Snaps on the first attacker who steps on it: heavy damage and pins them for a few seconds. Re-arm it afterwards.',
  },
  camera_kit: {
    name: 'Security Camera Kit', icon: '📷', cat: 'Upgrade', cap: 1, sell: 40, install: 'camera',
    desc: 'Install at home: during an attack every attacker on the property is marked on screen and on the map, even in the dark.',
  },
  sandbags: {
    name: 'Sandbags', icon: '▬', cat: 'Defense', cap: 4, sell: 15, place: 'sandbags',
    desc: 'Placeable cover (200 HP). Blocks bullets and movement. Place it from the inventory.',
  },
  barricade: {
    name: 'Wood Barricade', icon: '▦', cat: 'Defense', cap: 4, sell: 6, place: 'barricade',
    desc: 'Placeable cover made at the workbench (120 HP).',
  },
  floodlight_kit: {
    name: 'Floodlight Kit', icon: '💡', cat: 'Upgrade', cap: 1, sell: 25, install: 'floodlight',
    desc: 'Install on the cabin: lights the yard at night. Attackers in the light are always visible and their aim suffers from the glare.',
  },
  alarm_kit: {
    name: 'Tripwire Alarm Kit', icon: '🔔', cat: 'Upgrade', cap: 1, sell: 30, install: 'alarm',
    desc: 'Install on the cabin: warns you about 45 minutes earlier before an attack, wakes you, and reveals which directions attackers come from.',
  },
  ext_mag: {
    name: 'Extended Magazine', icon: '▮', cat: 'Upgrade', cap: 1, sell: 40, install: 'extMag',
    desc: 'Handgun magazine holds 12 rounds instead of 8. Applied immediately.',
  },
  burner: {
    name: 'Burner Phone', icon: '📱', cat: 'Story', cap: 1, sell: 0, story: true,
    desc: 'Taken from Sal Benedetto. One saved number, labeled only "L".',
  },
  note: {
    name: 'Folded Note', icon: '✉', cat: 'Story', cap: 1, sell: 0, story: true,
    desc: 'Found on the big man after the attack. "Pine Hollow. The cabin off Route 9."',
  },
};

// Shop catalogs. `qty` units are granted per purchase.
export const SHOPS = {
  dee: {
    name: "Marsh General Store",
    owner: 'dee',
    stock: [
      { id: 'ammo', qty: 12, price: 10 },
      { id: 'bandage', qty: 1, price: 8 },
      { id: 'medkit', qty: 1, price: 30 },
      { id: 'sandwich', qty: 1, price: 5 },
      { id: 'stew', qty: 1, price: 9 },
      { id: 'board_kit', qty: 1, price: 25 },
      { id: 'ext_mag', qty: 1, price: 90 },
      { id: 'shotgun', qty: 1, price: 160 },
      { id: 'shells', qty: 8, price: 12 },
      { id: 'rifle', qty: 1, price: 220 },
      { id: 'rifle_ammo', qty: 10, price: 15 },
    ],
  },
  gus: {
    name: 'Okafor Lumber & Hardware',
    owner: 'gus',
    stock: [
      { id: 'wood', qty: 2, price: 6 },
      { id: 'toolkit', qty: 1, price: 25 },
      { id: 'board_kit', qty: 1, price: 25 },
      { id: 'door_brace', qty: 1, price: 70 },
      { id: 'sandbags', qty: 1, price: 35 },
      { id: 'floodlight_kit', qty: 1, price: 60 },
      { id: 'alarm_kit', qty: 1, price: 75 },
      { id: 'shutter_kit', qty: 1, price: 55 },
      { id: 'bear_trap', qty: 1, price: 30 },
      { id: 'camera_kit', qty: 1, price: 90 },
    ],
  },
};

// Workbench crafting recipes (wood cost before Efficient Repairs).
export const RECIPES = [
  { id: 'board_kit', wood: 3, label: 'Window Board Kit' },
  { id: 'barricade', wood: 4, label: 'Wood Barricade' },
];

// Chapter 2: one store on Main Street carries a bit of everything.
SHOPS.rosa = {
  name: 'Delgado Hardware & Sporting',
  owner: 'rosa',
  stock: [
    { id: 'ammo', qty: 12, price: 10 }, { id: 'shells', qty: 8, price: 12 }, { id: 'rifle_ammo', qty: 10, price: 15 },
    { id: 'shotgun', qty: 1, price: 160 }, { id: 'rifle', qty: 1, price: 220 }, { id: 'ext_mag', qty: 1, price: 90 },
    { id: 'bandage', qty: 1, price: 8 }, { id: 'medkit', qty: 1, price: 30 }, { id: 'sandwich', qty: 1, price: 5 }, { id: 'stew', qty: 1, price: 9 },
    { id: 'wood', qty: 2, price: 6 }, { id: 'toolkit', qty: 1, price: 25 }, { id: 'board_kit', qty: 1, price: 25 },
    { id: 'door_brace', qty: 1, price: 70 }, { id: 'shutter_kit', qty: 1, price: 55 }, { id: 'sandbags', qty: 1, price: 35 },
    { id: 'bear_trap', qty: 1, price: 30 }, { id: 'floodlight_kit', qty: 1, price: 60 }, { id: 'alarm_kit', qty: 1, price: 75 },
    { id: 'camera_kit', qty: 1, price: 90 },
  ],
};
