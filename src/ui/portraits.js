// Painted-style character portraits for conversations, drawn procedurally on a
// canvas (no image files): soft key light from the upper left, a red rim light
// from the right, film grain and a dark vignette — noir, like the title screen.

const SIZE = 192;
const cache = new Map();

/* skin, hair colour + style, clothes, age 0..1, extras */
const PEOPLE = {
  frank: { skin: '#d9a982', hair: '#2a2220', style: 'slick', grey: 0.35, clothes: 'coat', cloth: '#26262c', shirt: '#d8d2c4', stubble: true, brow: 'stern', age: 0.45, jaw: 1.08 },
  ruth: { skin: '#e2b89a', hair: '#d9d9d9', style: 'bun', clothes: 'cardigan', cloth: '#6d8fb3', glasses: true, brow: 'kind', age: 0.9, earrings: true, female: true },
  dee: { skin: '#c58c69', hair: '#7a3b1f', style: 'curly', clothes: 'apron', cloth: '#b3546d', brow: 'kind', age: 0.55, earrings: true, lips: '#a3404e', female: true },
  gus: { skin: '#6b4a35', hair: '#1d1d1d', style: 'buzz', grey: 0.2, clothes: 'work', cloth: '#4f7a4a', beard: 'short', brow: 'stern', age: 0.55, jaw: 1.12 },
  marcus: { skin: '#5e3f2c', hair: '#cfcfcf', style: 'balding', clothes: 'cardigan', cloth: '#5a6b7a', mustache: true, glasses: true, brow: 'kind', age: 0.8 },
  rosa: { skin: '#c08a62', hair: '#2b1a12', style: 'long', clothes: 'work', cloth: '#7a2f4f', brow: 'stern', age: 0.45, earrings: true, lips: '#8f3040', female: true },
  pete: { skin: '#e2b494', hair: '#c9a46a', style: 'cap', hat: '#2f5878', clothes: 'work', cloth: '#3d6a8a', beard: 'full', brow: 'kind', age: 0.35, jaw: 1.1 },
  ingrid: { skin: '#f0c7a5', hair: '#e6d3a0', style: 'braid', clothes: 'flannel', cloth: '#6a4e7a', brow: 'stern', age: 0.6, female: true },
  bo: { skin: '#e8b898', hair: '#c9a46a', style: 'short', clothes: 'overalls', cloth: '#7a6a3a', beard: 'full', brow: 'kind', age: 0.5, jaw: 1.15 },
  tess: { skin: '#8a5a3e', hair: '#2b1a12', style: 'bob', clothes: 'flannel', cloth: '#3a6a5a', brow: 'stern', age: 0.4, earrings: true, female: true },
  eleanor: { skin: '#efd2bc', hair: '#ece8e0', style: 'bob', clothes: 'pearls', cloth: '#2d3346', brow: 'stern', age: 0.85, earrings: true, lips: '#9a4a55', female: true },
  theo: { skin: '#e3bc94', hair: '#1b1b1b', style: 'short', clothes: 'work', cloth: '#2f6f8f', glasses: true, brow: 'kind', age: 0.3 },
  walt: { skin: '#cf9c76', hair: '#9a9a9a', style: 'cap', hat: '#3c4a2c', clothes: 'flannel', cloth: '#7a3a2a', mustache: true, brow: 'stern', age: 0.7, jaw: 1.1 },
  reyes: { skin: '#b88660', hair: '#1a1210', style: 'bun', clothes: 'suit', cloth: '#1d2230', shirt: '#e8e6e0', tie: null, brow: 'stern', age: 0.4, female: true },
  stranger: { skin: '#d6a98a', hair: '#111', style: 'fedora', hat: '#2b2d31', clothes: 'coat', cloth: '#3b3f46', shirt: '#c8c4bc', brow: 'stern', age: 0.5, shadowed: true },
  deputy: { skin: '#e0b08a', hair: '#3a2a1a', style: 'trooper', hat: '#6b5a3a', clothes: 'uniform', cloth: '#7d6a45', mustache: true, brow: 'sly', age: 0.5, jaw: 1.12 },
  carmine: { skin: '#cf9a74', hair: '#151515', style: 'slick', clothes: 'suit', cloth: '#1b1b20', shirt: '#cfc8b8', tie: '#7a0e12', brow: 'stern', age: 0.5, jaw: 1.25, stubble: true },
  sal: { skin: '#d8a882', hair: '#2a2a2a', style: 'balding', grey: 0.5, clothes: 'suit', cloth: '#30302e', shirt: '#e0dccf', tie: '#5a1a1a', glasses: true, brow: 'sly', age: 0.65 },
  vinnie: { skin: '#d6a47e', hair: '#1a1410', style: 'slick', clothes: 'suit', cloth: '#3a1414', shirt: '#151515', tie: null, mustache: true, brow: 'sly', age: 0.4, scar: true },
  leo: { skin: '#d9ad8c', hair: '#e0e0e0', style: 'slick', clothes: 'suit', cloth: '#111114', shirt: '#f0ece2', tie: '#8b0000', brow: 'stern', age: 0.85, jaw: 1.05, rose: true },
  dom: { skin: '#e2b494', hair: '#d8d8d8', style: 'balding', clothes: 'suit', cloth: '#16161a', shirt: '#16161a', tie: null, collar: true, glasses: true, brow: 'kind', age: 0.85 },
  angie: { skin: '#d8a882', hair: '#2b1a12', style: 'curly', clothes: 'apron', cloth: '#8a2a2a', brow: 'stern', age: 0.45, earrings: true, lips: '#9a2a33', female: true },
  mickey: { skin: '#e8b898', hair: '#9a6a4a', style: 'short', grey: 0.3, clothes: 'work', cloth: '#2f4a3a', mustache: true, brow: 'stern', age: 0.6, jaw: 1.15 },
  dante: { skin: '#cf9a74', hair: '#202020', style: 'slick', grey: 0.4, clothes: 'suit', cloth: '#1a1a1e', shirt: '#d8d2c4', tie: '#2a2a2a', glasses: true, brow: 'stern', age: 0.6 },
  carlo: { skin: '#c88f6a', hair: '#151515', style: 'buzz', clothes: 'coat', cloth: '#2a2420', shirt: '#cfc8b8', beard: 'short', brow: 'stern', age: 0.45, jaw: 1.3 },
  nico: { skin: '#dcae88', hair: '#141010', style: 'slick', clothes: 'suit', cloth: '#18181c', shirt: '#2a0c0c', tie: null, stubble: true, brow: 'sly', age: 0.25, scar: false },
};

