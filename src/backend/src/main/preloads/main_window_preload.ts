import { contextBridge, ipcRenderer } from 'electron';

// Whitelist of channels allowed through the generic `send` bridge.
// Any channel not in this list will be silently dropped by the renderer-side
// wrapper, preventing XSS-loaded scripts from invoking arbitrary IPC channels
// (e.g. arbitrary file system or shell access via the main process).
const ALLOWED_SEND_CHANNELS = new Set<string>([
  'response-system-prompt',
]);

contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel: string, data: any) => {
    if (!ALLOWED_SEND_CHANNELS.has(channel)) {
      console.warn('[preload] blocked send on non-whitelisted channel:', channel);
      return;
    }
    ipcRenderer.send(channel, data);
  },
  changeMode: (mode: any) => ipcRenderer.send('changeMode', mode),
  openExternal: (href: string) => ipcRenderer.send('open-external', href),
  stopMessage: () => ipcRenderer.send('stopMessage'),
  renameChat: (data: Record<string, any>) => ipcRenderer.send('renameChat', data),
  delChat: (id: any) => ipcRenderer.send('delChat', id),
  toggleStar: (id: any) => ipcRenderer.invoke('toggleStar', id),
  setChat: (chat: any) => ipcRenderer.send('setChat', chat),
  showLog: (data: Record<string, any>) => ipcRenderer.send('show-log', data),
  startAgentLoop: (callback: (data: Record<string, any>) => void) => ipcRenderer.on('startAgentLoop', (_event, data) => callback(data)),
  handleExtraLoad: (callback: (data: Record<string, any>) => void) => ipcRenderer.on('extra_load', (_event, data) => callback(data)),
  handleQuestions: (callback: (data: Record<string, any>) => void) => ipcRenderer.on('handleQuestions', (_event, data) => callback(data)),
  handleClear: (callback: (value: any) => void) => ipcRenderer.on('clear', (_event, value) => callback(value)),
  initInfo: (callback: (info: any) => void) => ipcRenderer.on('init-info', (_event, info) => callback(info)),
  setPrompt: (callback: (prompt: any) => void) => ipcRenderer.on('prompt', (_event, prompt) => callback(prompt)),
  onRequestSystemPrompt: (callback: () => void) => ipcRenderer.on('request-system-prompt', () => callback()),
  handleLog: (callback: (log: any) => void) => ipcRenderer.on('log', (_event, log) => callback(log)),
  handleReactStatu: (callback: (status: any) => void) => ipcRenderer.on('react-statu', (_event, react_statu) => callback(react_statu)),
  handleDeleteMemory: (callback: (data: Record<string, any>) => void) => ipcRenderer.on('delete-memory', (_event, data) => callback(data)),
  toolData: (callback: (chunk: any) => void) => ipcRenderer.on('toolData', (_event, chunk) => callback(chunk)),
  streamData: (callback: (chunk: any) => void) => ipcRenderer.on('streamData', (_event, chunk) => callback(chunk)),
  infoData: (callback: (info: any) => void) => ipcRenderer.on('infoData', (_event, info) => callback(info)),
  userData: (callback: (info: any) => void) => ipcRenderer.on('userData', (_event, info) => callback(info)),
  agentRunning: (callback: (data: any) => void) => ipcRenderer.on('agentRunning', (_event, data) => callback(data)),
  agentIdle: (callback: (data: any) => void) => ipcRenderer.on('agentIdle', (_event, data) => callback(data)),
  uploadProgress: (callback: (info: any) => void) => ipcRenderer.on('upload-progress', (_event, info) => callback(info)),
  setUUID: (callback: (uuid: string) => void) => ipcRenderer.on('setUUID', (_event, uuid) => callback(uuid)),
  handleNewChat: (callback: (chat: any) => void) => ipcRenderer.on('handleNewChat', (_event, chat) => callback(chat)),
  handleSetChat: (callback: (chat: any) => void) => ipcRenderer.on('handleSetChat', (_event, chat) => callback(chat)),
  handleloadChat: (callback: (chat: any) => void) => ipcRenderer.on('handleloadChat', (_event, chat) => callback(chat)),
  handleRenameChat: (callback: (chat: any) => void) => ipcRenderer.on('handleRenameChat', (_event, chat) => callback(chat)),
  agentLoop: (data: Record<string, any>) => ipcRenderer.invoke('agentLoop', data),
  getFilePath: () => ipcRenderer.invoke('get-file-path'),
  captureRegion: (params: any) => ipcRenderer.invoke('capture-region', params),
  toggleMessageGroup: (data: Record<string, any>) => ipcRenderer.invoke('toggleMessageGroup', data),
  compressionGroupMessage: (data: Record<string, any>) => ipcRenderer.invoke('compressionGroupMessage', data),
  thumbMessageGroup: (data: Record<string, any>) => ipcRenderer.invoke('thumbMessageGroup', data),
  toggleContextMessage: (context_id: any) => ipcRenderer.invoke('toggleContextMessage', context_id),
  newChat: () => ipcRenderer.invoke('newChat'),
  loadChat: (id: any) => ipcRenderer.invoke('loadChat', id),
  getConfig: () => ipcRenderer.invoke('get-config-main'),
  setConfig: (config: any) => ipcRenderer.invoke('set-config-main', config),
  Envs: (data: Record<string, any>) => ipcRenderer.invoke('envs', data),
  Tasks: (data: Record<string, any>) => ipcRenderer.invoke('tasks', data),
  BGTasks: (data: Record<string, any>) => ipcRenderer.invoke('bgtasks', data),
  BGTaskDetails: (data: { type: string; taskId: string }) => ipcRenderer.invoke('bgtask-details', data),
});
