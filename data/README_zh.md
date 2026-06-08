# 多维分层基准数据集构建

## 概述

为了严密且全面地评估智能体在转录调控分析流程中的任务规划、工具编排以及长文本上下文处理能力，我们构建了一个包含 **400 个独立测试用例** 的多维分层基准数据集。该数据集的设计兼顾了真实世界交互的多样性与生物学逻辑的复杂性，由三个层级的评估模块构成。

## 数据集总览

| 模块 | 名称 | 用例数 | 核心评估维度 |
|------|------|--------|-------------|
| T1 | 多难度合成任务集 | 50 | 任务规划与工具编排 |
| T2 | 纯工具依赖型二分类推理评估集 | 300 | 多步工具链调用与数据整合 |
| T3 | 转录调控分析原语集 | 50 | 基础范式覆盖与链式执行验证 |

**总计: 400 个测试用例**

---

## T1: 多难度合成任务集

**用例数**: n = 50

### 设计目标
T1 模块旨在评估系统在不同结构复杂度下的韧性与泛化能力。该模块采用基于大语言模型引导的数据合成方法，在生成过程中融入严格的领域架构约束，以确保合成任务兼具生物学合理性与计算可执行性。

### 构建方法

#### 双核心先验注入
在任务生成过程中，系统整合了两类核心先验框架：

1. 精心构建的**转录调控专业知识库**
2. 涵盖 **29 种标准生物信息学工具**的**操作功能定义字典**，包括 `bedtools`、`macs2`、`deeptools`、`homer`、`rose`、`beta`、`trapt`、`fimo`、`meme`、`bowtie2`、`samtools`、`picard`、`bamCoverage`、`computeMatrix`、`plotHeatmap`、`plotProfile`、`chipseeker`、`clustProfiler`、`enrichGO`、`enrichKEGG`、`gseGO`、`gseKEGG`、`findMotifsGenome`、`annotatePeaks`、`getDiffExpression`、`aracne`、`viper`、`bedtools intersect`、`bedtools closest` 等，并预映射至有效的本地数据环境

#### 自底向上的任务构建逻辑
在具体构建单个任务时，自动化脚本通过随机采样机制从工具字典中抽取不同的工具组合，同步匹配经过验证的功能基因组数据（如高通量测序数据或基因目录）。随后，生成引擎从这些操作图反向推导，合成相应的自然语言任务描述。

#### 用户画像模拟
为捕捉真实科研场景中独特的语言特征，系统采用参数驱动的提示词工程，模拟不同教育与专业背景的用户，如分子生物学研究者、临床医生或在校学生。

#### 典型生成示例
当操作耦合 `DESeq2`（差异表达分析）与 `TRAPT`（转录因子富集分析）并映射至乳腺癌数据集时，大语言模型将其转化为逼真的用户场景：

> *"已知本地文件路径为 /data/example/geneset/BRCA.csv，请帮我分析该 BRCA 乳腺癌差异表达基因列表背后的转录调控机制，找出潜在的上游关键转录因子。"*

通过这种方式，数据生成过程能够将生硬的命令行工具调用自然地转译为高拟真度的用户提问，并与标准化的参考执行步骤严格配对。

### 数据隔离
为防止数据污染并确保强化学习阶段的评估完整性，该任务集被严格隔离，确保所有 T1 验证实例在模型训练期间完全不可见。


### 环境数据下载

T1 任务集依赖精心构建的本地数据环境。可从 Zenodo 下载所需的参考数据与功能基因组载荷文件：

- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.15291175.svg)](https://doi.org/10.5281/zenodo.20301849)
- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.15291175.svg)](https://doi.org/10.5281/zenodo.20485653)
### 数据格式



```csv
task,dataset,category
"Perform multi-database enrichment analysis and visualization of stemness signature genes...","T1","Enrichment & Functional Analysis"
```

完整数据集存储于 [`task_classification.csv`](./task_classification.csv)，包含三列：`task`（自然语言任务描述）、`dataset`（层级标签：T1/T2/T3）、`category`（分析类别）。

### 示例

| 类型 | 任务示例 |
|------|---------|
| 简单查询 | `使用 /data/example/geneset/BRCA.csv 中的 BRCA 差异表达基因进行通路富集分析` |
| 多步流程 | `I want to analyze differential gene expression in BRCA cancer samples from TCGA database and perform pathway enrichment analysis on the significant genes` |
| 路径+指令 | `/data/trapt/TR_bed/ADNP@Sample_01_0380.bed [分析ADNP转录因子的靶基因和功能注释]` |

---

## T2: 纯工具依赖型二分类推理评估集

**用例数**: n = 300

### 设计目标
T2 模块针对多智能体编排的核心执行能力，通过"是/否"二分类验证闭环，评估跨源数据整合与多步工具编译能力。

### 核心设计原则："绝对防推理"

T2 的首要架构约束是系统性阻断参数化记忆检索——系统被禁止借助内部知识库或通用生物学常识来推断正确的二分类状态。

#### 防泄露措施

| 措施 | 具体实施 |
|------|---------|
| **基因选择** | 严格排除已被充分表征的元素，彻底剔除 TP53、ESR1 等常见癌基因及经典共调控回路和普遍组织表达特征，转而采用注释较少的转录因子和低频非经典通路 |
| **比较逻辑** | 从机制层面强调几何密度与全局富集覆盖率，而非简单的绝对面积度量 |
| **属性判断** | 将验证范围从大规模基因家族精确收窄为双基因对比分析 |
| **数据来源** | 全面摒弃公认的共调控关系与经典组织表达特征 |

#### 自底向上的强依赖设计逻辑
任务设计实例化了对物理工具执行的绝对依赖，意味着在不实际运行生物信息学命令行的情况下，根本无法计算出确定的二分类答案。

#### 典型设计示例
在针对三维染色质构象与长程空间坐标的评估中，查询设计如下：

> *"锌指蛋白家族基因的转录起始位点到最近超级增强子的中位距离，是否严格小于 HIC2/TRIM66 结构域家族基因？"*

由于目标基因组坐标位于未映射的非经典窗口内，参数化推论在数学上是不充分的；智能体被迫自主执行结构化工具链，解析坐标文件，计算不同基因组与增强子之间的真实空间中位数，并完成最终的数学不等式验证。

#### 覆盖的 9 大转录调控分析原语

| 类别 | 子类型 | 描述 |
|------|--------|------|
| T1-表达比较 | 组织间表达比较 | 判断某转录因子在组织A中的表达是否高于组织B |
| T2-双特征交叠 | 基因组区域重叠 | 判断两类基因组注释区域与遗传变异的重叠碱基对数大小 |
| T3-空间距离 | 结合位点距离 | 计算变异与转录因子结合中心的空间距离 |
| T4-ChIP-seq统计 | 峰值统计 | ChIP-seq峰的统计与比较 |
| T5-基序分析 | 序列基序 | 基序富集与扫描分析 |
| T6-功能富集 | 通路/GO富集 | 基因集的功能富集比较 |
| T7-基因组注释 | 区域注释 | 基因组区域的分布注释 |
| T8-信号强度 | 信号对比 | 连续信号的定量比较 |
| T9-调控网络 | 网络拓扑 | 调控网络关系推断 |

### 强制工具链要求
T2 任务集强制要求智能体必须通过跨越 **2 至 5 步的真实工具链调用与数据计算**，才能推导出最终的生物学结论（是/否）。这种设计排除了所有可通过参数化记忆直接回答的常规任务，为准确评测智能体在面对复杂真实计算需求时的流程执行与数据处理能力提供了高质量的检验手段。

### 数据格式



```csv
task,dataset,category
"转录因子ZNF768在胃组织中的表达水平是否高于其在肾脏组织中的表达水平？","T2","Expression Comparison"
```

完整数据集存储于 [`task_classification.csv`](./task_classification.csv)。关键字段说明：

| 字段 | 说明 |
|------|------|
| `task` | 是/否二分类问题 |
| `dataset` | 层级标签（T1 / T2 / T3） |
| `category` | 分析原语类别（如表达比较、特征交叠、空间距离等） |

| 字段 | 说明 |
|------|------|
### 示例

| ID | 类别 | 任务 | 答案 |
|----|------|------|------|
| 0 | T1-表达比较 | 转录因子ZNF768在胃组织中的表达水平是否高于其在肾脏组织中的表达水平？ | 是 |
| 12 | T2-双特征交叠 | 在人类ZNF132基因转录起始位点上游100 kb至下游100 kb范围内，增强子RNA注释区域与常见遗传变异发生重叠的累计碱基对数，是否大于超级增强子区域与常见遗传变异重叠的累计碱基对数？ | 否 |
| 19 | T2-双特征交叠 | 在疾病风险遗传变异rs1002456（LMX1A附近）上下游各100 kb范围内，转录因子结合位点区域内含有疾病风险遗传变异的累计碱基对数，是否大于表达数量性状位点区域内含有疾病风险遗传变异的累计碱基对数？ | 否 |

---

## T3: 转录调控分析原语集

**用例数**: n = 50

### 设计目标
T3 模块广泛覆盖了转录调控研究的 **9 大基础范式**（详见上文 T2 原语表），涵盖差异表达分布、多特征交叠度量、空间坐标计算以及 ChIP-seq 信号富集统计等。该模块专门验证智能体是否能够在每种范式下可靠地驾驭 **跨越 2 至 5 个离散工具步骤的链式执行图**，作为全面的交叉验证子集。

### 数据格式



```csv
task,dataset,category
"计算转录起始位点到最近超级增强子的中位距离...","T3","Spatial Distance"
```

完整数据集存储于 [`task_classification.csv`](./task_classification.csv)。

## 基准测试与评估环境搭建

为确保基准测试的严谨性与高可复现性，本研究中所有对比评估均在统一、本地化、离线的环境中执行。横向对比纳入了七个具有代表性的开源生物领域专用智能体系统，其源码仓库如下：

| 系统 | 仓库 |
|------|------|
| Biomni | [snap-stanford/Biomni](https://github.com/snap-stanford/Biomni) |
| SpatialAgent | [Genentech/SpatialAgent](https://github.com/Genentech/SpatialAgent) |
| GeneGPT | [ncbi/GeneGPT](https://github.com/ncbi/GeneGPT) |
| BioChatter | [biocypher/biochatter](https://github.com/biocypher/biochatter) |
| ChatGSE | [wenliangz/ChatGSE](https://github.com/wenliangz/ChatGSE) |
| GeneAgent | [ncbi-nlp/GeneAgent](https://github.com/ncbi-nlp/GeneAgent) |
| CellAgent | [23AIBox/cellagent](https://github.com/23AIBox/cellagent) |

对于通用编码智能体基准测试，我们采用本地部署的 **Claude Code**（v2.1.89）与 **Gemini**（v0.42.0）。关于 **Codex CLI** 的评估，我们明确将版本锁定为 v0.80.0，因为这是兼容 DeepSeek 的最后一个版本。为确保底层模型能力的一致性，Codex 通信管线经过定制化重构：评估请求由 Codex CLI 发起，经由本地 Codex-Relay 服务路由，最终通过 LiteLLM 网关重定向至 DeepSeek 模型。此外，实现了一个由 DeepSeek 引擎驱动、配置了基础执行约束的 **ReAct 智能体**，作为标准化的对比基线。


## 评估代码案例

为便于复现，我们开源了完整的评估基础设施。代码库组织为两层：**代理服务层**将异构智能体 API 统一规整到 DeepSeek 后端，**批量执行运行器层**驱动各系统完成 MIX50 基准测试。

### 代理基础设施

所有被评估系统均通过一致的 DeepSeek 模型后端（`deepseek-v3.2` / `deepseek-chat`）路由，以消除模型能力差异作为混杂变量。

#### Gemini 协议代理 (`gemini_proxy_v3.py`)

将 Gemini 原生 API 调用转换为 OpenAI 兼容的 Chat Completions 格式的翻译代理。关键处理 `functionCall` ↔ `tool_calls` 协议转换：

- **Gemini `functionCall` 部件**重新映射为 OpenAI `tool_calls` 并自动生成调用 ID
- **Gemini `functionResponse` 部件**映射为 `role: "tool"` 消息
- **模型响应重建**：OpenAI `tool_calls` 在响应中还原为 Gemini `functionCall` 部件
- 同时支持流式（SSE 单事件包装）与非流式模式

```python
# 核心转换: Gemini functionCall → OpenAI tool_calls
for part in parts:
    if "functionCall" in part:
        fc = part["functionCall"]
        tool_calls.append({
            "id": f"call_{int(time.time()*1000000)}",
            "type": "function",
            "function": {
                "name": fc.get("name", ""),
                "arguments": json.dumps(fc.get("args", {}))
            }
        })
```

#### ReAct 中继代理 (`relay_proxy.py`)

多轮 ReAct 执行引擎，实现标准的推理-行动-观察循环。核心设计决策：

| 组件 | 实现 |
|------|------|
| 最大轮次 | 8（防止无限循环） |
| 工具执行 | `subprocess.run`，单命令超时 60s |
| 工具输出 | 每条结果截断至 5000 字符 |
| 命令提取 | 正则模式：` ```bash\n(.*?)``` ` |
| 模型 | `deepseek-chat`，通过 `runapi.co` |

```python
# 核心 ReAct 循环
for round_idx in range(MAX_REACT_ROUNDS):
    status, resp = call_chat(messages)
    response_text = resp["choices"][0]["message"]["content"]
    messages.append({"role": "assistant", "content": response_text})

    results, _ = execute_commands(response_text)
    if not results:
        break  # 无代码块 → 任务完成

    # 将工具结果作为用户消息反馈
    messages.append({
        "role": "user",
        "content": f"[TOOL EXECUTION RESULTS]\n{tool_result_text}\n\nPlease continue."
    })
```

#### Codex TLS 中继 (`codex_relay_tls.py`)

轻量级 TLS 终止代理，使 Codex CLI 能够与本地中继服务通信。监听 443 端口，剥离 TLS 后转发至 Codex-Relay 服务（4446 端口）。

### 批量执行运行器

每个系统均配备专用运行器脚本，负责任务调度、环境隔离、输出解析与结果聚合。所有运行器共享统一架构：加载 `MIX50.json`，以可配置并行度迭代任务，并以结构化 JSON 持久化结果并支持断点续跑。

#### TransMAgent（单智能体模式）— `run_MIX50[TransMAgent_T].py`

```python
CONFIG = {
    "api_base_url": "http://localhost:3005",
    "target_mode": "auto",            # 全自主模式
    "target_agent_mode": "transagent", # 单智能体编排
    "target_model": "deepseek-v3.2",
    "max_step": 1000,
    "max_workers": 1,                 # 顺序执行
}
```

运行器通过 `/chat/checkout` 初始化会话，配置模式与模型，然后通过 `/chat/completions` 逐一提交任务。结果包含完整的响应轨迹、耗时指标及增量持久化状态追踪。

#### TransMAgent（多智能体模式）— `run_MIX50[TransMAgent_M].py`

架构与单智能体版本相同，但配置为多智能体协作模式：

```python
CONFIG = {
    "target_agent_mode": "multagent",  # 多智能体编排
    "max_workers": 4,                  # 并行执行（4 并发）
    "launch_interval": 20,             # 启动间隔 20s
}
```

#### Claude Code CLI — `run_MIX50[ClaudeCode].py`

使用 Anthropic API 重映射至 DeepSeek（通过 `runapi.co`）来评估 Claude Code v2.1.158：

```python
CLAUDE_ENV = {
    "ANTHROPIC_BASE_URL": "https://runapi.co",
    "ANTHROPIC_MODEL": "deepseek-v3.2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v3.2",
}
```

关键实现细节：
- **Stream-JSON 输出解析**：从 Claude 的 `stream-json` 格式中重建消息历史，包括 `tool_use`、`tool_result` 与文本内容块
- **环境隔离**：每个任务在专属 `/data/run/{uuid}` 目录中运行，并通过约束提示强制路径隔离
- **代理清理**：剥离 HTTP/HTTPS 代理变量以防止网络泄漏
- **超时处理**：单任务 3600s，采用 `SIGTERM` → `SIGKILL` 递进终止

```python
# 每个任务嵌入的环境隔离约束
constraint = f"【目录限制】所有探索过程、中间文件和结果文件必须严格保存在 {run_dir} 下"
cmd = ["claude", "--print", "--verbose", "--output-format", "stream-json",
       "--dangerously-skip-permissions", "-p", full_task]
```

#### Codex CLI — `run_MIX50[CodexCLI].py`

通过自定义中继链评估 Codex CLI v0.80.0（兼容 DeepSeek 的最终版本）：

```
Codex CLI → Codex-Relay (port 4002) → LiteLLM Gateway (port 4446) → DeepSeek
```

`codex_relay_tls.py` 代理在 443 端口处理 TLS 终止，转发至 LiteLLM 网关。运行器通过 `~/.codex/config.toml` 配置 Codex：

```toml
[model_providers.litellm]
name = "LiteLLM-DeepSeek"
type = "openai"
base_url = "http://localhost:4446/v1"
api_key = "sk-local-proxy-master-key"

[profiles.default]
model_provider = "litellm"
model = "deepseek-v3.2"
```

运行器解析 Codex 的结构化事件流（`item.started`、`item.completed`、`command_execution`），重建完整的交互轨迹，区分智能体消息、工具调用与工具结果。

#### Gemini CLI — `run_MIX50[GeminiCLI].py`

通过 LiteLLM 适配器（端口 4001）路由至 DeepSeek 来评估 Gemini CLI v0.42.0：

```python
GEMINI_ENV = {
    "GOOGLE_GEMINI_BASE_URL": "http://localhost:4001",
    "GEMINI_API_KEY": "dummy",
    "GEMINI_CLI_TRUST_WORKSPACE": "true",
}
cmd = ["gemini", "--model", "deepseek-chat", "-p", full_prompt,
       "--output-format", "stream-json", "--yolo", "--sandbox", "false"]
```

#### ReAct 智能体 — `run_MIX50[ReAct].py`

自定义 ReAct 实现，配备鲁棒的 JSON 解析用于工具调用提取。核心特性：

- **字段级 JSON 清洗**：通过基于正则的清洗处理数字字段值污染（中文字符/罗马数字混入）
- **正则兜底提取**：当 JSON 完全解析失败时，正则模式直接提取 `command` 与 `timeout` 字段
- **孤立重复键删除**：检测并移除畸形 API 响应中的重复键
- **30 轮迭代上限**，总计 3600s 超时
- **10 路并行**，4s 启动间隔

```python
# 鲁棒的 JSON 字段级清洗
NUMERIC_KEYS = {"timeout", "max_iter", "retries", "top_n", "limit", "count"}
def _fix_numeric_field_values(text):
    for key in NUMERIC_KEYS:
        # 从污染的数字字段中提取纯数字
        text = re.sub(rf'("{key}"\s*:\s*)"?([^,\n\r}}]*?)"?', _repl, text)
    return text
```

#### Biomni — `run_MIX50[Biomni].py`

在 conda 环境中评估 Biomni A1 智能体。运行器为每个任务生成 bash 脚本，配置 Biomni 数据路径、API 凭证及环境隔离后启动 A1 智能体：

```python
CONDA_ENV = "agent"
AGENT_PYTHON = "/home/tostring/miniconda3/envs/agent/bin/python"
# 跨 15 个领域包的依赖验证
REQUIRED_DEPS = ['esm', 'torch', 'Bio', 'scanpy', 'pysam', 'igraph', ...]
```

#### SpatialAgent — `run_MIX50[SpatialAgent].py`

类似的基于 conda 的运行器架构。配置 `RECURSION_LIMIT = 80` 以支持深层推理链，最多支持 10 个并发工作线程：

```python
RECURSION_LIMIT = 80
MAX_WORKERS = 10
LAUNCH_INTERVAL = 4
```

### 评估输出模式

所有运行器产生统一结构的 JSON 结果文件：

```json
{
  "id": 0,
  "category": "Enrichment & Functional Analysis",
  "task": "原始任务描述...",
  "difficulty": "basic",
  "final_response": "智能体最终输出...",
  "messages": [
    {"role": "assistant", "content": "..."},
    {"role": "user", "content": "[Tool Result]..."}
  ],
  "duration_sec": 245.3,
  "timestamp": "2025-06-08 14:22:10",
  "status": "success"
}
```

### 环境一致性保障

所有评估执行统一约束：
- **离线执行**：网络代理变量全部清除；`no_proxy=*`
- **目录隔离**：每个任务限定于 `/data/run/{uuid}` 或等效目录
- **临时清理**：任务间清空 `/tmp` 以防止交叉污染
- **DeepSeek 后端**：所有系统通过 `runapi.co` 或 LiteLLM 路由至同一模型（`deepseek-v3.2` / `deepseek-chat`）

## Docker 容器化评估环境

为消除环境差异对基准测试结果的干扰，我们提供了极简 Docker 容器（~78 MB），通过宿主机路径挂载注入所有依赖，确保评估环境与原始开发环境完全一致。

### 架构设计

容器本身不安装任何 Python 包或生物信息学工具，所有依赖通过只读卷挂载从宿主机注入：

```
宿主机                                     Docker 容器 (路径完全一致)
────────────────────────────────────────────────────────────────
miniconda3/envs/agent     ──ro──>  /home/tostring/miniconda3/envs/agent
.local/lib/python3.12/    ──ro──>  /home/tostring/.local/lib/...
SpatialAgent/             ──ro──>  .../run_spatialagent/SpatialAgent
QA100/data/  (BiOmni)     ──ro──>  .../QA100/data
/data/example/            ──ro──>  /data/example/  (基因集、ChIP-seq等)
/data/trapt/              ──ro──>  /data/trapt/    (TR结合区)
/data/human/              ──ro──>  /data/human/    (人类注释)
MIX50.json                ──ro──>  .../MIX50/MIX50.json
run_Biomni/               ──rw──>  .../MIX50/run_Biomni  (结果输出)
run_SpatialAgent/         ──rw──>  .../MIX50/run_SpatialAgent
```

### 文件清单

| 文件 | 说明 |
|------|------|
| `Dockerfile` | Ubuntu 22.04 极简镜像，预建数据目录，非 root 用户 (UID 1000) |
| `docker-compose.yml` | 完整卷挂载与服务编排 |
| `build_and_run.sh` | 一键构建/运行 CLI 脚本 |
| `entrypoint.sh` | 容器入口，验证 Python、Node.js、Claude Code 及数据目录就绪状态 |
| `demo.json` | 单条测试用例，用于环境验证 |
| `README.md` | Docker 环境详细说明 |

### 支持的全部评估模式

`build_and_run.sh` 提供统一的命令行入口：

```bash
cd docker/

# 构建镜像（首次）
./build_and_run.sh build

# 运行各 Agent 评估
./build_and_run.sh biomni      # Biomni (A1 完整版)
./build_and_run.sh react       # ReAct Agent (DeepSeek)
./build_and_run.sh spatial     # SpatialAgent
./build_and_run.sh gemini      # Gemini CLI
./build_and_run.sh codex       # Codex CLI (v0.80.0)
./build_and_run.sh claude      # Claude Code
./build_and_run.sh transm_t    # TransMAgent 单智能体
./build_and_run.sh transm_m    # TransMAgent 多智能体

# 交互式调试
./build_and_run.sh exec

# 清理
./build_and_run.sh clean
```

### 环境一致性保障

| 保证项 | 实现方式 |
|--------|---------|
| **Python 环境** | Conda 环境 `agent`（含 biomni、scanpy、pysam 等 15+ 领域包）通过只读挂载注入，`PYTHONPATH` 自动配置 |
| **Node.js 生态** | Claude Code CLI（`/usr/local/lib/node_modules`）、Codex CLI（nvm v23.10.0）只读挂载 |
| **数据隔离** | MIX50 问题集与生物数据只读挂载；结果输出目录读写挂载，任务间自动隔离 |
| **网络隔离** | `network_mode: host` + `no_proxy=*`，防止意外的外部 API 调用 |
| **用户一致性** | 容器内 UID 1000 匹配宿主机，避免文件权限问题 |
| **路径一致性** | 所有挂载路径与宿主机硬编码路径完全一致，无需修改任何脚本 |
