// Top-down cars, pre-rendered once per model / colour / lights into small
// sprites at twice the resolution, then drawn rotated. Front points up (-y).
// Models: 'muscle' (Frank's car — a modern fastback with a long vented hood,
// tri-bar LED lights front and rear and quad exhausts, after the 2026
// Mustang GT, without badges), 'sedan', 'suv', 'pickup', 'hatch'.

// Older Safari (iOS 15) has no roundRect on canvas.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r); this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
  };
}

const S = 2; // sprite resolution multiplier
const W = 64, H = 112; // logical sprite box (car is ~52 × 96)
const cache = {};

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; } else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** Body outline from a list of [y, halfWidth] stations, front (-y) to back, mirrored. */
function bodyPath(g, st) {
  g.beginPath();
  g.moveTo(0, st[0][0]);
  for (let i = 0; i < st.length; i++) {
    const [y, hw] = st[i], [py, phw] = st[Math.max(0, i - 1)];
    if (i === 0) g.quadraticCurveTo(hw * 0.9, y, hw, y + 3);
    else g.bezierCurveTo(phw, py + (y - py) * 0.5, hw, y - (y - py) * 0.5, hw, y);
  }
  const [ly, lhw] = st[st.length - 1];
  g.quadraticCurveTo(lhw * 0.9, ly + 3, 0, ly + 3);
  g.quadraticCurveTo(-lhw * 0.9, ly + 3, -lhw, ly);
  for (let i = st.length - 2; i >= 0; i--) {
    const [y, hw] = st[i], [ny, nhw] = st[i + 1];
    g.bezierCurveTo(-nhw, ny - (ny - y) * 0.5, -hw, y + (ny - y) * 0.5, -hw, i === 0 ? y + 3 : y);
  }
  g.quadraticCurveTo(-st[0][1] * 0.9, st[0][0], 0, st[0][0]);
  g.closePath();
}

function glass(g, pts, light = 0.55) {
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
  const ys = pts.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const gr = g.createLinearGradient(-20, y0, 20, y1);
  gr.addColorStop(0, `rgba(170,205,230,${light})`); gr.addColorStop(0.45, 'rgba(40,58,78,0.95)'); gr.addColorStop(1, 'rgba(20,28,40,0.98)');
  g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.8; g.stroke();
  // a streak of sky reflection
  g.save(); g.clip(); g.strokeStyle = 'rgba(255,255,255,0.22)'; g.lineWidth = 3; g.beginPath(); g.moveTo(-14, y1); g.lineTo(6, y0); g.stroke(); g.restore();
}

function wheels(g, front, rear, hw) {
  g.fillStyle = '#111';
  for (const y of [front, rear]) for (const s of [-1, 1]) { g.beginPath(); g.roundRect(s * hw - (s > 0 ? 5.5 : 1.5), y - 8.5, 7, 17, 3); g.fill(); }
}
function mirrors(g, y, hw, col) {
  for (const s of [-1, 1]) { g.fillStyle = shade(col, -0.25); g.beginPath(); g.ellipse(s * (hw + 2.5), y, 3, 2, s * 0.4, 0, Math.PI * 2); g.fill(); }
}
function paint(g, st, col) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 7; g.shadowOffsetX = 2.5; g.shadowOffsetY = 3.5;
  bodyPath(g, st); g.fillStyle = shade(col, -0.3); g.fill();
  g.restore();
  bodyPath(g, st);
  const gr = g.createLinearGradient(-26, 0, 26, 0);
  gr.addColorStop(0, shade(col, -0.45)); gr.addColorStop(0.18, shade(col, -0.1)); gr.addColorStop(0.5, shade(col, 0.16)); gr.addColorStop(0.82, shade(col, -0.1)); gr.addColorStop(1, shade(col, -0.45));
  g.fillStyle = gr; g.fill();
  g.strokeStyle = shade(col, -0.6); g.lineWidth = 0.9; g.stroke();
  // the sky reflected in the paint: a soft band across the car
  g.save(); bodyPath(g, st); g.clip();
  const rf = g.createLinearGradient(0, -60, 0, 60);
  rf.addColorStop(0, 'rgba(255,255,255,0)'); rf.addColorStop(0.3, 'rgba(255,255,255,0.10)'); rf.addColorStop(0.34, 'rgba(255,255,255,0)'); rf.addColorStop(0.7, 'rgba(255,255,255,0.06)'); rf.addColorStop(0.73, 'rgba(255,255,255,0)');
  g.fillStyle = rf; g.fillRect(-30, -60, 60, 120); g.restore();
}

