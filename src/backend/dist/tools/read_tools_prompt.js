"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrompt = getPrompt;
exports.main = main;
const fs_1 = require("fs");
const globals_1 = require("../utils/globals");
const WindowManager_1 = require("../main/windows/WindowManager");
function getPrompt() {
    return {
        name: "read_tools_prompt",
        description: "Retrieve the \`tool core description file\` content along with MCP tools.",
        parameters: {
            type: "object",
            properties: {},
            required: []
        }
    };
}
function main() {
    return async () => {
        const mcp_client = WindowManager_1.WindowManager.instance.mainWindow.tool_call.mcp_client;
        await mcp_client.initMcp();
        const mcp_prompt = mcp_client.mcpPrompt;
        const prompt_file = globals_1.utils.getConfig("tool_call")?.cli_prompt || globals_1.utils.getDefault("cli_prompt.md");
        if ((0, fs_1.existsSync)(prompt_file)) {
            return {
                bash_tools: (0, fs_1.readFileSync)(prompt_file, 'utf-8'),
                mcp_tools: mcp_prompt
            };
        }
        else {
            return "The tool core description file does not exist";
        }
    };
}
//# sourceMappingURL=read_tools_prompt.js.map