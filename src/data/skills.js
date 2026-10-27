// Attributes (raised with character-level points) and JP skill paths.

export const ATTRIBUTES = {
  vit: { name: 'Vitality', short: 'VIT', desc: 'Maximum health: +12 per point.' },
  end: { name: 'Endurance', short: 'END', desc: 'Maximum stamina +10 and stamina costs -4% per point (sprint, dodge, melee, chopping).' },
  pre: { name: 'Precision', short: 'PRE', desc: 'Handgun spread -6% per point. Tighter shots at range.' },
  awa: { name: 'Awareness', short: 'AWA', desc: 'See attackers in the dark +20 px further, and siege warnings come 4 minutes earlier per point.' },
  res: { name: 'Resolve', short: 'RES', desc: 'Healing items +5% per point, out-of-combat recovery cap +5% per point, and a longer grace period after being hit.' },
};

export const MAX_ATTR = 10;

export const PATHS = {
  survivor: {
    name: 'Survivor', color: '#7fbf6a', icon: '🌲',
    earn: 'Chop trees, discover places, sleep safely in your own bed, and use healing or food.',
  },
  gunhand: {
    name: 'Gunhand', color: '#d9534f', icon: '🎯',
    earn: 'Land hits, defeat or drive off attackers, and survive sieges.',
  },
  handyman: {
    name: 'Handyman', color: '#e0a542', icon: '🔨',
    earn: 'Repair damage, install defenses, craft at the workbench, and finish repair jobs.',
  },
  neighbor: {
    name: 'Neighbor', color: '#5bc0de', icon: '🤝',
    earn: 'Talk with townsfolk (once a day each), give gifts, make deliveries and build friendships.',
  },
  shadow: {
    name: 'Shadow', color: '#a58bd8', icon: '👁',
    earn: 'Investigate suspicious signs, spot attackers before they spot you, and stay quiet with strangers.',
  },
};

export const SKILLS = {
  // SURVIVOR
  resourceful: { path: 'survivor', name: 'Resourceful', cost: 20, desc: 'Every tree you fell yields +1 extra wood.' },
  field_recovery: { path: 'survivor', name: 'Field Recovery', cost: 30, desc: 'Bandages, kits and food heal 35% more.' },
  watchful: { path: 'survivor', name: 'Watchful', cost: 40, desc: 'Siege warnings come 30 minutes earlier and show the direction of attack.' },
  // GUNHAND
  steady_hands: { path: 'gunhand', name: 'Steady Hands', cost: 20, desc: 'Handgun spread -30%; moving while shooting hurts accuracy half as much.' },
  quick_reload: { path: 'gunhand', name: 'Quick Reload', cost: 25, desc: 'Reload time -30%.' },
  composure: { path: 'gunhand', name: 'Composure', cost: 40, desc: 'Getting hit barely throws off your aim (flinch -75%).' },
  // HANDYMAN
  efficient_repairs: { path: 'handyman', name: 'Efficient Repairs', cost: 20, desc: 'Repairs and workbench crafting use 1 less wood (minimum 1).' },
  quick_fix: { path: 'handyman', name: 'Quick Fix', cost: 25, desc: 'Repair defenses 60% faster; the repair-job timing zone is wider.' },
  strong_foundations: { path: 'handyman', name: 'Strong Foundations', cost: 35, desc: 'Boards, door braces and placed cover get +35% durability.' },
  // NEIGHBOR
  familiar_face: { path: 'neighbor', name: 'Familiar Face', cost: 15, desc: '+50% relationship gains and extra friendly conversations.' },
  local_discount: { path: 'neighbor', name: 'Local Discount', cost: 25, desc: '10% off everything at Marsh General and Okafor Lumber.' },
  good_reputation: { path: 'neighbor', name: 'Good Reputation', cost: 35, desc: 'Unlocks the "Supply Run" job for Ruth and +15% pay on all jobs.' },
  // SHADOW
  keen_eye: { path: 'shadow', name: 'Keen Eye', cost: 20, desc: 'Suspicious signs are marked on screen, you see the exact Heat number, and you spot attackers in the dark 60 px further.' },
  quiet_steps: { path: 'shadow', name: 'Quiet Steps', cost: 25, desc: 'Attackers who have not noticed you yet need you 40% closer to notice you.' },
  escape_artist: { path: 'shadow', name: 'Escape Artist', cost: 35, desc: 'Dodge roll goes 30% further, has longer invulnerability and costs 40% less stamina.' },
};

/** Character XP needed to go from `level` to `level+1`. */
export function xpForLevel(level) {
  return Math.round(80 + (level - 1) * 55 + (level - 1) * (level - 1) * 8);
}

export const ATTR_POINTS_PER_LEVEL = 2;
