const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cowork', {
  quitSaver: () => ipcRenderer.send('quit-saver'),
  close: () => ipcRenderer.send('win-close'),
  pin: (v) => ipcRenderer.send('win-pin', v),
  maximize: () => ipcRenderer.send('win-max'),
  onTasks: (cb) => ipcRenderer.on('tasks-update', (_e, payload) => cb(payload)),
  openLink: (url) => ipcRenderer.send('open-link', url)
});
