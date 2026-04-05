"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClient = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
class MCPClient {
    toolcall;
    static instance = null;
    clients = {};
    tools = {}; // toolName -> clientName
    toolPrompts = {};
    mcpPrompt = "";
    isInitialized = false;
    constructor(toolcall) {
        this.toolcall = toolcall;
    }
    static getInstance(toolcall) {
        if (!this.instance) {
            this.instance = new MCPClient(toolcall);
        }
        return this.instance;
    }
    /**
     * 连接 Transport 层
     */
    async connectTransport(name, config) {
        if (this.clients[name])
            return;
        let transport;
        try {
            if (config.url) {
                const url = new URL(config.url);
                // 核心修改：使用 StreamableHTTPClientTransport 替代 SSE
                if (config.use_http) {
                    transport = new streamableHttp_js_1.StreamableHTTPClientTransport(url);
                }
                else {
                    // 如果 URL 存在但未指定 useHttp，默认使用 stdio 代理或保持原逻辑
                    transport = new stdio_js_1.StdioClientTransport({
                        command: "npx",
                        args: ["-y", "@modelcontextprotocol/server-http", config.url]
                    });
                }
            }
            else {
                if (!config.command)
                    return;
                transport = new stdio_js_1.StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: config.env
                });
            }
            const client = new index_js_1.Client({ name, version: "1.0.0" }, { capabilities: {} } // 保持空对象以符合最新 SDK 客户端定义
            );
            await client.connect(transport);
            this.clients[name] = client;
        }
        catch (error) {
            this.notifyError(`connectTransport[${name}]`, error);
        }
    }
    /**
     * 调用工具
     */
    async callTool(params) {
        const clientName = this.tools[params.name];
        const client = this.clients[clientName];
        if (!client)
            throw new Error(`MCP tool "${params.name}" not found.`);
        const timeout = (this.toolcall?.utils.getConfig("tool_call")?.mcp_timeout || 600) * 1000;
        return await client.callTool(params, types_js_1.CallToolResultSchema, { timeout });
    }
    /**
     * 初始化
     */
    async initMcp() {
        if (this.isInitialized)
            return;
        const configs = this.toolcall?.utils.getConfig("mcp_server") || {};
        // 并发初始化所有 client 提升速度
        await Promise.all(Object.entries(configs).map(async ([name, config]) => {
            if (!config.disabled) {
                await this.connectTransport(name, config);
            }
        }));
        await this.refreshPrompts();
        if (Object.keys(this.clients).length > 0 && this.mcpPrompt) {
            this.isInitialized = true;
        }
    }
    /**
     * 刷新并汇总所有工具的 Prompt 描述
     */
    async refreshPrompts() {
        const segments = [];
        for (const [name, client] of Object.entries(this.clients)) {
            const segment = await this.generateServerPrompt(name, client);
            if (segment)
                segments.push(segment);
        }
        this.mcpPrompt = segments.join("\n\n---\n\n");
    }
    async generateServerPrompt(serverName, client) {
        try {
            const caps = client.getServerCapabilities();
            if (!caps?.tools)
                return null;
            const { tools } = await client.listTools();
            let extraDesc = "";
            if (caps.prompts) {
                try {
                    const { prompts } = await client.listPrompts();
                    extraDesc = prompts?.[0]?.description ? `\n\n${prompts[0].description}` : "";
                }
                catch (error) {
                    console.warn(`[MCPClient] Failed to fetch prompts for server "${serverName}":`, error);
                }
            }
            const toolDocs = tools
                .filter(t => t.name !== "execute_bash")
                .map(tool => {
                // 记录工具所属的 client
                this.tools[tool.name] = serverName;
                const props = tool.inputSchema?.properties || {};
                const required = tool.inputSchema?.required || [];
                const argsDoc = Object.entries(props).map(([key, val]) => {
                    const isReq = required.includes(key) ? "(required)" : "";
                    return `- ${key}: ${isReq} ${val.description || val.title || ""} (type: ${val.type})`;
                }).join("\n");
                // 构建单个工具的描述字符串
                const toolDocStr = `MCP name: ${tool.name}\nMCP args:\n${argsDoc}\nMCP description:\n${tool.description}`;
                // 【核心修改】：将生成的单个工具 Prompt 存入 toolPrompts 字典
                this.toolPrompts[tool.name] = toolDocStr;
                return toolDocStr;
            }).join("\n\n");
            return `## MCP server: ${serverName}${extraDesc}\n\n## Use\n\n${toolDocs}`;
        }
        catch (error) {
            this.notifyError(`generateServerPrompt[${serverName}]`, error);
            return null;
        }
    }
    notifyError(context, error) {
        const message = `[MCPClient.${context}]: ${error.message}`;
        this.toolcall?.alertWindow?.create({ type: "error", content: message });
        console.error(message);
    }
}
exports.MCPClient = MCPClient;
//# sourceMappingURL=McpClient.js.map