const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('popout', {
  sendSignal: (data) => ipcRenderer.send('popout:to-main', data),
  onSignal: (cb) => { ipcRenderer.on('popout:from-main', (_, data) => cb(data)); },
  ready: () => ipcRenderer.send('popout:ready'),
});
