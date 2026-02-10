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
          // 增加错误捕获，防止外部服务挂掉影响主流程
          try {
            return await this.mcp_client.callTool({ name, arguments: args });
          } catch (e) {
            return { error: `MCP Call Failed: ${e.message}` };
          }
        },
        description: `## mcp_server
Purpose: Invoke external MCP (Model Context Protocol) services.
**Critical**: Use this for ALL external capability requests not covered by native tools.

Parameters:
- name: (String) Exact service name.
- args: (Object) Parameter dictionary key-values.

Usage:
{{
  "thinking": "Fetching weather data via MCP",
  "tool": "mcp_server",
  "params": {{
    "name": "weather_service",
    "args": {{ "city": "Tokyo", "unit": "metric" }}
  }}
}}`
      },

      "ask_followup_question": {
        func: async ({ question, options }) => {
          this.state = State.PAUSE;
          return { question, options };
        },
        description: `## ask_followup_question
Purpose: Pause execution to request clarification or missing info from the user.
**Trigger**: Ambiguity, missing parameters, or need for user decision.

Parameters:
- question: (String) Clear, specific inquiry.
- options: (Array<String>, Optional) 2-5 distinct choices to speed up user response.

Usage:
{{
  "thinking": "Ambiguous date format",
  "tool": "ask_followup_question",
  "params": {{
    "question": "Which date format should I use?",
    "options": ["YYYY-MM-DD", "DD/MM/YYYY"]
  }}
}}`
      },

      "waiting_feedback": {
        func: ({ options = ["Allow", "Deny"] }) => {
          this.state = State.PAUSE;
          return { question: "High-risk action detected. Awaiting approval.", options };
        },
        description: `## waiting_feedback
Purpose: MANDATORY safety pause before high-risk actions (file deletion, system config, deployment).

Parameters:
- options: (Array, Default: ["Allow", "Deny"])

Usage:
{{
  "thinking": "Deleting remote database requires approval",
  "tool": "waiting_feedback",
  "params": {{ "options": ["Proceed", "Abort"] }}
}}`
      },

      "plan_mode_response": {
        func: async ({ response, options }) => {
          // 强制状态校验，防止在非 Planning 模式下误用
          if (this.environment_details.mode !== 'PLAN') {
            return { error: "Tool 'plan_mode_response' is restricted to PLANNING MODE only." };
          }
          this.state = State.PAUSE;
          return { question: response, options };
        },
        description: `## plan_mode_response
Purpose: Interact with the user specifically during the "Planning Phase".
**Constraint**: ONLY available in 'Planning Mode'. Use for architecture design, requirements gathering, and blueprint confirmation.

Parameters:
- response: (String) The architectural proposal or clarifying question.
- options: (Array, Optional) Guided paths for the plan.

Usage:
{{
  "thinking": "Proposing 3-step workflow",
  "tool": "plan_mode_response",
  "params": {{
    "response": "I propose a 3-layer architecture. Details below...",
    "options": ["Approve Plan", "Modify Database Layer"]
  }}
}}`
      },

      "enter_idle_state": {
        func: async ({ final_answer }) => {
          this.state = State.FINAL;
          return final_answer;
        },
        description: `## enter_idle_state
Purpose: Terminate the current task sequence and return the final result.
**Trigger**: When all subtasks are complete and verified.

Parameters:
- final_answer: (String, Markdown) Comprehensive summary of results.

Usage:
{{
  "thinking": "All tasks verified. Generating report.",
  "tool": "enter_idle_state",
  "params": {{ "final_answer": "## Execution Summary\\n- Task A: Done\\n- Task B: Done" }}
}}`
      },

      "context_retrieval": {
        func: ({ context_id }) => {
          // 优化：仅提取需要的字段，减少 Token 消耗
          const history = this.llm_service.getMessages(true);
          const target = history.find(m => m.context_id === context_id);
          return target ? { role: target.role, content: target.content } : "Error: Context ID not found.";
        },
        description: `## context_retrieval
Purpose: Fetch raw details of a specific past interaction using its ID.
**Use Case**: Checking specific code snippets or parameters from previous turns.

Parameters:
- context_id: (Integer) The ID from the Context List.

Usage:
{{
  "thinking": "Verifying the API key provided in turn 5",
  "tool": "context_retrieval",
  "params": {{ "context_id": 5 }}
}}`
      },

      "add_subtasks": {
        func: ({ task, subtasks, task_type = "standard", trigger_condition = null }) => {
          // 1. 健壮性校验
          if (!task || !subtasks) return { status: "error", message: "Missing 'task' or 'subtasks'." };
          if (task_type === "recurring" && !trigger_condition) {
            return { status: "error", message: "Recurring tasks MUST have a 'trigger_condition'." };
          }

          const chatVars = this.llm_service.chat.vars;
          // 确保 tasks 容器存在
          chatVars.tasks = chatVars.tasks || {};
          chatVars.subtask_id = chatVars.subtask_id ?? 100; // 初始化 ID 计数器

          // 2. 构造子任务
          const subtaskList = (Array.isArray(subtasks) ? subtasks : [subtasks]).map(desc => ({
            id: chatVars.subtask_id++,
            description: desc,
            status: "pending",
            reflection: "",
            created_at: new Date().toISOString()
          }));

          // 3. 任务挂载 (幂等性处理)
          const taskId = utils.hashCode(task);
          const isUpdate = !!chatVars.tasks[taskId];

          if (isUpdate) {
            chatVars.tasks[taskId].subtasks.push(...subtaskList);
            // 如果升级为周期任务
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
              // Metric fields
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
**Strategy**: Create "Substantive Milestones", not atomic actions.

Parameters:
- task: (String) Main objective title.
- subtasks: (Array<String>) List of milestones.
- task_type: "standard" | "recurring"
- trigger_condition: (String, Required if recurring) e.g., "Every 1 hour".

Usage:
{{
  "thinking": "Decomposing deployment",
  "tool": "add_subtasks",
  "params": {{
    "task": "Deploy v2",
    "task_type": "standard",
    "subtasks": ["Build Docker", "Push to Registry", "Restart K8s"]
  }}
}}`
      },

      "record_subtasks": {
        func: ({ subtask_ids, status = "completed", reflection, options }) => {
          const ids = new Set((Array.isArray(subtask_ids) ? subtask_ids : [subtask_ids]).map(Number));
          const now = new Date().toISOString();
          const chatVars = this.llm_service.chat.vars;

          let updated = 0;
          let recurringTasksToCheck = new Set();

          // 1. 更新逻辑 (O(N) Scan)
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

          // 2. 周期任务自动重置逻辑
          recurringTasksToCheck.forEach(task => {
            const allDone = task.subtasks.every(s => ["completed", "failed"].includes(s.status));
            if (allDone) {
              task.last_completed_at = now;
              task.execution_count = (task.execution_count || 0) + 1;
              task.cycle_status = "cycle_wait"; // 标记为等待下一次调度
            }
          });

          // 3. 环境控制
          if (this.environment_details.mode === this.modes.ACT) {
            this.state = State.PAUSE;
          }

          return {
            status: "success",
            message: `Marked ${updated} steps as ${status}.`,
            options: options ?? ["Proceed to next step"]
          };
        },
        description: `## record_subtasks
Purpose: Checkpoint progress and save execution state.
**Mandatory**: Call this immediately after finishing a subtask.

Parameters:
- subtask_ids: (Array<Int>) IDs to update.
- status: "completed" | "failed" | "in_progress"
- reflection: (String) Result summary or metric data.

Usage:
{{
  "thinking": "Docker build successful",
  "tool": "record_subtasks",
  "params": {{
    "subtask_ids": [101],
    "status": "completed",
    "reflection": "Image built: sha256:e3b0c442"
  }}
}}`
      },

      "search_long_term_memory": {
        func: async ({ query, top_k = 5 }) => {
          try {
            return await this.memory_manager.queryLongTermMemory(query, top_k);
          } catch (e) {
            return { error: "Memory retrieval failed." };
          }
        },
        description: `## search_long_term_memory
Purpose: Retrieve historical knowledge from database.
**Trigger**: When context is missing or referencing past projects.

Parameters:
- query: (String) Semantic search string.
- top_k: (Int, Default: 5)

Usage:
{{
  "thinking": "Recalling user's preferred Python linter",
  "tool": "search_long_term_memory",
  "params": {{ "query": "python style preference", "top_k": 3 }}
}}`
      },

      "write_important_memory": {
        func: ({ content }) => {
          if (!content || typeof content !== 'string') return "Error: Content must be a non-empty string.";
          return this.memory_manager.appendImportantMemory(content, this.environment_details.time)
            ? "Success: Memory Archived"
            : "Error: Write Failed";
        },
        description: `## write_important_memory
Purpose: Save high-value, permanent user context (Preferences, Secrets, Milestones).
**Format**: "[Category] Content"

Parameters:
- content: (String)

Usage:
{{
  "thinking": "User is a vegetarian, saving preference.",
  "tool": "write_important_memory",
  "params": {{ "content": "[Diet] User strictly avoids meat products." }}
}}`
      }
    };

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
    this.environment_details.envs = envs.length > 0 ? envs.join("\n") : "[]";
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
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${observation.warning}\n\n`, end: true, chat: this.llm_service.chat });
        return observation.options;
      }
      switch (tool_info.tool) {
        case "display_file":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${output}\n\n`, chat: this.llm_service.chat });
          break;
        case "add_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\n`, chat: this.llm_service.chat });
          break;
        case "record_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\n`, chat: this.llm_service.chat });
          break;
        default:
          break;
      }
      if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_info.tool)) {
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: output, end: false, chat: this.llm_service.chat });
      }
      if (this.state == State.PAUSE) {
        const { question, options } = output;
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: question || "", end: true, chat: this.llm_service.chat });
        return options;
      }
      if (this.state == State.FINAL) {
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: output, end: true, chat: this.llm_service.chat });
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
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${tool_info.thinking}\n\n---\n\n`, chat: this.llm_service.chat });
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
        this.window.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true, chat: this.llm_service.chat });
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
