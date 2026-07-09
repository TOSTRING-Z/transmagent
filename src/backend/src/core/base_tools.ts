import { State } from "./LLMBase";
import { ToolCall } from "./ToolCall";
import { main as subagentLauncherMain, getPrompt as subagentLauncherPrompt } from '../tools/subagent_launcher';
import { main as sendMessageMain, getPrompt as sendMessagePrompt } from '../tools/send_message';

export default function getBaseTools(): Record<string, any> {
    return {

        "update_env": {
            func: async ({ key, value, toolCall }: { key: string, value: any, toolCall: ToolCall }) => {
                try {
                    if (!key) {
                        return { status: "error", message: "The 'key' parameter is required." };
                    }

                    const llmService = toolCall.mainLLMService ? toolCall.mainLLMService : toolCall.llmService;

                    if (!llmService.chatManager.chat.envs) {
                        llmService.chatManager.chat.envs = {};
                    }

                    // 删除变量逻辑：当 value 为空或 null 或 undefined 时删除该键
                    if (value === undefined || value === null || value === "") {
                        if (llmService.chatManager.chat.envs.hasOwnProperty(key)) {
                            delete llmService.chatManager.chat.envs[key];
                            return {
                                status: "success",
                                key: key,
                                message: `Environment variable '${key}' has been deleted.`
                            };
                        } else {
                            return {
                                status: "success",
                                key: key,
                                message: `Environment variable '${key}' did not exist; nothing to delete.`
                            };
                        }
                    }

                    const metadata = {
                        agent: toolCall.agentConfigs?.agentName || 'unknown',
                        timestamp: toolCall.llmService.environment_details?.time || new Date().toISOString(),
                    };

                    llmService.chatManager.chat.envs[key] = {
                        value: `${value}`,
                        _meta: metadata,  // 后端存储元数据，不污染 value
                    };

                    return {
                        status: "success",
                        key: key,
                        message: `Environment variable '${key}' has been successfully updated.`,
                        recorded: {
                            ...metadata,
                            key,
                            preview: String(value).substring(0, 100) + (String(value).length > 100 ? '...' : '')
                        }
                    };
                } catch (e: any) {
                    return { status: "error", message: `Update env failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "update_env",
                description: "[IN-SESSION STATE] Write, update, or DELETE a variable in the CURRENT session's shared environment. CRITICAL: Use this to share file paths, IDs, and temporary states with other sub-agents during this specific conversation. If 'value' is empty (null/undefined/blank), the variable will be DELETED.",
                parameters: {
                    type: "object",
                    properties: {
                        key: {
                            type: "string",
                            description: "The name of the environment variable (e.g., 'working_dir', 'task1_output'). Use clear, descriptive keys."
                        },
                        value: {
                            type: "string",
                            description: "The value to store. If this is blank/empty/null/undefined, the variable will be deleted from the environment. The system will automatically append metadata (agent name, timestamp) in the backend."
                        }
                    },
                    required: ["key", "value"]
                }
            })
        },

        "mcp_server": {
            func: async ({ name, args, toolCall }: { name: string, args: any, toolCall: ToolCall }) => {
                try {
                    // [逻辑减负]: 直接将模型传入的 FQN (例如 "biotools:get_mean_express_data") 
                    // 透传给底层 MCPClient。
                    // 剥离前缀、降级匹配等脏活已经全部由 MCPClient.callTool 内部的路由拦截器接管了。
                    return await toolCall.mcp_client.callTool({
                        name: name.trim(),
                        arguments: args
                    });
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
                        name: {
                            type: "string",
                            // [核心修改]: 强制模型使用 FQN (Fully Qualified Name)
                            description: "The Fully Qualified Name (FQN) of the service to call, STRICTLY formatted as 'server_name:tool_name' (e.g., 'biotools:get_mean_express_data' or 'math:calculator'). YOU MUST INCLUDE THE SERVER NAMESPACE PREFIX to avoid tool collisions."
                        },
                        args: {
                            type: "object",
                            description: "Parameter dictionary key-values."
                        }
                    },
                    required: ["name", "args"]
                }
            })
        },

        "ask_user": {
            func: async ({ questions, toolCall }: { questions?: Array<{ id: string; question: string; type: 'choice' | 'text' | 'confirm'; options?: string[]; required?: boolean }>, toolCall: ToolCall }) => {
                toolCall.state = State.PAUSE;
                if (!questions || !Array.isArray(questions) || questions.length === 0) {
                    return { questions: [{ id: 'q1', question: 'Please provide your input.', type: 'text', required: true }] };
                }
                return { questions };
            },
            getPrompt: () => ({
                name: "ask_user",
                description: "Pause execution to ask the user one or more questions simultaneously. Use this for clarification, decisions, missing data, or final approvals.\n\nCRITICAL RULES:\n1. MULTI-QUESTION: You can ask multiple questions in a single call. Each question has its own type and options.\n2. USE 'choice' TYPE: For strategic choices, technical paths, error resolutions, or plan/destructive action approvals. Provide the `options` array.\n3. USE 'text' TYPE: For open-ended user data (file paths, URLs, API keys, raw text input). DO NOT provide `options`.\n4. USE 'confirm' TYPE: For yes/no confirmations. DO NOT provide `options` (frontend auto-generates yes/no).\n5. Each question MUST have a unique `id` (e.g., 'q1', 'db_choice').",
                parameters: {
                    type: "object",
                    properties: {
                        questions: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    id: {
                                        type: "string",
                                        description: "Unique identifier for this question (e.g., 'q1', 'db_choice'). Used to map answers back."
                                    },
                                    question: {
                                        type: "string",
                                        description: "The question text presented to the user. Be clear and explain WHY you are asking."
                                    },
                                    type: {
                                        type: "string",
                                        enum: ["choice", "text", "confirm"],
                                        description: "Question type: 'choice' = select from options, 'text' = free-form input, 'confirm' = yes/no."
                                    },
                                    options: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                key: { type: "string", description: "Unique short identifier for this option (e.g., 'a', 'b', or a short slug)." },
                                                value: { type: "string", description: "The display text shown to the user." }
                                            },
                                            required: ["key", "value"]
                                        },
                                        description: "Required for 'choice' type. Each item MUST be an object with BOTH 'key' and 'value' fields. OMIT for 'text' and 'confirm' types."
                                    },
                                    required: {
                                        type: "boolean",
                                        description: "Whether this question must be answered. Default: true."
                                    }
                                },
                                required: ["id", "question", "type"]
                            }
                        }
                    },
                    required: ["questions"]
                }
            })
        },

        "context_retrieval": {
            func: async ({ context_id, toolCall }: { context_id: string | number, toolCall: ToolCall }) => {
                const history = toolCall.llmService.chatManager.getMessages(false);
                const target = history.find(m => String(m.context_id) === String(context_id));
                return target ? { role: target.role, content: target.content } : "Error: Context ID not found.";
            },
            getPrompt: () => ({
                name: "context_retrieval",
                description: `[IN-SESSION MEMORY] Retrieve the FULL, unredacted original content of a message that was TRUNCATED from your current active context window.

💡 UNDERLYING MECHANISM:
This tool accesses the in-memory array of the CURRENT session. When context length explodes, the system rolling-prunes old messages from your active LLM context and compresses them into a visual Markdown section titled '# 🗃️ Session Memory'.

🛑 STRICT PRE-CONDITIONS FOR CALLING (Zero Tolerance for Guessing):
1. You MUST ONLY call this tool if you explicitly see the '# 🗃️ Session Memory' block present in the current system prompt or upper context.
2. You MUST ONLY use a 'context_id' that is explicitly listed as an available string within that block.
3. NEVER guess, hallucinate, or pass dummy values like "0", "1", "null", or active group IDs as the 'context_id'. 
4. If '# 🗃️ Session Memory' does NOT exist in your current view, it means NO messages have been truncated yet. In this case, calling this tool is a critical logical error. If long term memory returned empty, simply acknowledge it to the user instead of triggering this tool.`,
                parameters: {
                    type: "object",
                    properties: {
                        context_id: {
                            type: "string",
                            description: "The EXACT Context ID string extracted from the active '# 🗃️ Session Memory' markdown table. Do not fabricate."
                        }
                    },
                    required: ["context_id"]
                }
            })
        },

        "add_subtasks": {
            func: async ({ task_id, task, subtasks, update_mode = "append", toolCall }: { task_id?: string, task?: string, subtasks: string | string[], update_mode?: string, toolCall: any }) => {
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                // 确保 tasks 始终是对象格式（防止被其他代码设置为数组）
                if (!chatVars.tasks || Array.isArray(chatVars.tasks)) {
                    chatVars.tasks = {};
                }
                chatVars.subtask_id = chatVars.subtask_id ?? 100;
                chatVars.task_id_counter = chatVars.task_id_counter ?? 1;

                if (!subtasks || subtasks.length === 0) return { status: "error", message: "Missing 'subtasks'." };

                let targetTaskId: string | undefined = task_id;
                const isUpdate = targetTaskId ? !!chatVars.tasks[targetTaskId] : false;

                if (!isUpdate) {
                    if (!task) return { status: "error", message: "Creating a new task requires a 'task' title." };
                    targetTaskId = `T-${chatVars.task_id_counter++}`;
                    chatVars.tasks[targetTaskId] = {
                        id: targetTaskId,
                        task_title: task,
                        type: "standard",
                        subtasks: [],
                        created_at: new Date().toISOString(),
                        last_completed_at: null,
                        execution_count: 0,
                    };
                }

                const targetTask = chatVars.tasks[targetTaskId!];

                if (update_mode === "replace_pending") {
                    targetTask.subtasks = targetTask.subtasks.filter((s: any) => s.status !== "pending");
                }

                const subtaskList = (Array.isArray(subtasks) ? subtasks : [subtasks]).map(desc => ({
                    id: chatVars.subtask_id++,
                    description: desc,
                    status: "pending",
                    reflection: "",
                    created_at: new Date().toISOString()
                }));

                targetTask.subtasks.push(...subtaskList);

                return {
                    status: "success",
                    message: isUpdate ? `Task [${targetTaskId}] updated.` : `New task created with ID [${targetTaskId}].`,
                    task_id: targetTaskId,
                    subtasks_added: subtaskList.map(s => ({ id: s.id, description: s.description }))
                };
            },
            getPrompt: () => ({
                name: "add_subtasks",
                description: "[IN-SESSION WORKFLOW] Break down complex goals or REPLAN the current task into actionable milestones.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: { type: "string", description: "Optional. Provide this to UPDATE an existing task (e.g., 'T-1')." },
                        task: { type: "string", description: "Main objective title (Required only if creating a NEW task)." },
                        subtasks: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of actionable milestones for the current task."
                        },
                        update_mode: {
                            type: "string",
                            enum: ["append", "replace_pending"],
                            description: "Default 'append'. Use 'replace_pending' to clear old pending subtasks before injecting the new plan."
                        }
                    },
                    required: ["subtasks"]
                }
            })
        },

        "record_subtasks": {
            func: async ({ subtask_ids, status, reflection, toolCall }: { subtask_ids: number[], status: string, reflection?: string, toolCall: any }) => {
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                const ids = new Set(subtask_ids);
                let updatedCount = 0;
                let skippedCount = 0;
                const now = new Date().toISOString();

                let remainingPendingCount = 0;

                Object.values(chatVars.tasks || {}).forEach((task: any) => {
                    task.subtasks.forEach((sub: any) => {
                        if (ids.has(Number(sub.id))) {
                            if (sub.status === "completed" && status !== "completed") {
                                skippedCount++;
                                return;
                            }
                            sub.status = status;
                            if (reflection) sub.reflection = reflection;
                            sub.updated_at = now;
                            updatedCount++;
                        }
                        if (sub.status === "pending") remainingPendingCount++;
                    });
                });

                if (updatedCount === 0) {
                    return {
                        status: "warning",
                        message: skippedCount > 0
                            ? `Update skipped: The specified subtasks were already marked as 'completed'.`
                            : `No matching subtask IDs found. Are you sure you provided the correct IDs?`
                    };
                }

                Object.values(chatVars.tasks || {}).forEach((task: any) => {
                    const allDone = task.subtasks.every((s: any) => ["completed", "failed"].includes(s.status));
                    if (allDone) {
                        task.last_completed_at = now;
                        task.execution_count = (task.execution_count || 0) + 1;
                    }
                });

                return {
                    status: "success",
                    message: `Successfully marked ${updatedCount} steps as '${status}'.`,
                    remaining_pending_tasks: remainingPendingCount
                };
            },
            getPrompt: () => ({
                name: "record_subtasks",
                description: "[IN-SESSION WORKFLOW] Checkpoint progress and save execution state. Mandatory: Call this immediately after finishing a subtask.",
                parameters: {
                    type: "object",
                    properties: {
                        subtask_ids: { type: "array", items: { type: "integer" }, description: "IDs to update." },
                        status: { type: "string", enum: ["completed", "failed", "in_progress"], description: "Status of the subtask." },
                        reflection: { type: "string", description: "Result summary, key paths found, or error details." },
                    },
                    required: ["subtask_ids", "status"]
                }
            })
        },

        "search_long_term_memory": {
            func: async ({ query, top_k = 5, toolCall }: { query: string, top_k?: number, toolCall: ToolCall }) => {
                try {
                    return await toolCall.memory_manager.queryLongTermMemory(query, top_k);
                } catch (e: any) {
                    return { error: `Memory retrieval failed: ${e.message}` };
                }
            },
            getPrompt: () => ({
                name: "search_long_term_memory",
                description: `[CROSS-SESSION MEMORY] Retrieve historical logs and core knowledge from the persistent database across past sessions.

💡 UNDERLYING MECHANISM (How this tool works):
1. Vector Semantic Search: Computes L2 distance of embeddings. It matches concepts, definitions, and implicit intents.
2. BM25 Statistical Keyword Search: Matches exact keyword frequencies. It expects precise tokens, product names, error codes, or absolute dates.
3. Temporal Fallback: If keywords lean heavily towards chronological recall (e.g., "recently", "latest"), the engine sorts logs by 'time' DESC to pull the freshest logs.

⚠️ MODEL OPERATIONAL GUIDELINES Based on Mechanism:
- If searching for a generic concept, formulate a dense semantic descriptive sentence.
- If searching for specific files, errors, or technical configs, input exact technical key tokens.
- CRITICAL FOR TIME-SENSITIVE QUERIES: If the user asks for "recent chats/history", DO NOT pass the word "recent". Because BM25/Vector search cannot evaluate relative time. You MUST explicitly look up the current system time from the environment, extract the corresponding year/month/date strings (e.g., '2026-05'), and append those absolute time blocks into your 'query' parameter to guide the database engine!`,
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The precision search query. Combine conceptual keywords with absolute dates (derived from the current environment time) if the intent is time-sensitive."
                        },
                        top_k: { type: "integer", description: "Number of top results to return. Default: 5" }
                    },
                    required: ["query"]
                }
            })
        },

        "write_important_memory": {
            func: async ({ content, toolCall }: { content: string, toolCall: ToolCall }) => {
                if (!content || typeof content !== 'string') return "Error: Content must be a non-empty string.";
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
        },
        "remove_tasks": {
            func: async ({ task_ids, subtask_ids, toolCall }: { task_ids?: string[], subtask_ids?: number[], toolCall: any }) => {
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                if (!chatVars.tasks) {
                    return { status: "warning", message: "No tasks exist." };
                }

                const removedTasks: string[] = [];
                const removedSubtasks: { taskId: string, subtaskId: number, description: string }[] = [];
                let notFoundTasks: string[] = [];
                let notFoundSubtasks: number[] = [];

                // 删除指定任务（整体移除）
                if (task_ids && task_ids.length > 0) {
                    for (const tid of task_ids) {
                        if (chatVars.tasks[tid]) {
                            removedTasks.push(tid);
                            delete chatVars.tasks[tid];
                        } else {
                            notFoundTasks.push(tid);
                        }
                    }
                }

                // 删除指定子任务（从所属任务中移除该子任务条目）
                if (subtask_ids && subtask_ids.length > 0) {
                    const subIdSet = new Set(subtask_ids);
                    for (const [tid, task] of Object.entries(chatVars.tasks) as [string, any][]) {
                        const before = task.subtasks.length;
                        task.subtasks = task.subtasks.filter((sub: any) => {
                            if (subIdSet.has(Number(sub.id))) {
                                removedSubtasks.push({ taskId: tid, subtaskId: sub.id, description: sub.description });
                                return false;
                            }
                            return true;
                        });
                        const removedCount = before - task.subtasks.length;
                        // 如果任务下所有子任务都被删完了，也清理该任务
                        if (removedCount > 0 && task.subtasks.length === 0) {
                            removedTasks.push(tid);
                            delete chatVars.tasks[tid];
                        }
                    }
                    // 检查哪些 subtask_id 没匹配到
                    const foundSubIds = new Set(removedSubtasks.map(s => s.subtaskId));
                    for (const sid of subtask_ids) {
                        if (!foundSubIds.has(sid)) {
                            notFoundSubtasks.push(sid);
                        }
                    }
                }

                const summary: string[] = [];
                if (removedTasks.length > 0) summary.push(`Removed ${removedTasks.length} task(s): [${removedTasks.join(', ')}]`);
                if (removedSubtasks.length > 0) summary.push(`Removed ${removedSubtasks.length} subtask(s) from tasks.`);
                if (notFoundTasks.length > 0) summary.push(`Task ID(s) not found: [${notFoundTasks.join(', ')}]`);
                if (notFoundSubtasks.length > 0) summary.push(`Subtask ID(s) not found: [${notFoundSubtasks.join(', ')}]`);

                if (removedTasks.length === 0 && removedSubtasks.length === 0) {
                    return { status: "warning", message: summary.join('; ') || "No matching tasks or subtasks found to remove." };
                }

                return {
                    status: "success",
                    message: summary.join('; '),
                    details: {
                        removed_tasks: removedTasks,
                        removed_subtasks: removedSubtasks.map(s => ({ task_id: s.taskId, subtask_id: s.subtaskId, description: s.description })),
                        remaining_task_count: Object.keys(chatVars.tasks).length
                    }
                };
            },
            getPrompt: () => ({
                name: "remove_tasks",
                description: "[IN-SESSION WORKFLOW] Remove (delete) tasks and/or subtasks from the current session. Supports removing entire tasks by task_id (e.g., 'T-1'), or removing specific subtasks by their numeric IDs. If all subtasks of a task are removed, the parent task is also cleaned up automatically.",
                parameters: {
                    type: "object",
                    properties: {
                        task_ids: {
                            type: "array",
                            items: { type: "string" },
                            description: "Array of task IDs to fully remove (e.g., ['T-1', 'T-2'])."
                        },
                        subtask_ids: {
                            type: "array",
                            items: { type: "integer" },
                            description: "Array of subtask IDs to remove from their parent tasks."
                        }
                    }
                }
            })
        },
        "send_message": {
            func: async ({ to, message, toolCall }: { to: string; message: string; toolCall: any }) => {
                const sender = sendMessageMain({});
                return await sender({ to, message, toolCall });
            },
            getPrompt: sendMessagePrompt,
        },
        "subagent_launcher": {
            func: async ({ agent_name, agent_prompt, query, tools, timeout, toolCall }: {
                agent_name: string;
                agent_prompt: string;
                query: string;
                tools?: string[];
                timeout?: number;
                toolCall: any;
            }) => {
                const launcher = subagentLauncherMain({});
                return await launcher({ agent_name, agent_prompt, query, tools, timeout, toolCall });
            },
            getPrompt: subagentLauncherPrompt,
        }
    };
}