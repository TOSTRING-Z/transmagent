import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { utils } from '../utils/globals';

/**
 * MCP 服务端配置接口
 */
interface McpConfig {
    disabled?: boolean;
    url?: string;
    useHttp?: boolean; // 对应你之前的 sse 逻辑，现在改为流式 HTTP 标志
    command?: string;
    args?: string[];
    env?: Record<string, string>;
}

class MCPClient {
    private static instance: MCPClient | null = null;
    
    public clients: Record<string, Client> = {};
    public tools: Record<string, string> = {}; // toolName -> clientName
    public mcpPrompt: string = "";
    public isInitialized: boolean = false;

    public constructor(private toolcall?: any) {}

    public static getInstance(toolcall?: any): MCPClient {
        if (!this.instance) {
            this.instance = new MCPClient(toolcall);
        }
        return this.instance;
    }

    /**
     * 连接 Transport 层
     */
    private async connectTransport(name: string, config: McpConfig) {
        if (this.clients[name]) return;

        let transport;
        try {
            if (config.url) {
                const url = new URL(config.url);
                // 核心修改：使用 StreamableHTTPClientTransport 替代 SSE
                if (config.useHttp) {
                    transport = new StreamableHTTPClientTransport(url);
                } else {
                    // 如果 URL 存在但未指定 useHttp，默认使用 stdio 代理或保持原逻辑
                    transport = new StdioClientTransport({
                        command: "npx",
                        args: ["-y", "@modelcontextprotocol/server-http", config.url]
                    });
                }
            } else {
                if (!config.command) return;
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args || [],
                    env: config.env as any
                });
            }

            const client = new Client(
                { name, version: "1.0.0" },
                { capabilities: {} } // 保持空对象以符合最新 SDK 客户端定义
            );

            await client.connect(transport);
            this.clients[name] = client;
        } catch (error: any) {
            this.notifyError(`connectTransport[${name}]`, error);
        }
    }

    /**
     * 调用工具
     */
    async callTool(params: { name: string; arguments?: Record<string, any> }) {
        const clientName = this.tools[params.name];
        const client = this.clients[clientName];

        if (!client) throw new Error(`MCP tool "${params.name}" not found.`);

        const timeout = (utils.getConfig("tool_call")?.mcp_timeout || 600) * 1000;
        
        return await client.callTool(
            params, 
            CallToolResultSchema, 
            { timeout }
        );
    }

    /**
     * 初始化
     */
    async initMcp() {
        if (this.isInitialized) return;

        const configs: Record<string, McpConfig> = utils.getConfig("mcp_server") || {};
        
        // 并发初始化所有 client 提升速度
        await Promise.all(
            Object.entries(configs).map(async ([name, config]) => {
                if (!config.disabled) {
                    await this.connectTransport(name, config);
                }
            })
        );

        await this.refreshPrompts();
        this.isInitialized = true;
    }

    /**
     * 刷新并汇总所有工具的 Prompt 描述
     */
    async refreshPrompts() {
        const segments: string[] = [];
        for (const [name, client] of Object.entries(this.clients)) {
            const segment = await this.generateServerPrompt(name, client);
            if (segment) segments.push(segment);
        }
        this.mcpPrompt = segments.join("\n\n---\n\n");
    }

    private async generateServerPrompt(serverName: string, client: Client): Promise<string | null> {
        try {
            const caps = client.getServerCapabilities();
            if (!caps?.tools) return null;

            const { tools } = await client.listTools();
            let extraDesc = "";

            if (caps.prompts) {
                const { prompts } = await client.listPrompts();
                extraDesc = prompts?.[0]?.description ? `\n\n${prompts[0].description}` : "";
            }

            const toolDocs = tools
                .filter(t => t.name !== "execute_bash")
                .map(tool => {
                    this.tools[tool.name] = serverName;
                    const props = tool.inputSchema?.properties || {};
                    const required = (tool.inputSchema?.required as string[]) || [];
                    
                    const argsDoc = Object.entries(props).map(([key, val]: [string, any]) => {
                        const isReq = required.includes(key) ? "(required)" : "";
                        return `- ${key}: ${isReq} ${val.description || val.title || ""} (type: ${val.type})`;
                    }).join("\n");

                    return `MCP name: ${tool.name}\nMCP args:\n${argsDoc}\nMCP description:\n${tool.description}`;
                }).join("\n\n");

            return `## MCP server: ${serverName}${extraDesc}\n\n## Use\n\n${toolDocs}`;
        } catch (error: any) {
            this.notifyError(`generateServerPrompt[${serverName}]`, error);
            return null;
        }
    }

    private notifyError(context: string, error: any) {
        const message = `[MCPClient.${context}]: ${error.message}`;
        this.toolcall?.alertWindow?.create({ type: "error", content: message });
        console.error(message);
    }
}

export { MCPClient };