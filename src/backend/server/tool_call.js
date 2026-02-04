const { ReActAgent, State } = require("./agent")
const { utils } = require('../modules/globals')
const { MCPClient } = require('./mcp_client')
const fs = require('fs');
const os = require('os');
const JSON5 = require("json5");

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

    this.cli_prompt = () => {
      if (this.prompt_args.agent_mode === "transagent") {
        const cli_prompt_path = utils.getConfig("tool_call").cli_prompt || utils.getDefault("cli_prompt.md");
        const cli_prompt = fs.readFileSync(cli_prompt_path, 'utf-8');
        return cli_prompt;
      }
      return "";
    };


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
        func: ({ final_answer }) => {
          this.state = State.FINAL;
          return final_answer;
        }
      },
      "memory_retrieval": {
        func: ({ memory_id }) => {
          const memory = this.llm_service.getMessages(true).filter(m => m.memory_id === memory_id).map(m => { return { role: m.role, content: m.content } });
          return memory || "No memory ID found";
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

    this.task_prompt = () => `${this.prompt_args.agent_prompt || (this.prompt_args.agent_mode === "multagent" ? `You are TransMAgent, an intelligent bioinformatics and programming assistant that coordinates specialized sub-agents to efficiently solve complex tasks.

**Emphasis**:
All agent tools do not have any context information. Please provide detailed existing results in the task description (such as analysis result files, conclusions, and existing problems) or information provided by the user (such as the user's original goals and prepared data.` : `You are TransMAgent, an all-around AI assistant designed to solve any tasks proposed by users. You can use various tools to efficiently complete complex requests.`)}

You should strictly follow the entire process of thinking first, then acting, and then observing:
1. Thinking: Describe your thought process or plan to solve this problem
2. Action: Based on your thinking, determine the tools needed to be called
3. Observation: Analyze the results of the action and incorporate them into your thinking

Tool usage instructions:
You can access and use a series of tools according to the user's approval. Only one tool can be used in each message, and you will receive the execution result of the tool in the user's response. You need to gradually use tools to complete the given task, and each use of the tool should be adjusted based on the results of the previous tool. 

**Protocol**: Both Thinking and Action phases require exhaustive detail, innovative approaches, and cross-domain thinking. Maintain strict phase separation while ensuring iterative feedback loops.
${this.prompt_args.todolist && this.environment_details.mode !== this.modes.FLASH ? `
When handling complex tasks, the following steps should be followed:
1. ${this.prompt_args.agent_mode === "multagent" ? "Use workflow_planner to obtain the tool list and task process." : "Analyze user tasks and design workflow steps using Mermaid syntax."}
2. Break down the task into smaller subtasks and use the \`add_subtasks\` tool to add them.
3. Immediately call the \`record_subtasks\` tool after completing each subtask-this step is critical for:
   - Maintaining task continuity
   - Preventing memory oversights
   - Ensuring no step is accidentally skipped
   - Creating traceable progress records
   - Reflect on the current task
4. Do not proceed to the next subtask without confirming completion via \`record_subtasks\`` : ""}
${!this.prompt_args.subagent && this.prompt_args.todolist && this.environment_details.mode !== this.modes.FLASH ? "5. The final subtask of all task breakdowns must be: **Summarize workflow steps using Mermaid syntax.**." : this.prompt_args.agent_mode === "multagent" ? "**Important**: Before executing any task, you should use workflow_planner to obtain the tool list and task process." : ""}

====

# Tool usage format:

## Output format:

Tool usage adopts the format of pure JSON content, prohibiting the use of any Markdown code block tags (including \`\`\`json or \`\`\`), and should not contain additional explanations, comments, or non-JSON text. The following is a structural example:

{{
  "thinking": "[Thinking process]",
  "tool": "[Tool name]",
  "params": {{
    "[parameter1_name]": "[value1]",
    "[parameter2_name]": "[value2]",
    ...
  }}
}}

Please always follow this format to ensure the tool can be correctly parsed and executed.

====

# Core Tools:
${this.prompt_args.todolist && this.environment_details.mode !== this.modes.FLASH ? `
## add_subtasks
Description: Add a new subtask to the current task. This tool is used to break down complex tasks into manageable subtasks, allowing for better organization and tracking of progress. It is essential for maintaining clarity and focus on the main task by defining specific actions that need to be completed.

Parameters:
- task: (Required) Description of the main task
- subtasks: (Required) Discription of the subtask

Usage Example:
{{
  "thinking": "User requested to create a new project, need to break down into subtasks",
  "tool": "add_subtasks",
  "params": {{
    "task": "Create a new project",
    "subtasks": [
      "Design project architecture", 
      "Create database schema", 
      "Implement API endpoints",
      ...
    ]
  }}
}}

## record_subtasks
Description: Record the completion status and reflection content of subtasks.

Parameters:
- subtask_ids: (Required) A single task ID or an array of subtask IDs to be marked as completed
- status: Completion status (true/false, bool, optional, defaults to true)
- reflection: (Required) Reflect on whether the current task was fully completed, whether the tool usage was optimal, and how to improve (within 100 characters)
${this.environment_details.mode === this.modes.ACT ? `- options: (Required) Provide the user with 2-5 options to choose from. Each option should be a string describing a possible answer. You do not always need to provide options, but in many cases, this can help the user avoid manually entering a response.` : ""}

Usage Example:
{{
  "thinking": "[Thinking process]",
  "tool": "record_subtasks",
  "params": {{
    "subtask_ids": [
      0, 
      1,
      ...
    ],
    "status": [boolean or string],
    "reflection": "Reflection content"${this.environment_details.mode === this.modes.ACT ? `,
    "options": [
      "Option 1",
      "Option 2",
      ...
    ]`: ""}
  }}
}}
`: ""}
${!this.prompt_args.subagent && this.environment_details.mode === this.modes.ACT ? `
## ask_followup_question
Description: Ask the user questions to collect additional information needed to complete the task. It should be used when encountering ambiguity, needing clarification, or requiring more details to proceed effectively. It achieves interactive problem-solving by allowing direct communication with the user. Use this tool wisely to balance between collecting necessary information and avoiding excessive back-and-forth communication.

Parameters:
- question: (Required) The question to ask the user. This should be a clear and specific question targeting the information you need.
- options: (Optional) Provide the user with 2-5 options to choose from. Each option should be a string describing a possible answer. You do not always need to provide options, but in many cases, this can help the user avoid manually entering a response.

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
}}
`: ""}
${!this.prompt_args.subagent && this.environment_details.mode !== this.modes.FLASH && this.environment_details.mode !== this.modes.AUTO ? `
## waiting_feedback
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
}}
${this.environment_details.mode === this.modes.PLAN ? `
## plan_mode_response
Description: Respond to user inquiries to plan solutions for user tasks. This tool should be used when you need to respond to user questions or statements about how to complete a task. This tool is only available in "planning mode". The environment details will specify the current mode; if it is not "planning mode", this tool should not be used. Depending on the user's message, you may ask questions to clarify the user's request, design a solution for the task, and brainstorm with the user. For example, if the user's task is to create a website, you can start by asking some clarifying questions, then propose a detailed plan based on the context, explain how you will complete the task, and possibly engage in back-and-forth discussions until the user switches you to another mode to implement the solution before finalizing the details.

Parameters:
response: (Required) The response provided to the user after the thinking process.
options: (Optional) An array containing 2-5 options for the user to choose from. Each option should describe a possible choice or a forward path in the planning process. This can help guide the discussion and make it easier for the user to provide input on key decisions. You may not always need to provide options, but in many cases, this can save the user time from manually entering a response. Do not provide options to switch modes, as there is no need for you to guide the user's operations.

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
}}
`: ""}
## memory_retrieval
Core Function: Query historical interactions by memory_id

