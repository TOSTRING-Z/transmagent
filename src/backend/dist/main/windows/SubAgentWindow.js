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
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
const LLMService_1 = require("../../core/LLMService");
const ToolCall_1 = require("../../core/ToolCall");
const Plugins_1 = require("../../core/Plugins");
class SubAgentWindow extends BaseWindow_1.BaseWindow {
    agentTools;
    windows; // 支持多个子 Agent 窗口
    windowListeners;
    plugins;
    constructor(windowManager) {
        super(windowManager);
        this.agentTools = {};
        this.windows = []; // 覆盖基类的 BrowserWindow | null
        this.windowListeners = new Map();
        this.plugins = new Plugins_1.Plugins();
        this.toolInit();
    }
    // 将工具统一为当前插件格式：{ func, getPrompt, extra? }
    normalizeTool(tool) {
        if (!tool)
            return null;
        if (typeof tool.func === 'function' && typeof tool.getPrompt === 'function') {
            return tool;
        }
        return null;
    }
    // 过滤无效工具，避免 undefined 传入 ToolCall
    normalizeTools(tools) {
        const normalized = {};
        Object.entries(tools).forEach(([name, tool]) => {
            const item = this.normalizeTool(tool);
            if (item)
                normalized[name] = item;
        });
        return normalized;
    }
    async query(query, agentToolName) {
        return await this.create({ query, agentToolName });
    }
    async create(params) {
        if (!params)
            return;
        const { query, agentToolName } = params;
        const win = new electron_1.BrowserWindow({
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
        const result = await new Promise((resolve) => {
            this.windowListeners.set(win, listeners);
            electron_1.ipcMain.once(`minimize-window-${win.id}`, listeners.minimize);
            electron_1.ipcMain.once(`close-window-${win.id}`, listeners.close);
            win.loadFile('src/frontend/subagent.html');
            const agentTool = this.agentTools[agentToolName];
            win.on('closed', () => {
                if (agentTool) {
                    agentTool.tool_call.changeWindow();
                    agentTool.tool_call.llm_service.stopMessage();
                    resolve("The user interrupted the task.");
                }
            });
            win.webContents.on('did-finish-load', async () => {
                win.restore();
                win.show();
                win.focus();
                win.webContents.send('windowInfo', { id: win.id, name: agentToolName });
                agentTool.tool_call.changeWindow(win);
                if (globals_1.utils.getConfig("tool_call")?.subagent_llm_init || this.windows.length > 1) {
                    agentTool.tool_call.llm_service.chatManager.init();
                }
                const mainChat = this.windowManager.mainWindow.llm_service.chatManager.chat;
                agentTool.tool_call.llm_service.chatManager.chat.tool_format = mainChat.tool_format;
                agentTool.tool_call.llm_service.startMessage();
                let data = agentTool.tool_call.getDataDefault({ query, model: mainChat.model, version: mainChat.version });
                data = await agentTool.tool_call.callReAct(data);
                const res_json = globals_1.utils.parseJsonContent(data.output_format);
                resolve(res_json?.thinking || data.output_format);
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
                        agentTool.tool_call.llm_service.chatManager.init();
                    agentTool.tool_call.llm_service.stopMessage();
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
    addAgentTool(tool_name, query_prompt, agent_description, agent_prompt, tools, options = {}, mainSubAgent = false) {
        const { todolist = true, mcp_server = false } = options;
        const llm_service = new LLMService_1.LLMService();
        llm_service.chatManager.chat.id = null;
        llm_service.chatManager.chat.name = tool_name;
        const normalizedTools = this.normalizeTools(tools);
        const tool_call = new ToolCall_1.ToolCall(this.plugins, normalizedTools, llm_service, null, this.windowManager.alertWindow, { agent_prompt, subagent: true, todolist, mcp_server });
        tool_call.changeMode("auto");
        this.agentTools[tool_name] = {
            tool_call,
            func: async ({ query }) => await this.query(query, tool_name),
            getPrompt: () => ({
                name: tool_name,
                description: agent_description || "",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: query_prompt || "The task content that requires the assistant to complete."
                        }
                    },
                    required: ["query"]
                }
            }),
            mainSubAgent
        };
    }
    getMainSubAgent() {
        return Object.fromEntries(Object.entries(this.agentTools).filter(([, subagent]) => subagent.mainSubAgent));
    }
    toolInit() {
        if (!globals_1.utils.getConfig()?.plugins?.cli_execute)
            return;
        this.plugins = new Plugins_1.Plugins();
        this.plugins.loadInit(globals_1.sysConfig.baseagent, true);
        this.plugins.loadInit(globals_1.sysConfig.transagent, true);
        const agentDefs = [
            {
                promptModule: 'url_summarizer',
                getTools: () => this.normalizeTools({
                    fetch_url: this.plugins.getTool("fetch_url"),
                    browser_client: this.plugins.getTool("browser_client"),
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'web_searcher',
                getTools: () => this.normalizeTools({
                    fetch_search: this.plugins.getTool("fetch_search"),
                    url_summarizer: this.agentTools["url_summarizer"]
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'error_solution_finder',
                getTools: () => this.normalizeTools({
                    error_solution_search: this.plugins.getTool("error_solution_search"),
                    web_searcher: this.agentTools["web_searcher"],
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'chart_plotter',
                getTools: () => this.normalizeTools({
                    cli_execute: this.plugins.getTool("cli_execute"),
                    list_dir: this.plugins.getTool("list_dir"),
                    write_to_file: this.plugins.getTool("write_to_file"),
                    replace_in_file: this.plugins.getTool("replace_in_file"),
                }),
                options: { todolist: false, mcp_server: false },
                isMain: true
            },
            {
                promptModule: 'tool_documentation_collector',
                getTools: () => this.normalizeTools({
                    fetch_search: this.plugins.getTool("fetch_search"),
                    url_summarizer: this.agentTools["url_summarizer"]
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'tool_manager',
                getTools: () => this.normalizeTools({
                    read_tools_prompt: this.plugins.getTool("read_tools_prompt"),
                    update_tool: this.plugins.getTool("update_tool"),
                    cli_execute: this.plugins.getTool("cli_execute"),
                    list_dir: this.plugins.getTool("list_dir"),
                    write_to_file: this.plugins.getTool("write_to_file"),
                    replace_in_file: this.plugins.getTool("replace_in_file"),
                    tool_documentation_collector: this.agentTools["tool_documentation_collector"],
                    error_solution_finder: this.agentTools["error_solution_finder"],
                }),
                options: { todolist: false, mcp_server: false },
                isMain: true
            },
            {
                promptModule: 'workflow_planner',
                getTools: () => this.normalizeTools({
                    read_tools_prompt: this.plugins.getTool("read_tools_prompt"),
                }),
                options: { todolist: false, mcp_server: false },
                isMain: true
            },
            {
                promptModule: 'task_executor',
                getTools: () => this.normalizeTools({
                    read_tools_prompt: this.plugins.getTool("read_tools_prompt"),
                    cli_execute: this.plugins.getTool("cli_execute"),
                    list_dir: this.plugins.getTool("list_dir"),
                    write_to_file: this.plugins.getTool("write_to_file"),
                    replace_in_file: this.plugins.getTool("replace_in_file"),
                    tool_manager: this.agentTools["tool_manager"],
                    chart_plotter: this.agentTools["chart_plotter"],
                    web_searcher: this.agentTools["web_searcher"],
                }),
                options: { todolist: false, mcp_server: true },
                isMain: true
            },
        ];
        for (const def of agentDefs) {
            try {
                const promptPath = path.join(__dirname, '..', '..', 'core', 'prompts', def.promptModule);
                const prompt = require(promptPath).default;
                this.addAgentTool(prompt.tool_name, prompt.query_prompt, prompt.agent_description, prompt.agent_prompt, def.getTools(), def.options, def.isMain);
            }
            catch (e) {
                console.error(`[SubAgentWindow] Failed to register agent '${def.promptModule}':`, e.message);
            }
        }
    }
    setup() {
        // 预留：子 Agent 窗口的 IPC 事件绑定
    }
}
exports.SubAgentWindow = SubAgentWindow;
//# sourceMappingURL=SubAgentWindow.js.map