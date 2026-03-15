import { existsSync, readFileSync } from "fs";
import { utils } from "../utils/globals";
import { WindowManager } from "../main/windows/WindowManager";

export function getPrompt() {
    return {
        name: "read_tools_prompt",
        description: "Retrieve the tool core description file content along with MCP tools.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    }
}

export function main() {
    return async (): Promise<any> => {
        const mcp_client = WindowManager.instance.mainWindow.tool_call.mcp_client;
        await mcp_client.initMcp();
        const mcp_prompt = mcp_client.mcpPrompt;
        const prompt_file = utils.getConfig("tool_call")?.cli_prompt || utils.getDefault("cli_prompt.md");
        if (existsSync(prompt_file)) {
            return {
                bash_tools: readFileSync(prompt_file, 'utf-8'),
                mcp_tools: mcp_prompt
            };
        } else {
            return "The tool core description file does not exist";
        }
    }
}