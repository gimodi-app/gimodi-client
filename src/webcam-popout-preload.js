const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wcPopout', {
  sendSignal: (data) => ipcRenderer.send('wcpopout:to-main', data),
  onSignal: (cb) => {
    ipcRenderer.on('wcpopout:from-main', (_, data) => cb(data));
  },
  ready: () => ipcRenderer.send('wcpopout:ready'),
});