/** Who in a dialogue line maps to which portrait. */
const ALIASES = {
  'You': 'frank', 'Frank': 'frank', 'Ruth Calloway': 'ruth', 'Dee Marsh': 'dee', 'Dolores "Dee" Marsh': 'dee', 'Gus Okafor': 'gus',
  'Marcus Bell': 'marcus', 'Rosa Delgado': 'rosa', 'Pete Kowalski': 'pete', 'Ingrid Haugen': 'ingrid', 'Bo Lindqvist': 'bo', 'Tess Albright': 'tess',
  'Man in a Grey Coat': 'stranger', 'Deputy Carl Mott': 'deputy', 'Leo Vescari': 'leo', 'Big Carmine': 'carmine', 'Sal Benedetto': 'sal',
  'Vinnie Vescari': 'vinnie', 'Nico Vescari': 'nico', 'Eleanor Whitcombe': 'eleanor', 'Theo Park': 'theo', 'Walt Bishop': 'walt',
  'Agent Dana Reyes': 'reyes', 'Father Dominic Russo': 'dom', 'Father Dom': 'dom', 'Angela "Angie" Marchetti': 'angie', 'Angie Marchetti': 'angie', 'Angie': 'angie',
  'Mickey Doyle': 'mickey', 'Dante Ruggiero': 'dante', 'Carlo Bruno': 'carlo', 'Special Agent Dana Reyes': 'reyes', 'Voice': 'stranger',
};

export function portraitId(who) {
  if (!who) return null;
  if (ALIASES[who]) return ALIASES[who];
  return null;
}

