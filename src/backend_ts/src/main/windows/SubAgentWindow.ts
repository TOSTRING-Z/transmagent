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
    getPrompt: () => string;
    mainSubAgent: boolean;
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
                nodeIntegration: true,
                contextIsolation: false
            }
        });

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
                win.webContents.send('window-info', { id: win.id, name: agentToolName });
                win.webContents.send('user-data', { id: 0, context_id: 0, content: query });

                agentTool.tool_call.changeWindow(win);

                if (utils.getConfig("tool_call")?.subagent_llm_init || this.windows.length > 1) {
                    agentTool.tool_call.llm_service.chatManager.init();
                }

                agentTool.tool_call.llm_service.startMessage();
                let data = agentTool.tool_call.getDataDefault({ query, id: 0 });
                data = await agentTool.tool_call.callReAct(data);
                const res_json = utils.parseJsonContent(data.output_format);
                resolve(res_json?.observation || data.output_format);
            });
        });

        listeners.close();
        return result;
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

        const tool_call = new ToolCall(
            this.plugins, tools, llm_service, null,
            this.windowManager.alertWindow,
            { agent_prompt, subagent: true, todolist, mcp_server }
        );
        tool_call.change_mode("auto");

        const tool_prompt_full = `## ${tool_name}  

Description: ${agent_description}

Parameters:  
- query: (required) ${query_prompt || "The task content that requires the assistant to complete."}

Usage:
{
  "thinking": "[Thinking process]",
  "tool": "${tool_name}",
  "params": {
    "query": "[Task details]",
  }
}`;

        this.agentTools[tool_name] = {
            tool_call,
            func: async ({ query }: { query: string }) => await this.query(query, tool_name),
            getPrompt: () => tool_prompt_full,
            mainSubAgent
        };
    }

    public getMainSubAgent(): Record<string, AgentTool> {
        return Object.fromEntries(
            Object.entries(this.agentTools).filter(([, subagent]) => subagent.mainSubAgent)
        );
    }

    private read_tools_prompt(): { getPrompt: () => string; func: () => Promise<any> } {
        return {
            getPrompt: () => `## read_tools_prompt

Description: Retrieve the tool core description file path and its content along with MCP tools.

Parameters: None

Usage:
{
    "thinking": "[Thinking process]",
    "tool": "read_tools_prompt",
    "params": {}
}`,
            func: async () => {
                const mcp_client = this.windowManager.mainWindow.tool_call.mcp_client;
                await mcp_client.initMcp();
                const mcp_prompt = mcp_client.mcp_prompt;
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

        // 定义子 Agent 注册表：[模块路径, 工具依赖, 选项, 是否主Agent]
        const agentDefs: Array<{
            promptModule: string;
            getTools: () => Record<string, any>;
            options: SubAgentOptions;
            isMain: boolean;
        }> = [
            {
                promptModule: 'url_summarizer',
                getTools: () => ({
                    fetch_url: this.plugins.getTool("fetch_url"),
                    browser_client: this.plugins.getTool("browser_client"),
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'web_searcher',
                getTools: () => ({
                    fetch_search: this.plugins.getTool("fetch_search"),
                    url_summarizer: this.agentTools["url_summarizer"]
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'error_solution_finder',
                getTools: () => ({
                    error_solution_search: this.plugins.getTool("error_solution_search"),
                    web_searcher: this.agentTools["web_searcher"],
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'chart_plotter',
                getTools: () => ({
                    cli_execute: this.plugins.getTool("cli_execute")
                }),
                options: { todolist: false, mcp_server: false },
                isMain: true
            },
            {
                promptModule: 'tool_documentation_collector',
                getTools: () => ({
                    fetch_search: this.plugins.getTool("fetch_search"),
                    url_summarizer: this.agentTools["url_summarizer"]
                }),
                options: { todolist: false, mcp_server: false },
                isMain: false
            },
            {
                promptModule: 'tool_manager',
                getTools: () => ({
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
                getTools: () => ({
                    read_tools_prompt: this.read_tools_prompt(),
                }),
                options: { todolist: false, mcp_server: false },
                isMain: true
            },
            {
                promptModule: 'task_executor',
                getTools: () => ({
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
                // 编译后路径: dist/main/windows/SubAgentWindow.js -> dist/core/prompts/{module}
                const promptPath = path.join(__dirname, '..', '..', 'core', 'prompts', def.promptModule);
                const prompt = require(promptPath);
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