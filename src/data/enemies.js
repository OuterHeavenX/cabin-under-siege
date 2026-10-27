// Enemy archetypes. Ranges are in pixels, times in seconds.

export const ENEMY_TYPES = {
  scout: {
    name: 'Scout', hp: 55, speed: 92, radius: 10,
    color: '#5a5f6b', trim: '#c23b3b',
    weapon: 'pistol', damage: 8, fireCooldown: 1.7, telegraph: 0.45, spread: 0.16, range: 300,
    preferDist: [150, 260], breachDamage: 10, retreatAt: 0.35, bravery: 0.45,
    xp: 15, cash: [4, 12], ammoDrop: [3, 6],
  },
  enforcer: {
    name: 'Enforcer', hp: 140, speed: 82, radius: 13,
    color: '#3a2f2f', trim: '#e04a2a',
    weapon: 'bat', damage: 18, fireCooldown: 1.1, telegraph: 0.4, spread: 0, range: 30,
    preferDist: [0, 24], breachDamage: 28, retreatAt: 0.2, bravery: 0.8,
    xp: 30, cash: [10, 22], ammoDrop: [2, 5],
  },
  gunman: {
    name: 'Gunman', hp: 85, speed: 72, radius: 10,
    color: '#2c3540', trim: '#ff7043',
    weapon: 'rifle', damage: 14, fireCooldown: 2.3, telegraph: 0.65, spread: 0.07, range: 430,
    preferDist: [210, 380], breachDamage: 12, retreatAt: 0.3, bravery: 0.6,
    xp: 22, cash: [8, 16], ammoDrop: [4, 8],
  },
};
