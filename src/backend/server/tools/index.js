const { State } = require("../agent"); // 假设 agent.js 在上级目录
const { utils } = require('../../modules/globals');

/**
 * 生成核心交互工具
 */
const createCoreTools = (agent) => ({
  "mcp_server": {
    func: async ({ name, args }) => {
      try {
        return await agent.mcp_client.callTool({ name, arguments: args });
      } catch (e) {
        return { error: `MCP Call Failed: ${e.message}` };
      }
    },
    description: `## mcp_server
Purpose: Invoke external MCP (Model Context Protocol) services.
**Critical**: Use this for ALL external capability requests not covered by native tools.

Parameters:
- name: (String) Exact service name.
- args: (Object/JSON String) Parameter dictionary key-values.

Usage:
<root>
  <thinking>Fetching weather data via MCP</thinking>
  <tool_call>
    <name>mcp_server</name>
    <parameters>
      <name>weather_service</name>
      <args>{"city": "Tokyo", "unit": "metric"}</args>
    </parameters>
  </tool_call>
</root>`
  },

  "ask_followup_question": {
    func: async ({ question, options }) => {
      agent.state = State.PAUSE;
      return { question, options };
    },
    description: `## ask_followup_question
Purpose: Pause execution to request clarification or missing info from the user.

Parameters:
- question: (String) Clear, specific inquiry.
- options: (Array<String>, Optional) JSON list of choices.

Usage:
<root>
  <thinking>Ambiguous date format, asking user.</thinking>
  <tool_call>
    <name>ask_followup_question</name>
    <parameters>
      <question>Which date format should I use?</question>
      <options>["YYYY-MM-DD", "DD/MM/YYYY"]</options>
    </parameters>
  </tool_call>
</root>`
  },

  "waiting_feedback": {
    func: ({ options = ["Allow", "Deny"] }) => {
      agent.state = State.PAUSE;
      return { question: "High-risk action detected. Awaiting approval.", options };
    },
    description: `## waiting_feedback
Purpose: MANDATORY safety pause before high-risk actions.

Parameters:
- options: (Array, Default: ["Allow", "Deny"])

Usage:
<root>
  <thinking>Deleting remote database requires approval</thinking>
  <tool_call>
    <name>waiting_feedback</name>
    <parameters>
      <options>["Proceed", "Abort"]</options>
    </parameters>
  </tool_call>
</root>`
  },

  "plan_mode_response": {
    func: async ({ response, options }) => {
      if (agent.environment_details.mode !== 'PLAN') {
        return { error: "Tool 'plan_mode_response' is restricted to PLANNING MODE only." };
      }
      agent.state = State.PAUSE;
      return { question: response, options };
    },
    description: `## plan_mode_response
Purpose: Interact with the user specifically during the "Planning Phase".

Parameters:
- response: (String) The architectural proposal.
- options: (Array, Optional)

Usage:
<root>
  <thinking>Proposing 3-step workflow</thinking>
  <tool_call>
    <name>plan_mode_response</name>
    <parameters>
      <response>I propose a 3-layer architecture...</response>
      <options>["Approve Plan", "Modify"]</options>
    </parameters>
  </tool_call>
</root>`
  },

  "enter_idle_state": {
    func: async ({ final_answer }) => {
      agent.state = State.FINAL;
      return final_answer;
    },
    description: `## enter_idle_state
Purpose: Terminate the current task sequence and return the final result.

Parameters:
- final_answer: (String) Comprehensive summary.

Usage:
<root>
  <thinking>All tasks verified. Generating report.</thinking>
  <tool_call>
    <name>enter_idle_state</name>
    <parameters>
      <final_answer>## Execution Summary\nTask complete.</final_answer>
    </parameters>
  </tool_call>
</root>`
  },

  "context_retrieval": {
    func: ({ context_id }) => {
      const history = agent.llm_service.getMessages(true);
      const target = history.find(m => m.context_id === context_id);
      return target ? { role: target.role, content: target.content } : "Error: Context ID not found.";
    },
    description: `## context_retrieval
Purpose: Fetch raw details of a specific past interaction using its ID.

Parameters:
- context_id: (Integer)

Usage:
<root>
  <thinking>Checking turn 5 details</thinking>
  <tool_call>
    <name>context_retrieval</name>
    <parameters>
      <context_id>5</context_id>
    </parameters>
  </tool_call>
</root>`
  }
});

