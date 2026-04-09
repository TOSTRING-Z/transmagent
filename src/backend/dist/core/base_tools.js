"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = getBaseTools;
const ReActAgent_1 = require("./ReActAgent");
function getBaseTools() {
    return {
        // ====================================================================
        // update_env - 时间戳后端自动化
        // ====================================================================
        "update_env": {
            func: async ({ key, value, toolCall }) => {
                try {
                    if (!key || value === undefined) {
                        return { status: "error", message: "Both key and value parameters are required." };
                    }
                    const chatState = toolCall.llmService.chatManager.chat;
                    if (!chatState.envs) {
                        chatState.envs = {};
                    }
                    const metadata = {
                        agent: toolCall.agentConfigs?.agentName || 'unknown',
                        timestamp: toolCall.llmService.environment_details?.time || new Date().toISOString(),
                    };
                    chatState.envs[key] = {
                        value: `${value}`,
                        _meta: metadata, // 后端存储元数据，不污染 value
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
                            description: "The value to store. Simply provide the actual value - the system will automatically append metadata (agent name, timestamp) in the backend."
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
                const history = toolCall.llmService.chatManager.getMessages(true);
                const target = history.find(m => String(m.context_id) === String(context_id));
                return target ? { role: target.role, content: target.content } : "Error: Context ID not found.";
            },
            getPrompt: () => ({
                name: "context_retrieval",
                description: "[IN-SESSION MEMORY] Fetch raw details of a specific past interaction within the CURRENT session. Use Case: When you see a Context ID in the '# 🗃️ Session Memory' block at the top of the chat.",
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
            func: async ({ task_id, task, subtasks, task_type = "standard", trigger_condition = null, update_mode = "append", toolCall }) => {
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                chatVars.tasks = chatVars.tasks || {};
                chatVars.subtask_id = chatVars.subtask_id ?? 100;
                chatVars.task_id_counter = chatVars.task_id_counter ?? 1;
                if (!subtasks || subtasks.length === 0)
                    return { status: "error", message: "Missing 'subtasks'." };
                if (task_type === "recurring" && !trigger_condition)
                    return { status: "error", message: "Recurring tasks MUST have a 'trigger_condition'." };
                let targetTaskId = task_id;
                const isUpdate = targetTaskId ? !!chatVars.tasks[targetTaskId] : false;
                if (!isUpdate) {
                    if (!task)
                        return { status: "error", message: "Creating a new task requires a 'task' title." };
                    targetTaskId = `T-${chatVars.task_id_counter++}`;
                    chatVars.tasks[targetTaskId] = {
                        id: targetTaskId,
                        task_title: task,
                        type: task_type,
                        trigger_condition: trigger_condition || null,
                        subtasks: [],
                        created_at: new Date().toISOString(),
                        last_completed_at: null,
                        execution_count: 0,
                        cycle_status: "active"
                    };
                }
                const targetTask = chatVars.tasks[targetTaskId];
                if (update_mode === "replace_pending") {
                    targetTask.subtasks = targetTask.subtasks.filter((s) => s.status !== "pending");
                }
                const subtaskList = (Array.isArray(subtasks) ? subtasks : [subtasks]).map(desc => ({
                    id: chatVars.subtask_id++,
                    description: desc,
                    status: "pending",
                    reflection: "",
                    created_at: new Date().toISOString()
                }));
                targetTask.subtasks.push(...subtaskList);
                if (isUpdate && task_type === "recurring") {
                    targetTask.type = "recurring";
                    targetTask.trigger_condition = trigger_condition;
                }
                return {
                    status: "success",
                    message: isUpdate ? `Task [${targetTaskId}] updated.` : `New task created with ID [${targetTaskId}].`,
                    task_id: targetTaskId,
                    subtasks_added: subtaskList.map(s => ({ id: s.id, description: s.description }))
                };
            },
            getPrompt: () => ({
                name: "add_subtasks",
                description: "[IN-SESSION WORKFLOW] Break down complex goals or REPLAN. Use 'task_id' to update an existing workflow. Use 'update_mode=replace_pending' if you need to scrap old unexecuted ideas and pivot to a new plan.",
                parameters: {
                    type: "object",
                    properties: {
                        task_id: { type: "string", description: "Optional. Provide this to UPDATE an existing task (e.g., 'T-1')." },
                        task: { type: "string", description: "Main objective title (Required only if creating a NEW task)." },
                        subtasks: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of milestones."
                        },
                        update_mode: {
                            type: "string",
                            enum: ["append", "replace_pending"],
                            description: "Default 'append'. Use 'replace_pending' to delete current 'pending' subtasks and replace them with this new list (crucial for replanning when encountering dead ends)."
                        },
                        task_type: { type: "string", enum: ["standard", "recurring"], description: "Type of task." },
                        trigger_condition: { type: "string", description: "Required if recurring." }
                    },
                    required: ["subtasks"]
                }
            })
        },
        "record_subtasks": {
            func: async ({ subtask_ids, status, reflection, toolCall }) => {
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                const ids = new Set(subtask_ids);
                let updatedCount = 0;
                let skippedCount = 0;
                const now = new Date().toISOString();
                let recurringTasksToCheck = new Set();
                let remainingPendingCount = 0;
                Object.values(chatVars.tasks || {}).forEach((task) => {
                    let taskModified = false;
                    task.subtasks.forEach((sub) => {
                        if (ids.has(Number(sub.id))) {
                            if (sub.status === "completed" && status !== "completed") {
                                skippedCount++;
                                return;
                            }
                            sub.status = status;
                            if (reflection)
                                sub.reflection = reflection;
                            sub.updated_at = now;
                            updatedCount++;
                            taskModified = true;
                        }
                        if (sub.status === "pending")
                            remainingPendingCount++;
                    });
                    if (taskModified && task.type === "recurring")
                        recurringTasksToCheck.add(task);
                });
                if (updatedCount === 0) {
                    return {
                        status: "warning",
                        message: skippedCount > 0
                            ? `Update skipped: The specified subtasks were already marked as 'completed'.`
                            : `No matching subtask IDs found. Are you sure you provided the correct IDs?`
                    };
                }
                recurringTasksToCheck.forEach((task) => {
                    const allDone = task.subtasks.every((s) => ["completed", "failed"].includes(s.status));
                    if (allDone) {
                        task.last_completed_at = now;
                        task.execution_count = (task.execution_count || 0) + 1;
                        task.cycle_status = "cycle_wait";
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