<video src="./public/video/transmagent.mp4" data-canonical-src="./public/video/transmagent.mp4" controls="controls" muted="muted" class="d-block rounded-bottom-2 border-top width-fit" style="max-height:640px; min-height: 200px"></video>

English | [中文](README_zh.md)

**TransMAgent** is a cross-platform multi-agent transcription regulation analysis system supporting **Windows, macOS, and Linux**. It integrates **enhanced memory mechanisms**, **multi-agent collaboration architecture**, **MCP tool services**, **virtualized secure execution environments**, and **large-scale transcription regulation databases**, providing bioinformatics researchers with an intelligent, all-in-one transcription regulation analysis platform.

[![GitHub](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/TOSTRING-Z/TransMAgent)
[![HuggingFace](https://img.shields.io/badge/HuggingFace-Model-yellow?logo=huggingface)](https://huggingface.co/tostring/Qwen3-SFT-GRPO-8B)
[![Paper](https://img.shields.io/badge/Paper-PDF-red?logo=googlescholar)](https://github.com/TOSTRING-Z/TransMAgent)
[![Documentation](https://img.shields.io/badge/Docs-Documentation-green?logo=readthedocs)](https://github.com/TOSTRING-Z/TransMAgent)
[![Docker](https://img.shields.io/badge/Docker-Image-blue?logo=docker)](https://github.com/TOSTRING-Z/TransMAgent)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)


## ✨ Core Features

### :clipboard: Work Execution Flow

TransMAgent interacts with backend large language models through natural language conversations, offering four working modes: **Auto Mode, Execution Mode, Planning Mode, and Flash Mode**. Users can switch between modes to complete various complex transcription regulation analysis tasks.

**Core Workflow**:
- **Planning Mode**: The agent deeply interacts with the user to gather details like data sources and analysis requirements, generating specific subtask plans.
- **Execution Mode**: The agent automatically thinks and calls appropriate tools based on subtasks, displaying the execution process and results in real-time.
- **Auto Mode**: No user interaction allowed; all problems are automatically attempted to be solved, suitable for fully automated scenarios.
- **Flash Mode**: Quick responses to simple questions.

The system adopts a **Five-Stage Task Flow**: Task Parsing → Task Decomposition → File Validation → Chain Reasoning → Result Summarization, ensuring systematic and complete analysis processes.

### 🧰 BioTools Integration

We provide a general transcription regulation MCP service [BioTools](./biotools), integrating over **30 bioinformatics analysis tools** (e.g., HOMER, DEEptools, ROSE, BETA, TRAPT, etc.).  
The BioTools MCP service uses Docker virtualization and streaming HTTP communication mechanisms for unified cloud and local tool calls, allowing users to quickly extend or customize analysis tools.

**Core Tool Set**:
- `add_subtasks`: Task initialization and decomposition
- `complete_subtasks`: Dynamically update subtask status
- `mcp_server`: Core scheduling interface for calling analysis tools and databases
- `ask_followup_question`: Proactively ask clarifying questions
- `memory_retrieval`: Retrieve historical interaction records
- `enter_idle_state`: Structured task conclusion and summarization

### 🐳 Virtualized Environment
Utilizes **Docker container virtualization technology** to effectively isolate execution environments and prevent system-level command errors.  
All results are saved in user-specified directories, and support **SSH remote command execution** for running compute-intensive analyses on high-performance servers.

### :arrows_clockwise: Agent Working Modes

We integrate three Agent modes for users to choose from:

- **TransAgent**: Default mode, serially schedules tasks and tools, follows "subtask-record-reflection" process

- **MultAgent**: Multi-agent collaboration mode, uses task document-driven division of labor architecture

- **BaseAgent**: Basic mode for general instruction processing

**MultAgent Sub-Agent System**:

| Sub-Agent                       | Function                           |
| ------------------------------- | ---------------------------------- |
| `workflow_planner`              | Analyzes tasks and plans complete workflows |
| `task_executor`                 | Responsible for command execution and result validation |
| `tool_manager`                  | Automatically installs, fixes, updates analysis tools |
| `error_solution_finder`         | Handles programming and package dependency errors |
| `web_searcher` / `url_summarizer` | Automatic web search and webpage information integration |
| `chart_plotter`                 | Generates high-quality charts (supports ggplot2) |

Through this "expert division of labor" structure, the system achieves efficiency and stability in complex analyses.

### 🔄 Agent Behavior Modes

The system provides four behavior modes that users can dynamically switch between:

- **Auto Mode**: Fully automated execution without manual intervention
- **Execution Mode**: Allows interaction and mid-process feedback
- **Planning Mode**: Generates complete analysis plan before execution
- **Quick Response Mode**: Prioritizes answering brief questions

This flexible mode switching supports phased processing and debugging of complex research tasks.

### ⚡ MCP Service Support
TransMAgent supports rapid integration of external **MCP (Model Context Protocol)** tool services through configuration files, enabling **fast plugin-like extensions**, including command-line tools, database query services, and third-party API interfaces.

### 🛠️ Custom Tools
To facilitate users in designing more system-level functionalities, we allow custom tool definitions, including tool calls and tool prompts, to meet personalized analysis needs.

### 🎛️ System/CLI Tool Prompts
We reserve injection interfaces for system and CLI tool prompts. Researchers can easily fine-tune agent behavior by modifying configuration files, enabling rapid tool customization.

### 🧩 User Interaction Controls

Each agent output includes interactive controls:

- 👍 Like: Provide feedback on result quality
- ❌ Delete: Remove redundant or incorrect outputs
- 📍 Locate: Jump to corresponding JSON content
- 🪶 Quote: Extract paragraphs for subsequent analysis

### 🧠 Enhanced Memory Module
To address the "memory loss" problem in long-context tasks, TransMAgent employs a **2D Hybrid Memory Mechanism**:

- **Precise Memory (PM)**: Stores complete content of recent interactions
- **Fuzzy Memory (FM)**: Records long-term thought content and indexes
- **Memory Retrieval Tool**: Can backtrack historical conversation details based on indexes
- **Dynamic Memory Management**: Users can manually enable or disable memory at any step, achieving "atomic-level control"

The system uses a standardized JSON output format to ensure agent output consistency and parsability:
```json
{
  "thinking": "Current step's thought process and tool call rationale",
  "tool": "Called tool name", 
  "params": "Tool call parameters"
}
```

### 🧬 Internal Multi-Omics Annotation Resources
TransMAgent includes a rich transcription regulation resource library:

| Data Type            | Data Sources                                            | Data Scale |
| -------------------- | ------------------------------------------------------- | ---------- |
| Super Enhancers      | SEdb, SEA, dbSuper                                     | 2,678,273 entries |
| Regular Enhancers    | EnhancerAtlas, HACER, ENCODE, FANTOM5, etc.            | 14,797,266 entries |
| eRNA                 | eRNAbase                                               | 10,399,928 entries |
| Common SNPs          | dbSNP                                                  | 37,302,978 entries |
| Risk SNPs            | GWAS Catalog, GWASdb                                   | 351,728 entries |
| eQTL Sites           | GTEx, PancanQTL, seeQTL, etc.                          | 11,995,221 entries |
| Chromatin Accessibility | ATACdb, ENCODE DNase-seq                             | Over 130 million regions |
| 3D Genome Structure  | 4DGenome, 3D Genome Browser                            | 34,342,926 interaction sites |
| DNA Methylation      | ENCODE, TCGA                                           | Over 190 million sites |
| Expression Profiles  | GTEx, TCGA, CCLE, ENCODE                               | Multiple tissues and cancers |

These data are deeply integrated with MCP services, enabling cross-omics annotation and regulatory network reconstruction.

### ⚗️ Model Training and Reinforcement Learning
TransMAgent's underlying large language model is fine-tuned based on **Qwen3-8B** in two stages:

#### Stage 1: Supervised Fine-Tuning
- **Dataset Generation**: Generate high-quality Q/A pairs via API calls to DeepSeek-V3
- **Data Content**: Tool usage instructions + transcription regulation expertise
- **Training Method**: Uses LoRA low-rank adaptation technology, trained in 8*A800 GPU distributed environment
- **Optimization Objective**: Maximum likelihood estimation with sliding window for long contexts

#### Stage 2: Reinforcement Learning Fine-Tuning
- **Dataset Construction**: Filter high-quality trajectory data, use 2D sliding window to simulate real environment
- **Training Method**: Group Relative Policy Optimization (GRPO) method to eliminate length bias
- **Reward Functions**:
  - MCP Tool Validation Reward: Checks parameter completeness and validity
  - Text Similarity Reward: Combines Jaccard, cosine, and edit distance similarities
  - Format Compliance Reward: Ensures standard JSON output

**Reward Function Formula**:
```
Comprehensive Similarity = w1×Jaccard Similarity + w2×Cosine Similarity + w3×Edit Distance Similarity
```

**Optimization Objective**:
```
L_GRPO = -E[Â_{i,t} × log(π_ϕ/π_ref)] + β×D_KL(π_ϕ||π_ref)
```

This method significantly improves model stability and accuracy in complex tool calling and transcription regulation reasoning tasks.

### 🧱 Core Architecture Principles

TransMAgent adopts a **Standardized Task Processing Architecture**:

1. **Task Parsing**: Clarify user requirements, handle ambiguous or vague questions
2. **Task Decomposition**: Use `add_subtasks` to break down complex problems into manageable subtasks
3. **File Validation**: Automatically verify file authenticity and structural integrity
4. **Chain Reasoning**: Call biological toolkits via `mcp_server`, execute system commands via `cli_execute`
5. **Result Summarization**: Generate analysis reports, recommend follow-up questions

Each subtask completion automatically triggers a reflection mechanism to continuously optimize execution logic.

### 💡 Ollama Support
To ensure data security and privacy, the system supports connecting to **Ollama local large models**, enabling completely offline agent reasoning and tool control.

### 📊 Other Features
To meet researchers' one-stop needs, we also integrate:
- Basic conversation functionality
- Chain calling
- Session saving and loading
- Automated dataset review website

## 🎯 Application Examples

- **TransAgent Mode Demo:**

<div align="center">
  <img src="./public/video/BixChat.gif" alt="TransAgent Demo" width="600">
</div>

- **MultAgent Mode Demo:**

<div align="center">
  <img src="./public/video/case.gif" alt="TransAgent Demo" width="600">
</div>

## 📋 System Requirements

- **Windows**: Windows 10 or later
- **Ubuntu**: Ubuntu 18.04 or later
- **macOS**: macOS 10.14 or later

## 🚀 Quick Start

```shell
# Use Node.js 23
nvm use 23

# Install dependencies
npm install

# Start application
npm run start

# Package application
npm run dist
```

> 💡 Due to rapid version iterations, we recommend compiling yourself to experience the latest features.


### 🔧 Agent Parameter Configuration
See [mcp_server](biotools/mcp_server)

### 📦 Tool Dependency Installation
See [plugins](resources/plugins)

### 🤖 Large Model and Software Detailed Configuration
Refer to [Configuration Example](CONFIG.md) for advanced configurations like `Ollama Support`

## 🌐 API Interface

### Print Session List
```bash
curl -X POST http://localhost:3005/chat/list \
  -H "Content-Type: application/json"
```

### Start New Session
```bash
curl -X POST http://localhost:3005/chat/checkout \
  -H "Content-Type: application/json"
```

### Switch Session
```bash
curl -X POST http://localhost:3005/chat/checkout \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "chat-ba0091e2-a942-425d-8783-115d82011781"}'
```

### Switch Mode
```bash
curl -X POST http://localhost:3005/chat/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "auto/act/plan/flash"}'
```

### Submit Query
```bash
curl -X POST http://localhost:3005/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
        {"role": "user", "content": "Hello"}
    ],
    "max_step": 2
  }'
```

## 📞 Contact Us

For any questions, please contact us via:  
📧 Email: [mp798378522@gmail.com](mailto:mp798378522@gmail.com)

<p align="center">
  <em>TransMAgent - Making Transcription Regulation Analysis Simple and Efficient</em>
</p>