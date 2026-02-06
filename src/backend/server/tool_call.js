const { ReActAgent, State } = require("./agent")
const { utils } = require('../modules/globals')
const { MCPClient } = require('./mcp_client')
const Prompts = require('./prompts');
const os = require('os');
const JSON5 = require("json5");
const MemoryManager = require('../modules/MemoryManager');

class ToolCall extends ReActAgent {

  constructor(plugins, tools = {}, llm_service, window, alertWindow, prompt_args = {
    agent_prompt: null,
    mcp_server: true,
    todolist: true,
    subagent: false,
    agent_mode: "transagent"
  }) {
    super(plugins, llm_service, window, alertWindow);
    this.mcp_client = new MCPClient(this);

    this.prompt_args = prompt_args;

    this.modes = {
      AUTO: 'Automatic mode',
      ACT: 'Execution mode',
      PLAN: 'Planning mode',
      FLASH: 'Flash mode',
    }

    this.system_prompt;
    this.mcp_prompt;
    this.init_var();

    this.base_tools = {
      "mcp_server": {
        func: async ({ name, args }) => {
          const result = await this.mcp_client.callTool({
            name: name,
            arguments: args
          });
          return result;
        },
        description: `## mcp_server
Description: Request MCP (Model Context Protocol) service.

Parameters:
- name: (Required) The name of the MCP service to request.
- args: (Required) The parameters of the MCP service request.

Usage:
{{
  "thinking": "[Thinking process]",
  "tool": "mcp_server",
  "params": {{
    "name": "[value]",
    "args": {{
      "[parameter1_name]": [value1],
      "[parameter2_name]": [value2],
      ...
    }}
  }}
}}
`
      },
      "ask_followup_question": {
        func: async ({ question, options }) => {
          this.state = State.PAUSE;
          return { question, options }
        },
        description: `## ask_followup_question
Description: Ask the user questions to collect additional information needed to complete the task. It should be used when encountering ambiguity, needing clarification, or requiring more details to proceed effectively. It achieves interactive problem-solving by allowing direct communication with the user. Use this.agent tool wisely to balance between collecting necessary information and avoiding excessive back-and-forth communication.

Parameters:
- question: (Required) The question to ask the user. this.agent should be a clear and specific question targeting the information you need.
- options: (Optional) Provide the user with 2-5 options to choose from. Each option should be a string describing a possible answer. You do not always need to provide options, but in many cases, this.agent can help the user avoid manually entering a response.

Usage:
{{
  "thinking": "[Thinking process]",
  "tool": "ask_followup_question",
  "params": {{
    "question": "[value]",
    "options": [
      "Option 1",
      "Option 2",
      ...
    ]
  }}
}}`
      },
      "waiting_feedback": {
        func: ({ options = ["Allow", "Deny"] }) => {
          this.state = State.PAUSE;
          return { question: "Task paused, waiting for user feedback...", options: options }
        },
        description: `## waiting_feedback
Description: Suspends task execution to await explicit user approval/rejection before performing system-altering operations (file modifications, config changes, etc.). Designed for high-risk actions requiring human validation.

Parameters:
options: (Optional) An array containing 2-4 options for the user to choose from.


Usage example:
{{
  "thinking": "[Explain why confirmation is needed and impact analysis]",
  "tool": "waiting_feedback",
  "params": {{
    "options": ["Allow", "Deny"]
  }}
}}`
      },
      "plan_mode_response": {
        func: async ({ response, options }) => {
          this.state = State.PAUSE;
          return { question: response, options }
        },
        description: `## plan_mode_response
Description: Respond to user inquiries to plan solutions for user tasks. this.agent tool should be used when you need to respond to user questions or statements about how to complete a task. this.agent tool is only available in "planning mode". The environment details will specify the current mode; if it is not "planning mode", this.agent tool should not be used. Depending on the user's message, you may ask questions to clarify the user's request, design a solution for the task, and brainstorm with the user. For example, if the user's task is to create a website, you can start by asking some clarifying questions, then propose a detailed plan based on the context, explain how you will complete the task, and possibly engage in back-and-forth discussions until the user switches you to another mode to implement the solution before finalizing the details.

Parameters:
response: (Required) The response provided to the user after the thinking process.
options: (Optional) An array containing 2-5 options for the user to choose from. Each option should describe a possible choice or a forward path in the planning process. this.agent can help guide the discussion and make it easier for the user to provide input on key decisions. You may not always need to provide options, but in many cases, this.agent can save the user time from manually entering a response. Do not provide options to switch modes, as there is no need for you to guide the user's operations.

Usage:
{{
  "thinking": "[Thinking process]",
  "tool": "plan_mode_response",
  "params": {{
    "response": "[value]",
    "options": [
      "Option 1",
      "Option 2",
      ...
    ]
  }}
}}`
      },
      "enter_idle_state": {
        func: async ({ final_answer }) => {
          this.state = State.FINAL;
          return final_answer;
        },
        description: `## enter_idle_state  
Description: Stop current task and enter idle state, waiting for further instructions (called when task is completed).

Parameters:
- final_answer: (Required, Markdown format)

Usage:
{{
  "thinking": "Task analysis completed. Key steps:\n1. Executed 3 code analyses\n2. Performed 2 file searches\n3. Validated architecture patterns",
  "tool": "enter_idle_state",
  "params": {{
    "final_answer": "[final_answer]"
  }}
}}`
      },
      "context_retrieval": {
        func: ({ context_id }) => {
          const memory = this.llm_service.getMessages(true).filter(m => m.context_id === context_id).map(m => { return { role: m.role, content: m.content } });
          return memory || "No memory ID found";
        },
        description: `## context_retrieval
Core Function: Query historical interactions by context_id

Typical Scenarios:
1. Review analysis steps
2. Verify historical discussions
3. Resume previous work

Parameters:
- context_id: (Required)
  - Type: Integer
  - Values: Numeric IDs from Context List
  - Example: 42

Usage Example:
{{
  "thinking": "Need to confirm previous discussion about X",
  "tool": "context_retrieval",
  "params": {{
    "context_id": 24
  }}
}}`
      },
      "add_subtasks": {
        func: ({ task, subtasks, task_type = "standard", trigger_condition = null }) => {
          // --- 1. 参数校验与防御性编程 ---
          if (!task) return { status: "error", message: "Missing required parameter: task" };

          // 强制校验：周期任务必须包含触发条件
          if (task_type === "recurring" && !trigger_condition) {
            return { status: "error", message: "Recurring tasks require a 'trigger_condition' (e.g., 'Every hour')." };
          }

          const subtaskList = Array.isArray(subtasks) ? subtasks : [subtasks];
          const chatVars = this.llm_service.chat.vars;

          // --- 2. 格式化子任务 (Atomic Object Creation) ---
          const newSubtasks = subtaskList.map(desc => ({
            id: chatVars.subtask_id++, // 全局自增 ID
            description: desc,
            status: "pending",
            reflection: null, // 初始化字段，避免 undefined
            created_at: new Date().toISOString()
          }));

          // --- 3. 任务对象构建与合并 (Idempotency Support) ---
          const taskId = utils.hashCode(task); // 假设 utils 已存在
          const existingTask = chatVars.tasks[taskId];

          if (existingTask) {
            // A. 现有任务：合并子任务
            existingTask.subtasks.push(...newSubtasks);

            // 如果是周期任务，允许更新触发规则
            if (task_type === "recurring" && trigger_condition) {
              existingTask.trigger_condition = trigger_condition;
              existingTask.type = "recurring"; // 允许将标准任务升级为周期任务
            }
          } else {
            // B. 新任务：初始化结构
            chatVars.tasks[taskId] = {
              task_id: taskId,
              title: task,
              type: task_type,
              trigger_condition: task_type === "recurring" ? trigger_condition : null,
              subtasks: newSubtasks,
              created_at: new Date().toISOString(),
              // 周期任务元数据
              last_triggered: null,
              last_completed_at: null,
              execution_count: 0
            };
          }

          // --- 4. 响应构建 ---
          const typeInfo = task_type === "recurring" ? `Recurring (Rule: ${trigger_condition})` : "Standard";
          return {
            status: "success",
            message: `Registered ${newSubtasks.length} subtasks to ${typeInfo} task.`,
            data: {
              task_id: taskId,
              new_ids: newSubtasks.map(t => t.id)
            }
          };
        },
        description: `## add_subtasks
Description: Register a new project or a recurring maintenance schedule. Use this to structure complex goals into actionable subtasks.

Parameters:
- task: (Required) Clear title of the main objective.
- subtasks: (Required) List of executable steps (strings).
- task_type: (Required) 
  - "standard": One-off projects (e.g., "Research report").
  - "recurring": System maintenance or monitoring (e.g., "Hourly health check").
- trigger_condition: (Required for "recurring") The interval or rule (e.g., "Every 30 mins", "Daily at 9AM").

Usage (Standard):
{ "task": "Write Blog Post", "task_type": "standard", "subtasks": ["Outline", "Draft", "Publish"] }

Usage (Recurring):
{ "task": "Server Health Check", "task_type": "recurring", "trigger_condition": "Every 1 hour", "subtasks": ["Check CPU", "Check Memory"] }`
      },

      "record_subtasks": {
        func: ({ subtask_ids, status = "completed", reflection, options }) => {
          // --- 1. 输入标准化 ---
          const targetIds = new Set((Array.isArray(subtask_ids) ? subtask_ids : [subtask_ids]).map(id => parseInt(id)));
          const now = new Date().toISOString();
          const chatVars = this.llm_service.chat.vars;

          let updatedCount = 0;
          let affectedRecurringTasks = new Set(); // 追踪受影响的周期任务

          // --- 2. 遍历查找与更新 (O(Tasks * Subtasks)) ---
          // 注：如果任务量巨大，建议建立 id -> task_id 的反向索引映射
          for (const taskId in chatVars.tasks) {
            const parentTask = chatVars.tasks[taskId];
            let taskModified = false;

            parentTask.subtasks.forEach(subtask => {
              if (targetIds.has(subtask.id)) {
                // 更新状态
                subtask.status = status;
                subtask.reflection = reflection || subtask.reflection;
                subtask.updated_at = now;

                updatedCount++;
                taskModified = true;
              }
            });

            if (taskModified && parentTask.type === "recurring") {
              affectedRecurringTasks.add(parentTask);
            }
          }

          if (updatedCount === 0) {
            return { status: "warning", message: "No subtasks found with provided IDs." };
          }

          // --- 3. 周期任务生命周期管理 ---
          affectedRecurringTasks.forEach(task => {
            // 检查是否该周期内的所有子任务都已完成
            const allSubtasksDone = task.subtasks.every(st => ["completed", "success", "failed"].includes(st.status));

            if (allSubtasksDone) {
              task.last_completed_at = now;
              task.execution_count = (task.execution_count || 0) + 1;

              // 可选策略：为了下个周期，重置子任务状态为 'pending'
              // 或者保留历史，由调度器生成新的子任务实例。
              // 此处采用“软重置”逻辑：仅打标，调度器负责重置
              task.cycle_status = "cycle_completed";
            }
          });

          // --- 4. 环境控制 ---
          if (this.environment_details.mode === this.modes.ACT) {
            this.state = State.PAUSE;
          }

          return {
            status: "success",
            message: `Updated ${updatedCount} subtasks.`,
            meta: {
              recurring_updates: affectedRecurringTasks.size > 0 ? "Synced with scheduler" : "None"
            },
            options: options?.length > 0 ? options : ["continue"]
          };
        },
        description: `## record_subtasks
Description: Update the status of specific subtasks. Critical for tracking progress and providing feedback to the system.

Parameters:
- subtask_ids: (Required) List of IDs to update.
- status: (Optional) New state ("completed", "failed", "in_progress"). Default: "completed".
- reflection: (Required) Brief insight on the result.
  - Standard: Quality/Outcome check.
  - Recurring: Anomaly detection report (e.g., "CPU normal at 40%").
- options: (Optional) Suggested next steps for the user.

Example:
{ 
  "subtask_ids": [105, 106], 
  "status": "completed", 
  "reflection": "Database migration successful, no data loss.", 
  "options": ["Verify data integrity", "Close ticket"] 
}`
      },
      "search_long_term_memory": {
        func: async ({ query, top_k }) => {
          return await this.memory_manager.queryLongTermMemory(query, top_k);
        },
        description: `## search_long_term_memory
Description: Search long-term memory for relevant information based on a query.

Parameters:
- query: (Required) The search query string/time.
- top_k: (Optional, default 5) The number of top relevant results to return.

Usage Example:
{{
  "thinking": "Searching long-term memory for relevant information",
  "tool": "search_long_term_memory",
  "params": {{
    "query": "[2025-2-5 18:xx:xx] What did the dialogue say?",
    "top_k": 5
  }}
}}`
      },
      "write_important_memory": {
        func: ({ content }) => {
          return this.memory_manager.appendImportantMemory(content) ? "Memory saved" : "Failed to save memory";
        },
        description: `## write_important_memory
Description: Writes critical user context directly to the 'Important Memory' section of the System Prompt. STRICTLY enforce the following format for all entries: [Category] Content. Use this tool to persist high-value, enduring information—such as specific preferences, professional details, or long-term goals—that necessitates updating the model's core instructions.

Parameters:
- content: (Required) The content to be written to Important Memory.

Usage Example:
{{
  "thinking": "Writing important user preferences to Important Memory",
  "tool": "write_important_memory",
  "params": {{
    "content": "[Preferences] User prefers a clean and minimalistic UI design."
  }}
}}`
      },
    }

    this.tools = { ...tools, ...this.base_tools };

    this.prompts = new Prompts(this);
    this.memory_manager = new MemoryManager(utils);

    this.task_prompt = () => this.prompts.getSystemPrompts();

    this.env_prompt = this.prompts.getEnvPrompts();
  }

