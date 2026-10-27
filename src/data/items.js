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
  guard_dog: {
    name: 'Guard Dog (Duke)', icon: '🐕', cat: 'Upgrade', cap: 1, sell: 0, install: 'dog',
    desc: 'Adopt Duke, a trained German shepherd. He follows you around home, barks and marks strangers, and bites attackers (pinning them). Moves with you to new homes.',
  },
  safe_room_kit: {
    name: 'Safe Room Kit', icon: '🛡', cat: 'Upgrade', cap: 1, sell: 60, install: 'safeRoom',
    desc: 'Steel-plate the bedroom. During an attack, standing by your bed you take half damage and slowly recover health. Stays with the house.',
  },
  ext_mag: {
    name: 'Extended Magazine', icon: '▮', cat: 'Upgrade', cap: 1, sell: 40, install: 'extMag',
    desc: 'Handgun magazine holds 12 rounds instead of 8. Applied immediately.',
  },
  burner: {
    name: 'Burner Phone', icon: '📱', cat: 'Story', cap: 1, sell: 0, story: true,
    desc: 'Taken from Sal Benedetto. One saved number, labeled only "L".',
  },
  ledger: {
    name: 'Leo\'s Ledger', icon: '📒', cat: 'Story', cap: 1, sell: 0, story: true,
    desc: 'Vinnie Vescari\'s copy of the family books — every payoff, every account, every name.',
  },
  fishing_rod: {
    name: 'Fishing Rod', icon: '🎣', cat: 'Tools', cap: 1, sell: 10,
    desc: 'Stand at the water\'s edge and press ACT to cast. Fish can be sold, cooked, or delivered.',
  },
  fish: {
    name: 'Fresh Fish', icon: '🐟', cat: 'Food', cap: 12, sell: 6,
    desc: 'Caught with a rod. Cook it at a stove, sell it, or deliver it.',
  },
  vegetables: {
    name: 'Vegetables', icon: '🥕', cat: 'Food', cap: 20, sell: 3,
    desc: 'Picked on the farm. Cook them at a stove or deliver them to the co-op.',
  },
  fish_fry: {
    name: 'Fish Fry', icon: '🍤', cat: 'Food', cap: 6, heal: 35, stamina: 100, sell: 8, quick: true, food: true,
    desc: 'Cooked from 2 fish. Restores 35 health and refills stamina.',
  },
  veg_stew: {
    name: 'Garden Stew', icon: '🍲', cat: 'Food', cap: 6, heal: 30, stamina: 100, regenBuff: 150, sell: 7, quick: true, food: true,
    desc: 'Cooked from 3 vegetables. Restores 30 health, refills stamina, faster stamina for 2½ minutes.',
  },
  hearty_meal: {
    name: 'Hearty Supper', icon: '🍽', cat: 'Food', cap: 4, heal: 60, stamina: 100, regenBuff: 180, wellFed: 240, sell: 12, quick: true, food: true,
    desc: 'Cooked from 1 fish + 2 vegetables + 1 sandwich. Restores 60 health, and you are Well Fed for 4 minutes (+25 max stamina, +10% max health).',
  },
  scope: {
    name: 'Rifle Scope', icon: '🔭', cat: 'Upgrade', cap: 1, sell: 40, install: 'scope',
    desc: 'Fits the hunting rifle: half the spread and 30% more range.',
  },
  choke: {
    name: 'Shotgun Choke', icon: '◎', cat: 'Upgrade', cap: 1, sell: 30, install: 'choke',
    desc: 'Fits the pump shotgun: tighter pellet spread and 25% more range.',
  },
  suppressor: {
    name: 'Pistol Suppressor', icon: '🔇', cat: 'Upgrade', cap: 1, sell: 45, install: 'suppressor',
    desc: 'Fits the handgun: shots are much quieter — distant attackers aren\'t alerted, and gunfire in town doesn\'t raise your Heat.',
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
      { id: 'fishing_rod', qty: 1, price: 30 },
      { id: 'suppressor', qty: 1, price: 120 },
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
      { id: 'choke', qty: 1, price: 80 },
      { id: 'scope', qty: 1, price: 110 },
      { id: 'safe_room_kit', qty: 1, price: 140 },
      { id: 'guard_dog', qty: 1, price: 150 },
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
    { id: 'fishing_rod', qty: 1, price: 30 }, { id: 'scope', qty: 1, price: 110 }, { id: 'choke', qty: 1, price: 80 }, { id: 'suppressor', qty: 1, price: 120 },
    { id: 'safe_room_kit', qty: 1, price: 140 }, { id: 'guard_dog', qty: 1, price: 150 },
  ],
};

// Chapter 3: the feed store at Kettle Crossing.
SHOPS.bo = {
  name: 'Lindqvist Feed & Supply',
  owner: 'bo',
  stock: [...SHOPS.rosa.stock.map((s) => ({ ...s, price: Math.round(s.price * (s.id === 'wood' ? 0.8 : 1)) }))],
};

// Stove recipes (cooking).
export const COOK_RECIPES = [
  { id: 'fish_fry', label: 'Fish Fry', needs: { fish: 2 } },
  { id: 'veg_stew', label: 'Garden Stew', needs: { vegetables: 3 } },
  { id: 'hearty_meal', label: 'Hearty Supper', needs: { fish: 1, vegetables: 2, sandwich: 1 } },
];
