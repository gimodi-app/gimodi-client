const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gimodi', {
  identity: {
    loadAll: () => ipcRenderer.invoke('identity:load-all'),
    create: (name) => ipcRenderer.invoke('identity:create', name),
    delete: (fingerprint) => ipcRenderer.invoke('identity:delete', fingerprint),
    setDefault: (fingerprint) => ipcRenderer.invoke('identity:set-default', fingerprint),
    getDefault: () => ipcRenderer.invoke('identity:get-default'),
    export: (fingerprint) => ipcRenderer.invoke('identity:export', fingerprint),
    import: () => ipcRenderer.invoke('identity:import'),
  },
});
