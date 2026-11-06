// Overlays for the 3D view, drawn on the 2D canvas above it: segmented health
// pips and names over people, the "?" and "!" of suspicion, the interaction
// ring, labels on things you can use, the objective marker and a highlighted
// destination square, damage numbers, aim telegraphs — then the same screen
// effects the 2D view uses (edge arrows, damage vignette, weather, grain).
import { G } from '../game/state.js';
import { TILE } from '../config.js';
import { dist } from '../util.js';
import { darkness, activeLights, inFloodlight } from './lights.js';
import { derived } from '../game/progression.js';
import { toScreen, pxPerUnit, frankPipHeight } from './render3d.js';
import { drawScreenFx } from './render.js';
import { drawScreenAtmosphere } from './atmosphere.js';

const HEAD = 64;
function pips(ctx, x, y, frac, n, colOn, colOff = 'rgba(20,24,30,0.75)') {
  const w = Math.max(26, n * 4.6), seg = w / n;
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - w / 2 - 2, y - 2, w + 4, 8);
  const on = Math.ceil(frac * n - 0.001);
  for (let i = 0; i < n; i++) { ctx.fillStyle = i < on ? colOn : colOff; ctx.fillRect(x - w / 2 + i * seg + 0.5, y, seg - 1.2, 4); }
}
function tag(ctx, text, x, y, fg, bg = 'rgba(8,12,18,0.72)', size = 10) {
  ctx.font = `700 ${size}px system-ui, sans-serif`; ctx.textAlign = 'center';
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = bg; ctx.fillRect(x - tw / 2 - 5, y - size, tw + 10, size + 5);
  ctx.fillStyle = fg; ctx.fillText(text, x, y);
}
/** A ring lying on the ground, projected. */
function groundRing(ctx, x, y, r, stroke, width = 2, dash = null, h = 1) {
  ctx.beginPath();
  for (let k = 0; k <= 32; k++) { const a = (k / 32) * Math.PI * 2; const [sx, sy] = toScreen(x + Math.cos(a) * r, y + Math.sin(a) * r, h); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); }
  ctx.strokeStyle = stroke; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]);
}
function litByStatic(x, y) {
  if (darkness() < 0.4) return true;
  for (const l of activeLights()) { if (l.building) continue; if ((x - l.x) ** 2 + (y - l.y) ** 2 < (l.r * 0.75) ** 2) return true; }
  return false;
}

