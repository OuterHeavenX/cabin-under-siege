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

  // ---- Tier 2 (The Longer Life): each needs two skills from its own path first ----
  trail_sense: { path: 'survivor', tier: 2, name: 'Trail Sense', cost: 40, desc: 'You read the ground. Watcher clues are marked from anywhere on your property, and deer only spook if you sprint.' },
  prepared: { path: 'survivor', tier: 2, name: 'Prepared', cost: 45, desc: 'Carrying a healing item, food and 2+ wood makes you PREPARED: +10% max health and +15 max stamina.' },
  controlled_fire: { path: 'gunhand', tier: 2, name: 'Controlled Fire', cost: 45, active: true, cooldown: 60, short: 'STEADY', desc: 'ABILITY (G / R3 / the STEADY button): for 6 seconds your aim barely spreads and getting hit doesn\'t throw you off. 60 s cooldown.' },
  ready_reload: { path: 'gunhand', tier: 2, name: 'Ready Reload', cost: 40, desc: 'Reloading while standing still or in cover is 40% faster.' },
  emergency_repair: { path: 'handyman', tier: 2, name: 'Emergency Repair', cost: 45, active: true, cooldown: 90, short: 'PATCH', desc: 'ABILITY: even mid-attack, patch the nearest damaged door or window (+40% of its strength) for 1 wood — or splice a cut power line. 90 s cooldown.' },
  efficient_construction: { path: 'handyman', tier: 2, name: 'Efficient Construction', cost: 35, desc: 'Home projects (and restoring your car) cost 25% less wood and money.' },
  trusted_friend: { path: 'neighbor', tier: 2, name: 'Trusted Friend', cost: 40, desc: 'Once per chapter, ask a close friend (♥3+) for a favor from their menu: a day\'s work on a home project, a box of supplies, or an eye on the road (+60 min warning next attack).' },
  local_knowledge: { path: 'neighbor', tier: 2, name: 'Local Knowledge', cost: 35, desc: 'People tell you things. Every investigation (a watcher phase or a rat case) starts with one clue already in hand.' },
  misdirection: { path: 'shadow', tier: 2, name: 'Misdirection', cost: 40, active: true, cooldown: 25, short: 'TOSS', desc: 'ABILITY: toss a stone where you\'re aiming. Attackers who haven\'t seen you go to look at the noise for a few seconds. 25 s cooldown.' },
  vanish: { path: 'shadow', tier: 2, name: 'Vanish', cost: 45, desc: 'Out of sight, attackers lose track of you twice as fast — and a dodge roll while none of them can see you breaks contact on the spot.' },
};

/** How many skills of a path a tier-2 skill needs first. */
export const TIER2_NEEDS = 2;

/** Character XP needed to go from `level` to `level+1`. */
export function xpForLevel(level) {
  return Math.round(80 + (level - 1) * 55 + (level - 1) * (level - 1) * 8);
}

export const ATTR_POINTS_PER_LEVEL = 2;
