import { contextBridge, ipcRenderer } from 'electron';

/**
 * Demo 窗口的 preload 脚本
 * 演示窗口为纯前端自治，仅暴露最小 API 表面
 */
contextBridge.exposeInMainWorld('demoAPI', {
    notifyReady: () => ipcRenderer.send('demo-window-ready'),
    platform: process.platform,
});

export {};