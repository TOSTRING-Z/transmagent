# Construction of a Multidimensional Hierarchical Benchmark Dataset

## Overview

To rigorously and comprehensively evaluate an agent's capabilities in task planning, tool orchestration, and long-context processing within transcriptional regulation analysis workflows, we constructed a **multidimensional hierarchical benchmark dataset** comprising **400 independent test cases**. The design of this dataset accounts for both the diversity of real-world interactions and the complexity of biological logic, and is composed of three hierarchical evaluation modules.

## Dataset at a Glance

| Tier | Name | Count | Core Evaluation Dimension |
|------|------|-------|---------------------------|
| T1 | Multi-complexity Synthetic Task Cohort | 50 | Task planning & tool orchestration |
| T2 | Strictly Tool-Dependent Binary Reasoning Task Cohort | 300 | Multi-step tool-chain invocation & data integration |
| T3 | Transcriptional Regulation Analysis Primitives | 50 | Foundational paradigm coverage & chained execution |

**Total: 400 test cases**

---

## T1: Multi-complexity Synthetic Task Cohort

**Sample size**: n = 50

### Design Objective
The T1 cohort is engineered to assess system resilience and generalization capabilities under varying structural complexities. It leverages an LLM-guided data synthesis methodology that incorporates strict domain-specific architectural guardrails to maintain biological plausibility and computational executability.

### Construction Methodology

#### Dual Core Prior Injection
During generation, two core prior frameworks are integrated:

1. An extensive, curated **transcriptional regulation knowledge base**
2. An **operations dictionary** defining **29 standard bioinformatics utilities** (e.g., `bedtools`, `macs2`, `deeptools`, `homer`, `rose`, `beta`, `trapt`, `fimo`, `meme`, `bowtie2`, `samtools`, `picard`, `bamCoverage`, `computeMatrix`, `plotHeatmap`, `plotProfile`, `chipseeker`, `clustProfiler`, `enrichGO`, `enrichKEGG`, `gseGO`, `gseKEGG`, `findMotifsGenome`, `annotatePeaks`, `getDiffExpression`, `aracne`, `viper`, `bedtools intersect`, `bedtools closest`), pre-mapped to valid local data environments

#### Bottom-Up Task Construction
Atomically, generation scripts randomly sample distinct tool combinations alongside verified functional genomic payloads (e.g., high-throughput sequencing data or gene catalogs). The generation engine then back-propagates from these operational graphs to synthesize corresponding natural language task descriptions.

#### User Persona Simulation
To encapsulate the idiosyncratic linguistics of genuine research environments, the system applies parameter-driven prompt engineering to emulate users across diverse educational and professional strata, such as molecular biology investigators, clinical practitioners, or academic students.

#### Illustrative Generation Example
For instance, an operational coupling of `DESeq2` (differential expression profiling) and `TRAPT` (transcription factor enrichment) mapped onto a breast cancer dataset is translated into a realistic user scenario:

> *"Given the local path /data/example/geneset/BRCA.csv, analyze the underlying transcriptional regulatory mechanisms governing this differential breast cancer gene list to identify potential upstream master regulators."*

This methodology fluidly translates raw command-line arguments into highly authentic user inquiries, pairing them strictly with standardized reference execution steps.

### Data Isolation
Critically, to prevent data contamination and guarantee evaluation integrity during reinforcement learning phases, this task cohort is stringently isolated, ensuring that all T1 validation instances remain entirely unseen during model training.


### Environment Data Download

The T1 task cohort relies on a curated local data environment. Download the required reference data and functional genomic payload files from Zenodo:

- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.15291175.svg)](https://doi.org/10.5281/zenodo.20301849)
- [![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.15291175.svg)](https://doi.org/10.5281/zenodo.20485653)
### Data Format



```csv
task,dataset,category
"Perform multi-database enrichment analysis and visualization of stemness signature genes...","T1","Enrichment & Functional Analysis"
```

The complete dataset is stored in [`task_classification.csv`](./task_classification.csv) with columns: `task` (natural language task description), `dataset` (tier label: T1/T2/T3), and `category` (analysis category).

### Examples

| Type | Task Example |
|------|-------------|
| Simple query | `Use the BRCA differentially expressed genes from /data/example/geneset/BRCA.csv to perform pathway enrichment analysis` |
| Multi-step workflow | `I want to analyze differential gene expression in BRCA cancer samples from TCGA database and perform pathway enrichment analysis on the significant genes` |
| Path + Directive | `/data/trapt/TR_bed/ADNP@Sample_01_0380.bed [Analyze target genes and functional annotation of the ADNP transcription factor]` |

---

## T2: Strictly Tool-Dependent Binary Reasoning Task Cohort

**Sample size**: n = 300

### Design Objective
The T2 cohort targets the core execution competencies of multi-agent orchestration, evaluating data integration across disparate sources and multi-step tool compilation through binary ("Yes/No") verification loops.

### Core Design Principle: "Absolute Anti-Reasoning"

The paramount architectural constraint governing T2 is the systematic obstruction of parametric memory retrieval; the system is barred from leveraging internal knowledge bases or generic biological common sense to deduce the correct binary state.

#### Anti-Leakage Measures

| Measure | Implementation |
|---------|---------------|
| **Gene Selection** | Rigidly restricted to exclude well-characterized elements, omitting common oncogenes (e.g., TP53, ESR1), canonical co-regulatory circuits, and pervasive tissue-specific expression archetypes. Instead, the framework selectively draws upon poorly annotated transcription factors and low-frequency, non-canonical pathways |
| **Comparison Logic** | Mechanistically, comparison parameters emphasize geometric densities and global enrichment coverage over trivial absolute area metrics |
| **Attribute Judgment** | Verification perimeter scaled down from massive gene families to precise, comparative dual-gene analyses |
| **Data Provenance** | Comprehensively discard well-known co-regulatory relationships and classical tissue expression signatures |

#### Bottom-Up Strong-Dependency Design Logic
The task designs instantiate absolute dependency on physical tool execution, meaning that the definitive binary answer cannot be computed without executing real-world bioinformatics command lines.

#### Illustrative Design Example
In an evaluation targeting three-dimensional chromatin geometry and long-range spatial coordinates, a query is formulated as follows:

> *"Is the median distance from the transcription start sites of the zinc-finger protein family genes to the nearest super-enhancers strictly less than that of the HIC2/TRIM66 structural domain family genes?"*

Because the targeted genomic coordinates sit within unmapped, non-canonical windows, parametric deduction is mathematically insufficient; the agent is forced to autonomously execute structural toolchains, decode coordinate files, calculate real-space medians between distinct gene groups and enhancers, and perform terminal mathematical inequality verification.

#### The 9 Transcriptional Regulation Analysis Primitives Covered

| Category | Subtype | Description |
|----------|---------|-------------|
| T1-Expression Comparison | Cross-tissue expression comparison | Determine whether a transcription factor's expression in tissue A is higher than in tissue B |
| T2-Dual Feature Overlap | Genomic region overlap | Determine whether the cumulative base-pair overlap between two classes of genomic annotation regions and genetic variants is larger or smaller |
| T3-Spatial Distance | Binding site distance | Compute the spatial distance between variants and transcription factor binding centers |
| T4-ChIP-seq Statistics | Peak statistics | ChIP-seq peak statistics and comparison |
| T5-Motif Analysis | Sequence motifs | Motif enrichment and scanning analysis |
| T6-Functional Enrichment | Pathway/GO enrichment | Functional enrichment comparison of gene sets |
| T7-Genomic Annotation | Region annotation | Distributional annotation of genomic regions |
| T8-Signal Intensity | Signal comparison | Quantitative comparison of continuous signals |
| T9-Regulatory Network | Network topology | Regulatory network relationship inference |

### Mandatory Tool-Chain Requirement
The T2 task cohort mandates that the agent must traverse **2 to 5 steps of real tool-chain invocations and data computation** before deriving the final biological conclusion (Yes/No). This design excludes all routine tasks that could be answered through parametric memory alone, providing a high-quality means of accurately evaluating an agent's workflow execution and data processing capabilities when facing complex, real computational demands.

### Data Format



```csv
task,dataset,category
"Is the expression level of transcription factor ZNF768 in stomach tissue higher than its expression level in kidney tissue?","T2","Expression Comparison"
```

The complete dataset is stored in [`task_classification.csv`](./task_classification.csv). Key fields include:

| Field | Description |
|-------|-------------|
| `task` | Yes/No binary question |
| `dataset` | Tier label (T1 / T2 / T3) |
| `category` | Analysis primitive category (e.g., Expression Comparison, Feature Overlap, Spatial Distance) |

| Field | Description |
|-------|-------------|
### Examples

| ID | Category | Task | Answer |
|----|----------|------|--------|
| 0 | T1-Expression Comparison | Is the expression level of transcription factor ZNF768 in stomach tissue higher than its expression level in kidney tissue? | Yes |
| 12 | T2-Dual Feature Overlap | Within the 100 kb upstream to 100 kb downstream region of the human ZNF132 gene transcription start site, is the cumulative base-pair overlap between enhancer RNA annotation regions and common genetic variants greater than the cumulative base-pair overlap between super-enhancer regions and common genetic variants? | No |
| 19 | T2-Dual Feature Overlap | Within the 100 kb upstream and downstream regions flanking the disease risk genetic variant rs1002456 (near LMX1A), is the cumulative base-pair count of disease risk variants located within transcription factor binding site regions greater than the cumulative base-pair count of disease risk variants located within expression quantitative trait loci regions? | No |

---

## T3: Transcriptional Regulation Analysis Primitives

**Sample size**: n = 50

### Design Objective
The T3 cohort extensively mirrors the **9 foundational paradigms** of transcriptional regulation research (detailed in the T2 primitives table above), including differential expression distribution, multi-feature overlap metrics, spatial coordinate calculation, and ChIP-seq signal enrichment statistics. This module specifically validates whether the agent can reliably navigate **chained execution graphs spanning 2 to 5 discrete tool steps** across each paradigm, serving as a comprehensive cross-validation subset.

### Data Format



```csv
task,dataset,category
"Calculate the median distance from transcription start sites to nearest super-enhancers...","T3","Spatial Distance"
```

The complete dataset is stored in [`task_classification.csv`](./task_classification.csv).

## Benchmarking and Evaluation Environment Setup

To ensure the rigor and high reproducibility of the benchmark testing, all comparative evaluations in this study were executed within a unified, localized, and offline environment. We included seven representative open-source, domain-specific agent systems for biology in the horizontal comparison, with their source repositories as follows:

| System | Repository |
|--------|------------|
| Biomni | [snap-stanford/Biomni](https://github.com/snap-stanford/Biomni) |
| SpatialAgent | [Genentech/SpatialAgent](https://github.com/Genentech/SpatialAgent) |
| GeneGPT | [ncbi/GeneGPT](https://github.com/ncbi/GeneGPT) |
| BioChatter | [biocypher/biochatter](https://github.com/biocypher/biochatter) |
| ChatGSE | [wenliangz/ChatGSE](https://github.com/wenliangz/ChatGSE) |
| GeneAgent | [ncbi-nlp/GeneAgent](https://github.com/ncbi-nlp/GeneAgent) |
| CellAgent | [23AIBox/cellagent](https://github.com/23AIBox/cellagent) |

For general-purpose coding agent benchmarks, we employed locally configured versions of **Claude Code** (v2.1.89) and **Gemini** (v0.42.0). Regarding the evaluation of **Codex CLI**, we explicitly locked the version to v0.80.0, as it is the final release compatible with DeepSeek. To ensure consistency in underlying model capabilities, the Codex communication pipeline was custom-reconstructed: evaluation requests were initiated by the Codex CLI, routed through a local Codex-Relay service, and ultimately redirected via a LiteLLM gateway to the DeepSeek model. Additionally, a **ReAct agent** powered by the DeepSeek engine, configured with fundamental execution constraints, was implemented to serve as a standardized comparative baseline.


## Evaluation Code Examples

To facilitate reproducibility, we open-source the complete evaluation infrastructure. The codebase is organized into two layers: **proxy services** that normalize heterogeneous agent APIs into a unified DeepSeek backend, and **batch execution runners** that drive each system through the MIX50 benchmark.

### Proxy Infrastructure

All evaluated systems are routed through a consistent DeepSeek model backend (`deepseek-v3.2` / `deepseek-chat`) to eliminate model capability as a confounding variable.

#### Gemini Protocol Proxy (`gemini_proxy_v3.py`)

A translation proxy that converts Gemini-native API calls to OpenAI-compatible chat completions. It handles the critical `functionCall` ↔ `tool_calls` protocol conversion:

- **Gemini `functionCall` parts** are remapped to OpenAI `tool_calls` with auto-generated call IDs
- **Gemini `functionResponse` parts** are mapped to `role: "tool"` messages
- **Model response reconstruction**: OpenAI `tool_calls` are converted back to Gemini `functionCall` parts in the response
- Supports both streaming (SSE-wrapped single event) and non-streaming modes

```python
# Core conversion: Gemini functionCall → OpenAI tool_calls
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

#### ReAct Relay Proxy (`relay_proxy.py`)

A multi-round ReAct execution engine that implements the standard Reason-Act-Observe loop. Key design decisions:

| Component | Implementation |
|-----------|---------------|
| Max rounds | 8 (prevents infinite loops) |
| Tool execution | `subprocess.run` with 60s timeout per command |
| Tool output | Capped at 5000 characters per result |
| Command extraction | Regex pattern: ` ```bash\n(.*?)``` ` |
| Model | `deepseek-chat` via `runapi.co` |

```python
# Core ReAct loop
for round_idx in range(MAX_REACT_ROUNDS):
    status, resp = call_chat(messages)
    response_text = resp["choices"][0]["message"]["content"]
    messages.append({"role": "assistant", "content": response_text})

    results, _ = execute_commands(response_text)
    if not results:
        break  # No code blocks → task complete

    # Feed tool results back as user message
    messages.append({
        "role": "user",
        "content": f"[TOOL EXECUTION RESULTS]\n{tool_result_text}\n\nPlease continue."
    })
```

#### Codex TLS Relay (`codex_relay_tls.py`)

A lightweight TLS termination proxy that enables the Codex CLI to communicate with a local relay service. Listens on port 443, strips TLS, and forwards to the Codex-Relay service on port 4446.

### Batch Execution Runners

Each system has a dedicated runner script that handles task dispatch, environment isolation, output parsing, and result aggregation. All runners share a common architecture: load `MIX50.json`, iterate tasks with configurable parallelism, and persist structured JSON results with checkpoint-resume support.

#### TransMAgent (Single-Agent Mode) — `run_MIX50[TransMAgent_T].py`

```python
CONFIG = {
    "api_base_url": "http://localhost:3005",
    "target_mode": "auto",           # Fully autonomous mode
    "target_agent_mode": "transagent", # Single-agent orchestration
    "target_model": "deepseek-v3.2",
    "max_step": 1000,
    "max_workers": 1,                # Sequential execution
}
```

The runner initializes a chat session via `/chat/checkout`, configures mode and model, then submits each task through `/chat/completions`. Results include full response traces, duration metrics, and status tracking with incremental persistence.

#### TransMAgent (Multi-Agent Mode) — `run_MIX50[TransMAgent_M].py`

Identical architecture to the single-agent variant but configured for multi-agent协作 mode:

```python
CONFIG = {
    "target_agent_mode": "multagent", # Multi-agent orchestration
    "max_workers": 4,                 # Parallel execution (4 concurrent)
    "launch_interval": 20,            # 20s spacing between launches
}
```

#### Claude Code CLI — `run_MIX50[ClaudeCode].py`

Evaluates Claude Code v2.1.158 with the Anthropic API remapped to DeepSeek via `runapi.co`:

```python
CLAUDE_ENV = {
    "ANTHROPIC_BASE_URL": "https://runapi.co",
    "ANTHROPIC_MODEL": "deepseek-v3.2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v3.2",
}
```

Key implementation details:
- **Stream-JSON output parsing**: Reconstructs message history from Claude's `stream-json` format, including `tool_use`, `tool_result`, and text content blocks
- **Environment isolation**: Each task runs in a dedicated `/data/run/{uuid}` directory with a constraint prompt enforcing path isolation
- **Proxy cleansing**: HTTP/HTTPS proxy variables are stripped to prevent network leakage
- **Timeout**: 3600s per task with `SIGTERM` → `SIGKILL` escalation

```python
# Environment isolation constraint embedded in every task
constraint = f"【目录限制】所有探索过程、中间文件和结果文件必须严格保存在 {run_dir} 下"
cmd = ["claude", "--print", "--verbose", "--output-format", "stream-json",
       "--dangerously-skip-permissions", "-p", full_task]
```

#### Codex CLI — `run_MIX50[CodexCLI].py`

Evaluates Codex CLI v0.80.0 (the final release compatible with DeepSeek) through a custom relay chain:

```
Codex CLI → Codex-Relay (port 4002) → LiteLLM Gateway (port 4446) → DeepSeek
```

The `codex_relay_tls.py` proxy handles TLS termination on port 443, forwarding to the LiteLLM gateway. The runner configures Codex via `~/.codex/config.toml`:

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

The runner parses Codex's structured event stream (`item.started`, `item.completed`, `command_execution`) to reconstruct the full interaction trace, distinguishing between agent messages, tool invocations, and tool results.

#### Gemini CLI — `run_MIX50[GeminiCLI].py`

Evaluates Gemini CLI v0.42.0 through a LiteLLM adapter (port 4001) routing to DeepSeek:

```python
GEMINI_ENV = {
    "GOOGLE_GEMINI_BASE_URL": "http://localhost:4001",
    "GEMINI_API_KEY": "dummy",
    "GEMINI_CLI_TRUST_WORKSPACE": "true",
}
cmd = ["gemini", "--model", "deepseek-chat", "-p", full_prompt,
       "--output-format", "stream-json", "--yolo", "--sandbox", "false"]
```

#### ReAct Agent — `run_MIX50[ReAct].py`

A custom ReAct implementation with robust JSON parsing for tool call extraction. Key features:

- **Field-level JSON cleaning**: Handles numeric field value pollution (Chinese/Roman numeral contamination) via regex-based sanitization
- **Regex fallback**: When JSON parsing fails entirely, regex patterns directly extract `command` and `timeout` fields
- **Orphan duplicate key removal**: Detects and removes duplicated keys from malformed API responses
- **30-iteration cap** with 3600s total timeout
- **10-way parallelism** with 4s launch intervals

```python
# Robust JSON field-level cleaning
NUMERIC_KEYS = {"timeout", "max_iter", "retries", "top_n", "limit", "count"}
def _fix_numeric_field_values(text):
    for key in NUMERIC_KEYS:
        # Extract digits from polluted numeric fields
        text = re.sub(rf'("{key}"\s*:\s*)"?([^,\n\r}}]*?)"?', _repl, text)
    return text
```

#### Biomni — `run_MIX50[Biomni].py`

Evaluates the Biomni A1 agent within a conda environment. The runner generates per-task bash scripts that configure the Biomni data path, API credentials, and environment isolation before launching the A1 agent:

```python
CONDA_ENV = "agent"
AGENT_PYTHON = "/home/tostring/miniconda3/envs/agent/bin/python"
# Dependency verification across 15 domain packages
REQUIRED_DEPS = ['esm', 'torch', 'Bio', 'scanpy', 'pysam', 'igraph', ...]
```

#### SpatialAgent — `run_MIX50[SpatialAgent].py`

Similar conda-based runner architecture. Configures `RECURSION_LIMIT = 80` for deep reasoning chains and supports up to 10 concurrent workers:

```python
RECURSION_LIMIT = 80
MAX_WORKERS = 10
LAUNCH_INTERVAL = 4
```

### Evaluation Output Schema

All runners produce uniformly structured JSON result files:

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

### Environment Consistency

All evaluations enforce identical constraints:
- **Offline execution**: Network proxy variables purged; `no_proxy=*`
- **Directory isolation**: Each task confined to `/data/run/{uuid}` or equivalent
- **Temporary cleanup**: `/tmp` purged between tasks to prevent cross-contamination
- **DeepSeek backend**: All systems routed through the same model (`deepseek-v3.2` / `deepseek-chat`) via `runapi.co` or LiteLLM

## Docker Containerized Evaluation Environment

To eliminate environmental discrepancies as a confounding factor in benchmark results, we provide a minimal Docker container (~78 MB) that injects all dependencies via host path mounts, ensuring the evaluation environment is fully consistent with the original development environment.

### Architecture

The container does not install any Python packages or bioinformatics tools internally. All dependencies are injected from the host via read-only volume mounts:

```
Host                                      Docker Container (identical paths)
────────────────────────────────────────────────────────────────
miniconda3/envs/agent     ──ro──>  /home/tostring/miniconda3/envs/agent
.local/lib/python3.12/    ──ro──>  /home/tostring/.local/lib/...
SpatialAgent/             ──ro──>  .../run_spatialagent/SpatialAgent
QA100/data/  (BiOmni)     ──ro──>  .../QA100/data
/data/example/            ──ro──>  /data/example/  (gene sets, ChIP-seq, etc.)
/data/trapt/              ──ro──>  /data/trapt/    (TR binding regions)
/data/human/              ──ro──>  /data/human/    (human annotations)
MIX50.json                ──ro──>  .../MIX50/MIX50.json
run_Biomni/               ──rw──>  .../MIX50/run_Biomni  (results output)
run_SpatialAgent/         ──rw──>  .../MIX50/run_SpatialAgent
```

### File Inventory

| File | Description |
|------|-------------|
| `Dockerfile` | Ubuntu 22.04 minimal image with pre-created data directories, non-root user (UID 1000) |
| `docker-compose.yml` | Full volume mount and service orchestration |
| `build_and_run.sh` | One-click build/run CLI wrapper |
| `entrypoint.sh` | Container entrypoint that verifies Python, Node.js, Claude Code, and data directory readiness |
| `demo.json` | Single test case for environment verification |
| `README.md` | Detailed Docker environment documentation |

### All Supported Evaluation Modes

`build_and_run.sh` provides a unified command-line interface:

```bash
cd docker/

# Build image (first time only)
./build_and_run.sh build

# Run each agent evaluation
./build_and_run.sh biomni      # Biomni (A1 full version)
./build_and_run.sh react       # ReAct Agent (DeepSeek)
./build_and_run.sh spatial     # SpatialAgent
./build_and_run.sh gemini      # Gemini CLI
./build_and_run.sh codex       # Codex CLI (v0.80.0)
./build_and_run.sh claude      # Claude Code
./build_and_run.sh transm_t    # TransMAgent single-agent
./build_and_run.sh transm_m    # TransMAgent multi-agent

# Interactive debugging
./build_and_run.sh exec

# Cleanup
./build_and_run.sh clean
```

### Environment Consistency Guarantees

| Guarantee | Implementation |
|-----------|---------------|
| **Python Environment** | Conda environment `agent` (containing 15+ domain packages: biomni, scanpy, pysam, etc.) injected via read-only mount; `PYTHONPATH` auto-configured |
| **Node.js Ecosystem** | Claude Code CLI (`/usr/local/lib/node_modules`), Codex CLI (nvm v23.10.0) via read-only mounts |
| **Data Isolation** | MIX50 question set and biological data mounted read-only; result output directories mounted read-write with per-task isolation |
| **Network Isolation** | `network_mode: host` + `no_proxy=*`, preventing accidental external API calls |
| **User Consistency** | Container UID 1000 matches host, avoiding file permission issues |
| **Path Consistency** | All mount paths are identical to hardcoded paths in evaluation scripts, requiring zero script modifications |
