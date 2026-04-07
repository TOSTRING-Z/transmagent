import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { WindowManager } from "./WindowManager";
import { ToolCall } from '../../core/ToolCall';
import { Mode } from '../../core/ReActAgent';
import { AgentTool } from '../../core/SubAgent';
import { LLMService } from '../../core/LLMService';
import { parseJsonContent } from '../../utils/public';

export class SubAgentWindow {
    public agentToolName?: string;
    public agentTool?: AgentTool;
    public agentTools: Record<string, AgentTool>;
    public windows: BrowserWindow[]; // 支持多个子 Agent 窗口
    private windowListeners: Map<BrowserWindow, { minimize: () => void; close: () => void }>;
    constructor(agentTools: Record<string, AgentTool> = {}) {
        this.agentTools = agentTools;
        this.windows = [] as any; // 覆盖基类的 BrowserWindow | null
        this.windowListeners = new Map();
    }

    public async query(query: string, agentToolName: string, toolCall: ToolCall): Promise<any> {
        return await this.create({ query, agentToolName, toolCall });
    }

    public async create(params?: { query: string; agentToolName: string, toolCall: ToolCall }): Promise<any> {
        if (!params) return;
        const { query, agentToolName, toolCall } = params;

        const win = new BrowserWindow({
            width: 800 - Math.min(this.windows.length, 5) * 50,
            height: 800 - Math.min(this.windows.length, 5) * 50,
            frame: false,
            transparent: false,
            resizable: true,
            webPreferences: {
                preload: path.join(__dirname, '../preloads/subagent_window_preload.js'),
            },
        });

        // win.webContents.openDevTools()

        this.windows.push(win);

        const listeners = {
            minimize: () => win.minimize(),
            close: () => {
                if (win && !win.isDestroyed()) {
                    win.close();
                    this.windows = this.windows.filter(w => w !== win);
                }
            }
        };

        const result = await new Promise<any>((resolve) => {
            this.windowListeners.set(win, listeners);

            ipcMain.once(`minimize-window-${win.id}`, listeners.minimize);
            ipcMain.once(`close-window-${win.id}`, listeners.close);

            win.loadFile('src/frontend/subagent.html');

            this.agentToolName = agentToolName;
            this.agentTool = this.agentTools[agentToolName];

            win.on('closed', () => {
                if (this.agentTool) {
                    this.agentTool.toolCall.changeWindow();
                    this.agentTool.toolCall.llmService.stopLoop();
                    resolve("The user interrupted the task.");
                }
            });

            win.webContents.on('did-finish-load', async () => {
                win.restore();
                win.show();
                win.focus();
                win.webContents.send('windowInfo', { id: win.id, name: agentToolName });
                if (this.agentTool) {
                    this.agentTool.toolCall.changeWindow(win);
                    // 子代理模式同主代理模式一样（计划模式例外）
                    if (toolCall.llmService.environment_details.mode !== Mode.PLAN) {
                        this.agentTool.toolCall.changeMode(toolCall.llmService.chatManager.chat.mode);
                    } else {
                        // 计划模式下，子代理默认为自动模式
                        this.agentTool.toolCall.changeMode("auto");
                    }

                    if (toolCall.llmService.utils.getConfig("toolCall")?.subagent_llm_init || this.windows.length > 1) {
                        this.agentTool.toolCall.llmService.chatManager.initMessages();
                    }
                    const mainChat = toolCall.llmService.chatManager.chat;
                    this.agentTool.toolCall.llmService.chatManager.chat.tool_format = mainChat.tool_format;
                    this.agentTool.toolCall.llmService.startLoop();
                    let data = this.agentTool.toolCall.getDataDefault({ query, model: mainChat.model, version: mainChat.version });
                    data = await this.agentTool.toolCall.callReAct(data);
                    const res_json = parseJsonContent(data.output_format);
                    resolve(res_json[0]?.content || data.output_format);
                }
            });
        });

        listeners.close();
        return {
            content: result,
            subagent_tool: true
        };
    }

    public destroy(init: boolean = true): void {
        if (this.windows && this.windows.length > 0) {
            const windowsToClose = [...this.windows];

            for (const name in this.agentTools) {
                if (Object.prototype.hasOwnProperty.call(this.agentTools, name)) {
                    const agentTool = this.agentTools[name];
                    if (init) agentTool.toolCall.llmService.chatManager.initMessages();
                    agentTool.toolCall.llmService.stopLoop();
                }
            }

            windowsToClose.forEach(win => {
                if (win && !win.isDestroyed()) {
                    win.close();
                }
            });

            this.windows.length = 0;
            this.windowListeners.clear();
        }
    }

    public setup(): void {
        // 预留：子 Agent 窗口的 IPC 事件绑定
    }
}