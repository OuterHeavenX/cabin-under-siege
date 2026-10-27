// Dynamic cell blockers: doors, windows and placed cover. Their persistent state
// lives in the save record (`rec`) so damage and upgrades survive reloads.
import { G, hasSkill } from '../game/state.js';

export const DOOR_BASE_HP = 100;
export const DOOR_BRACE_HP = 150;
export const GLASS_HP = 20;
export const BOARD_HP = 90;
export const SHUTTER_HP = 160;
export const COVER_HP = { sandbags: 200, barricade: 120 };

export const defenseMult = () => (hasSkill('strong_foundations') ? 1.35 : 1);

export class Door {
  constructor(id, cx, cy, rec, label, vertical = false) {
    this.kind = 'door';
    this.id = id; this.cx = cx; this.cy = cy; this.rec = rec; this.label = label; this.vertical = vertical;
    this.hitT = 0;
  }
  get maxHp() { return DOOR_BASE_HP + (this.rec.reinforced ? Math.round(DOOR_BRACE_HP * defenseMult()) : 0); }
  get broken() { return this.rec.hp <= 0; }
  get passable() { return this.broken || this.rec.open; }
  blocksMove(who) { return who === 'npc' ? false : !this.passable; }
  blocksSight() { return !this.passable; }
  onBullet(b) {
    if (this.passable) return false;
    if (b.owner === 'enemy') this.damage(b.dmg * 0.5);
    return true;
  }
  damage(n) {
    if (this.broken) return;
    this.rec.hp = Math.max(0, this.rec.hp - n);
    this.hitT = 0.2;
    if (this.rec.hp <= 0) {
      this.rec.open = true;
      G.events?.emit('door_broken', this);
    }
  }
  /** 0..1 */
  get condition() { return this.rec.hp / this.maxHp; }
}

export class Window {
  constructor(id, cx, cy, rec, label, vertical = false) {
    this.kind = 'window';
    this.id = id; this.cx = cx; this.cy = cy; this.rec = rec; this.label = label; this.vertical = vertical;
    this.hitT = 0;
  }
  get boardMax() { return Math.round(BOARD_HP * defenseMult()); }
  get shutterMax() { return Math.round(SHUTTER_HP * defenseMult()); }
  get boarded() { return this.rec.boards && this.rec.boardHp > 0; }
  get shuttered() { return !!this.rec.shutters && this.rec.shutterHp > 0; }
  get broken() { return this.rec.glass <= 0 && !this.boarded && !this.shuttered; }
  blocksMove() { return !this.broken; }
  blocksSight() { return false; }
  onBullet(b) {
    if (this.shuttered && Math.random() < 0.9) {
      if (b.owner === 'enemy') this.damage(b.dmg * 0.4);
      return true;
    }
    if (this.boarded && Math.random() < 0.6) {
      if (b.owner === 'enemy') this.damage(b.dmg * 0.4);
      return true;
    }
    if (this.rec.glass > 0) {
      this.rec.glass = 0;
      G.events?.emit('glass_break', this);
    }
    return false;
  }
  damage(n) {
    this.hitT = 0.2;
    if (this.shuttered) {
      this.rec.shutterHp = Math.max(0, this.rec.shutterHp - n);
      if (this.rec.shutterHp <= 0) { this.rec.shutters = false; G.events?.emit('boards_broken', this); }
      return;
    }
    if (this.boarded) {
      this.rec.boardHp = Math.max(0, this.rec.boardHp - n);
      if (this.rec.boardHp <= 0) { this.rec.boards = false; G.events?.emit('boards_broken', this); }
      return;
    }
    if (this.rec.glass > 0) {
      this.rec.glass = Math.max(0, this.rec.glass - n);
      if (this.rec.glass <= 0) G.events?.emit('glass_break', this);
    }
  }
  get condition() {
    const max = GLASS_HP + (this.rec.boards ? this.boardMax : 0) + (this.rec.shutters ? this.shutterMax : 0);
    return (this.rec.glass + (this.rec.boards ? this.rec.boardHp : 0) + (this.rec.shutters ? this.rec.shutterHp : 0)) / max;
  }
}

export class Cover {
  constructor(rec) {
    this.kind = 'cover';
    this.rec = rec;
    this.cx = rec.cx; this.cy = rec.cy;
    this.hitT = 0;
  }
  get maxHp() { return Math.round(COVER_HP[this.rec.type] * defenseMult()); }
  blocksMove() { return true; }
  blocksSight() { return false; }
  onBullet(b) { this.damage(b.dmg * (b.owner === 'enemy' ? 1 : 0.25)); return true; }
  damage(n) {
    this.rec.hp -= n;
    this.hitT = 0.2;
    if (this.rec.hp <= 0) G.events?.emit('cover_destroyed', this);
  }
  get condition() { return this.rec.hp / this.maxHp; }
}