/** A data URL for this speaker's portrait, or null for notes/signs/unknown voices. */
export function portraitFor(who) {
  const id = portraitId(who);
  if (!id || !PEOPLE[id]) return null;
  if (!cache.has(id)) cache.set(id, paint(PEOPLE[id], id).toDataURL('image/png'));
  return cache.get(id);
}

export const PORTRAIT_IDS = Object.keys(PEOPLE);

/* ------------------------------------------------------------------ */
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
function seeded(str) {
  let h = 2166136261;
  for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
function ell(g, x, y, rx, ry, fill, rot = 0) { g.fillStyle = fill; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); }

function paint(p, id) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const rnd = seeded(id);
  const S = SIZE;
  const cx = S * 0.5, hy = S * 0.42; // head centre
  const hw = S * 0.2 * (p.female ? 0.94 : 1), hh = S * 0.25;
  const jaw = p.jaw || 1;

  // Backdrop: deep red key behind, black edges.
  const bg = g.createRadialGradient(S * 0.62, S * 0.35, S * 0.05, S * 0.5, S * 0.5, S * 0.75);
  bg.addColorStop(0, '#5b0b0b'); bg.addColorStop(0.5, '#220606'); bg.addColorStop(1, '#050303');
  g.fillStyle = bg; g.fillRect(0, 0, S, S);

  // Hair behind the head (long styles).
  if (p.style === 'long' || p.style === 'braid' || p.style === 'curly') {
    ell(g, cx, hy + hh * 0.35, hw * 1.35, hh * 1.25, shade(p.hair, -0.25));
  }

  // Shoulders / clothes.
  drawClothes(g, p, cx, S);

  // Neck.
  const neck = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
  neck.addColorStop(0, shade(p.skin, -0.35)); neck.addColorStop(1, shade(p.skin, -0.55));
  g.fillStyle = neck; g.fillRect(cx - hw * 0.45, hy + hh * 0.6, hw * 0.9, hh * 0.75);

  // Ears.
  ell(g, cx - hw * 0.98, hy + hh * 0.05, hw * 0.16, hh * 0.2, shade(p.skin, -0.15));
  ell(g, cx + hw * 0.98, hy + hh * 0.05, hw * 0.16, hh * 0.2, shade(p.skin, -0.4));
  if (p.earrings) { ell(g, cx - hw * 0.98, hy + hh * 0.26, 2.6, 2.6, '#e8d9a8'); ell(g, cx + hw * 0.98, hy + hh * 0.26, 2.6, 2.6, '#b8a978'); }

  // Head: key light upper left, falling into shadow right.
  g.save();
  g.beginPath();
  g.moveTo(cx, hy - hh);
  g.bezierCurveTo(cx + hw * 1.1, hy - hh, cx + hw * 1.05, hy + hh * 0.2, cx + hw * 0.75 * jaw, hy + hh * 0.7);
  g.quadraticCurveTo(cx + hw * 0.3, hy + hh * 1.05, cx, hy + hh * 1.02);
  g.quadraticCurveTo(cx - hw * 0.3, hy + hh * 1.05, cx - hw * 0.75 * jaw, hy + hh * 0.7);
  g.bezierCurveTo(cx - hw * 1.05, hy + hh * 0.2, cx - hw * 1.1, hy - hh, cx, hy - hh);
  g.closePath();
  const face = g.createRadialGradient(cx - hw * 0.45, hy - hh * 0.35, hw * 0.1, cx, hy, hw * 1.5);
  face.addColorStop(0, shade(p.skin, 0.12)); face.addColorStop(0.55, p.skin); face.addColorStop(1, shade(p.skin, -0.5));
  g.fillStyle = face; g.fill();
  g.clip();
  // Cheek warmth and the shadow side.
  ell(g, cx - hw * 0.45, hy + hh * 0.3, hw * 0.3, hh * 0.16, 'rgba(200,90,80,0.14)');
  const side = g.createLinearGradient(cx, 0, cx + hw * 1.1, 0);
  side.addColorStop(0, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(10,0,0,0.45)');
  g.fillStyle = side; g.fillRect(cx, hy - hh, hw * 1.2, hh * 2.2);
  if (p.stubble || p.beard) {
    g.fillStyle = p.beard ? shade(p.hair, -0.1) : 'rgba(40,30,30,0.28)';
    g.beginPath(); g.ellipse(cx, hy + hh * 0.72, hw * (p.beard === 'full' ? 0.95 : 0.8), hh * (p.beard === 'full' ? 0.5 : 0.36), 0, 0, Math.PI); g.fill();
    if (p.beard === 'full') { g.fillRect(cx - hw, hy + hh * 0.2, hw * 0.25, hh * 0.55); g.fillRect(cx + hw * 0.75, hy + hh * 0.2, hw * 0.25, hh * 0.55); }
  }
  g.restore();

  // Age lines.
  if (p.age > 0.55) {
    g.strokeStyle = `rgba(80,40,30,${0.15 + (p.age - 0.55) * 0.5})`; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(cx - hw * 0.62, hy - hh * 0.03); g.lineTo(cx - hw * 0.72, hy + hh * 0.02); g.stroke();
    g.beginPath(); g.moveTo(cx + hw * 0.62, hy - hh * 0.03); g.lineTo(cx + hw * 0.72, hy + hh * 0.02); g.stroke();
    g.beginPath(); g.moveTo(cx - hw * 0.35, hy + hh * 0.42); g.quadraticCurveTo(cx - hw * 0.42, hy + hh * 0.58, cx - hw * 0.32, hy + hh * 0.66); g.stroke();
    g.beginPath(); g.moveTo(cx + hw * 0.35, hy + hh * 0.42); g.quadraticCurveTo(cx + hw * 0.42, hy + hh * 0.58, cx + hw * 0.32, hy + hh * 0.66); g.stroke();
  }

  // Eyes, brows.
  const ey = hy - hh * 0.02, ex = hw * 0.42;
  for (const s of [-1, 1]) {
    const x = cx + s * ex;
    ell(g, x, ey + 1, hw * 0.2, hh * 0.075, shade(p.skin, -0.3)); // socket shadow
    ell(g, x, ey, hw * 0.15, hh * 0.05, s < 0 ? '#ece6dc' : '#bdb5ab');
    ell(g, x + hw * 0.02, ey, hw * 0.075, hh * 0.05, p.shadowed ? '#111' : '#2b1d16');
    ell(g, x - hw * 0.01, ey - hh * 0.015, 1.3, 1.3, 'rgba(255,255,255,0.85)');
    g.strokeStyle = shade(p.hair === '#d9d9d9' || p.hair === '#ece8e0' ? '#8a8580' : p.hair, -0.1); g.lineWidth = p.female ? 2.2 : 3.4; g.lineCap = 'round';
    const tilt = p.brow === 'stern' ? 0.12 : p.brow === 'kind' ? -0.1 : s < 0 ? 0.16 : -0.08;
    g.beginPath();
    g.moveTo(x - s * hw * 0.2, ey - hh * 0.14 + tilt * s * -6);
    g.quadraticCurveTo(x, ey - hh * 0.2, x + s * hw * 0.22, ey - hh * 0.13 - tilt * s * -6);
    g.stroke();
  }
  if (p.shadowed) { // hat brim shadow over the eyes
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(cx - hw * 1.1, ey - hh * 0.25, hw * 2.2, hh * 0.32);
  }

  // Nose: light ridge + shadow side.
  g.strokeStyle = shade(p.skin, -0.35); g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx + hw * 0.04, ey + hh * 0.05); g.quadraticCurveTo(cx + hw * 0.16, hy + hh * 0.32, cx + hw * 0.02, hy + hh * 0.38); g.stroke();
  ell(g, cx - hw * 0.06, hy + hh * 0.38, hw * 0.12, hh * 0.04, shade(p.skin, -0.25));

  // Mouth.
  const my = hy + hh * 0.58;
  if (p.mustache) { g.fillStyle = shade(p.hair, -0.05); g.beginPath(); g.ellipse(cx, my - hh * 0.07, hw * 0.34, hh * 0.07, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = p.lips || shade(p.skin, -0.45); g.lineWidth = p.lips ? 3.2 : 2.2;
  const smile = p.brow === 'kind' ? 3 : p.brow === 'sly' ? 1.5 : -0.5;
  g.beginPath(); g.moveTo(cx - hw * 0.26, my); g.quadraticCurveTo(cx, my + smile, cx + hw * 0.26, my - (p.brow === 'sly' ? 2 : 0)); g.stroke();

  if (p.scar) { g.strokeStyle = 'rgba(150,60,60,0.8)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx + hw * 0.5, ey - hh * 0.2); g.lineTo(cx + hw * 0.3, ey + hh * 0.3); g.stroke(); }

  if (p.glasses) {
    g.strokeStyle = 'rgba(30,25,25,0.9)'; g.lineWidth = 2;
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(cx + s * ex, ey + 1, hw * 0.24, hh * 0.1, 0, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - ex + hw * 0.24, ey); g.lineTo(cx + ex - hw * 0.24, ey); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(cx - ex - hw * 0.15, ey - hh * 0.06, hw * 0.12, hh * 0.04);
  }

  drawHair(g, p, cx, hy, hw, hh, rnd);

  // Red rim light down the right side, and a key light on the left.
  g.save();
  g.globalCompositeOperation = 'lighter';
  const rim = g.createLinearGradient(cx + hw * 0.55, 0, cx + hw * 1.45, 0);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(0.6, 'rgba(200,24,24,0.32)'); rim.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rim;
  g.beginPath(); g.ellipse(cx + hw * 0.95, hy + hh * 0.6, hw * 0.55, hh * 2.1, 0, 0, Math.PI * 2); g.fill();
  g.restore();

  if (p.rose) { // a red rose in the lapel
    ell(g, cx - S * 0.21, S * 0.86, 7, 6, '#a3090f'); ell(g, cx - S * 0.21, S * 0.855, 4, 3.5, '#d42a2f');
  }

  // Film grain + vignette.
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const vg = g.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)');
  g.fillStyle = vg; g.fillRect(0, 0, S, S);
  return c;
}

function drawClothes(g, p, cx, S) {
  const top = S * 0.74;
  const body = g.createLinearGradient(0, top, 0, S);
  body.addColorStop(0, shade(p.cloth, 0.08)); body.addColorStop(1, shade(p.cloth, -0.45));
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(cx - S * 0.42, S); g.quadraticCurveTo(cx - S * 0.4, top, cx - S * 0.12, top - S * 0.03);
  g.lineTo(cx + S * 0.12, top - S * 0.03); g.quadraticCurveTo(cx + S * 0.4, top, cx + S * 0.42, S); g.closePath(); g.fill();
  const v = (fill, w = 0.1, d = 0.2) => { g.fillStyle = fill; g.beginPath(); g.moveTo(cx - S * w, top - S * 0.03); g.lineTo(cx, top + S * d); g.lineTo(cx + S * w, top - S * 0.03); g.closePath(); g.fill(); };
  switch (p.clothes) {
    case 'suit': case 'coat':
      v(p.shirt || '#ddd', 0.1, 0.22);
      if (p.collar) { g.fillStyle = '#f4f2ee'; g.fillRect(cx - 6, top - S * 0.035, 12, 7); }
      if (p.tie) { g.fillStyle = p.tie; g.beginPath(); g.moveTo(cx - 5, top); g.lineTo(cx + 5, top); g.lineTo(cx + 7, S); g.lineTo(cx - 7, S); g.closePath(); g.fill(); }
      g.strokeStyle = shade(p.cloth, -0.6); g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(cx - S * 0.12, top - S * 0.03); g.lineTo(cx - S * 0.05, S); g.moveTo(cx + S * 0.12, top - S * 0.03); g.lineTo(cx + S * 0.05, S); g.stroke();
      if (p.clothes === 'coat') { g.fillStyle = shade(p.cloth, 0.12); g.beginPath(); g.moveTo(cx - S * 0.13, top - S * 0.04); g.lineTo(cx - S * 0.24, top + S * 0.1); g.lineTo(cx - S * 0.1, top + S * 0.08); g.closePath(); g.fill(); g.beginPath(); g.moveTo(cx + S * 0.13, top - S * 0.04); g.lineTo(cx + S * 0.24, top + S * 0.1); g.lineTo(cx + S * 0.1, top + S * 0.08); g.closePath(); g.fill(); }
      break;
    case 'cardigan': v('#e8e2d4', 0.08, 0.14); g.fillStyle = 'rgba(255,255,255,0.5)'; for (let i = 0; i < 3; i++) ell(g, cx - S * 0.06, top + S * (0.12 + i * 0.07), 2, 2, '#ddd'); break;
    case 'apron': g.fillStyle = '#e9e1cf'; g.fillRect(cx - S * 0.13, top + S * 0.05, S * 0.26, S * 0.25); g.strokeStyle = '#e9e1cf'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx - S * 0.1, top + S * 0.05); g.lineTo(cx - S * 0.08, top - S * 0.03); g.moveTo(cx + S * 0.1, top + S * 0.05); g.lineTo(cx + S * 0.08, top - S * 0.03); g.stroke(); break;
    case 'flannel': g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 3; for (let i = -4; i <= 4; i++) { g.beginPath(); g.moveTo(cx + i * 16, top); g.lineTo(cx + i * 16, S); g.stroke(); } for (let y = top + 10; y < S; y += 14) { g.beginPath(); g.moveTo(cx - S * 0.42, y); g.lineTo(cx + S * 0.42, y); g.stroke(); } v(shade(p.cloth, -0.2), 0.08, 0.1); break;
    case 'overalls': g.fillStyle = '#3b4f6e'; g.fillRect(cx - S * 0.16, top + S * 0.08, S * 0.32, S * 0.2); g.fillRect(cx - S * 0.15, top - S * 0.02, S * 0.05, S * 0.12); g.fillRect(cx + S * 0.1, top - S * 0.02, S * 0.05, S * 0.12); break;
    case 'uniform': v('#c8b88a', 0.08, 0.12); g.fillStyle = '#d4af37'; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 4 : 9; g.lineTo(cx - S * 0.2 + Math.cos(a) * r, top + S * 0.1 + Math.sin(a) * r); } g.closePath(); g.fill(); break;
    case 'pearls': v(shade(p.cloth, 0.1), 0.1, 0.1); for (let i = -5; i <= 5; i++) ell(g, cx + i * 6, top + S * 0.02 + Math.abs(i) * -1.2 + 10, 3, 3, '#f1ece0'); break;
    default: v(shade(p.cloth, -0.25), 0.07, 0.08);
  }
}

