"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    toolData: (callback) => electron_1.ipcRenderer.on('toolData', (_event, chunk) => callback(chunk)),
    streamData: (callback) => electron_1.ipcRenderer.on('streamData', (_event, chunk) => callback(chunk)),
    infoData: (callback) => electron_1.ipcRenderer.on('infoData', (_event, info) => callback(info)),
    userData: (callback) => electron_1.ipcRenderer.on('userData', (_event, info) => callback(info)),
    // subagent
    windowInfo: (callback) => electron_1.ipcRenderer.on('windowInfo', (_event, data) => callback(data)),
    minimizeWindow: (info) => electron_1.ipcRenderer.send(`minimize-window-${info.id}`),
    closeWindow: (info) => electron_1.ipcRenderer.send(`close-window-${info.id}`),
});
//# sourceMappingURL=subagent_window_preload.js.map