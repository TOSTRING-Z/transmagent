import { BrowserWindow, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { utils, sysConfig } from '../../utils/globals';
import { LLMService } from '../../core/LLMService';
import { ToolCall } from '../../core/ToolCall';
import { Plugins } from '../../core/Plugins';

interface AgentTool {
    tool_call: ToolCall;
    func: (params: { query: string }) => Promise<any>;
    getPrompt: () => any;
    mainSubAgent: boolean;
    extra?: any;
}

interface SubAgentOptions {
    todolist?: boolean;
    mcp_server?: boolean;
}

export class SubAgentWindow extends BaseWindow {
    public agentTools: Record<string, AgentTool>;
    public windows: BrowserWindow[]; // 支持多个子 Agent 窗口
    private windowListeners: Map<BrowserWindow, { minimize: () => void; close: () => void }>;
    private plugins: Plugins;

    constructor(windowManager: WindowManager) {
        super(windowManager);
        this.agentTools = {};
        this.windows = [] as any; // 覆盖基类的 BrowserWindow | null
        this.windowListeners = new Map();
        this.plugins = new Plugins();
        this.toolInit();
    }

    // 将工具统一为当前插件格式：{ func, getPrompt, extra? }
    private normalizeTool(tool: any): any {
        if (!tool) return null;
        if (typeof tool.func === 'function' && typeof tool.getPrompt === 'function') {
            return tool;
        }
        return null;
    }

    // 过滤无效工具，避免 undefined 传入 ToolCall
    private normalizeTools(tools: Record<string, any>): Record<string, any> {
        const normalized: Record<string, any> = {};
        Object.entries(tools).forEach(([name, tool]) => {
            const item = this.normalizeTool(tool);
            if (item) normalized[name] = item;
        });
        return normalized;
    }

    public async query(query: string, agentToolName: string): Promise<any> {
        return await this.create({ query, agentToolName });
    }

    public async create(params?: { query: string; agentToolName: string }): Promise<any> {
        if (!params) return;
        const { query, agentToolName } = params;

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

                if (utils.getConfig("tool_call")?.subagent_llm_init || this.windows.length > 1) {
                    agentTool.tool_call.llm_service.chatManager.init();
                }
                const mainChat = this.windowManager.mainWindow.llm_service.chatManager.chat;
                agentTool.tool_call.llm_service.chatManager.chat.tool_format = mainChat.tool_format;
                agentTool.tool_call.llm_service.startMessage();
                let data = agentTool.tool_call.getDataDefault({ query, model: mainChat.model, version: mainChat.version });
                data = await agentTool.tool_call.callReAct(data);
                const res_json = utils.parseJsonContent(data.output_format);
                resolve(res_json?.thinking || data.output_format);
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
                    if (init) agentTool.tool_call.llm_service.chatManager.init();
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

    public addAgentTool(
        tool_name: string,
        query_prompt: string,
        agent_description: string,
        agent_prompt: string,
        tools: Record<string, any>,
        options: SubAgentOptions = {},
        mainSubAgent: boolean = false
    ): void {
        const { todolist = true, mcp_server = false } = options;

        const llm_service = new LLMService();
        llm_service.chatManager.chat.id = null as any;
        llm_service.chatManager.chat.name = tool_name;

        const normalizedTools = this.normalizeTools(tools);

        const tool_call = new ToolCall(
            this.plugins, normalizedTools, llm_service, null,
            this.windowManager.alertWindow,
            { agent_prompt, subagent: true, todolist, mcp_server }
        );
        tool_call.change_mode("auto");

        this.agentTools[tool_name] = {
            tool_call,
            func: async ({ query }: { query: string }) => await this.query(query, tool_name),
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

    public getMainSubAgent(): Record<string, AgentTool> {
        return Object.fromEntries(
            Object.entries(this.agentTools).filter(([, subagent]) => subagent.mainSubAgent)
        );
    }

    private read_tools_prompt(): { getPrompt: () => any; func: () => Promise<any> } {
        return {
            getPrompt: () => ({
                name: "read_tools_prompt",
                description: "Retrieve the tool core description file path and its content along with MCP tools.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }),
            func: async () => {
                const mcp_client = this.windowManager.mainWindow.tool_call.mcp_client;
                await mcp_client.initMcp();
                const mcp_prompt = mcp_client.mcpPrompt;
                const prompt_file = utils.getConfig("tool_call")?.cli_prompt || utils.getDefault("cli_prompt.md");
                if (fs.existsSync(prompt_file)) {
                    return {
                        path: prompt_file,
                        bash_tools: fs.readFileSync(prompt_file, 'utf-8'),
                        mcp_tools: mcp_prompt
                    };
                } else {
                    return "The tool core description file does not exist";
                }
            }
        };
    }

    private toolInit(): void {
        if (!utils.getConfig()?.plugins?.cli_execute) return;

        this.plugins = new Plugins();
        this.plugins.init(sysConfig.baseagent, true);
        this.plugins.init(sysConfig.transagent, true);

        const agentDefs: Array<{
            promptModule: string;
            getTools: () => Record<string, any>;
            options: SubAgentOptions;
            isMain: boolean;
        }> = [
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
                        cli_execute: this.plugins.getTool("cli_execute")
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
                        read_tools_prompt: this.read_tools_prompt(),
                        tool_documentation_collector: this.agentTools["tool_documentation_collector"],
                        error_solution_finder: this.agentTools["error_solution_finder"],
                        cli_execute: this.plugins.getTool("cli_execute"),
                        update_tool: this.plugins.getTool("update_tool"),
                    }),
                    options: { todolist: false, mcp_server: false },
                    isMain: true
                },
                {
                    promptModule: 'workflow_planner',
                    getTools: () => this.normalizeTools({
                        read_tools_prompt: this.read_tools_prompt(),
                    }),
                    options: { todolist: false, mcp_server: false },
                    isMain: true
                },
                {
                    promptModule: 'task_executor',
                    getTools: () => this.normalizeTools({
                        read_tools_prompt: this.read_tools_prompt(),
                        cli_execute: this.plugins.getTool("cli_execute"),
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
                this.addAgentTool(
                    prompt.tool_name,
                    prompt.query_prompt,
                    prompt.agent_description,
                    prompt.agent_prompt,
                    def.getTools(),
                    def.options,
                    def.isMain
                );
            } catch (e: any) {
                console.error(`[SubAgentWindow] Failed to register agent '${def.promptModule}':`, e.message);
            }
        }
    }

    public setup(): void {
        // 预留：子 Agent 窗口的 IPC 事件绑定
    }
}