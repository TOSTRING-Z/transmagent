"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = getBaseTools;
const ReActAgent_1 = require("./ReActAgent");
const utils = __importStar(require("../utils/public"));
function getBaseTools() {
    return {
        "update_env": {
            func: async ({ key, value, toolCall }) => {
                try {
                    if (!key || value === undefined) {
                        return { status: "error", message: "Both key and value parameters are required." };
                    }
                    // 主代理实例
                    const chatState = toolCall.llmService.chatManager.chat;
                    // Ensure envs object exists
                    if (!chatState.envs) {
                        chatState.envs = {};
                    }
                    // Write or update the environment variable
                    chatState.envs[key] = `${value}`;
                    return {
                        status: "success",
                        key: key,
                        message: `Environment variable '${key}' has been successfully updated.`
                    };
                }
                catch (e) {
                    return { status: "error", message: `Update env failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "update_env",
                description: "[IN-SESSION STATE] Writes or updates a variable in the CURRENT session's shared environment. CRITICAL: Use this to share file paths, IDs, and temporary states with other sub-agents during this specific conversation.",
                parameters: {
                    type: "object",
                    properties: {
                        key: {
                            type: "string",
                            description: "The name of the environment variable (e.g., 'working_dir', 'task1_output'). Use clear, descriptive keys."
                        },
                        value: {
                            type: "string",
                            description: "The value to store. STRICT FORMAT REQUIRED: You MUST prefix the actual value with your agent name and the current time in this exact format: `[agent_name/time] actual_value`. Example: `[task_executor/14:30:00] /path/to/clean_data.csv`."
                        }
                    },
                    required: ["key", "value"]
                }
            })
        },
        "mcp_server": {
            func: async ({ name, args, toolCall }) => {
                try {
                    return await toolCall.mcp_client.callTool({ name, arguments: args });
                }
                catch (e) {
                    return { error: `MCP Call Failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "mcp_server",
                description: "Invoke external MCP (Model Context Protocol) services. Critical: Use this for ALL external capability requests not covered by native tools.",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Exact service name." },
                        args: { type: "object", description: "Parameter dictionary key-values." }
                    },
                    required: ["name", "args"]
                }
            })
        },
        "ask_user": {
            func: async ({ ask, options, toolCall }) => {
                toolCall.state = ReActAgent_1.State.PAUSE;
                return { ask, options };
            },
            getPrompt: () => ({
                name: "ask_user",
                description: "Pause execution to interact with the user for clarification, decisions, missing data, or final approvals.\n\nCRITICAL RULES (Adaptive Querying):\n1. DECISIONS & APPROVALS: For strategic choices, technical paths, error resolutions, or plan/destructive action approvals, you MUST provide the `options` array (e.g., ['Approve', 'Needs adjustments', 'Abort']).\n2. UNGUESSABLE DATA: For specific user data (e.g., file paths, URLs, API keys, raw text input), you MUST LEAVE `options` EMPTY (undefined) to allow open-ended text input.",
                parameters: {
                    type: "object",
                    properties: {
                        ask: {
                            type: "string",
                            description: "The clear, specific question, context, or summary presented to the user. Explain WHY you are asking."
                        },
                        options: {
                            type: "array",
                            items: { type: "string" },
                            description: "Actionable choices for the user. STRICTLY OMIT this parameter if asking for open-ended data like file paths, URLs, or keys."
                        }
                    },
                    required: ["ask"]
                }
            })
        },
        "context_retrieval": {
            func: async ({ context_id, toolCall }) => {
                // 修复：指向 ChatManager 获取历史记录
                const history = toolCall.llmService.chatManager.getMessages(true);
                const target = history.find(m => String(m.context_id) === String(context_id));
                return target ? { role: target.role, content: target.content } : "Error: Context ID not found.";
            },
            getPrompt: () => ({
                name: "context_retrieval",
                description: "[IN-SESSION MEMORY] Fetch raw details of a specific past interaction within the CURRENT session. Use Case: When you see a Context ID in the '# 🗃️ Session Memory' block and need to recall its full logs, code snippets, or precise paths.",
                parameters: {
                    type: "object",
                    properties: {
                        context_id: { type: "integer", description: "The Context ID extracted from the '# 🗃️ Session Memory' block at the top of the chat." }
                    },
                    required: ["context_id"]
                }
            })
        },
        "add_subtasks": {
            func: async ({ task, subtasks, task_type = "standard", trigger_condition = null, toolCall }) => {
                if (!task || !subtasks)
                    return { status: "error", message: "Missing 'task' or 'subtasks'." };
                if (task_type === "recurring" && !trigger_condition) {
                    return { status: "error", message: "Recurring tasks MUST have a 'trigger_condition'." };
                }
                // 修复：指向 ChatManager 中的 vars
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                chatVars.tasks = chatVars.tasks || {};
                chatVars.subtask_id = chatVars.subtask_id ?? 100;
                const subtaskList = (Array.isArray(subtasks) ? subtasks : [subtasks]).map(desc => ({
                    id: chatVars.subtask_id++,
                    description: desc,
                    status: "pending",
                    reflection: "",
                    created_at: new Date().toISOString()
                }));
                const taskId = utils.hashCode(task);
                const isUpdate = !!chatVars.tasks[taskId];
                if (isUpdate) {
                    chatVars.tasks[taskId].subtasks.push(...subtaskList);
                    if (task_type === "recurring") {
                        chatVars.tasks[taskId].type = "recurring";
                        chatVars.tasks[taskId].trigger_condition = trigger_condition;
                    }
                }
                else {
                    chatVars.tasks[taskId] = {
                        task_id: taskId,
                        title: task,
                        type: task_type,
                        trigger_condition,
                        subtasks: subtaskList,
                        created_at: new Date().toISOString(),
                        execution_count: 0,
                        last_triggered: null
                    };
                }
                return {
                    status: "success",
                    message: `${isUpdate ? "Updated" : "Created"} task '${task}' with ${subtaskList.length} subtasks.`,
                    data: { task_id: taskId, subtask_ids: subtaskList.map((t) => t.id) }
                };
            },
            getPrompt: () => ({
                name: "add_subtasks",
                description: "[IN-SESSION WORKFLOW] Break down complex goals into tracking units for the CURRENT session. Strategy: Create 'Substantive Milestones', not atomic actions.",
                parameters: {
                    type: "object",
                    properties: {
                        task: { type: "string", description: "Main objective title." },
                        subtasks: { type: "array", items: { type: "string" }, description: "List of milestones." },
                        task_type: { type: "string", enum: ["standard", "recurring"], description: "Type of task." },
                        trigger_condition: { type: "string", description: "Required if recurring, e.g., 'Every 1 hour'." }
                    },
                    required: ["task", "subtasks"]
                }
            })
        },
        "record_subtasks": {
            func: async ({ subtask_ids, status = "completed", reflection, toolCall }) => {
                const ids = new Set((Array.isArray(subtask_ids) ? subtask_ids : [subtask_ids]).map(Number));
                const now = new Date().toISOString();
                // 修复：指向 ChatManager 中的 vars
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                let updated = 0;
                let recurringTasksToCheck = new Set();
                Object.values(chatVars.tasks || {}).forEach((task) => {
                    let taskModified = false;
                    task.subtasks.forEach((sub) => {
                        if (ids.has(Number(sub.id))) {
                            sub.status = status;
                            sub.reflection = reflection || sub.reflection;
                            sub.updated_at = now;
                            updated++;
                            taskModified = true;
                        }
                    });
                    if (taskModified && task.type === "recurring")
                        recurringTasksToCheck.add(task);
                });
                if (updated === 0)
                    return { status: "warning", message: "No matching subtask IDs found." };
                recurringTasksToCheck.forEach((task) => {
                    const allDone = task.subtasks.every((s) => ["completed", "failed"].includes(s.status));
                    if (allDone) {
                        task.last_completed_at = now;
                        task.execution_count = (task.execution_count || 0) + 1;
                        task.cycle_status = "cycle_wait";
                    }
                });
                return `Marked ${updated} steps as ${status}.`;
            },
            getPrompt: () => ({
                name: "record_subtasks",
                description: "[IN-SESSION WORKFLOW] Checkpoint progress and save execution state for the CURRENT session. Mandatory: Call this immediately after finishing a subtask.",
                parameters: {
                    type: "object",
                    properties: {
                        subtask_ids: { type: "array", items: { type: "integer" }, description: "IDs to update." },
                        status: { type: "string", enum: ["completed", "failed", "in_progress"], description: "Status of the subtask." },
                        reflection: { type: "string", description: "Result summary or metric data." },
                    },
                    required: ["subtask_ids"]
                }
            })
        },
        "search_long_term_memory": {
            func: async ({ query, top_k = 5, toolCall }) => {
                try {
                    return await toolCall.memory_manager.queryLongTermMemory(query, top_k);
                }
                catch (e) {
                    return { error: `Memory retrieval failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "search_long_term_memory",
                description: "[CROSS-SESSION MEMORY] Retrieve historical knowledge from the persistent database across past sessions. Trigger: Call this BEFORE acting if the user refers to past projects, old tasks, or global configurations established in previous conversations.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Semantic search string representing the historical context you are looking for." },
                        top_k: { type: "integer", description: "Number of top results to return. Default: 5" }
                    },
                    required: ["query"]
                }
            })
        },
        "write_important_memory": {
            func: async ({ content, toolCall }) => {
                if (!content || typeof content !== 'string')
                    return "Error: Content must be a non-empty string.";
                return await toolCall.memory_manager.appendImportantMemory(content, toolCall.llmService.environment_details.time)
                    ? "Success: Memory Archived"
                    : "Error: Write Failed";
            },
            getPrompt: () => ({
                name: "write_important_memory",
                description: `[CROSS-SESSION MEMORY] Proactively save high-value, permanent information useful for completely different FUTURE sessions.

CRITICAL OVERRIDE: If the user explicitly says 'Remember X', saving 'X' IS YOUR PRIMARY TASK. You MUST invoke this tool BEFORE replying. Do not just say 'I will remember'.

⛔ ANTI-HALLUCINATION GUARDRAIL (STRICTLY FORBIDDEN):
You MUST NOT save any transient session state. DO NOT save:
1. Current Workflow Progress or Subtask lists (e.g., ✅/⏳).
2. Temporary file paths (e.g., /tmp/...).
3. Specific analysis states belonging to the current run.
(Note: Use 'update_env' for sharing temporary session state, NOT this tool.)`,
                parameters: {
                    type: "object",
                    properties: {
                        content: {
                            type: "string",
                            description: "The permanent knowledge to archive. MUST follow this exact format: '[Category] Content'.\nAllowed Categories: [Identity], [Preferences], [Permanent_Paths] (e.g., /data/...), [Global_Configs], [Milestones].\nExample: '[Permanent_Paths] BRCA expression data is located at /data/tcga/brca.csv'"
                        }
                    },
                    required: ["content"]
                }
            })
        }
    };
}
//# sourceMappingURL=base_tools.js.map