function drawHair(g, p, cx, hy, hw, hh, rnd) {
  const hair = p.hair;
  const hi = shade(hair, 0.25), lo = shade(hair, -0.35);
  const grad = g.createLinearGradient(cx - hw, hy - hh, cx + hw, hy);
  grad.addColorStop(0, hi); grad.addColorStop(1, lo);
  g.fillStyle = grad;
  const cap = (h = 0.55, w = 1.08) => { g.beginPath(); g.ellipse(cx, hy - hh * 0.45, hw * w, hh * h, 0, Math.PI, 0); g.fill(); };
  switch (p.style) {
    case 'slick':
      cap(0.62, 1.06);
      g.fillRect(cx - hw * 1.04, hy - hh * 0.5, hw * 0.16, hh * 0.45); g.fillRect(cx + hw * 0.88, hy - hh * 0.5, hw * 0.16, hh * 0.45);
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(cx - hw * 0.8 + i * hw * 0.3, hy - hh * 0.6); g.quadraticCurveTo(cx + i * 4, hy - hh * 1.08, cx + hw * 0.9, hy - hh * 0.8); g.stroke(); }
      if (p.grey) { g.fillStyle = `rgba(200,200,200,${p.grey})`; g.fillRect(cx - hw * 1.04, hy - hh * 0.45, hw * 0.16, hh * 0.38); g.fillRect(cx + hw * 0.88, hy - hh * 0.45, hw * 0.16, hh * 0.38); }
      break;
    case 'short': cap(0.6, 1.07); break;
    case 'buzz': g.globalAlpha = 0.75; cap(0.5, 1.04); g.globalAlpha = 1; break;
    case 'balding':
      g.fillRect(cx - hw * 1.05, hy - hh * 0.45, hw * 0.25, hh * 0.5); g.fillRect(cx + hw * 0.8, hy - hh * 0.45, hw * 0.25, hh * 0.5);
      ell(g, cx - hw * 0.2, hy - hh * 0.7, hw * 0.5, hh * 0.25, 'rgba(255,255,255,0.12)');
      break;
    case 'bun': cap(0.62, 1.1); ell(g, cx + hw * 0.1, hy - hh * 1.1, hw * 0.38, hh * 0.24, grad); break;
    case 'bob': cap(0.66, 1.16); g.fillRect(cx - hw * 1.16, hy - hh * 0.5, hw * 0.3, hh * 1.05); g.fillRect(cx + hw * 0.86, hy - hh * 0.5, hw * 0.3, hh * 1.05); break;
    case 'long': cap(0.66, 1.14); g.fillRect(cx - hw * 1.14, hy - hh * 0.5, hw * 0.28, hh * 1.6); g.fillRect(cx + hw * 0.86, hy - hh * 0.5, hw * 0.28, hh * 1.6); break;
    case 'braid': cap(0.62, 1.1); for (let i = 0; i < 5; i++) ell(g, cx + hw * 0.95, hy + hh * (0.2 + i * 0.28), hw * 0.16, hh * 0.15, i % 2 ? lo : hi); break;
    case 'curly': for (let i = 0; i < 26; i++) { const a = Math.PI + (i / 25) * Math.PI; ell(g, cx + Math.cos(a) * hw * 1.02, hy - hh * 0.3 + Math.sin(a) * hh * 0.85, hw * 0.24, hw * 0.24, i % 2 ? hi : lo); } for (let i = 0; i < 6; i++) { ell(g, cx - hw * 1.05, hy - hh * 0.2 + i * 9, hw * 0.2, hw * 0.2, lo); ell(g, cx + hw * 1.05, hy - hh * 0.2 + i * 9, hw * 0.2, hw * 0.2, lo); } break;
    case 'cap': cap(0.5, 1.04); hat(g, cx, hy, hw, hh, p.hat || '#333', 'cap'); break;
    case 'fedora': hat(g, cx, hy, hw, hh, p.hat || '#222', 'fedora'); break;
    case 'trooper': cap(0.5, 1.04); hat(g, cx, hy, hw, hh, p.hat || '#6b5a3a', 'trooper'); break;
    default: cap();
  }
  void rnd;
}

