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
  arsonist: {
    name: 'Arsonist', hp: 70, speed: 88, radius: 10,
    color: '#5b3a1e', trim: '#ff9f1c',
    weapon: 'molotov', damage: 0, fireCooldown: 4.5, telegraph: 0.75, spread: 0.12, range: 270,
    preferDist: [130, 240], breachDamage: 8, retreatAt: 0.45, bravery: 0.3,
    xp: 22, cash: [8, 18], ammoDrop: [2, 5],
  },
  handler: {
    name: 'Dog Handler', hp: 80, speed: 80, radius: 10,
    color: '#3b3226', trim: '#e0a542',
    weapon: 'pistol', damage: 9, fireCooldown: 1.6, telegraph: 0.45, spread: 0.14, range: 300,
    preferDist: [140, 260], breachDamage: 10, retreatAt: 0.3, bravery: 0.5,
    xp: 24, cash: [8, 18], ammoDrop: [3, 6], pack: 2,
  },
  attack_dog: {
    name: 'Attack Dog', hp: 40, speed: 150, radius: 9, dog: true, melee: true,
    color: '#3a3a3a', trim: '#c23b3b',
    weapon: 'bite', damage: 11, fireCooldown: 0.8, telegraph: 0.22, spread: 0, range: 22,
    preferDist: [0, 18], breachDamage: 4, retreatAt: 0.15, bravery: 0.9,
    xp: 10, cash: [0, 0], ammoDrop: [0, 0],
  },
  sniper: {
    name: 'Sniper', hp: 70, speed: 70, radius: 10,
    color: '#3d4a2f', trim: '#e8e85a',
    weapon: 'srifle', damage: 30, fireCooldown: 3.6, telegraph: 1.25, spread: 0.02, range: 640,
    preferDist: [360, 600], breachDamage: 6, retreatAt: 0.5, bravery: 0.35,
    xp: 30, cash: [10, 20], ammoDrop: [4, 8],
  },
  truck: {
    name: 'Ram Truck', hp: 320, speed: 135, radius: 22, vehicle: true,
    color: '#2a2d33', trim: '#c0392b',
    weapon: 'ram', damage: 0, fireCooldown: 99, telegraph: 0, spread: 0, range: 0,
    preferDist: [0, 0], breachDamage: 170, retreatAt: 0, bravery: 1,
    xp: 40, cash: [0, 0], ammoDrop: [0, 0],
  },
  lieutenant: {
    name: 'Lieutenant', hp: 320, speed: 76, radius: 14, boss: true,
    color: '#1b1b22', trim: '#d4af37',
    weapon: 'eshotgun', damage: 7, pellets: 5, fireCooldown: 1.7, telegraph: 0.6, spread: 0.2, range: 210,
    preferDist: [60, 170], breachDamage: 35, retreatAt: 0, bravery: 1,
    xp: 90, cash: [40, 70], ammoDrop: [6, 10],
  },
};
