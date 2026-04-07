import { SubAgentWindow } from "../main/windows/SubAgentWindow";
import { Utils } from "./Utils";
import { ToolCall } from "./ToolCall";
import { Plugins } from "./Plugins";
import path from "path";
import { LLMService } from "./LLMService";
import { store, sysConfig } from "../utils/globals";
import { WindowManager } from "../main/windows/WindowManager";

export interface AgentTool {
    tool_call: ToolCall;
    func: (params: { query: string }) => Promise<any>;
    getPrompt: () => any;
    mainSubAgent: boolean;
    extra?: any;
}

export interface SubAgentOptions {
    todolist?: boolean;
    env?: boolean;
    skill?: boolean;
    mcp_server?: boolean;
}

export class SubAgent {
    public utils: Utils;
    public llmService: LLMService;
    public agentToolName?: string;
    public agentTool?: AgentTool;
    public agentTools: Record<string, AgentTool>;
    public subAgentWindow: SubAgentWindow;
    private plugins: Plugins;

    constructor(utils: Utils, llmService: LLMService) {
        this.utils = utils;
        this.llmService = llmService;
        this.agentTools = {};
        this.plugins = new Plugins(utils);
        this.subAgentWindow = new SubAgentWindow(this.agentTools, this.llmService);
        this.toolInit();
    }

    public async query(query: string, agentToolName: string): Promise<any> {
        return await this.subAgentWindow.create({ query, agentToolName });
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

    public addAgentTool(
        tool_name: string,
        query_prompt: string,
        agent_description: string,
        agent_prompt: string,
        tools: Record<string, any>,
        options: SubAgentOptions = {},
        mainSubAgent: boolean = false
    ): void {
        const { todolist = true, env = true, skill = true, mcp_server = false } = options;

        const llmService = new LLMService(undefined, null, this.utils);
        llmService.chatManager.chat.id = null as any;
        llmService.chatManager.chat.name = tool_name;

        const normalizedTools = this.normalizeTools(tools);

        const tool_call = new ToolCall(
            this.plugins, normalizedTools, llmService, null, this.utils,
            { agent_prompt, subagent: true, todolist, env, skill, mcp_server, agent_name: tool_name, agentMode: store.get('agentMode', 'transagent') },
        );

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

    public getAgentTools(): Record<string, AgentTool> {
        return this.agentTools;
    }

    private toolInit(): void {
        if (!this.utils.getConfig()?.plugins?.cli_execute) return;

        this.plugins = new Plugins(this.utils);
        this.plugins.loadInit(sysConfig.baseagent, true);
        this.plugins.loadInit(sysConfig.transagent, true);

        const agentDefs: Array<{
            promptModule: string;
            getTools: () => Record<string, any>;
            options: SubAgentOptions;
            isMain: boolean;
        }> = [
                {
                    promptModule: 'url_summarizer',
                    getTools: () => this.normalizeTools({
                        web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                        browser_client: this.plugins.getTool("browser_client"),
                    }),
                    options: { todolist: false, env: false, skill: false, mcp_server: false },
                    isMain: false
                },
                {
                    promptModule: 'web_searcher',
                    getTools: () => this.normalizeTools({
                        web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                        url_summarizer: this.agentTools["url_summarizer"]
                    }),
                    options: { todolist: false, env: false, skill: false, mcp_server: false },
                    isMain: false
                },
                {
                    promptModule: 'error_solution_finder',
                    getTools: () => this.normalizeTools({
                        error_solution_search: this.plugins.getTool("error_solution_search"),
                        web_searcher: this.agentTools["web_searcher"],
                    }),
                    options: { todolist: false, env: false, skill: false, mcp_server: false },
                    isMain: false
                },
                {
                    promptModule: 'chart_plotter',
                    getTools: () => this.normalizeTools({
                        cli_execute: this.plugins.getTool("cli_execute"),
                        read_tools_prompt: this.plugins.getTool("read_tools_prompt"),
                        list_dir: this.plugins.getTool("list_dir"),
                        write_to_file: this.plugins.getTool("write_to_file"),
                        replace_in_file: this.plugins.getTool("replace_in_file"),
                        image_vision: this.plugins.getTool("image_vision"),
                    }),
                    options: { todolist: false, env: true, skill: false, mcp_server: false },
                    isMain: true
                },
                {
                    promptModule: 'tool_documentation_collector',
                    getTools: () => this.normalizeTools({
                        web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                        url_summarizer: this.agentTools["url_summarizer"]
                    }),
                    options: { todolist: false, env: false, skill: false, mcp_server: false },
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
                    options: { todolist: false, env: true, skill: false, mcp_server: false },
                    isMain: true
                },
                {
                    promptModule: 'workflow_planner',
                    getTools: () => this.normalizeTools({
                        read_tools_prompt: this.plugins.getTool("read_tools_prompt"),
                    }),
                    options: { todolist: true, env: true, skill: false, mcp_server: false },
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
                    options: { todolist: false, env: true, skill: false, mcp_server: false },
                    isMain: true
                },
                {
                    promptModule: 'deep_researcher',
                    getTools: () => this.normalizeTools({
                        literature_search: this.plugins.getTool("literature_search"),
                        web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                        browser_client: this.plugins.getTool("browser_client"),
                        url_summarizer: this.agentTools["url_summarizer"],
                    }),
                    options: { todolist: false, env: true, skill: false, mcp_server: false },
                    isMain: true
                },
            ];

        for (const def of agentDefs) {
            try {
                const promptPath = path.join(__dirname, 'prompts', def.promptModule);
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
}