function hat(g, cx, hy, hw, hh, col, kind) {
  const top = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
  top.addColorStop(0, shade(col, 0.2)); top.addColorStop(1, shade(col, -0.4));
  if (kind === 'cap') {
    g.fillStyle = top; g.beginPath(); g.ellipse(cx, hy - hh * 0.55, hw * 1.08, hh * 0.55, 0, Math.PI, 0); g.fill();
    ell(g, cx - hw * 0.3, hy - hh * 0.55, hw * 0.95, hh * 0.1, shade(col, -0.3));
  } else {
    const brimW = kind === 'trooper' ? 1.75 : 1.6;
    ell(g, cx, hy - hh * 0.55, hw * brimW, hh * 0.16, shade(col, -0.35));
    g.fillStyle = top;
    g.beginPath(); g.moveTo(cx - hw * 0.95, hy - hh * 0.6); g.lineTo(cx - hw * 0.8, hy - hh * 1.25); g.quadraticCurveTo(cx, hy - hh * (kind === 'trooper' ? 1.5 : 1.15), cx + hw * 0.8, hy - hh * 1.25); g.lineTo(cx + hw * 0.95, hy - hh * 0.6); g.closePath(); g.fill();
    g.fillStyle = kind === 'trooper' ? '#3a2a14' : '#0d0d0d'; g.fillRect(cx - hw * 0.93, hy - hh * 0.78, hw * 1.86, hh * 0.14);
  }
}
