<div align="center">
  <video src="./public/video/transmagent.mp4" data-canonical-src="./public/video/transmagent.mp4" controls="controls" muted="muted" class="d-block rounded-bottom-2 border-top width-fit" style="max-height:640px; min-height: 200px"></video>
</div>

[English](README.md) | 中文

**TransMAgent** 是一款跨平台的多智能体转录调控分析系统，支持 **Windows、macOS 与 Linux**。它集成**增强记忆机制**、**多智能体协作体系**、**MCP 工具服务**、**虚拟化安全执行环境**以及**大规模转录调控数据库**，为生物信息学研究人员提供一体化的智能化转录调控分析平台。

<div align="center">

  [![GitHub](https://img.shields.io/badge/GitHub-Repository-blue?logo=github)](https://github.com/TOSTRING-Z/TransMAgent)
  [![HuggingFace](https://img.shields.io/badge/HuggingFace-Model-yellow?logo=huggingface)](https://huggingface.co/tostring/Qwen3-SFT-GRPO-8B)
  [![Paper](https://img.shields.io/badge/Paper-PDF-red?logo=googlescholar)](https://github.com/TOSTRING-Z/TransMAgent)
  [![Documentation](https://img.shields.io/badge/Docs-Documentation-green?logo=readthedocs)](https://github.com/TOSTRING-Z/TransMAgent)
  [![Docker](https://img.shields.io/badge/Docker-Image-blue?logo=docker)](https://github.com/TOSTRING-Z/TransMAgent)
  [![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

</div>


## ✨ 核心特性

### :clipboard: 工作执行流

TransMAgent 通过自然语言对话的方式与后端大语言模型进行定制化交互，提供4种工作模式：**自动模式、执行模式、规划模式和Flash模式**。用户可以在不同模式间切换以完成各种复杂转录调控分析任务。

**核心工作流程**：
- **规划模式**：智能体与用户深入交互，收集数据来源、分析需求等细节信息，生成具体子任务计划
- **执行模式**：智能体自动根据子任务进行思考和调用合适工具，实时展示执行过程和结果
- **自动模式**：禁止与用户交互，所有问题自动尝试解决，适合完全自动控制场景
- **Flash模式**：快速响应简单问题

系统采用**五阶段任务流**：任务解析 → 任务分解 → 文件验证 → 链式推理 → 结果总结，确保分析过程的系统性和完整性。

### 🧰 BioTools 集成

我们提供了一个通用的转录调控 MCP 服务 [BioTools](./biotools)，其中集成了超过 **30 种生物信息学分析工具**（如 HOMER、DEEptools、ROSE、BETA、TRAPT 等）。  
BioTools MCP 服务通过 Docker 虚拟化与 流式HTTP 通信机制实现云端与本地统一调用，用户可快速拓展或自定义分析工具。

**核心工具集合**：
- `add_subtasks`：任务初始化与分解
- `complete_subtasks`：动态更新子任务状态
- `mcp_server`：核心调度接口，调用分析工具与数据库
- `ask_followup_question`：主动发起问题澄清
- `memory_retrieval`：检索历史交互记录
- `enter_idle_state`：任务结构化收束与总结

### 🐳 虚拟化环境
采用 **Docker 虚拟化容器技术**，有效隔离执行环境，防止系统级命令误操作。  
所有结果保存在用户指定目录中，并支持通过 **SSH 远程执行命令**，在高性能服务器上运行计算密集型分析。

### :arrows_clockwise: 智能体工作模式

我们集成了三种Agent模式供用户选择：

- **TransAgent**：默认模式，串行调度任务与工具，遵循"子任务-记录-反思"流程

- **MultAgent**：多智能体协作模式，通过任务文档驱动的分工协作架构

- **BaseAgent**：基础模式，用于通用指令处理

**MultAgent子智能体系统**：

| 子智能体                          | 功能                           |
| --------------------------------- | ------------------------------ |
| `workflow_planner`                | 分析任务并规划完整流程         |
| `task_executor`                   | 负责命令执行与结果验证         |
| `tool_manager`                    | 自动安装、修复、更新分析工具   |
| `error_solution_finder`           | 处理编程与包依赖错误           |
| `web_searcher` / `url_summarizer` | 自动联网搜索与网页信息整合     |
| `chart_plotter`                   | 生成高质量图表（支持 ggplot2） |

通过这种"专家式分工"结构，系统在复杂分析中实现高效与稳定。

### 🔄 智能体行为模式

系统提供四种行为模式，用户可动态切换：

- **自动模式**：全流程自动执行，无需人工干预  
- **执行模式**：允许交互与中途反馈  
- **规划模式**：生成完整分析计划后再执行  
- **快速响应模式**：优先回答简短问题  

这种灵活的模式切换支持复杂科研任务的分阶段处理与调试。

### ⚡ MCP 服务支持
TransMAgent 支持通过配置文件快速接入外部 **MCP（Model Context Protocol）** 工具服务，  
可实现 **快速插件化拓展**，包括命令行工具、数据库查询服务与第三方 API 接口。

### 🛠️ 自定义工具
为方便用户设计更多系统级功能，我们允许用户自定义工具，包括工具调用和工具提示，满足个性化分析需求。

### 🎛️ 系统/CLI 工具提示
我们为系统和 CLI 工具提示预留了注入接口，研究人员只需修改配置文件即可轻松微调智能体行为，快速定制工具。

###  🧩 用户交互控件

每条智能体输出旁均提供交互控件：

- 👍 点赞：反馈结果质量  
- ❌ 删除：移除冗余或错误输出  
- 📍 定位：跳转到对应 JSON 内容  
- 🪶 引用：提取段落用于后续分析  

### 🧠 增强记忆模块
为解决长上下文任务中的"记忆丢失"问题，TransMAgent采用 **2D混合记忆机制**：

- **精确记忆（PM）**：保存最近交互的完整内容
- **模糊记忆（FM）**：记录长期的思考内容与索引
- **记忆检索工具**：可根据索引回溯历史对话细节
- **动态记忆管理**：用户可在任意步骤手动开启或关闭记忆，实现"原子级控制"

系统采用标准化JSON输出格式，确保智能体输出的规范性和可解析性：
```json
{
  "thinking": "当前步的思考过程和工具调用理由",
  "tool": "调用的工具名称", 
  "params": "工具调用参数"
}
```

### 🧬 内部多组学注释资源
TransMAgent 内置了丰富的转录调控资源库：

| 数据类型            | 数据来源                                            | 数据规模 |
| ------------------- | --------------------------------------------------- | -------- |
| 超级增强子          | SEdb, SEA, dbSuper                                 | 2,678,273个 |
| 普通增强子          | EnhancerAtlas, HACER, ENCODE, FANTOM5等            | 14,797,266个 |
| eRNA                | eRNAbase                                           | 10,399,928个 |
| 常见SNP             | dbSNP                                              | 37,302,978个 |
| 风险SNP             | GWAS Catalog, GWASdb                               | 351,728个 |
| eQTL位点            | GTEx, PancanQTL, seeQTL等                          | 11,995,221个 |
| 染色质开放性        | ATACdb, ENCODE DNase-seq                           | 超过1.3亿区域 |
| 三维基因组结构      | 4DGenome, 3D Genome Browser                        | 34,342,926个互作位点 |
| DNA甲基化           | ENCODE, TCGA                                       | 超过1.9亿位点 |
| 表达谱              | GTEx, TCGA, CCLE, ENCODE                           | 多组织多癌症 |

这些数据与 MCP 服务深度结合，可实现跨组学注释与调控网络重建。

### ⚗️ 模型训练与强化学习
TransMAgent 的底层大语言模型基于 **Qwen3-8B** 进行两阶段微调：

#### 第一阶段：监督微调
- **数据集生成**：通过API调用DeepSeek-V3生成高质量的Q/A问答对
- **数据内容**：工具使用说明 + 转录调控专业知识
- **训练方法**：采用LoRA低秩适配器技术，在8*A800 GPU分布式环境中训练
- **优化目标**：最大似然估计，采用滑动窗口处理长上下文

#### 第二阶段：强化学习微调
- **数据集构建**：筛选高质量轨迹数据，采用2D滑动窗口模拟真实环境
- **训练方法**：分组策略优化（GRPO）方法，消除长度偏差
- **奖励函数**：
  - MCP工具验证奖励：检查参数完整性和有效性
  - 文本相似度奖励：结合Jaccard、余弦和编辑距离相似度
  - 格式规范奖励：确保标准JSON输出

**奖励函数公式**：
```
综合相似度 = w1×Jaccard相似度 + w2×余弦相似度 + w3×编辑距离相似度
```

**优化目标**：
```
L_GRPO = -E[Â_{i,t} × log(π_ϕ/π_ref)] + β×D_KL(π_ϕ||π_ref)
```

该方法显著提升了模型在复杂工具调用与转录调控推理任务中的稳定性与准确性。

### 🧱 核心架构原理

TransMAgent 采用 **标准化任务处理架构**：

1. **任务解析**：明确用户需求，处理模糊或歧义问题
2. **任务分解**：使用`add_subtasks`将复杂问题拆解为可管理子任务
3. **文件验证**：自动检验文件真实性和结构完整性
4. **链式推理**：通过`mcp_server`调用生物学工具包，`cli_execute`执行系统命令
5. **结果总结**：生成分析报告，推荐后续问题

每个子任务完成后自动触发反思机制，持续优化执行逻辑。

### 💡 Ollama 支持
为确保数据安全与隐私，系统支持连接 **Ollama 本地大模型**，实现完全离线的智能体推理与工具控制。

---
### 📊 其他功能
为满足研究人员的一站式需求，我们还集成了：
- 基础对话功能
- 链式调用
- 会话保存与加载
- 自动化数据集审阅网站

## 🎯 应用示例

- **TransAgent模式运行展示：**

<div align="center">
  <img src="./public/video/BixChat.gif" alt="TransAgent Demo" width="600">
</div>

- **MultAgent模式运行展示：**

<div align="center">
  <img src="./public/video/case.gif" alt="TransAgent Demo" width="600">
</div>

## 📋 系统要求

- **Windows**: Windows 10 或更高版本
- **Ubuntu**: Ubuntu 18.04 或更高版本
- **macOS**: macOS 10.14 或更高版本

## 🚀 快速开始

```shell
# 使用 Node.js 23
nvm use 23

# 安装依赖
npm install

# 启动应用
npm run start

# 打包应用
npm run dist
```

> 💡 由于版本迭代迅速，建议自行编译以体验最新功能。

## ⚙️ 安装配置

如安装失败，请手动将配置文件 (`src/backend/config.json`) 复制到以下路径：

- **Linux**: `/home/[user]/.transmagent/config.json`
- **Windows**: `C:\Users\[user]\.transmagent\config.json`

安装完成后，需要进行以下配置：

### 🔧 Agent 参数配置
详见 [mcp_server](biotools/mcp_server)

### 📦 工具依赖安装
详见 [plugins](resources/plugins)

### 🤖 大模型与软件详细配置
参考 [配置示例](CONFIG.md) 了解 `Ollama 支持` 等高级配置

## 🌐 API 接口

### 打印会话列表
```bash
curl -X POST http://localhost:3005/chat/list \
  -H "Content-Type: application/json"
```

### 开启新会话
```bash
curl -X POST http://localhost:3005/chat/checkout \
  -H "Content-Type: application/json"
```

### 切换会话
```bash
curl -X POST http://localhost:3005/chat/checkout \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "chat-ba0091e2-a942-425d-8783-115d82011781"}'
```

### 切换模式
```bash
curl -X POST http://localhost:3005/chat/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "auto/act/plan/flash"}'
```

### 提交查询
```bash
curl -X POST http://localhost:3005/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
        {"role": "user", "content": "你好"}
    ],
    "max_step": 2
  }'
```

## 📞 联系我们

如有任何问题，请通过以下方式联系：  
📧 Email: [mp798378522@gmail.com](mailto:mp798378522@gmail.com)

---
<p align="center">
  <em>TransMAgent - 让转录调控分析变得简单高效</em>
</p>