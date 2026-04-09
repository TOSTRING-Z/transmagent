import { State } from "./ReActAgent";
import * as utils from '../utils/public';
import { ToolCall } from "./ToolCall";

// ============================================================================
// 重试熔断配置 (Retry Circuit Breaker Configuration)
// ============================================================================
const RETRY_CONFIG = {
    maxRetries: 3,                    // 单任务最大重试次数
    maxTotalRetries: 10,               // 会话内最大总重试次数
    backoffMultiplier: 1.5,           // 退避倍数
    circuitBreakerThreshold: 3,       // 连续失败触发熔断的次数
};

// 全局重试计数器（由后端管理，避免 LLM 幻觉时间戳）
let globalRetryCounter = {
    sessionTotal: 0,
    consecutiveFailures: 0,
};

export function resetRetryCounter() {
    globalRetryCounter = { sessionTotal: 0, consecutiveFailures: 0 };
}

export function getRetryState() {
    return { ...globalRetryCounter, maxRetries: RETRY_CONFIG };
}

function incrementRetry(success: boolean) {
    if (success) {
        globalRetryCounter.consecutiveFailures = 0;
    } else {
        globalRetryCounter.sessionTotal++;
        globalRetryCounter.consecutiveFailures++;
    }
}

export function shouldCircuitBreak(): boolean {
    return globalRetryCounter.consecutiveFailures >= RETRY_CONFIG.circuitBreakerThreshold;
}

export default function getBaseTools(): Record<string, any> {
    return {
        // ====================================================================
        // 核心修复 #2: update_env - 时间戳后端自动化
        // ====================================================================
        "update_env": {
            func: async ({ key, value, toolCall }: { key: string, value: any, toolCall: ToolCall }) => {
                try {
                    if (!key || value === undefined) {
                        return { status: "error", message: "Both key and value parameters are required." };
                    }

                    const chatState = toolCall.llmService.chatManager.chat;

                    if (!chatState.envs) {
                        chatState.envs = {};
                    }

                    // ====================================================================
                    // 关键优化：后端自动追加元数据，LLM 无需拼装格式
                    // ====================================================================
                    const metadata = {
                        agent: toolCall.agentConfigs?.name || 'unknown',
                        timestamp: toolCall.llmService.environment_details?.time || new Date().toISOString(),
                    };

                    chatState.envs[key] = {
                        value: `${value}`,
                        _meta: metadata,  // 后端存储元数据，不污染 value
                    };

                    return {
                        status: "success",
                        key: key,
                        message: `Environment variable '${key}' has been successfully updated.`,
                        // 返回完整记录供调试（可选）
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
            func: async ({ name, args, toolCall }: { name: string, args: any, toolCall: ToolCall }) => {
                try {
                    return await toolCall.mcp_client.callTool({ name, arguments: args });
                } catch (e: any) {
                    incrementRetry(false);
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
            func: async ({ ask, options, toolCall }: { ask: string, options?: string[], toolCall: ToolCall }) => {
                toolCall.state = State.PAUSE;
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
            func: async ({ context_id, toolCall }: { context_id: string | number, toolCall: ToolCall }) => {
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
            func: async ({ task, subtasks, task_type = "standard", trigger_condition = null, toolCall }: { task: string, subtasks: string | string[], task_type?: string, trigger_condition?: string | null, toolCall: ToolCall }) => {
                if (!task || !subtasks) return { status: "error", message: "Missing 'task' or 'subtasks'." };
                if (task_type === "recurring" && !trigger_condition) {
                    return { status: "error", message: "Recurring tasks MUST have a 'trigger_condition'." };
                }

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
                } else {
                    chatVars.tasks[taskId] = {
                        task,
                        type: task_type,
                        trigger_condition: trigger_condition || null,
                        subtasks: subtaskList,
                        created_at: new Date().toISOString(),
                        last_completed_at: null,
                        execution_count: 0,
                        cycle_status: "active"
                    };
                }

                return { 
                    status: "success", 
                    message: `Task '${task}' created/updated.`,
                    task_id: taskId,
                    subtasks: subtaskList.map(s => ({ id: s.id, description: s.description }))
                };
            },
            getPrompt: () => ({
                name: "add_subtasks",
                description: "[IN-SESSION WORKFLOW] Break down complex goals into tracking units for the CURRENT session. Strategy: Create 'Substantive Milestones', not atomic actions.",
                parameters: {
                    type: "object",
                    properties: {
                        task: { type: "string", description: "Main objective title." },
                        subtasks: {
                            type: "array",
                            items: { type: "string" },
                            description: "List of milestones. Each should be a substantial step, NOT an atomic action."
                        },
                        task_type: { 
                            type: "string", 
                            enum: ["standard", "recurring"], 
                            description: "Type of task. Default: standard" 
                        },
                        trigger_condition: {
                            type: "string",
                            description: "Required if recurring, e.g., 'Every 1 hour'."
                        }
                    },
                    required: ["task", "subtasks"]
                }
            })
        },

        "record_subtasks": {
            func: async ({ subtask_ids, status, reflection, toolCall }: { subtask_ids: number[], status: string, reflection?: string, toolCall: ToolCall }) => {
                const chatVars = toolCall.llmService.chatManager.chat.vars;
                const ids = new Set(subtask_ids);
                let updated = 0;
                const now = new Date().toISOString();

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

                // ====================================================================
                // 关键修复 #3: 熔断机制 - 连续失败时阻止继续重试
                // ====================================================================
                if (status === "failed") {
                    incrementRetry(false);
                    if (shouldCircuitBreak()) {
                        return { 
                            status: "circuit_break", 
                            message: `⚠️ CIRCUIT BREAKER TRIGGERED: ${RETRY_CONFIG.circuitBreakerThreshold} consecutive failures detected. Execution halted.`,
                            retry_state: getRetryState()
                        };
                    }
                } else {
                    incrementRetry(true);
                }

                recurringTasksToCheck.forEach((task: any) => {
                    const allDone = task.subtasks.every((s: any) => ["completed", "failed"].includes(s.status));
                    if (allDone) {
                        task.last_completed_at = now;
                        task.execution_count = (task.execution_count || 0) + 1;
                        task.cycle_status = "cycle_wait";
                    }
                });

                return {
                    status: "success",
                    message: `Marked ${updated} steps as ${status}.`,
                    retry_state: getRetryState()
                };
            },
            getPrompt: () => ({
                name: "record_subtasks",
                description: "[IN-SESSION WORKFLOW] Checkpoint progress and save execution state for the CURRENT session. Mandatory: Call this immediately after finishing a subtask.\n\n⚠️ IMPORTANT: The system tracks retry attempts internally. If you see a 'circuit_break' status, you MUST halt execution and report the block.",
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
            func: async ({ query, top_k = 5, toolCall }: { query: string, top_k?: number, toolCall: ToolCall }) => {
                try {
                    return await toolCall.memory_manager.queryLongTermMemory(query, top_k);
                } catch (e: any) {
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
        }
    };
}