const MODELS = {
  muscle(g, col, lit) {
    const st = [[-51, 13], [-46, 19.5], [-32, 23], [-14, 22], [2, 21], [18, 23], [30, 25], [43, 23], [49, 18.5]];
    wheels(g, -32, 30, 24);
    paint(g, st, col);
    // long hood: centre power dome and two heat-extractor vents
    g.fillStyle = shade(col, 0.22); g.beginPath(); g.moveTo(-6, -47); g.lineTo(6, -47); g.lineTo(7.5, -16); g.lineTo(-7.5, -16); g.closePath(); g.fill();
    g.strokeStyle = shade(col, -0.35); g.lineWidth = 0.7; g.beginPath(); g.moveTo(-6, -47); g.lineTo(-7.5, -16); g.moveTo(6, -47); g.lineTo(7.5, -16); g.stroke();
    g.fillStyle = '#121214';
    for (const s of [-1, 1]) { g.beginPath(); g.moveTo(s * 9.5, -33); g.lineTo(s * 15, -31); g.lineTo(s * 14.5, -25); g.lineTo(s * 9.5, -27); g.closePath(); g.fill(); g.strokeStyle = 'rgba(255,255,255,0.12)'; for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(s * 10, -31.5 + k * 1.8); g.lineTo(s * 14.5, -29.8 + k * 1.8); g.stroke(); } }
    // nose: black grille, slim LED headlights with three vertical bars each
    g.fillStyle = '#0d0d10'; g.beginPath(); g.moveTo(-9, -50.5); g.lineTo(9, -50.5); g.lineTo(8, -47); g.lineTo(-8, -47); g.closePath(); g.fill();
    for (const s of [-1, 1]) {
      g.fillStyle = '#1a1c20'; g.beginPath(); g.moveTo(s * 9.5, -49.5); g.lineTo(s * 19, -45); g.lineTo(s * 19.5, -42.5); g.lineTo(s * 9.5, -46.5); g.closePath(); g.fill();
      g.fillStyle = lit ? '#fffbe0' : '#e9eef5';
      for (let k = 0; k < 3; k++) g.fillRect(s * (11.5 + k * 2.4) - 0.5, -48.2 + k * 1.2, 1.1, 2.6);
    }
    // windshield, roof, long fastback rear glass, short deck, lip spoiler
    glass(g, [[-17.5, -14], [17.5, -14], [15.5, -2], [-15.5, -2]]);
    g.fillStyle = shade(col, -0.05); g.beginPath(); g.roundRect(-15.5, -2, 31, 14, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(-11, 0, 22, 3);
    glass(g, [[-15, 12], [15, 12], [12.5, 31], [-12.5, 31]], 0.35);
    g.strokeStyle = shade(col, -0.55); g.lineWidth = 1.4; g.beginPath(); g.moveTo(-19, 44); g.quadraticCurveTo(0, 46.5, 19, 44); g.stroke();
    // tri-bar tail lights and quad exhausts
    for (const s of [-1, 1]) {
      g.fillStyle = '#2a0608'; g.beginPath(); g.roundRect(s > 0 ? 10 : -20, 45.5, 10, 4, 1); g.fill();
      g.fillStyle = lit ? '#ff3b30' : '#c81e1e';
      for (let k = 0; k < 3; k++) g.fillRect(s > 0 ? 11 + k * 3 : -19 + k * 3, 46, 1.6, 3);
      g.fillStyle = '#2b2b2e'; for (const o of [4, 7]) { g.beginPath(); g.arc(s * o, 51.5, 1.3, 0, Math.PI * 2); g.fill(); }
    }
    mirrors(g, -11, 22, col);
    // highlights: a sheen along the hood and the haunches
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.ellipse(-8, -34, 3, 11, 0.05, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(-17, 30, 2.5, 9, 0, 0, Math.PI * 2); g.fill();
  },
  sedan(g, col, lit) {
    const st = [[-48, 18], [-42, 21.5], [-20, 22], [10, 22], [36, 21.5], [47, 19]];
    wheels(g, -29, 29, 22);
    paint(g, st, col);
    g.strokeStyle = shade(col, -0.3); g.lineWidth = 0.7; g.beginPath(); g.moveTo(-8, -46); g.lineTo(-9, -20); g.moveTo(8, -46); g.lineTo(9, -20); g.stroke();
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#fffbe0' : '#dfe6ee'; g.beginPath(); g.moveTo(s * 10, -48); g.lineTo(s * 18, -45); g.lineTo(s * 17, -42.5); g.lineTo(s * 10, -45.5); g.closePath(); g.fill(); }
    g.fillStyle = '#16171a'; g.fillRect(-9, -49, 18, 2.5);
    glass(g, [[-17, -18], [17, -18], [16, -5], [-16, -5]]);
    g.fillStyle = shade(col, -0.04); g.beginPath(); g.roundRect(-16, -5, 32, 20, 3); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(-12, -2, 24, 3);
    glass(g, [[-16, 15], [16, 15], [14, 25], [-14, 25]], 0.3);
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#ff3b30' : '#b81c1c'; g.beginPath(); g.roundRect(s > 0 ? 10 : -19, 44, 9, 3.5, 1); g.fill(); }
    mirrors(g, -15, 21, col);
  },
  suv(g, col, lit) {
    const st = [[-49, 19], [-43, 23], [-20, 23.5], [20, 23.5], [44, 23], [49, 21]];
    wheels(g, -31, 31, 23.5);
    paint(g, st, col);
    g.fillStyle = '#18191c'; g.fillRect(-12, -49.5, 24, 4);
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#fffbe0' : '#dfe6ee'; g.fillRect(s > 0 ? 13 : -20, -47.5, 7, 3); }
    glass(g, [[-19, -24], [19, -24], [18, -12], [-18, -12]]);
    g.fillStyle = shade(col, -0.08); g.beginPath(); g.roundRect(-18, -12, 36, 50, 3); g.fill();
    g.fillStyle = '#2a2b2e'; g.fillRect(-15, -8, 2, 42); g.fillRect(13, -8, 2, 42); // roof rails
    g.fillStyle = 'rgba(20,30,45,0.55)'; g.beginPath(); g.roundRect(-9, -6, 18, 12, 2); g.fill(); // sunroof
    glass(g, [[-17, 38], [17, 38], [16, 44], [-16, 44]], 0.25);
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#ff3b30' : '#b81c1c'; g.fillRect(s > 0 ? 17 : -21, 40, 4, 8); }
    mirrors(g, -21, 23, col);
  },
  pickup(g, col, lit) {
    const st = [[-49, 19], [-43, 23.5], [-10, 23.5], [20, 23.5], [44, 23.5], [49, 22]];
    wheels(g, -32, 32, 23.5);
    paint(g, st, col);
    g.fillStyle = '#18191c'; g.fillRect(-13, -49.5, 26, 4.5);
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#fffbe0' : '#dfe6ee'; g.fillRect(s > 0 ? 13 : -20, -48, 7, 3.5); }
    glass(g, [[-19, -22], [19, -22], [18, -12], [-18, -12]]);
    g.fillStyle = shade(col, -0.06); g.beginPath(); g.roundRect(-18, -12, 36, 18, 3); g.fill();
    glass(g, [[-17, 6], [17, 6], [17, 9], [-17, 9]], 0.2);
    // the bed: liner and ribs
    g.fillStyle = '#2a2a2c'; g.beginPath(); g.roundRect(-19, 11, 38, 34, 2); g.fill();
    g.strokeStyle = '#3c3c40'; g.lineWidth = 1; for (let x = -15; x <= 15; x += 5) { g.beginPath(); g.moveTo(x, 13); g.lineTo(x, 43); g.stroke(); }
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#ff3b30' : '#b81c1c'; g.fillRect(s > 0 ? 19.5 : -22.5, 40, 3, 8); }
    mirrors(g, -19, 23.5, col);
  },
  hatch(g, col, lit) {
    const st = [[-44, 17], [-38, 21], [-14, 21.5], [20, 21.5], [38, 20.5], [42, 18]];
    wheels(g, -26, 26, 21.5);
    paint(g, st, col);
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#fffbe0' : '#dfe6ee'; g.beginPath(); g.ellipse(s * 13, -41, 4, 2, s * 0.3, 0, Math.PI * 2); g.fill(); }
    glass(g, [[-17, -20], [17, -20], [16, -8], [-16, -8]]);
    g.fillStyle = shade(col, -0.05); g.beginPath(); g.roundRect(-16, -8, 32, 30, 3); g.fill();
    glass(g, [[-15, 22], [15, 22], [14, 32], [-14, 32]], 0.3);
    for (const s of [-1, 1]) { g.fillStyle = lit ? '#ff3b30' : '#b81c1c'; g.fillRect(s > 0 ? 13 : -19, 37, 6, 4); }
    mirrors(g, -16, 21, col);
  },
};
export const VEHICLE_MODELS = Object.keys(MODELS);

export function vehicleSprite(model, color, lit) {
  const key = `${model}|${color}|${lit ? 1 : 0}`;
  if (cache[key]) return cache[key];
  const c = document.createElement('canvas'); c.width = W * S; c.height = H * S;
  const g = c.getContext('2d');
  g.scale(S, S); g.translate(W / 2, H / 2);
  (MODELS[model] || MODELS.sedan)(g, color, lit);
  cache[key] = c;
  return c;
}

/** Draw a car centred at (x, y), rotated by `rot` (0 = front up). */
export function drawVehicle(ctx, x, y, rot, model, color, lit = false) {
  const sp = vehicleSprite(model, color, lit);
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot);
  ctx.drawImage(sp, -W / 2, -H / 2, W, H);
  ctx.restore();
}