export function drawOverlays3d(ctx, props = []) {
  const { w, h, dpr } = G.view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w * dpr, h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p = G.player, t = G.time, d = derived(), dk = darkness(), m = G.map;
  if (!p) return;

  // Where the objective wants you: a highlighted square on the ground, like a move order.
  const wp = G.waypoint;
  if (wp && wp.map === m.id && dist(wp.x, wp.y, p.x, p.y) > 40) {
    const s = 28, pulse = 0.55 + Math.sin(t * 3) * 0.25;
    ctx.beginPath();
    [[-s, -s], [s, -s], [s, s], [-s, s]].forEach(([ox, oy], k) => { const [sx, sy] = toScreen(wp.x + ox, wp.y + oy, 1); k ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
    ctx.closePath();
    ctx.fillStyle = `rgba(91,214,255,${0.10 * pulse})`; ctx.fill();
    ctx.strokeStyle = `rgba(91,214,255,${0.9 * pulse})`; ctx.lineWidth = 2; ctx.stroke();
    const [lx, ly] = toScreen(wp.x, wp.y + s, 1);
    ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    const lab = (wp.label || 'Objective').toUpperCase();
    ctx.strokeText(lab, lx, ly + 16); ctx.fillStyle = '#bfefff'; ctx.fillText(lab, lx, ly + 16);
    const [mx, my] = toScreen(wp.x, wp.y, 74 + Math.sin(t * 3) * 5);
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(mx, my + 10); ctx.lineTo(mx - 8, my); ctx.lineTo(mx, my - 10); ctx.lineTo(mx + 8, my); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a4210'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // Labels on things you can use, close by (like a tactical map).
  for (const pr of [...m.props, ...props]) {
    if (!pr.label || pr.kind === 'parked' || dist(pr.x, pr.y, p.x, p.y) > 200) continue;
    const pb = m.buildingAt(pr.x, pr.y);
    if (pb && pb !== m.buildingAt(p.x, p.y)) continue; // under someone else's roof
    const [sx, sy, sz] = toScreen(pr.x, pr.y, 26);
    if (sz > 1) continue;
    ctx.font = '800 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    const lab = pr.label.replace(/\(.*?\)/g, '').trim().toUpperCase().slice(0, 34);
    ctx.strokeText(lab, sx, sy); ctx.fillStyle = 'rgba(236,240,232,0.92)'; ctx.fillText(lab, sx, sy);
  }

  // Interaction highlight: a dashed ring on the ground.
  const tg = G.interactTarget;
  if (tg && !G.modal) groundRing(ctx, tg.x, tg.y, 19, `rgba(255,255,255,${0.6 + Math.sin(t * 6) * 0.3})`, 2, [5, 4]);
  // Sign markers.
  for (const pr of m.props) {
    if (!pr.sign) continue;
    if (!G.s.skills.includes('keen_eye') && dist(pr.x, pr.y, p.x, p.y) > 160) continue;
    groundRing(ctx, pr.x, pr.y, 22 + Math.sin(t * 4) * 3, '#b9a4e0', 2);
  }

  // Enemy telegraphs: dashed aim lines at chest height.
  for (const e of G.enemies) {
    if (e.dead || e.gone || !(e.aimT > 0) || e.def.weapon === 'bat' || e.def.weapon === 'bite') continue;
    const prog = 1 - e.aimT / e.def.telegraph;
    const len = Math.min(e.def.range, dist(e.x, e.y, p.x, p.y) + 40);
    const [ax, ay] = toScreen(e.x, e.y, 32), [bx, by] = toScreen(e.x + Math.cos(e.aimAngle) * len, e.y + Math.sin(e.aimAngle) * len, 32);
    ctx.strokeStyle = `rgba(255,60,40,${0.25 + prog * 0.6})`; ctx.lineWidth = 1.5 + prog * 1.5; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
  }

  // Attackers: health pips, names, suspicion.
  for (const e of G.enemies) {
    if (e.dead || e.gone) continue;
    const pd = dist(e.x, e.y, p.x, p.y);
    const visible = dk < 0.4 || pd < d.seeRadius || e.spotted > 0 || inFloodlight(e.x, e.y) || litByStatic(e.x, e.y);
    if (!visible) continue;
    const [sx, sy] = toScreen(e.x, e.y, HEAD + 8);
    if (G.settings.highContrast) groundRing(ctx, e.x, e.y, e.radius + 9, '#ffe14a', 3);
    if (e.alerted || e.hp < e.maxHp) pips(ctx, sx, sy - 4, e.hp / e.maxHp, Math.min(12, Math.max(4, Math.round(e.maxHp / 12))), e.retreating ? '#f0c040' : '#ff4d3a');
    ctx.fillStyle = e.retreating ? '#f0c040' : '#ff3b30';
    const hy = sy - 14 + Math.sin(t * 6) * 1.5;
    ctx.beginPath(); ctx.moveTo(sx - 6, hy - 5); ctx.lineTo(sx + 6, hy - 5); ctx.lineTo(sx, hy + 2); ctx.closePath(); ctx.fill();
    if (e.aimT > 0) { ctx.fillStyle = '#fff'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', sx, hy - 8); }
    if (!e.alerted && e.sus > 0.04) {
      const cy = hy - 16;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(sx, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sx, cy, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, e.sus)); ctx.stroke();
      ctx.fillStyle = '#f5c542'; ctx.font = 'bold 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('?', sx, cy + 4);
    } else if (e.alertPop > 0) {
      ctx.font = 'bold 18px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText('!', sx, hy - 12); ctx.fillStyle = '#ff3b30'; ctx.fillText('!', sx, hy - 12);
    }
    if (e.name !== e.def.name || pd < 140) { const [nx, ny] = toScreen(e.x, e.y, 0); tag(ctx, e.name.toUpperCase(), nx, ny + 18, '#ffd2c8', 'rgba(40,8,8,0.7)', 9); }
  }
  // Frank and the people with him.
  {
    const [sx, sy] = toScreen(p.x, p.y, frankPipHeight());
    pips(ctx, sx, sy, p.hp / d.maxHp, 10, '#5bd6ff');
    if (p.reloadT > 0 && p.reloadMax > 0) {
      const f = 1 - p.reloadT / p.reloadMax;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(sx, sy - 14, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sx, sy - 14, 7, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); ctx.stroke();
    }
    const r = G.repairHold;
    if (r) { pips(ctx, sx, sy - 14, r.t / r.time, 10, '#5bc0de'); tag(ctx, 'REPAIRING', sx, sy - 20, '#fff', 'rgba(0,0,0,0.6)', 9); }
  }
  for (const n of G.npcs) {
    if (!n.present) continue;
    const near = dist(n.x, n.y, p.x, p.y) < (n.scripted ? 400 : 120);
    if (n.ally) {
      const [sx, sy] = toScreen(n.x, n.y, HEAD + 6);
      pips(ctx, sx, sy, n.hp / 140, 10, n.downed ? '#ffb3a7' : '#6fdc7a');
      tag(ctx, n.downed ? 'RUTH — WOUNDED' : 'RUTH', sx, sy - 6, n.downed ? '#ffb3a7' : '#c9f5cd', 'rgba(6,24,10,0.7)', 9);
      continue;
    }
    if (n.scripted && n.sus > 0.04) {
      const [sx, sy] = toScreen(n.x, n.y, HEAD + 14);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#f5c542'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sx, sy, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, n.sus)); ctx.stroke();
    }
    if (!near) continue;
    const nb = m.buildingAt(n.x, n.y);
    if (nb && nb !== m.buildingAt(p.x, p.y)) continue;
    const [sx, sy] = toScreen(n.x, n.y, HEAD + 6);
    tag(ctx, n.def.name, sx, sy, '#d6f3ff', 'rgba(8,14,22,0.72)', 10);
  }
  if (G.dog && (G.siegeActive || G.dog.hp < 90)) { const [sx, sy] = toScreen(G.dog.x, G.dog.y, 30); pips(ctx, sx, sy, G.dog.hp / 90, 6, '#6fdc7a'); }

  // Floating damage numbers and notes.
  for (const f of G.floaters) {
    ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
    const age = f.max - f.life, sc = age < 0.12 ? 1.7 - age * 5.8 : 1;
    const [sx, sy] = toScreen(f.x, f.y, 40);
    ctx.save(); ctx.translate(sx, sy); ctx.scale(sc, sc);
    ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(f.text, 0, 0); ctx.fillStyle = f.color; ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Screen effects shared with the 2D view.
  drawScreenAtmosphere(ctx, w, h, dk, G.frameDt || 1 / 60);
  drawScreenFx(ctx, 0, 0, 1, (x, y) => { const [sx, sy] = toScreen(x, y, 20); return [sx, sy]; });
}

export { pxPerUnit, TILE };
