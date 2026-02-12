const { ReActAgent, State } = require("./agent")
const { utils } = require('../modules/globals')
const { MCPClient } = require('./mcp_client')
const Prompts = require('./prompts');
const os = require('os');
const MemoryManager = require('../modules/MemoryManager');

// 引入拆分后的模块
const XmlParser = require('./utils/XmlParser');
const { createCoreTools, createTaskTools, createMemoryTools } = require('./tools/index');

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

    this.init_var(); // 初始化变量

    this.prompts = new Prompts(this);
    this.memory_manager = new MemoryManager(utils);

    // === 组装工具 ===
    this.base_tools = {
      ...createCoreTools(this),
      ...createTaskTools(this),
      ...createMemoryTools(this)
    };

    this.tools = { ...tools, ...this.base_tools };

    this.task_prompt = () => this.prompts.getSystemPrompts();
    this.env_prompt = this.prompts.getEnvPrompts();
  }

  init_var() {
    this.context_id = 0;
    this.memory_list = [];
    this.thinking_repetitions = [];
    this.repetitions_delay_empty = 0
    this.system_prompt = null;
    this.mcp_prompt = null;

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
        tool_prompt.push(this.tools[key].getPrompt());
      } else if (this.tools[key]?.description) {
        // 兼容 base_tools 中的直接 description
        tool_prompt.push(this.tools[key].description);
      }
    }
    return tool_prompt;
  }

  async save_long_term_memory(user_content, final_answer) {
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
    this.environment_details.skills = this.prompts.getSkillPrompt();
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

      // 更新：保持 Observation 的结构，但在历史记录中存储 XML/String 表现形式，或者保持对象以便后续处理
      // 这里为了让 LLM 看到结果，我们将 Observation 转回 JSON 字符串（LLM 能读懂 JSON 结果）
      // 或者也可以尝试格式化为 XML 结果，但 JSON 对于结果数据（Data）通常更紧凑
      data.output_format = JSON.stringify(observation, null, 2);
      this.llm_service.pushMessage("user", data.output_format, data.id, this.context_id);

      if (observation?.warning) {
        this.state = State.PAUSE;
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${observation.warning}\n\n`, end: true, chat: this.llm_service.chat });
        return observation.options;
      }

      // 更新：流式输出格式化为 XML 代码块或文本，不再使用 ```json
      const formatOutput = (content) => `\`\`\`json\n${JSON.stringify(content, null, 2)}\n\`\`\`\n\n`; // 工具结果保持 JSON 格式展示给用户比较易读

      switch (tool_info.tool) {
        case "display_file":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${output}\n\n`, chat: this.llm_service.chat });
          break;
        case "add_subtasks":
        case "record_subtasks":
          this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: formatOutput(output), chat: this.llm_service.chat });
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
    const raw_response = await this.llmCall(data);
    console.log(`raw_response: ${raw_response}`);

    // 直接保存原始 XML 响应
    data.output_format = raw_response;

    this.window.webContents.send('info-data', { id: data.id, context_id: ++this.context_id, content: this.get_info(data) });
    this.llm_service.pushMessage("assistant", data.output_format, data.id, this.context_id);
    return this.get_tool(data.output_format, data);
  }

  get_tool(content, data) {
    try {
      // === 使用 XmlParser 模块 ===
      const { thinking, toolName, params } = XmlParser.parseResponse(content);

      if (toolName) {
        const tool_info = {
          thinking: thinking,
          tool: toolName,
          params: params
        };

        // 统计重复思考逻辑
        this.handleThinkingRepetitions(tool_info.thinking);

        // 流式输出
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${tool_info.thinking}\n\n---\n\n`, chat: this.llm_service.chat });
        return tool_info;
      } else if (thinking) {
        this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: `${thinking}\n\n`, chat: this.llm_service.chat });
        return null;
      } else {
        throw new Error("Could not parse <thinking> or <tool_call> tags.");
      }

    } catch (error) {
      console.log(error);
      data.output_format = JSON.stringify({
        "tool_call": null,
        "observation": "Tool was not executed.",
        "error": "Invalid XML format. Ensure you use <root>, <thinking>, and <tool_call> tags."
      }, null, 2);
      this.llm_service.setTag(false);
      this.llm_service.pushMessage("user", data.output_format, data.id, this.context_id);
      this.environment_update(data);
      this.window.webContents.send('info-data', { id: data.id, context_id: this.context_id, content: this.get_info(data) });
    }
  }

  handleThinkingRepetitions(thinking) {
    if (this.thinking_repetitions.length === 0 || this.thinking_repetitions[0] === thinking) {
      this.thinking_repetitions.push(thinking);
    } else {
      this.repetitions_delay_empty += 1
      if (this.repetitions_delay_empty >= (utils.getConfig("tool_call")?.repetitions_delay_empty || 2)) {
        this.thinking_repetitions.length = 0;
        this.repetitions_delay_empty = 0;
      }
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

  /* 功能：ReAct agent 方式调用流程 */
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