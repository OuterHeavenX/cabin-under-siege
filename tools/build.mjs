// Copies the playable game (and nothing else) into dist/ for static hosting.
// No bundling: the game runs as plain ES modules. Usage: npm run build
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const out = root + 'dist/';
const SHIP = ['index.html', 'manifest.webmanifest', 'sw.js', '_headers', 'css', 'src', 'icons', 'audio'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of SHIP) if (existsSync(root + f)) cpSync(root + f, out + f, { recursive: true });
console.log(`Built dist/ (${SHIP.join(', ')})`);
