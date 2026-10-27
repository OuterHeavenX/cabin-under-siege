// Desktop shell for Cabin Under Siege (Steam Deck, Linux, Windows).
// Serves the game from app://game/ so ES modules, localStorage and fetch work
// exactly as they do on the web, opens fullscreen, and gives the page a tiny
// bridge for quitting and toggling fullscreen.
const { app, BrowserWindow, protocol, net, ipcMain, Menu, shell, powerMonitor } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const GAME = path.join(__dirname, 'game');

// The Deck's controller isn't a "user gesture", so let audio start without one.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('no-sandbox');
app.setName('Cabin Under Siege');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;

function createWindow() {
  const windowed = process.argv.includes('--windowed');
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 540,
    fullscreen: !windowed,
    backgroundColor: '#0a0707',
    title: 'Cabin Under Siege',
    icon: path.join(GAME, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://game/index.html');
  // Links (e.g. in the README) open in the system browser, never inside the game.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); shell.openExternal(url); } });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(GAME, decodeURIComponent(pathname)));
    if (!file.startsWith(GAME)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('toggle-fullscreen', () => { if (win) win.setFullScreen(!win.isFullScreen()); });
  createWindow();
  // Steam Deck sleep (power button) or a laptop lid: pause the game first.
  const suspend = () => { if (win) win.webContents.send('suspend'); };
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('lock-screen', suspend);
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
