import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  toolData: (callback: (chunk: any) => void) => ipcRenderer.on('toolData', (_event, chunk) => callback(chunk)),
  streamData: (callback: (chunk: any) => void) => ipcRenderer.on('streamData', (_event, chunk) => callback(chunk)),
  infoData: (callback: (info: any) => void) => ipcRenderer.on('infoData', (_event, info) => callback(info)),
  userData: (callback: (info: any) => void) => ipcRenderer.on('userData', (_event, info) => callback(info)),
  // subagent
  windowInfo: (callback: (data: Record<string, any>) => void) => ipcRenderer.on('windowInfo', (_event, data) => callback(data)),
  minimizeWindow: (info: Record<string, any>) => ipcRenderer.send(`minimize-window-${info.id}`),
  closeWindow: (info: Record<string, any>) => ipcRenderer.send(`close-window-${info.id}`),
});