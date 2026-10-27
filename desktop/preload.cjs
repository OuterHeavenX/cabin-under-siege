// The only things the game page can ask of the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

ipcRenderer.on('suspend', () => window.dispatchEvent(new Event('cus-suspend')));

contextBridge.exposeInMainWorld('cusDesktop', {
  platform: process.platform,
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
});
