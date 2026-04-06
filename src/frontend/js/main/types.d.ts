export interface ElectronAPI {
  saveChat: (chat: any) => Promise<void>;
  handleLog: (callback: (log: { type: string; content: string }) => void) => void;
  showLog: (log: { type: string; content: string }) => void;
  handleDeleteMemory: (callback: (data: { context_ids: number[]; ids: number[] }) => void) => void;
  initInfo: (callback: (info: any) => void) => void;
  Envs: (data: { type: string; envs?: any }) => Promise<any>;
  Tasks: (data: { type: string; tasks?: any }) => Promise<any>;
  changeMode: (mode: string) => void;
  getFilePath: () => Promise<string | null>;
  setChat: (chat: any) => Promise<void>;
  setUUID: (callback: (uuid: string) => void) => void;
  toggleMessageGroup: (data: { group_id: string; del: boolean }) => Promise<{ del_mode: boolean }>;
  compressionGroupMessage: (data: { group_id: string }) => Promise<{ compression_content: string }>;
  thumbMessageGroup: (data: { group_id: string; thumb: number }) => Promise<number>;
  toggleContextMessage: (context_id: string) => Promise<{ del_mode: boolean }>;
  handleMarkDownFormat: (callback: (status: boolean) => void) => void;
  handleReactStatu: (callback: (status: boolean) => void) => void;
  streamData: (callback: (chunk: any) => void) => void;
  toolData: (callback: (chunk: any) => void) => void;
  infoData: (callback: (info: any) => void) => void;
  userData: (callback: (data: any) => void) => void;
  agentRunning: (callback: (data: { group_id?: string; uuid?: string }) => void) => void;
  agentIdle: (callback: (data: { group_id?: string; uuid?: string }) => void) => void;
  stopMessage: () => Promise<void>;
  startAgentLoop: (callback: (data: any) => void) => void;
  agentLoop: (data: any) => void;
  handleExtraLoad: (callback: (data: any[]) => void) => void;
  handleOptions: (callback: (data: { options: string[]; group_id: string, uuid: string }) => void) => void;
  setPrompt: (callback: (prompt: string) => void) => void;
  handleClear: (callback: () => void) => void;
  uploadProgress: (callback: (info: any) => void) => void;
  getConfig: () => Promise<any>;
  setConfig: (config: any) => Promise<any>;
  newChat: () => Promise<any>;
  handleNewChat: (callback: (chat: any) => void) => void;
  loadChat: (chatId: string) => Promise<any>;
  handleSelectChat: (callback: (chat: any) => void) => void;
  handleSetChat: (callback: (chat: any) => void) => void;
  delChat: (chatId: string) => Promise<void>;
  renameChat: (data: { id: string; name: string }) => Promise<void>;
  handleAutoRenameChat: (callback: (chat: any) => void) => void;
  // subagent
  windowInfo: (callback: (data: any) => void) => void;
  minimizeWindow: (info: Record<string, any>) => void;
  closeWindow: (info: Record<string, any>) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    hljs: any;
    mermaid: any;
    pdfjsLib: any;
    marked: any;
    markedHighlight: any;
    markedKatex: any;
    JSONEditor: any;
  }
}
