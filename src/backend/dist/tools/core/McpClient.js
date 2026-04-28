"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClient = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const streamableHttp_js_1 = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
class MCPClient {
    constructor(toolcall) {
        this.toolcall = toolcall;
        this.clients = {};
        // [核心重构]: 路由映射表
        // 严格映射: "serverName:toolName" -> { serverName, actualToolName }
        this.fqnRoutingMap = {};
        // 降级映射 (兼容旧调用或无前缀调用): "toolName" -> "serverName"
        this.fallbackToolMap = {};
        this.toolPrompts = {};
        this.mcpPrompt = "";
        this.isInitialized = false;
    }
    static getInstance(toolcall) {
        if (!this.instance) {
            this.instance = new MCPClient(toolcall);
        }
        return this.instance;
    }
    /**
     * 连接 Transport 层 (保持原有逻辑)
     */
    async connectTransport(name, config) {
        if (this.clients[name])
            return;
        let transport;
        try {
            if (config.url) {
                const url = new URL(config.url);
                if (config.use_http) {
                    transport = new streamableHttp_js_1.StreamableHTTPClientTransport(url);
                }
                else {
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
            const client = new index_js_1.Client({ name, version: "1.0.0" }, { capabilities: {} });
            await client.connect(transport);
            this.clients[name] = client;
        }
        catch (error) {
            this.notifyError(`connectTransport[${name}]`, error);
        }
    }
    /**
     * [核心重构]: 智能路由调用
     */
    async callTool(params) {
        const requestedName = params.name.trim();
        let targetServerName;
        let targetToolName = requestedName;
        // 1. 尝试 FQN (全限定名) 精准匹配 (e.g., "biotools:get_mean_express_data")
        if (this.fqnRoutingMap[requestedName]) {
            const route = this.fqnRoutingMap[requestedName];
            targetServerName = route.serverName;
            targetToolName = route.actualToolName;
        }
        // 2. 动态解析未注册但带有 ':' 的调用 (防御模型自行组合)
        else if (requestedName.includes(':')) {
            const parts = requestedName.split(':');
            const possibleServer = parts[0];
            if (this.clients[possibleServer]) {
                targetServerName = possibleServer;
                targetToolName = parts.slice(1).join(':'); // 提取 ':' 后面的所有内容
            }
        }
        // 3. 降级处理：无前缀的裸工具名
        if (!targetServerName) {
            targetServerName = this.fallbackToolMap[requestedName];
            if (!targetServerName) {
                throw new Error(`[MCP Router] Tool "${requestedName}" not found. No matching namespace or tool name.`);
            }
            console.warn(`[MCP Router] Missing namespace for tool "${requestedName}". Routed to "${targetServerName}" via fallback.`);
        }
        const client = this.clients[targetServerName];
        if (!client)
            throw new Error(`[MCP Router] Server "${targetServerName}" is disconnected or invalid.`);
        const timeout = (this.toolcall?.utils.getConfig("tool_call")?.mcp_timeout || 600) * 1000;
        // 使用剥离前缀后的真实工具名请求底层 MCP Server
        return await client.callTool({ name: targetToolName, arguments: params.arguments }, types_js_1.CallToolResultSchema, { timeout });
    }
    async initMcp() {
        if (this.isInitialized)
            return;
        const configs = this.toolcall?.utils.getConfig("mcp_server") || {};
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
    async refreshPrompts() {
        const segments = [];
        // 清理旧的路由映射，防止热重载时数据污染
        this.fqnRoutingMap = {};
        this.fallbackToolMap = {};
        this.toolPrompts = {};
        for (const [name, client] of Object.entries(this.clients)) {
            const segment = await this.generateServerPrompt(name, client);
            if (segment)
                segments.push(segment);
        }
        this.mcpPrompt = segments.join("\n\n---\n\n");
    }
    /**
     * [核心重构]: 生成带有 Namespace 的 Prompt
     */
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
                // 构建全限定名 (FQN)
                const fqn = `${serverName}:${tool.name}`;
                // 注册智能路由
                this.fqnRoutingMap[fqn] = { serverName, actualToolName: tool.name };
                // 注册降级路由，并检测潜在的跨 Server 重名冲突
                if (this.fallbackToolMap[tool.name]) {
                    console.warn(`[MCP Router] Tool collision detected for "${tool.name}". FQN routing is strongly recommended.`);
                }
                else {
                    this.fallbackToolMap[tool.name] = serverName;
                }
                const props = tool.inputSchema?.properties || {};
                const required = tool.inputSchema?.required || [];
                const argsDoc = Object.entries(props).map(([key, val]) => {
                    const isReq = required.includes(key) ? "(required)" : "";
                    return `- ${key}: ${isReq} ${val.description || val.title || ""} (type: ${val.type})`;
                }).join("\n");
                // 在 Prompt 中强迫模型看到并使用带有 serverName: 的完整名称
                const toolDocStr = `MCP name: ${fqn}\nMCP args:\n${argsDoc}\nMCP description:\n${tool.description}`;
                this.toolPrompts[fqn] = toolDocStr;
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
MCPClient.instance = null;
