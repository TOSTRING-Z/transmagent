import { contextBridge, ipcRenderer } from 'electron';

/**
 * Demo 窗口的 preload 脚本
 * 演示窗口为纯前端自治，仅暴露最小 API 表面
 */
contextBridge.exposeInMainWorld('demoAPI', {
    notifyReady: () => ipcRenderer.send('demo-window-ready'),
    platform: process.platform,
    /**
     * 接收主窗口推送的聊天历史数据
     * @param callback 回调函数，参数为 { title, scenario, messages }
     */
    onDemoData: (callback: (payload: any) => void) => {
        ipcRenderer.removeAllListeners('demo-data');
        ipcRenderer.on('demo-data', (_event, payload) => callback(payload));
    },
});

export {};