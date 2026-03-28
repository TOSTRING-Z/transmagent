import { State } from "./ReActAgent";
import { utils } from '../utils/globals';
import { ToolCall } from "./ToolCall";
import { WindowManager } from "../main/windows/WindowManager";

export default function getBaseTools(toolCallInstance: ToolCall): Record<string, any> {
    return {
        "update_env": {
            func: async ({ key, value }: { key: string, value: any }) => {
                try {
                    if (!key || value === undefined) {
                        return { status: "error", message: "Both key and value parameters are required." };
                    }

                    // 主代理实例
                    const chatState = WindowManager.instance.mainWindow.llm_service.chatManager.chat;

                    // Ensure envs object exists
                    if (!chatState.envs) {
                        chatState.envs = {};
                    }

                    // Write or update the environment variable
                    chatState.envs[key] = value;

                    return {
                        status: "success",
                        key: key,
                        message: `Environment variable '${key}' has been successfully set/updated.`
                    };
                } catch (e: any) {
                    return { status: "error", message: `Update env failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "update_env",
                description: "Writes or updates an environment variable in the global `envs` object. CRITICAL: Use this tool to record important analytical processes, learned experiences, generated output file paths, working directories, and other key information so that context is not lost in future turns.",
                parameters: {
                    type: "object",
                    properties: {
                        key: {
                            type: "string",
                            description: "The name of the environment variable (e.g., 'working_dir', 'compile_experience', 'latest_output_file'). Use clear, descriptive keys."
                        },
                        value: {
                            type: "string",
                            description: "The value or content to store. Keep the information highly relevant and concise."
                        }
                    },
                    required: ["key", "value"]
                }
            })
        },

        "mcp_server": {
            func: async ({ name, args }: { name: string, args: any }) => {
                try {
                    return await toolCallInstance.mcp_client.callTool({ name, arguments: args });
                } catch (e: any) {
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
            func: async ({ ask, options }: { ask: string, options?: string[] }) => {
                toolCallInstance.state = State.PAUSE;
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
            func: async ({ context_id }: { context_id: string | number }) => {
                // 修复：指向 ChatManager 获取历史记录
                const history = toolCallInstance.llm_service.chatManager.getMessages(true);
                const target = history.find(m => String(m.context_id) === String(context_id));
                return target ? { role: target.role, content: target.content } : "Error: Context ID not found.";
            },
            getPrompt: () => ({
                name: "context_retrieval",
                description: "Fetch raw details of a specific past interaction using its ID. Use Case: Checking specific code snippets or parameters from previous turns.",
                parameters: {
                    type: "object",
                    properties: {
                        context_id: { type: "integer", description: "The ID from the Context List." }
                    },
                    required: ["context_id"]
                }
            })
        },

        "add_subtasks": {
            func: async ({ task, subtasks, task_type = "standard", trigger_condition = null }: { task: string, subtasks: string | string[], task_type?: string, trigger_condition?: string | null }) => {
                if (!task || !subtasks) return { status: "error", message: "Missing 'task' or 'subtasks'." };
                if (task_type === "recurring" && !trigger_condition) {
                    return { status: "error", message: "Recurring tasks MUST have a 'trigger_condition'." };
                }

                // 修复：指向 ChatManager 中的 vars
                const chatVars = toolCallInstance.llm_service.chatManager.chat.vars;
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
                } else {
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
                    data: { task_id: taskId, subtask_ids: subtaskList.map((t: any) => t.id) }
                };
            },
            getPrompt: () => ({
                name: "add_subtasks",
                description: "Break down complex goals into tracking units. Strategy: Create 'Substantive Milestones', not atomic actions.",
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
            func: async ({ subtask_ids, status = "completed", reflection }: { subtask_ids: number | number[], status?: string, reflection?: string }) => {
                const ids = new Set((Array.isArray(subtask_ids) ? subtask_ids : [subtask_ids]).map(Number));
                const now = new Date().toISOString();

                // 修复：指向 ChatManager 中的 vars
                const chatVars = toolCallInstance.llm_service.chatManager.chat.vars;

                let updated = 0;
                let recurringTasksToCheck = new Set<any>();

                Object.values(chatVars.tasks || {}).forEach((task: any) => {
                    let taskModified = false;
                    task.subtasks.forEach((sub: any) => {
                        if (ids.has(Number(sub.id))) {
                            sub.status = status;
                            sub.reflection = reflection || sub.reflection;
                            sub.updated_at = now;
                            updated++;
                            taskModified = true;
                        }
                    });
                    if (taskModified && task.type === "recurring") recurringTasksToCheck.add(task);
                });

                if (updated === 0) return { status: "warning", message: "No matching subtask IDs found." };

                recurringTasksToCheck.forEach((task: any) => {
                    const allDone = task.subtasks.every((s: any) => ["completed", "failed"].includes(s.status));
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
                description: "Checkpoint progress and save execution state. Mandatory: Call this immediately after finishing a subtask.",
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
            func: async ({ query, top_k = 5 }: { query: string, top_k?: number }) => {
                try {
                    return await toolCallInstance.memory_manager.queryLongTermMemory(query, top_k);
                } catch (e: any) {
                    return { error: `Memory retrieval failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "search_long_term_memory",
                description: "Retrieve historical knowledge from database. Trigger: When context is missing or referencing past projects.",
                parameters: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Semantic search string." },
                        top_k: { type: "integer", description: "Number of top results to return. Default: 5" }
                    },
                    required: ["query"]
                }
            })
        },

        "write_important_memory": {
            func: async ({ content }: { content: string }) => {
                if (!content || typeof content !== 'string') return "Error: Content must be a non-empty string.";
                return await toolCallInstance.memory_manager.appendImportantMemory(content, toolCallInstance.environment_details.time)
                    ? "Success: Memory Archived"
                    : "Error: Write Failed";
            },
            getPrompt: () => ({
                name: "write_important_memory",
                description: "Save high-value, permanent user context (Preferences, Secrets, Milestones). Format: '[Category] Content'",
                parameters: {
                    type: "object",
                    properties: {
                        content: { type: "string", description: "Content to write into memory." }
                    },
                    required: ["content"]
                }
            })
        }
    };
}