Typical Scenarios:
1. Review analysis steps
2. Verify historical discussions
3. Resume previous work

Parameters:
- memory_id: (Required)
  - Type: Integer
  - Values: Numeric IDs from Memory List
  - Example: 42

Usage Example:
{{
  "thinking": "Need to confirm previous discussion about X",
  "tool": "memory_retrieval",
  "params": {{
    "memory_id": 24
  }}
}}` : ""}

## enter_idle_state  
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
}}

${this.prompt_args.mcp_server ? `## mcp_server
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
`: ""}
====

# Base Tools:

{tool_prompt}
${!this.prompt_args.subagent && this.prompt_args.agent_mode === "transagent" ? `
====

# Available Bash Tools:

**Important**: All Bash tools MUST be called using the Base Tool \`cli_execute\`

{cli_prompt}
`: ""}
====
${this.prompt_args.mcp_server ? `
# Available MCP Services

**Important**: All MCP services MUST be called using the Core Tool \`mcp_server\`

{mcp_prompt}
`: ""}
${!this.prompt_args.subagent && this.environment_details.mode !== this.modes.FLASH ? `
====

{extra_prompt}

====

# Operation Modes

## 🔄 Automatic Mode
- **Cannot use**: Planning/feedback tools
- **Behavior**: Fully autonomous execution
- **Completion**: Use \`enter_idle_state\` to show results

## ⚙️ Execution Mode
- **Cannot use**: Planning tools
- **Behavior**: Interactive execution with confirmations
- **Completion**: Use \`enter_idle_state\` to show results

## 📋 Planning Mode
- **Can only use**: \`plan_mode_response\` + read tools
- **Purpose**: Information gathering & solution design
- **Workflow**:
  1. Collect context and requirements
  2. View file/directory contents as needed
  3. Develop detailed plan
  4. Get user approval
  5. Switch to execution/auto mode

## Mode Switching
- To Planning: Stop current tasks, start planning
- From Planning: Implement approved solution

====

# Task Execution Framework

## 1. Operation Modes
- **Auto Mode**: Full automation, disables confirmation tools  
- **Exec Mode**: Interactive execution with step confirmations  
- **Plan Mode**: Info gathering & solution design only  

## 2. Workflow
- Task Processing:
  Analyze → Break down → Create subtasks (using \`add_subtasks\`)
- Subtask Execution:
  Execution Loop (Thinking→Action→Observation) → Mark complete (using \`record_subtasks\`)

## 3. Core Tools
- \`add_subtasks\`: When task requires >3 steps  
- \`record_subtasks\`: Mandatory after each milestone  

## 4. Completion Criteria
✓ All subtasks marked complete  
✓ Results pass validation checks  
✓ Includes execution summary & quality metrics  

## 5. Key Rules
✔️ Single objective per subtask  
✔️ Maintain full audit trail  
✖️ Never mix tools across modes  
✖️ Never skip result validation  

===

# Memory List Guide

## Basics
- Each chat creates a unique \`memory_id\`
- All \`memory_id\`s form your conversation history
- Acts as our "chat memory bank"

## When to Use
🔍 **Check past steps**: Review previous analysis
📝 **Verify history**: When questions relate to earlier chats
🔎 **Confirm details**: Check past tool parameters/results
♻️ **Before repeating**: Always check prior tool results first

===

# Mermaid Workflow Rules

## 1. Rule Definition
- **Name each rule** clearly (e.g., \`Validate Input\`)
- **Components per rule**:
  - 🟢 Input: Required data/triggers 
  - 🟡 Output: Produced results
  - 🔵 Action: Core logic (1-2 sentences)
  - 🔴 Errors: Fallback actions (optional)

## 2. Dependency Mapping
- Specify: 
  - \`Rule A → Rule B\` (output→input)
  - \`Rule X completes → triggers Rule Y\`

## 3. Mermaid Output Requirements
\`\`\`mermaid
graph TD
    Start --> Rule1[[Descriptive Name]]
    Rule1 -->|output: data| Rule2
    Rule2 -->{{Condition?}}
    {{Condition?}} -->|Yes| Rule3
    {{Condition?}} -->|No| Rule4
    Rule3 & Rule4 --> End
\`\`\`

====
` : ""}
# Environment Details Explanation
- Language: The type of language the assistant needs to use to reply to messages
- Current time: Current system time
- Temporary folder: The location where temporary files are stored during the execution process
${!this.prompt_args.subagent ? `- Current mode: The current mode (automatic mode / execution mode / planning mode/ flash mode)` : ""}
====