  init_var() {
    this.context_id = 0;
    this.memory_list = [];
    this.thinking_repetitions = [];
    this.repetitions_delay_empty = 0

    this.environment_details = {
      language: utils.getLanguage(),
      tmpdir: utils.getConfig("tool_call")?.tmpdir || os.tmpdir(),
      time: utils.formatDate(),
      mode: this.modes.ACT,
      envs: null,
      todolist: null,
    }
  }

  get_tools_prompt() {
    const tool_prompt = []
    for (let key in this.tools) {
      if (this.tools[key]?.getPrompt) {
        const getPrompt = this.tools[key].getPrompt;
        tool_prompt.push(getPrompt());
      }
    }
    return tool_prompt;
  }

  async save_long_term_memory(user_content, final_answer) {
    // Save to long term memory
    try {
      if (user_content && final_answer) {
        const time = this.environment_details.time;
        const content = `Date: ${time}\nUser: ${user_content}\nAgent: ${final_answer}`;
        await this.memory_manager.addLongTermMemory(
          this.llm_service.chat.id,
          content,
          time
        );
      }
    } catch (e) {
      console.error("Error saving memory", e);
    }
  }

  memory_update(data) {
    let messages = this.llm_service.getMessages(false);
    let messages_list = [];
    if (messages.length > data.memory_length) {
      messages_list = messages.slice(Math.max(messages.length - data.long_memory_length - data.memory_length, 0), messages.length - data.memory_length).map(message => {
        const message_copy = this.llm_service.delMessage(message, message?.del);
        delete message_copy.react;
        delete message_copy.id;
        delete message_copy.show;
        return message_copy;
      })
    }
    this.memory_list = messages_list
    this.system_prompt = this.task_prompt().format({
      system_type: utils.getConfig("tool_call")?.system_type || os.type(),
      system_platform: utils.getConfig("tool_call")?.system_platform || os.platform(),
      system_arch: utils.getConfig("tool_call")?.system_arch || os.arch(),
      tool_prompt: this.get_tools_prompt().join("\n\n"),
      mcp_prompt: this.mcp_prompt,
      cli_prompt: this.prompts.getCliPrompt(),
      extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt),
      important_memory: this.memory_manager.getImportantMemory(),
      memory_list: JSON.stringify(this.memory_list, null, 2)
    })
  }

  environment_update(data) {
    this.environment_details.time = utils.formatDate();
    this.environment_details.language = data?.language || utils.getLanguage();
    const envs = [];
    for (const key in this.llm_service.chat.envs) {
      if (Object.prototype.hasOwnProperty.call(this.llm_service.chat.envs, key)) {
        const value = this.llm_service.chat.envs[key];
        envs.push(`- ${key}: ${value}`)
      }
    }
    const todolist = [];
    for (const task_id in this.llm_service.chat.vars.tasks) {
      if (Object.prototype.hasOwnProperty.call(this.llm_service.chat.vars.tasks, task_id)) {
        const task = this.llm_service.chat.vars.tasks[task_id].task;
        const subtasks = this.llm_service.chat.vars.tasks[task_id].subtasks.map(subtask => {
          return `  - subtask id: ${subtask.id}, description: ${subtask.description}, status: ${subtask.status}`;
        });
        todolist.push(`- ${task_id}: ${task}:\n${subtasks.join("\n")}`);
      }
    }
    this.environment_details.todolist = todolist.join("\n");
    this.environment_details.envs = envs.join("\n");
    data.env_message = utils.getConfig("tool_call")?.env_message ? this.llm_service.envMessage(this.env_prompt.format(this.environment_details)) : null;
  }

  change_mode(mode = null) {
    const modeMap = {
      "auto": this.modes.AUTO,
      "plan": this.modes.PLAN,
      "flash": this.modes.FLASH,
      "act": this.modes.ACT,
    };
    if (modeMap[mode]) {
      this.environment_details.mode = modeMap[mode];
      this.llm_service.chat.mode = mode;
      this.window?.webContents.send('change-mode', mode);
    } else {
      this.environment_details.mode = this.modes.ACT;
      this.llm_service.chat.mode = "act";
      this.window?.webContents.send('change-mode', "act");
    }
  }

  async step(data) {
    if (!this.mcp_prompt && this.prompt_args.mcp_server) {
      await this.mcp_client.initMcp();
      this.mcp_prompt = this.mcp_client.mcp_prompt;
    }
    data.push_message = false
    if (this.state == State.IDLE) {
      this.llm_service.pushMessage("user", data.query, data.id, this.context_id++, true, false);
      this.state = State.RUNNING;
    }
    this.environment_update(data);
    this.memory_update(data);
    const tool_info = await this.task(data);
    // Check if a tool needs to be called
    if (tool_info?.tool) {
      let { observation, output } = await this.act(tool_info);
      if (this.thinking_repetitions.length >= (utils.getConfig("tool_call")?.max_thinking_repetitions || 3)) {
        observation = {
          warning: `You have been stuck in a thinking loop ${this.thinking_repetitions.length} times. Try a new approach to break through, or end it directly.`,
          options: ["End Task", "Try New Approach"]
        };
        this.thinking_repetitions.length = 0;
      }
      data.output_format = JSON.stringify(observation, null, 2);
      this.llm_service.pushMessage("user", data.output_format, data.id, this.context_id);
      if (observation?.warning) {
        this.state = State.PAUSE;
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${observation.warning}\n\n`, end: true });
        return observation.options;
      }
      switch (tool_info.tool) {
        case "display_file":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${output}\n\n` });
          break;
        case "add_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\n` });
          break;
        case "record_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\n` });
          break;
        default:
          break;
      }
      if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_info.tool)) {
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: output, end: false });
      }
      if (this.state == State.PAUSE) {
        const { question, options } = output;
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: question || "", end: true });
        return options;
      }
      if (this.state == State.FINAL) {
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: output, end: true });
      } else {
        this.window.webContents.send('info-data', { id: data.id, context_id: this.context_id, content: this.get_info(data) });
      }
    }
  }

  async task(data) {
    data.prompt = this.system_prompt;
    const raw_json = await this.llmCall(data);
    console.log(`raw_json: ${raw_json}`);
    data.output_format = utils.extractJson(raw_json) || raw_json;
    this.window.webContents.send('info-data', { id: data.id, context_id: ++this.context_id, content: this.get_info(data) });
    this.llm_service.pushMessage("assistant", data.output_format, data.id, this.context_id);
    return this.get_tool(data.output_format, data);
  }

  get_tool(content, data) {
    try {
      const tool_info = JSON5.parse(content);
      if (tool_info?.tool && tool_info?.thinking) {
        // 统计重复回答
        if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[0] === tool_info.thinking) {
          this.thinking_repetitions.push(tool_info.thinking);
        } else {
          this.repetitions_delay_empty += 1
          if (this.repetitions_delay_empty >= (utils.getConfig("tool_call")?.repetitions_delay_empty || 2)) {
            this.thinking_repetitions.length = 0;
            this.repetitions_delay_empty = 0;
          }
        }
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${tool_info.thinking}\n\n---\n\n` });
        return tool_info;
      }
    } catch (error) {
      console.log(error);
      data.output_format = `{
  "tool_call": "",
  "observation": "Tool was not executed.",
  "error": "Your response is not a pure JSON text, or there is a problem with the JSON format: ${error.message}"
}`;
      this.llm_service.setTag(false);
      this.llm_service.pushMessage("user", data.output_format, data.id, this.context_id);
      this.environment_update(data);
      this.window.webContents.send('info-data', { id: data.id, context_id: this.context_id, content: this.get_info(data) });
    }
  }

  async act({ tool, params }) {
    try {
      if (!Object.prototype.hasOwnProperty.call(this.tools, tool)) {
        const observation = {
          "tool_call": tool,
          "observation": "Tool was not executed.",
          "error": "Tool does not exist."
        };
        this.llm_service.setTag(false);
        return { observation, output: null };
      }
      const will_tool = this.tools[tool].func;
      const output = await will_tool(params);
      const observation = {
        "tool_call": tool,
        "observation": output,
        "error": ""
      };
      if (tool == "cli_execute") {
        const success = output?.success;
        this.llm_service.setTag(success);
      } else {
        this.llm_service.setTag(true);
      }
      return { observation, output };
    } catch (error) {
      console.log(error);
      const observation = {
        "tool_call": tool,
        "observation": "Tool has been executed.",
        "error": error.message
      };
      this.llm_service.setTag(false);
      return { observation, output: error.message };
    }
  }

  /* 功能：ReAct agent 方式调用流程
   * 参数：
   *   data.api_url: API的URL地址
   *   data.api_key: API的密钥
   *   data.chat: 当前聊天对象（见：getChatInit()）
   *   data.id: 当前对话 ID（用户每个提交id加1）
   *   data.is_plugin: 是否插件模型
   *   data.query: 用户输入的内容
   *   data.max_step: 最大执行步数
   *   data.prompt: 当前对话的系统提示词
   *   data.img_url: 用户上传的图片链接
   *   data.file_path: 用户上传的文件路径
   *   data.model: 使用的模型
   *   data.input_template: 输入模板
   *   data.prompt_template: 系统提示模板
   *   data.params: 
       - llm_params: 语言模型参数（最高优先级，存在则覆盖data.llm_params）
       - vision: 是否视觉模型（示例：["image"]）
       - ollama: 是否ollama模型
   *   data.llm_params: 语言模型参数
   *   data.memory_length: 上下文记忆长度
   *   data.push_message: 是否将用户输入和 AI 回复存入对话历史，默认值 true
   *   data.end: 是否结束当前对话，默认值 false
   *   data.event: 渲染事件
   * 返回：最终的 data 对象，包含任务执行结果
   * 说明：该方法负责处理 ReAct agent 的调用逻辑，管理状态并执行任务
  */
  async callReAct(data) {
    let step = 0;
    this.state = State.IDLE;
    let tool_call = utils.getConfig("tool_call");
    while (this.state != State.FINAL && this.state != State.PAUSE) {
      if (this.llm_service.stop) {
        this.state = State.FINAL
        this.window.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true });
        break;
      }
      if (data?.max_step && step > data.max_step) {
        break
      }
      data = { ...data, ...tool_call, step: ++step, context_id: this.context_id, react: true };

      let options = await this.step(data);
      if (!this.llm_service.chat.name) {
        this.setChatName(data).then(() => {
          if (this.llm_service.chat.name) {
            this.window.webContents.send('auto-rename-chat', this.llm_service.chat);
          }
        });
      }
      if (!this.prompt_args.subagent) {
        this.setHistory();
      }
      if (this.state == State.PAUSE) {
        this.window.webContents.send("options", { options, id: data.id });
      }
    }
    if (!this.prompt_args.subagent) {
      this.sendData(data);
    }
    return data;
  }
}

module.exports = {
  ToolCall
};
