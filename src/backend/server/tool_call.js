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

    const base_tools = {
      "mcp_server": {
        func: async ({ name, args }) => {
          const result = await this.mcp_client.callTool({
            name: name,
            arguments: args
          });
          return result;
        }
      },
      "ask_followup_question": {
        func: async ({ question, options }) => {
          this.state = State.PAUSE;
          return { question, options }
        }
      },
      "waiting_feedback": {
        func: ({ options = ["Allow", "Deny"] }) => {
          this.state = State.PAUSE;
          return { question: "Task paused, waiting for user feedback...", options: options }
        }
      },
      "plan_mode_response": {
        func: async ({ response, options }) => {
          this.state = State.PAUSE;
          return { question: response, options }
        }
      },
      "enter_idle_state": {
        func: async ({ final_answer }) => {
          this.state = State.FINAL;
          // Save to long term memory
          try {
             const messages = this.llm_service.getMessages(false);
             const last_user_msg = messages.filter(m => m.role === 'user').pop();
             if (last_user_msg) {
                 const content = `User: ${last_user_msg.content}\nAgent: ${final_answer}`;
                 await this.memory_manager.addLongTermMemory(
                    Date.now().toString(),
                    content,
                    Date.now()
                 );
             }
          } catch (e) {
             console.error("Error saving memory", e);
          }
          return final_answer;
        }
      },
      "memory_retrieval": {
        func: async ({ query }) => {
          if (!query) return "Please provide a query.";
          const results = await this.memory_manager.queryLongTermMemory(query);
          if (!results || results.length === 0) return "No relevant memories found.";
          return results.map(r => `[${new Date(r.timestamp).toISOString()}] ${r.content}`).join("\n\n");
        }
      },
      "memory_writing": {
        func: ({ content }) => {
            if (!content) return "Content is empty.";
            this.memory_manager.appendImportantMemory(content);
            return "Important information saved to memory.";
        }
      },
      "add_subtasks": {
        func: ({ task, subtasks }) => {
          if (!task) {
            return {
              status: "error",
              message: `Missing task parameter!`
            };
          }
          if (!Array.isArray(subtasks)) {
            subtasks = [subtasks];
          }
          subtasks = subtasks.map(task_description => {
            const subtask = {
              id: this.llm_service.chat.vars.subtask_id,
              description: task_description,
              status: "pending"
            }
            this.llm_service.chat.vars.subtask_id++;
            return subtask;
          });
          //task hash
          const task_id = utils.hashCode(task);
          if (!this.llm_service.chat.vars.tasks[task_id]) {
            this.llm_service.chat.vars.tasks[task_id] = {
              task: task,
              subtasks: subtasks,
            }
          } else {
            this.llm_service.chat.vars.tasks[task_id].subtasks = this.llm_service.chat.vars.tasks[task_id].subtasks.concat(subtasks)
          }
          return {
            status: "success",
            message: `${subtasks.length} subtasks added`
          };
        }
      },
      "record_subtasks": {
        func: ({ subtask_ids, status, reflection, options }) => {
          if (!Array.isArray(subtask_ids)) {
            subtask_ids = [subtask_ids];
          }
          subtask_ids = subtask_ids.map(id => {
            try {
              return parseInt(id);
            } catch {
              return -1;
            }
          });
          for (const task_id in this.llm_service.chat.vars.tasks) {
            if (Object.prototype.hasOwnProperty.call(this.llm_service.chat.vars.tasks, task_id)) {
              this.llm_service.chat.vars.tasks[task_id].subtasks = this.llm_service.chat.vars.tasks[task_id].subtasks.map(subtask => {
                if (subtask_ids.includes(subtask.id)) {
                  subtask.status = status || true;
                  subtask.reflection = reflection;
                }
                return subtask;
              });
            }
          }
          if (this.environment_details.mode === this.modes.ACT) {
            this.state = State.PAUSE;
          }
          return {
            status: "success",
            message: `${subtask_ids.length} subtasks completed`,
            options: options?.length != 0 ? options: ["continue"]
          };
        }
      },
      "search_long_term_memory": {
        func: async ({ query, top_k }) => {
          return await this.memory_manager.queryLongTermMemory(query, top_k);
        }
      },
      "write_important_memory": {
        func: ({ content }) => {
            return this.memory_manager.appendImportantMemory(content) ? "Memory saved" : "Failed to save memory";
        }
      },
    }

    this.tools = { ...tools, ...base_tools }

    this.modes = {
      AUTO: 'Automatic mode',
      ACT: 'Execution mode',
      PLAN: 'Planning mode',
      FLASH: 'Flash mode',
    }

    this.system_prompt;
    this.mcp_prompt;
    this.init_var();

    this.prompts = new Prompts(this);
    this.memory_manager = new MemoryManager(utils);

    this.task_prompt = () => this.prompts.getSystemPrompts();

    this.env_prompt = this.prompts.getEnvPrompts();
  }

  init_var() {
    this.memory_id = 0;
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
      extra_prompt: this.prompts.getExtraPrompt(data.extra_prompt) + "\n\nImportant Memory (User Preferences/Events):\n" + this.memory_manager.getImportantMemory(),
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
      this.llm_service.pushMessage("user", data.query, data.id, this.memory_id++, true, false);
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
      this.llm_service.pushMessage("user", data.output_format, data.id, this.memory_id);
      if (observation?.warning) {
        this.state = State.PAUSE;
        this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: `${observation.warning}\n\n`, end: true });
        return observation.options;
      }
      switch (tool_info.tool) {
        case "display_file":
          this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: `${output}\n\n` });
          break;
        case "add_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\n` });
          break;
        case "record_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: `\`\`\`json\n${JSON.stringify(output, null, 2)}\n\`\`\`\n\n` });
          break;
        default:
          break;
      }
      if (["workflow_planner", "tool_manager", "web_searcher", "chart_plotter", "task_executor", "tool_documentation_collector", "url_summarizer"].includes(tool_info.tool)) {
        this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: output, end: false });
      }
      if (this.state == State.PAUSE) {
        const { question, options } = output;
        this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: question || "", end: true });
        return options;
      }
      if (this.state == State.FINAL) {
        this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: output, end: true });
      } else {
        this.window.webContents.send('info-data', { id: data.id, memory_id: this.memory_id, content: this.get_info(data) });
      }
    }
  }

  async task(data) {
    data.prompt = this.system_prompt;
    const raw_json = await this.llmCall(data);
    console.log(`raw_json: ${raw_json}`);
    data.output_format = utils.extractJson(raw_json) || raw_json;
    this.window.webContents.send('info-data', { id: data.id, memory_id: ++this.memory_id, content: this.get_info(data) });
    this.llm_service.pushMessage("assistant", data.output_format, data.id, this.memory_id);
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
        this.window.webContents.send('stream-data', { id: data.id, memory_id: this.memory_id, content: `${tool_info.thinking}\n\n---\n\n` });
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
      this.llm_service.pushMessage("user", data.output_format, data.id, this.memory_id);
      this.environment_update(data);
      this.window.webContents.send('info-data', { id: data.id, memory_id: this.memory_id, content: this.get_info(data) });
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
      data = { ...data, ...tool_call, step: ++step, memory_id: this.memory_id, react: true };

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
