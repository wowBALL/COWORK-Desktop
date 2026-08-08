const { contextBridge, ipcRenderer } = require('electron');

// preload ของ "แถบเครื่องมือ" เท่านั้น ไม่ใช่ของหน้าเว็บเป้าหมาย — หน้าเว็บเป้าหมายไม่มี preload
// เลยโดยตั้งใจ จะได้ไม่มีทางที่หน้าเว็บภายนอกเรียก IPC ของแอปได้
contextBridge.exposeInMainWorld('grab', {
  navigate: (url) => ipcRenderer.send('web-grab-navigate', url),
  capture: () => ipcRenderer.send('web-grab-capture'),
  done: () => ipcRenderer.send('web-grab-done'),
  onStatus: (cb) => ipcRenderer.on('web-grab-status', (_e, s) => cb(s)),
});
