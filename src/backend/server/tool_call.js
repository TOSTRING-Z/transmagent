const { ReActAgent, State } = require("./agent")
const { utils } = require('../modules/globals')
const { MCPClient } = require('./mcp_client')
const Prompts = require('./prompts');
const os = require('os');
const JSON5 = require("json5");
const MemoryManager = require('../modules/MemoryManager');

const getBaseTools = require('./base_tools');

class ToolCall extends ReActAgent {

  constructor(plugins, tools = {}, llm_service, window, alertWindow, prompt_args = {
    agent_prompt: null,
    mcp_server: true,
    todolist: true,
    subagent: false,
    agent_mode: "transagent",
    tool_format: "prompt"
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

    this.base_tools = getBaseTools(this);

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
    const format = this.prompt_args?.tool_format || "prompt";

    const tool_schemas = [];
    for (let key in this.tools) {
      if (this.tools[key]?.getPrompt) {
        const schemaOrStr = this.tools[key].getPrompt();
        if (typeof schemaOrStr === 'string') {
          tool_schemas.push({ type: "raw_string", content: schemaOrStr });
        } else {
          tool_schemas.push(schemaOrStr);
        }
      }
    }

    if (format === "openai") {
      return tool_schemas.map(schema => {
        if (schema.type === "raw_string" || schema.name === "enter_idle_state") return null;
        return {
          type: "function",
          function: schema
        };
      }).filter(Boolean);
    } else {
      const tool_prompt = [];
      for (const schema of tool_schemas) {
        if (schema.type === "raw_string") {
          tool_prompt.push(schema.content);
        } else {
          let paramsStr = '';
          if (schema.parameters && schema.parameters.properties) {
            for (const [key, prop] of Object.entries(schema.parameters.properties)) {
              const required = schema.parameters.required?.includes(key) ? "(Required)" : "(Optional)";
              paramsStr += `- ${key}: ${required} ${prop.description || ''}
`;
            }
          }

          const exampleParams = {};
          if (schema.parameters && schema.parameters.properties) {
            for (const [key, prop] of Object.entries(schema.parameters.properties)) {
              if (schema.parameters.required?.includes(key)) {
                exampleParams[key] = `[${prop.type} value]`;
              }
            }
          }

          const usageObj = {
            thinking: "[Thinking process]",
            tool: schema.name,
            params: exampleParams
          };
          const usageStr = JSON.stringify(usageObj, null, 2).replace(/\n/g, '\\n');

          const str = `## ${schema.name}
Description: ${schema.description}

Parameters:
${paramsStr}
Usage:
${usageStr}`;
          tool_prompt.push(str);
        }
      }
      return tool_prompt;
    }
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
    const format = this.prompt_args?.tool_format || "prompt";
    const toolsData = this.get_tools_prompt();
    this.system_prompt = this.task_prompt().format({
      system_type: utils.getConfig("tool_call")?.system_type || os.type(),
      system_platform: utils.getConfig("tool_call")?.system_platform || os.platform(),
      system_arch: utils.getConfig("tool_call")?.system_arch || os.arch(),
      tool_prompt: format === "prompt" ? toolsData.join("\n\n") : "",
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
    } else if (tool_info?.thinking) {
      this.window.webContents.send('stream-data', { id: data.id, context_id: this.context_id, content: null, end: true, chat: this.llm_service.chat });
      this.state = State.FINAL;
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
      let tool_info = utils.parseJsonContent(content);
      if (content.startsWith(`{\n  "content"`) && content.endsWith("}")) {
        if (!tool_info) {
          throw new Error("Failed to parse JSON content");
        }
      } else if (this.prompt_args.tool_format === "prompt") {
        tool_info = JSON5.parse(content);
      }
      if (tool_info) {
        if (tool_info?.tool_calls) {
          let call = tool_info.tool_calls[0];
          tool_info = {
            thinking: tool_info.content,
            tool: call?.function.name,
            params: JSON5.parse(call?.function.arguments)
          };
        }
      } else {
        tool_info = {
          thinking: content,
          tool: null,
          params: null
        };
      }
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
    } catch (error) {
      data.output_format = `{
  "tool_call": "",
  "observation": "Tool was not executed.",
  "error": "Function calling is not a pure JSON text, or there is a problem with the JSON format: ${error.message}"
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

    data.tool_format = this.prompt_args?.tool_format || "prompt";
    if (data.tool_format !== "prompt") {
      data.tools = this.get_tools_prompt();
    }
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
