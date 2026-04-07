"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubAgent = void 0;
const SubAgentWindow_1 = require("../main/windows/SubAgentWindow");
const ToolCall_1 = require("./ToolCall");
const Plugins_1 = require("./Plugins");
const path_1 = __importDefault(require("path"));
const LLMService_1 = require("./LLMService");
const globals_1 = require("../utils/globals");
class SubAgent {
    utils;
    llmService;
    agentToolName;
    agentTool;
    agentTools;
    subAgentWindow;
    plugins;
    constructor(utils, llmService) {
        this.utils = utils;
        this.llmService = llmService;
        this.agentTools = {};
        this.plugins = new Plugins_1.Plugins(utils);
        this.subAgentWindow = new SubAgentWindow_1.SubAgentWindow(this.agentTools);
        this.toolInit();
    }
    async query(query, agentToolName, toolCall) {
        return await this.subAgentWindow.create({ query, agentToolName, toolCall });
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
    addAgentTool(tool_name, query_prompt, agent_description, agent_prompt, tools, options = {}, mainSubAgent = false) {
        const { todolist = true, env = true, skill = true, mcpTool = false } = options;
        const llmService = new LLMService_1.LLMService(undefined, null, this.utils);
        llmService.chatManager.chat.id = null;
        llmService.chatManager.chat.name = tool_name;
        const normalizedTools = this.normalizeTools(tools);
        const toolCall = new ToolCall_1.ToolCall(this.plugins, normalizedTools, llmService, null, this.utils, { agentPrompt: agent_prompt, subagent: true, todolist, env, skill, mcpTool: mcpTool, agentName: tool_name, agentMode: globals_1.store.get('agentMode', 'transagent') });
        this.agentTools[tool_name] = {
            toolCall,
            func: async ({ query, toolCall }) => await this.query(query, tool_name, toolCall),
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
    getAgentTools() {
        return this.agentTools;
    }
    toolInit() {
        if (!this.utils.getConfig()?.plugins?.cli_execute)
            return;
        this.plugins = new Plugins_1.Plugins(this.utils);
        this.plugins.loadInit(globals_1.sysConfig.baseagent, true);
        this.plugins.loadInit(globals_1.sysConfig.transagent, true);
        const agentDefs = [
            {
                promptModule: 'url_summarizer',
                getTools: () => this.normalizeTools({
                    web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                    browser_client: this.plugins.getTool("browser_client"),
                }),
                options: { todolist: false, env: false, skill: false, mcpTool: false, mcpPrompt: false },
                isMain: false
            },
            {
                promptModule: 'web_searcher',
                getTools: () => this.normalizeTools({
                    web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                    url_summarizer: this.agentTools["url_summarizer"]
                }),
                options: { todolist: false, env: false, skill: false, mcpTool: false, mcpPrompt: false },
                isMain: false
            },
            {
                promptModule: 'error_solution_finder',
                getTools: () => this.normalizeTools({
                    error_solution_search: this.plugins.getTool("error_solution_search"),
                    web_searcher: this.agentTools["web_searcher"],
                }),
                options: { todolist: false, env: false, skill: false, mcpTool: false, mcpPrompt: false },
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
                options: { todolist: false, env: true, skill: false, mcpTool: false, mcpPrompt: false },
                isMain: true
            },
            {
                promptModule: 'tool_documentation_collector',
                getTools: () => this.normalizeTools({
                    web_crawler_toolkit: this.plugins.getTool("web_crawler_toolkit"),
                    url_summarizer: this.agentTools["url_summarizer"]
                }),
                options: { todolist: false, env: false, skill: false, mcpTool: false, mcpPrompt: false },
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
                options: { todolist: false, env: true, skill: false, mcpTool: true, mcpPrompt: false },
                isMain: true
            },
            {
                promptModule: 'workflow_planner',
                getTools: () => this.normalizeTools({
                    read_tools_prompt: this.plugins.getTool("read_tools_prompt"),
                }),
                options: { todolist: true, env: true, skill: false, mcpTool: false, mcpPrompt: false },
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
                options: { todolist: false, env: true, skill: false, mcpTool: true, mcpPrompt: false },
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
                options: { todolist: false, env: true, skill: false, mcpTool: false, mcpPrompt: false },
                isMain: true
            },
        ];
        for (const def of agentDefs) {
            try {
                const promptPath = path_1.default.join(__dirname, 'prompts', def.promptModule);
                const prompt = require(promptPath).default;
                this.addAgentTool(prompt.tool_name, prompt.query_prompt, prompt.agent_description, prompt.agent_prompt, def.getTools(), def.options, def.isMain);
            }
            catch (e) {
                console.error(`[SubAgentWindow] Failed to register agent '${def.promptModule}':`, e.message);
            }
        }
    }
}
exports.SubAgent = SubAgent;
//# sourceMappingURL=SubAgent.js.map