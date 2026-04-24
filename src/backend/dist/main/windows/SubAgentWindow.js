"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubAgentWindow = void 0;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const ReActAgent_1 = require("../../core/ReActAgent");
const public_1 = require("../../utils/public");
class SubAgentWindow {
    agentToolName;
    agentTool;
    agentTools;
    windows; // 支持多个子 Agent 窗口
    windowListeners;
    constructor(agentTools = {}) {
        this.agentTools = agentTools;
        this.windows = []; // 覆盖基类的 BrowserWindow | null
        this.windowListeners = new Map();
    }
    async query(query, agentToolName, toolCall) {
        return await this.create({ query, agentToolName, toolCall });
    }
    async create(params) {
        if (!params)
            return;
        const { query, agentToolName, toolCall } = params;
        // 检查静默模式
        const silentMode = (0, public_1.isSilentMode)();
        // 静默模式下不创建窗口，直接执行子代理任务
        if (silentMode) {
            console.log('[SubAgentWindow] Running in silent mode - executing agent without window');
            return this.executeInSilentMode(query, agentToolName, toolCall);
        }
        const win = new electron_1.BrowserWindow({
            width: 800 - Math.min(this.windows.length, 5) * 50,
            height: 800 - Math.min(this.windows.length, 5) * 50,
            frame: false,
            transparent: false,
            resizable: true,
            show: false, // 先隐藏窗口，等加载完成再显示
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
        const result = await new Promise((resolve) => {
            this.windowListeners.set(win, listeners);
            electron_1.ipcMain.once(`minimize-window-${win.id}`, listeners.minimize);
            electron_1.ipcMain.once(`close-window-${win.id}`, listeners.close);
            win.loadFile('src/frontend/subagent.html');
            this.agentToolName = agentToolName;
            this.agentTool = this.agentTools[agentToolName];
            win.on('closed', () => {
                if (this.agentTool) {
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
                    this.agentTool.toolCall.setWindow(win);
                    // 子代理模式同主代理模式一样（计划模式例外）
                    if (toolCall.llmService.environment_details.mode !== ReActAgent_1.Mode.PLAN) {
                        this.agentTool.toolCall.changeMode(toolCall.llmService.chatManager.chat.mode);
                    }
                    else {
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
                    const res_json = (0, public_1.parseJsonContent)(data.output_format);
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
    destroy(init = true) {
        if (this.windows && this.windows.length > 0) {
            const windowsToClose = [...this.windows];
            for (const name in this.agentTools) {
                if (Object.prototype.hasOwnProperty.call(this.agentTools, name)) {
                    const agentTool = this.agentTools[name];
                    if (init)
                        agentTool.toolCall.llmService.chatManager.initMessages();
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
    /**
     * 静默模式下执行子代理任务（不创建窗口）
     */
    async executeInSilentMode(query, agentToolName, toolCall) {
        try {
            console.log(`[SubAgentWindow-Silent] Executing ${agentToolName} with query: ${query}`);
            this.agentToolName = agentToolName;
            this.agentTool = this.agentTools[agentToolName];
            if (!this.agentTool) {
                throw new Error(`Agent tool ${agentToolName} not found`);
            }
            // 子代理模式同主代理模式一样（计划模式例外）
            if (toolCall.llmService.environment_details.mode !== ReActAgent_1.Mode.PLAN) {
                this.agentTool.toolCall.changeMode(toolCall.llmService.chatManager.chat.mode);
            }
            else {
                // 计划模式下，子代理默认为自动模式
                this.agentTool.toolCall.changeMode("auto");
            }
            // 初始化消息（仅在首次或需要时）
            if (toolCall.llmService.utils.getConfig("toolCall")?.subagent_llm_init) {
                this.agentTool.toolCall.llmService.chatManager.initMessages();
            }
            const mainChat = toolCall.llmService.chatManager.chat;
            this.agentTool.toolCall.llmService.chatManager.chat.tool_format = mainChat.tool_format;
            this.agentTool.toolCall.llmService.startLoop();
            let data = this.agentTool.toolCall.getDataDefault({ query, model: mainChat.model, version: mainChat.version });
            data = await this.agentTool.toolCall.callReAct(data);
            const res_json = (0, public_1.parseJsonContent)(data.output_format);
            return {
                content: res_json[0]?.content || data.output_format,
                subagent_tool: true
            };
        }
        catch (error) {
            console.error(`[SubAgentWindow-Silent] Error: ${error.message}`);
            return {
                content: `Error executing subagent: ${error.message}`,
                subagent_tool: true,
                error: true
            };
        }
    }
    setup() {
        // 预留：子 Agent 窗口的 IPC 事件绑定
    }
}
exports.SubAgentWindow = SubAgentWindow;
//# sourceMappingURL=SubAgentWindow.js.map