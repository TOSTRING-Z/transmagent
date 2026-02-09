const { Window } = require("./Window");
const { utils, config } = require('./globals')
const { ToolCall } = require("../server/tool_call");
const { LLMService } = require("../server/llm_service");
const { BrowserWindow, ipcMain } = require('electron');
const { Plugins } = require('./Plugins');
const fs = require('fs');

class SubAgentWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
        this.agentTools = {};
        this.toolInit();
        this.window = [];
        this.windowListeners = new Map(); // 存储每个窗口的监听器
    }

    async query(query, agentToolName) {
        return await this.create({ query, agentToolName });
    }

    async create({ query, agentToolName }) {
        let window = new BrowserWindow({
            width: 800 - Math.min(this.window.length, 5) * 50,
            height: 800 - Math.min(this.window.length, 5) * 50,
            frame: false, // 隐藏默认标题栏和边框
            transparent: false, // 可选：实现透明效果
            resizable: true, // 允许调整窗口大小
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        })

        this.window.push(window);

        // 为每个窗口创建独立的事件监听器
        const listeners = {
            minimize: () => window.minimize(),
            close: () => {
                if (window && !window.isDestroyed()) {
                    window.close();
                    this.window = this.window.filter(w => w !== window);
                }
            }
        };

        const result = await new Promise((resolve) => {
            // 存储监听器引用以便清理
            this.windowListeners.set(window, listeners);

            // 注册事件监听器
            ipcMain.once(`minimize-window-${window.id}`, listeners.minimize);
            ipcMain.once(`close-window-${window.id}`, listeners.close);

            window.loadFile('src/frontend/subagent.html')

            const agentTool = this.agentTools[agentToolName];

            window.on('closed', () => {
                if (agentTool) {
                    agentTool.tool_call.changeWindow();
                    agentTool.tool_call.llm_service.stopMessage();
                    resolve("The user interrupted the task.");
                }
            });

            window.webContents.on('did-finish-load', async () => {
                // window.webContents.openDevTools();
                window.restore(); // 恢复窗口
                window.show();
                window.focus();
                window.webContents.send('window-info', { id: window.id, name: agentToolName });
                window.webContents.send('user-data', { id: 0, context_id: 0, content: query });
                agentTool.tool_call.changeWindow(window);
                if (utils.getConfig("tool_call")?.subagent_llm_init || this.window.length > 1) {
                    agentTool.tool_call.llm_service.init();
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

    // 清理窗口资源
    destroy(init = true) {
        if (this.window) {
            // 复制数组以避免在遍历时修改
            const windowsToClose = [...this.window];
            for (const name in this.agentTools) {
                if (Object.prototype.hasOwnProperty.call(this.agentTools, name)) {
                    const agentTool = this.agentTools[name];
                    if (init) agentTool.tool_call.llm_service.init();
                    agentTool.tool_call.llm_service.stopMessage();
                }
            }
            windowsToClose.forEach(win => {
                if (win && !win.isDestroyed()) {
                    win.close();
                }
            });
            this.window.length = 0;
            this.windowListeners.clear();
        }
    }

    addAgentTool(tool_name, query_prompt, agent_description, agent_prompt, tools, { todolist = true, mcp_server = false } = {}, mainSubAgent = false) {
        const llm_service = new LLMService();
        llm_service.chat.id = null;
        llm_service.chat.name = tool_name;
        const tool_call = new ToolCall(this.plugins, tools, llm_service, null, this.windowManager.alertWindow, { agent_prompt, subagent: true, todolist, mcp_server });
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
}`
        this.agentTools[tool_name] = { tool_call, func: async ({ query }) => await this.query(query, tool_name), getPrompt: () => tool_prompt_full, mainSubAgent };
    }

    getMainSubAgent() {
        return Object.fromEntries(
            Object.entries(this.agentTools).filter(([, subagent]) => subagent.mainSubAgent)
        );
    }

    read_tools_prompt() {
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
                const prompt_file = utils.getConfig("tool_call").cli_prompt || utils.getDefault("cli_prompt.md");
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

    toolInit() {
        if (utils.getConfig().plugins?.cli_execute) {
            this.plugins = new Plugins();
            this.plugins.init(config.baseagent, true);
            this.plugins.init(config.transagent, true);
            
            let prompt = require('../server/prompts/url_summarizer');
            this.addAgentTool(
                prompt.tool_name, 
                prompt.query_prompt, 
                prompt.agent_description, 
                prompt.agent_prompt,
                {
                    fetch_url: this.plugins.getTool("fetch_url"),
                    browser_client: this.plugins.getTool("browser_client"),
                },
                {
                    todolist: false,
                    mcp_server: false
                }
            );
            
            let webSearcherPrompt = require('../server/prompts/web_searcher');
            this.addAgentTool(
                webSearcherPrompt.tool_name, 
                webSearcherPrompt.query_prompt, 
                webSearcherPrompt.agent_description, 
                webSearcherPrompt.agent_prompt,
                {
                    fetch_search: this.plugins.getTool("fetch_search"),
                    url_summarizer: this.agentTools["url_summarizer"]
                },
                {
                    todolist: false,
                    mcp_server: false
                },
                false
            );
            
            let errorSolutionFinderPrompt = require('../server/prompts/error_solution_finder');
            this.addAgentTool(
                errorSolutionFinderPrompt.tool_name, 
                errorSolutionFinderPrompt.query_prompt, 
                errorSolutionFinderPrompt.agent_description, 
                errorSolutionFinderPrompt.agent_prompt,
                {
                    error_solution_search: this.plugins.getTool("error_solution_search"),
                    web_searcher: this.agentTools["web_searcher"],
                },
                {
                    todolist: false,
                    mcp_server: false
                }
            );
            
            let chartPlotterPrompt = require('../server/prompts/chart_plotter');
            this.addAgentTool(
                chartPlotterPrompt.tool_name, 
                chartPlotterPrompt.query_prompt, 
                chartPlotterPrompt.agent_description, 
                chartPlotterPrompt.agent_prompt,
                {
                    cli_execute: this.plugins.getTool("cli_execute")
                },
                {
                    todolist: false,
                    mcp_server: false
                },
                true
            );
            
            let toolDocumentationCollectorPrompt = require('../server/prompts/tool_documentation_collector');
            this.addAgentTool(
                toolDocumentationCollectorPrompt.tool_name, 
                toolDocumentationCollectorPrompt.query_prompt, 
                toolDocumentationCollectorPrompt.agent_description, 
                toolDocumentationCollectorPrompt.agent_prompt,
                {
                    fetch_search: this.plugins.getTool("fetch_search"),
                    url_summarizer: this.agentTools["url_summarizer"]
                },
                {
                    todolist: false,
                    mcp_server: false
                },
                false
            );
            
            let toolManagerPrompt = require('../server/prompts/tool_manager');
            this.addAgentTool(
                toolManagerPrompt.tool_name, 
                toolManagerPrompt.query_prompt, 
                toolManagerPrompt.agent_description, 
                toolManagerPrompt.agent_prompt,
                {
                    read_tools_prompt: this.read_tools_prompt(),
                    tool_documentation_collector: this.agentTools["tool_documentation_collector"],
                    error_solution_finder: this.agentTools["error_solution_finder"],
                    cli_execute: this.plugins.getTool("cli_execute"),
                    update_tool: this.plugins.getTool("update_tool"),
                },
                {
                    todolist: false,
                    mcp_server: false
                },
                true
            );
            
            let workflowPlannerPrompt = require('../server/prompts/workflow_planner');
            this.addAgentTool(
                workflowPlannerPrompt.tool_name, 
                workflowPlannerPrompt.query_prompt, 
                workflowPlannerPrompt.agent_description, 
                workflowPlannerPrompt.agent_prompt,
                {
                    read_tools_prompt: this.read_tools_prompt(),
                },
                {
                    todolist: false,
                    mcp_server: false
                },
                true
            );
            
            let taskExecutorPrompt = require('../server/prompts/task_executor');
            this.addAgentTool(
                taskExecutorPrompt.tool_name, 
                taskExecutorPrompt.query_prompt, 
                taskExecutorPrompt.agent_description, 
                taskExecutorPrompt.agent_prompt,
                {
                    read_tools_prompt: this.read_tools_prompt(),
                    cli_execute: this.plugins.getTool("cli_execute"),
                    tool_manager: this.agentTools["tool_manager"],
                    chart_plotter: this.agentTools["chart_plotter"],
                    web_searcher: this.agentTools["web_searcher"],
                },
                {
                    todolist: false,
                    mcp_server: true
                },
                true
            );
        }
    }

    setup() {

    }

}

// const { app } = require('electron');
// app.whenReady().then(async () => {
//     const subAgentWindow = new SubAgentWindow({ alertWindow: null });
//     const result = await subAgentWindow.query("安装生物信息软件chromvar使用案例", "tool_manager");
//     console.log("调试结果:", result);
// })

module.exports = {
    SubAgentWindow
};