# System Information
- Operating system type: {system_type}
- Operating system platform: {system_platform}
- CPU architecture: {system_arch}

====

# Memory List:
{memory_list}
`
    this.env = `# Environment details
- Language: Please answer using {language}
- Current time: {time}
- Temporary folder: {tmpdir}
${!this.prompt_args.subagent ? `- Current mode: {mode}
{envs}` : ""}
${this.prompt_args.todolist ? `
# TodoList
{todolist}
` : ""}`
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

  get_extra_prompt(extra_prompt = null) {
    try {
      extra_prompt = extra_prompt || utils.getSystem(`system_prompts/${this.prompt_args.agent_mode}.md`);
      if (fs.existsSync(extra_prompt)) {
        // eslint-disable-next-line no-undef
        return fs.readFileSync(extra_prompt, 'utf-8');
      }
      return "";
    } catch (error) {
      console.log(error.message);
      this.alertWindow.create({ type: "error", content: `[ToolCall.get_extra_prompt]: ${error.message}` });
      return "";
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
      cli_prompt: this.cli_prompt(),
      extra_prompt: this.get_extra_prompt(data.extra_prompt),
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
    data.env_message = utils.getConfig("tool_call")?.env_message ? this.llm_service.envMessage(this.env.format(this.environment_details)) : null;
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
