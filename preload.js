const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cowork', {
  quitSaver: () => ipcRenderer.send('quit-saver'),
  close: () => ipcRenderer.send('win-close'),
  pin: (v) => ipcRenderer.send('win-pin', v),
  maximize: () => ipcRenderer.send('win-max'),
  onTasks: (cb) => ipcRenderer.on('tasks-update', (_e, payload) => cb(payload)),
  openLink: (url) => ipcRenderer.send('open-link', url),
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  onWorkspace: (cb) => ipcRenderer.on('workspace-update', (_e, payload) => cb(payload)),
  openFile: (p) => ipcRenderer.send('open-file', p),
  refreshWorkspace: () => ipcRenderer.send('workspace-refresh'),
  getIssuePreview: (id) => ipcRenderer.invoke('get-issue-preview', id),
  closeIssue: (id, customField) => ipcRenderer.invoke('close-issue', id, customField),
  getRedmineConfig: () => ipcRenderer.invoke('get-redmine-config'),
  testRedmineConnection: (cfg) => ipcRenderer.invoke('test-redmine-connection', cfg),
  saveRedmineConfig: (cfg) => ipcRenderer.invoke('save-redmine-config', cfg)
});
