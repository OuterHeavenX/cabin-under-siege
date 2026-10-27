// The only things the game page can ask of the desktop shell.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cusDesktop', {
  platform: process.platform,
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
});
