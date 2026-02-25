const { State } = require("./agent");
const { utils } = require('../modules/globals');

module.exports = function getBaseTools(toolCallInstance) {
    return {
        "mcp_server": {
            func: async ({ name, args }) => {
                try {
                    return await toolCallInstance.mcp_client.callTool({ name, arguments: args });
                } catch (e) {
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
        "ask_followup_question": {
            func: async ({ question, options }) => {
                toolCallInstance.state = State.PAUSE;
                return { question, options };
            },
            getPrompt: () => ({
                name: "ask_followup_question",
                description: "Pause execution to request clarification or missing info from the user. Trigger: Ambiguity, missing parameters, or need for user decision.",
                parameters: {
                    type: "object",
                    properties: {
                        question: { type: "string", description: "Clear, specific inquiry." },
                        options: { type: "array", items: { type: "string" }, description: "2-5 distinct choices to speed up user response." }
                    },
                    required: ["question"]
                }
            })
        },
        "waiting_feedback": {
            func: ({ options = ["Allow", "Deny"] }) => {
                toolCallInstance.state = State.PAUSE;
                return { question: "High-risk action detected. Awaiting approval.", options };
            },
            getPrompt: () => ({
                name: "waiting_feedback",
                description: "MANDATORY safety pause before high-risk actions (file deletion, system config, deployment).",
                parameters: {
                    type: "object",
                    properties: {
                        options: { type: "array", items: { type: "string" }, description: "Array of options, Default: ['Allow', 'Deny']" }
                    },
                    required: []
                }
            })
        },
        "plan_mode_response": {
            func: async ({ response, options }) => {
                if (toolCallInstance.environment_details.mode !== 'PLAN') {
                    return { error: "Tool 'plan_mode_response' is restricted to PLANNING MODE only." };
                }
                toolCallInstance.state = State.PAUSE;
                return { question: response, options };
            },
            getPrompt: () => ({
                name: "plan_mode_response",
                description: "Interact with the user specifically during the 'Planning Phase'. Constraint: ONLY available in 'Planning Mode'. Use for architecture design, requirements gathering, and blueprint confirmation.",
                parameters: {
                    type: "object",
                    properties: {
                        response: { type: "string", description: "The architectural proposal or clarifying question." },
                        options: { type: "array", items: { type: "string" }, description: "Guided paths for the plan." }
                    },
                    required: ["response"]
                }
            })
        },
        "enter_idle_state": {
            func: async ({ final_answer }) => {
                toolCallInstance.state = State.FINAL;
                return final_answer;
            },
            getPrompt: () => ({
                name: "enter_idle_state",
                description: "Terminate the current task sequence and return the final result. Trigger: When all subtasks are complete and verified.",
                parameters: {
                    type: "object",
                    properties: {
                        final_answer: { type: "string", description: "Comprehensive summary of results in Markdown format." }
                    },
                    required: ["final_answer"]
                }
            })
        },
        "context_retrieval": {
            func: ({ context_id }) => {
                const history = toolCallInstance.llm_service.getMessages(true);
                const target = history.find(m => m.context_id === context_id);
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
            func: ({ task, subtasks, task_type = "standard", trigger_condition = null }) => {
                if (!task || !subtasks) return { status: "error", message: "Missing 'task' or 'subtasks'." };
                if (task_type === "recurring" && !trigger_condition) {
                    return { status: "error", message: "Recurring tasks MUST have a 'trigger_condition'." };
                }

                const chatVars = toolCallInstance.llm_service.chat.vars;
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
                    data: { task_id: taskId, subtask_ids: subtaskList.map(t => t.id) }
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
            func: ({ subtask_ids, status = "completed", reflection, options }) => {
                const ids = new Set((Array.isArray(subtask_ids) ? subtask_ids : [subtask_ids]).map(Number));
                const now = new Date().toISOString();
                const chatVars = toolCallInstance.llm_service.chat.vars;

                let updated = 0;
                let recurringTasksToCheck = new Set();

                Object.values(chatVars.tasks || {}).forEach(task => {
                    let taskModified = false;
                    task.subtasks.forEach(sub => {
                        if (ids.has(sub.id)) {
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

                recurringTasksToCheck.forEach(task => {
                    const allDone = task.subtasks.every(s => ["completed", "failed"].includes(s.status));
                    if (allDone) {
                        task.last_completed_at = now;
                        task.execution_count = (task.execution_count || 0) + 1;
                        task.cycle_status = "cycle_wait";
                    }
                });

                if (toolCallInstance.environment_details.mode === toolCallInstance.modes.ACT) {
                    toolCallInstance.state = State.PAUSE;
                }

                return {
                    status: "success",
                    message: `Marked ${updated} steps as ${status}.`,
                    options: options ?? ["Proceed to next step"]
                };
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
                        options: { type: "array", items: { type: "string" }, description: "Next step options." }
                    },
                    required: ["subtask_ids"]
                }
            })
        },
        "search_long_term_memory": {
            func: async ({ query, top_k = 5 }) => {
                try {
                    return await toolCallInstance.memory_manager.queryLongTermMemory(query, top_k);
                } catch (e) {
                    return { error: "Memory retrieval failed." };
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
            func: ({ content }) => {
                if (!content || typeof content !== 'string') return "Error: Content must be a non-empty string.";
                return toolCallInstance.memory_manager.appendImportantMemory(content, toolCallInstance.environment_details.time)
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
};
