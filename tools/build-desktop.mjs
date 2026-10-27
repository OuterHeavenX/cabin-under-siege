// Builds the installable desktop game (Steam Deck / Linux, optionally Windows)
// as ready-to-upload itch.io zips in desktop/dist/.
//
// Usage (from the repo root):
//   cd desktop && npm install        # once: Electron + packager
//   node tools/build-desktop.mjs     # Linux x64 (Steam Deck)
//   node tools/build-desktop.mjs --win      # also Windows x64
//   node tools/build-desktop.mjs --stage    # only copy the game into desktop/game (for `npm start`)
import { cpSync, rmSync, mkdirSync, existsSync, writeFileSync, chmodSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = new URL('..', import.meta.url).pathname;
const desk = root + 'desktop/';
const game = desk + 'game/';
const SHIP = ['index.html', 'css', 'src', 'icons', 'audio'];
const version = readFileSync(root + 'src/config.js', 'utf8').match(/GAME_VERSION = '([^']+)'/)[1];
const args = process.argv.slice(2);

// 1. Stage the game files next to the shell.
rmSync(game, { recursive: true, force: true });
mkdirSync(game, { recursive: true });
for (const f of SHIP) if (existsSync(root + f)) cpSync(root + f, game + f, { recursive: true });
console.log(`Staged game v${version} in desktop/game/`);
if (args.includes('--stage')) process.exit(0);

// 2. Package with Electron.
const require = createRequire(desk + 'package.json');
const { packager } = require('@electron/packager');
// One version number for everything: GAME_VERSION in src/config.js.
const pkg = JSON.parse(readFileSync(desk + 'package.json', 'utf8'));
if (pkg.version !== version) { pkg.version = version; writeFileSync(desk + 'package.json', JSON.stringify(pkg, null, 2) + '\n'); console.log(`desktop/package.json version -> ${version}`); }

const targets = [{ platform: 'linux', arch: 'x64' }];
if (args.includes('--win')) targets.push({ platform: 'win32', arch: 'x64' });

const out = desk + 'out/';
const dist = desk + 'dist/';
rmSync(out, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const README = `CABIN UNDER SIEGE v${version}
"You left the family. The family didn't leave you."

STEAM DECK
  1. Install with the itch.io app (Desktop Mode), or unzip this folder anywhere,
     e.g. /home/deck/Games/CabinUnderSiege.
  2. Steam > Games > "Add a Non-Steam Game to My Library..." > Browse, and pick
     cabin-under-siege.sh (set the file type filter to "All Files").
  3. Back in Game Mode, it's in your library under Non-Steam. Controller layout:
     use the "Gamepad" template (the default for non-Steam games).

CONTROLS (controller)
  Left stick move (full tilt / LT / L3 sprints) . Right stick aim . RT fire
  A interact / talk . B dodge . X reload . Y switch weapon
  RB melee . LB quick item . Menu pause . View journal
  D-pad: up map, down items, left home, right character
  Menus: D-pad or stick to move, A select, B back, LB/RB tabs

Keyboard and mouse work too. F11 toggles fullscreen; start windowed with --windowed.
Saves live in ~/.config/Cabin Under Siege (Linux) or %APPDATA%\\Cabin Under Siege (Windows).
Moving a save from the browser version: Settings > Export save file there, Import here.
`;

for (const t of targets) {
  const [dir] = await packager({
    dir: desk,
    out,
    ...t,
    overwrite: true,
    asar: true,
    prune: true,
    name: 'Cabin Under Siege',
    executableName: 'cabin-under-siege',
    appVersion: version,
    appCopyright: 'Cabin Under Siege',
    ignore: [/^\/out($|\/)/, /^\/dist($|\/)/, /^\/README\.md$/],
    quiet: true,
  });
  const win = t.platform === 'win32';
  writeFileSync(`${dir}/README.txt`, README);
  if (win) {
    writeFileSync(`${dir}/.itch.toml`, '[[actions]]\nname = "play"\npath = "cabin-under-siege.exe"\n');
  } else {
    // Unzipped Chromium can't use its setuid sandbox helper, so start without it
    // (the game only ever loads its own local files).
    writeFileSync(`${dir}/cabin-under-siege.sh`, '#!/bin/sh\nDIR="$(cd "$(dirname "$0")" && pwd)"\nexec "$DIR/cabin-under-siege" --no-sandbox "$@"\n');
    chmodSync(`${dir}/cabin-under-siege.sh`, 0o755);
    chmodSync(`${dir}/cabin-under-siege`, 0o755);
    writeFileSync(`${dir}/.itch.toml`, '[[actions]]\nname = "play"\npath = "cabin-under-siege.sh"\nplatform = "linux"\n');
  }
  const zip = `${dist}cabin-under-siege-${win ? 'windows' : 'linux'}-x64-v${version}.zip`;
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qry', zip, '.'], { cwd: dir });
  console.log(`Built ${zip.slice(root.length)}  (folder: ${dir.slice(root.length)})`);
}
