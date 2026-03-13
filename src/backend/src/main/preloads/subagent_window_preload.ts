import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  windowInfo: (callback: (data: Record<string, any>) => void) => ipcRenderer.on('windowInfo', (_event, data) => callback(data)),
  toolData: (callback: (chunk: any) => void) => ipcRenderer.on('toolData', (_event, chunk) => callback(chunk)),
  streamData: (callback: (chunk: any) => void) => ipcRenderer.on('streamData', (_event, chunk) => callback(chunk)),
  infoData: (callback: (info: any) => void) => ipcRenderer.on('infoData', (_event, info) => callback(info)),
  userData: (callback: (info: any) => void) => ipcRenderer.on('userData', (_event, info) => callback(info)),
  agentLoop: (data: Record<string, any>) => ipcRenderer.invoke('agentLoop', data),
});