/**
 * 生成任务管理工具
 */
const createTaskTools = (agent) => ({
  "add_subtasks": {
    func: ({ task, subtasks, task_type = "standard", trigger_condition = null }) => {
      if (!task || !subtasks) return { status: "error", message: "Missing 'task' or 'subtasks'." };
      
      const chatVars = agent.llm_service.chat.vars;
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
    description: `## add_subtasks
Purpose: Break down complex goals into tracking units.

Parameters:
- task: (String) Main objective title.
- subtasks: (Array<String>) JSON Array of milestones.
- task_type: "standard" | "recurring"
- trigger_condition: (String, optional)

Usage:
<root>
  <thinking>Decomposing deployment</thinking>
  <tool_call>
    <name>add_subtasks</name>
    <parameters>
      <task>Deploy v2</task>
      <task_type>standard</task_type>
      <subtasks>["Build Docker", "Push to Registry"]</subtasks>
    </parameters>
  </tool_call>
</root>`
  },

  "record_subtasks": {
    func: ({ subtask_ids, status = "completed", reflection, options }) => {
      const ids = new Set((Array.isArray(subtask_ids) ? subtask_ids : [subtask_ids]).map(Number));
      const now = new Date().toISOString();
      const chatVars = agent.llm_service.chat.vars;

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

      if (agent.environment_details.mode === agent.modes.ACT) {
        agent.state = State.PAUSE;
      }

      return {
        status: "success",
        message: `Marked ${updated} steps as ${status}.`,
        options: options ?? ["Proceed to next step"]
      };
    },
    description: `## record_subtasks
Purpose: Checkpoint progress and save execution state.

Parameters:
- subtask_ids: (Array<Int>) JSON Array of IDs.
- status: "completed" | "failed" | "in_progress"
- reflection: (String) Result summary.

Usage:
<root>
  <thinking>Docker build successful</thinking>
  <tool_call>
    <name>record_subtasks</name>
    <parameters>
      <subtask_ids>[101]</subtask_ids>
      <status>completed</status>
      <reflection>Image built successfully</reflection>
    </parameters>
  </tool_call>
</root>`
  }
});

/**
 * 生成记忆管理工具
 */
const createMemoryTools = (agent) => ({
  "search_long_term_memory": {
    func: async ({ query, top_k = 5 }) => {
      try {
        return await agent.memory_manager.queryLongTermMemory(query, top_k);
      } catch (e) {
        return { error: "Memory retrieval failed." };
      }
    },
    description: `## search_long_term_memory
Purpose: Retrieve historical knowledge from database.

Parameters:
- query: (String) Semantic search string.
- top_k: (Int, Default: 5)

Usage:
<root>
  <thinking>Recalling preferences</thinking>
  <tool_call>
    <name>search_long_term_memory</name>
    <parameters>
      <query>python style preference</query>
      <top_k>3</top_k>
    </parameters>
  </tool_call>
</root>`
  },

  "write_important_memory": {
    func: ({ content }) => {
      if (!content || typeof content !== 'string') return "Error: Content must be a non-empty string.";
      return agent.memory_manager.appendImportantMemory(content, agent.environment_details.time)
        ? "Success: Memory Archived"
        : "Error: Write Failed";
    },
    description: `## write_important_memory
Purpose: Save high-value user context.

Parameters:
- content: (String)

Usage:
<root>
  <thinking>User likes vegetarian food.</thinking>
  <tool_call>
    <name>write_important_memory</name>
    <parameters>
      <content>[Diet] User strictly avoids meat products.</content>
    </parameters>
  </tool_call>
</root>`
  }
});

module.exports = { createCoreTools, createTaskTools, createMemoryTools };