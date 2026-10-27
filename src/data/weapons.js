// Player weapons. `ammo` is the inventory item consumed. Spread is in radians
// (half-angle); for the shotgun it is the pellet cone.

export const WEAPONS = {
  pistol: {
    name: '9mm Handgun', short: 'PISTOL', icon: '🔫', ammo: 'ammo', mag: 8, extMag: 12,
    dmg: 26, pellets: 1, fireCd: 0.26, spread: 0.075, moveSpread: 0.06, speed: 900, range: 520,
    reload: 1.45, sound: 'shot', shake: 2, knock: 90,
    desc: 'Reliable sidearm. Quick to fire and reload.',
  },
  shotgun: {
    name: 'Pump Shotgun', short: 'SHOTGUN', icon: '💥', ammo: 'shells', mag: 5,
    dmg: 14, pellets: 7, fireCd: 0.85, spread: 0.2, moveSpread: 0.04, speed: 760, range: 250,
    reload: 0.5, perRound: true, sound: 'shotgun', shake: 7, knock: 170,
    desc: 'Seven pellets per shell. Devastating at doorways, useless at range. Reloads one shell at a time — fire to interrupt.',
  },
  rifle: {
    name: 'Hunting Rifle', short: 'RIFLE', icon: '🎯', ammo: 'rifle_ammo', mag: 5,
    dmg: 72, pellets: 1, pierce: 1, fireCd: 1.05, spread: 0.018, moveSpread: 0.14, speed: 1500, range: 950,
    reload: 2.3, sound: 'rifleShot', shake: 4, knock: 140,
    desc: 'Huge damage at long range and punches through the first attacker. Slow; inaccurate on the move.',
  },
};

export const WEAPON_ORDER = ['pistol', 'shotgun', 'rifle'];
