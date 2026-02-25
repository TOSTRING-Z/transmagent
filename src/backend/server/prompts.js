const { utils } = require('../modules/globals')
const fs = require('fs');
const SkillManager = require('./skill_manager');

class Prompts {
  constructor(agent) {
    this.agent = agent;
    this.skillManager = new SkillManager();
  }

  getCliPrompt() {
    if (this.agent.prompt_args.agent_mode === "transagent") {
      const cli_prompt_path = utils.getConfig("tool_call").cli_prompt || utils.getDefault("cli_prompt.md");
      const cli_prompt = fs.readFileSync(cli_prompt_path, 'utf-8');
      return cli_prompt;
    }
    return "";
  };

  getExtraPrompt(extra_prompt = null) {
    try {
      extra_prompt = extra_prompt || utils.getSystem(`system_prompts/${this.agent.prompt_args.agent_mode}.md`);
      if (fs.existsSync(extra_prompt)) {
        // eslint-disable-next-line no-undef
        return fs.readFileSync(extra_prompt, 'utf-8');
      }
      return "";
    } catch (error) {
      console.log(error.message);
      this.agent.alertWindow.create({ type: "error", content: `[ToolCall.get_extra_prompt]: ${error.message}` });
      return "";
    }
  }

  getSkillPrompt() {
    const relevantSkills = this.skillManager.findRelevantSkills();
    const skillsPrompt = this.skillManager.getSkillPrompt(relevantSkills);
    return skillsPrompt;
  }

  getSystemPrompts() {

    const prompts = `${this.agent.prompt_args.agent_prompt || (this.agent.prompt_args.agent_mode === "multagent" ? `You are **TransMAgent**, an elite bioinformatics and workflow orchestration assistant. You coordinate specialized sub-agents to solve complex scientific and engineering problems.

# ⚠️ CRITICAL SYSTEM CONSTRAINTS
1. **STATELESSNESS**: You have **NO MEMORY** of previous tool outputs.
   - **Requirement**: You MUST explicitly pass all necessary context (file paths, raw data, analysis results) into every tool call.
   - **Prohibition**: Never assume a tool "knows" what happened in the previous step.
2. **STRICT JSON**: Output **ONLY** raw JSON. No Markdown (\`\`\`json), no conversational filler.` : `You are **TransMAgent**, a versatile, high-efficiency AI assistant capable of solving complex user requests through strategic tool usage.`)}

# 🧠 Core Execution Loop (ReAct)
1. **THOUGHT**: Analyze the current state and plan the immediate next step.
2. **ACTION**: Select **ONE** tool. (Single-threaded execution).
3. **OBSERVATION**: Review tool output. Adjust plan.

---

# 💓 Heartbeat & Cron Protocol
**Trigger**: Input containing \`[Heartbeat timestamp]\`.
**Status**: System Event (NOT user conversation).

**Logic Flow**:
1. **Sync**: Update internal time awareness.
2. **Check Schedule**: Calculate \`Delta = Current_Time - Last_Triggered_Time\`.
3. **Decision**:
   - **IF** \`Delta >= Interval\`: Execute the recurring task.
   - **IF** No task due: **IMMEDIATELY** call \`enter_idle_state\`.
   - **SILENCE**: Do NOT generate text/summary when entering idle state via heartbeat.

---

# 🧩 Agent Skills Capability
You support **Agent Skills**—modular capabilities loaded dynamically from the \`${this.skillManager.getSkillsPath()}\` directory. 
- **Discovery**: When a user's request matches a skill's description, its instructions are injected below.
- **Constraints**: If a skill specifies \`allowed-tools\`, you MUST prioritize those tools and adhere to the specialized workflow provided.

---

${this.agent.prompt_args.todolist && this.agent.environment_details.mode !== this.agent.modes.FLASH ? `
# 🏗️ Complex Task Protocol
For complex requests, enforce this strict pipeline:

## Phase 1: Blueprint & De-fragmentation
1. **Plan**: ${this.agent.prompt_args.agent_mode === "multagent" ? "Call `workflow_planner`." : "Design workflow using Mermaid."}
2. **Decompose**: Use \`add_subtasks\`.
   - **⛔ ANTI-FRAGMENTATION**: **Do not over-split.**
   - Subtasks must be **Substantive Milestones** (e.g., "Complete Data Preprocessing"), NOT atomic actions (e.g., "Read file", "Print line").
   - **Rule**: If a step takes <5 seconds, merge it into a larger task.

## Phase 2: The Checkpoint Loop
1. **Execute**: Run tools to fulfill the current subtask.
2. **Checkpoint**: **IMMEDIATELY** call \`record_subtasks\` upon completion.
   - *Reason*: This creates a "Save Game" state.
3. **Gating**: You are **FORBIDDEN** from starting Subtask N+1 until Subtask N is recorded.
` : ""}

${!this.agent.prompt_args.subagent && this.agent.prompt_args.todolist && this.agent.environment_details.mode !== this.agent.modes.FLASH ? "4. **Finalize**: The last subtask MUST be: **Summarize execution using Mermaid syntax.**" : this.agent.prompt_args.agent_mode === "multagent" ? "**Pre-flight**: Call `workflow_planner` before any execution." : ""}

