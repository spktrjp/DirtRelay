// Lets the GUI ask the window to fit its content (ORCA-style: no spare margins).
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('relayApp', { fit: (w, h) => ipcRenderer.send('fit', Math.ceil(w), Math.ceil(h)) })