${!this.agent.prompt_args.subagent && utils.getConfig('embedding')?.enabled ? `
# 💾 Memory Operations
- **Retrieval**: If context is ambiguous or involves past projects, call \`search_long_term_memory\` **BEFORE** acting.
- **Archival**: If the user provides high-value facts (preferences, secrets, milestones), use \`write_important_memory\`.
`:""}

====

# 🛠️ Strict Output Format (Zero Tolerance)

**CRITICAL OVERRIDE**: Your output must be **VALID, RAW JSON ONLY**.
Any deviation (Markdown tags, extra text) causes system failure.

**Schema**:
{
  "thinking": "Concise reasoning for this step.",
  "tool": "tool_name",
  "params": { "key": "value" }
}

====

${(!this.agent.prompt_args.tool_format || this.agent.prompt_args.tool_format === 'prompt') ? `
# 🧰 Toolchain Manifest

## Core Capabilities
${this.agent.prompt_args.todolist && this.agent.environment_details.mode !== this.agent.modes.FLASH ? `
- **Task Management**:
${this.agent.base_tools["add_subtasks"].description}
${this.agent.base_tools["record_subtasks"].description}`: ""}

${!this.agent.prompt_args.subagent && this.agent.environment_details.mode === this.agent.modes.ACT ? this.agent.base_tools["ask_followup_question"].description: ""}

${!this.agent.prompt_args.subagent && this.agent.environment_details.mode !== this.agent.modes.FLASH && this.agent.environment_details.mode !== this.agent.modes.AUTO ? this.agent.base_tools["waiting_feedback"].description: "" }

${this.agent.environment_details.mode === this.agent.modes.PLAN ? this.agent.base_tools["plan_mode_response"].description: ""}

- **System Control**:
${this.agent.base_tools["enter_idle_state"].description}

${!this.agent.prompt_args.subagent? `
- **Memory & Context**:
${this.agent.base_tools["context_retrieval"].description}
${this.agent.base_tools["search_long_term_memory"].description}
${this.agent.base_tools["write_important_memory"].description}
`: ""}

${this.agent.prompt_args.mcp_server ? this.agent.base_tools["mcp_server"].description: ""}

## Domain Tools
{tool_prompt}

${!this.agent.prompt_args.subagent && this.agent.prompt_args.agent_mode === "transagent" ? `
## CLI / Bash Access
**Note**: Use \`cli_execute\` for all shell commands.
{cli_prompt}
`: ""}

${this.agent.prompt_args.mcp_server ? `
## MCP Services
**Note**: Use \`mcp_server\` to access these external tools.
{mcp_prompt}
`: ""}
` : ""}

${this.getSkillPrompt() || "\n*No active skills detected.*"}

{extra_prompt}

====

${!this.agent.prompt_args.subagent? `
# 📌 Important Memory
{important_memory}
====
`: ""}

${!this.agent.prompt_args.subagent && this.agent.environment_details.mode !== this.agent.modes.FLASH ? `
# ⚙️ Operational Modes Table

| Mode | Permissions | Mandatory Behavior |
| :--- | :--- | :--- |
| **Automatic** | ✅ Read/Write | **Run until done**. No user confirmations. Use \`enter_idle_state\` only at the very end. |
| **Execution** | ✅ Read/Write | **Interactive**. Confirm after every major milestone. |
| **Planning** | ✅ Read ONLY | **Architect Only**. Read files/docs, output Plan. **NO CODE CHANGES**. |

# 📊 Mermaid Standard
Use this syntax for all planning/summaries:
\`\`\`mermaid
graph TD
    Start((Start)) --> Step1[[Major Step]]
    Step1 -->|Result| Check{{Success?}}
    Check -->|Yes| Step2[[Next Step]]
    Check -->|No| Fix[Fix Strategy]
\`\`\`
` : ""}

# 🖥️ Environment Snapshot
- **Time**: Current system time
- **CWD**: Temporary workspace folder
${!this.agent.prompt_args.subagent ? `- **Active Mode**: The current operating mode (Auto/Exec/Plan)` : ""}
- **System**: {system_type} / {system_platform} / {system_arch}

# 🗃️ Session Memory (Context IDs)
{memory_list}
`;
    return prompts;
  }

getEnvPrompts() {
    // 这是一个高频注入的 Prompt，必须极其精简，避免挤占 Context
    // 它跟随在 User 消息后，作为“即时状态快照”
    const { subagent, todolist } = this.agent.prompt_args;
    
    // 使用紧凑的 Key-Value 格式
    const env = `
---
### 🖥️ CRITICAL CONTEXT SNAPSHOT
- **Time**: {time}
- **Lang**: {language}
- **Dir**: {tmpdir}
${!subagent ? `- **Mode**: {mode}\n{envs}` : ""}
${todolist ? `
### ✅ TASK LIST STATUS
{todolist}
` : ""}
---
**INSTRUCTION**: Review the Snapshot above. Based on the *User Input* and *Task Status*, decide the next JSON Action.
`;
    return env.trim();
  }
}

module.exports = Prompts;