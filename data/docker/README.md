# MIX50 Multi-Agent Docker 测试环境

## 概述
极简 Docker 容器 (78MB)，支持 7 种 Agent 运行 MIX50 基准测试。
所有依赖通过宿主机挂载提供，容器本身不安装任何包。

## 架构

```
宿主机                                     Docker 容器 (路径完全一致)
────────────────────────────────────────────────────────────────
miniconda3/envs/agent     ──ro──>  /home/tostring/miniconda3/envs/agent
miniconda3/envs/sctranslation ──ro──>  /home/tostring/miniconda3/envs/sctranslation
.local/lib/python3.12/    ──ro──>  /home/tostring/.local/lib/...
SpatialAgent/             ──ro──>  /home/tostring/桌面/.../tmp/run_spatialagent/SpatialAgent
QA100/data/               ──ro──>  /home/tostring/桌面/.../QA100/data
MIX50/MIX50.json          ──ro──>  /home/tostring/桌面/.../MIX50/MIX50.json
MIX50/run_Biomni/         ──rw──>  /home/tostring/桌面/.../MIX50/run_Biomni
MIX50/run_SpatialAgent/   ──rw──>  /home/tostring/桌面/.../MIX50/run_SpatialAgent
```

## Agent 列表

| 命令 | Agent | 脚本 |
|------|-------|------|
| `biomni` | Biomni (完整版 A1) | `run_MIX50[Biomni].py` | `agent` |
| `react` | ReAct (DeepSeek) | `run_MIX50[ReAct].py` | `agent` |
| `spatial` | SpatialAgent | `run_MIX50[SpatialAgent].py` | `sctranslation` |
| `gemini` | Gemini CLI | `run_MIX50[GeminiCLI].py` | `agent` |
| `codex` | Codex CLI | `run_MIX50[CodexCLI].py` | `agent` |
| `claude` | Claude Code | `run_MIX50[ClaudeCode].py` | `agent` |
| `transm_t` | TransMAgent T | `run_MIX50[TransMAgent_T].py` | `agent` |
| `transm_m` | TransMAgent M | `run_MIX50[TransMAgent_M].py` | `agent` |

## 快速使用

```bash
cd /home/tostring/桌面/document/NM改稿/MIX50/docker

# 构建镜像 (首次)
./build_and_run.sh build

# 运行各 Agent
./build_and_run.sh biomni     # Biomni
./build_and_run.sh react      # ReAct
./build_and_run.sh gemini     # Gemini CLI

# 交互式调试
./build_and_run.sh exec

# 查看所有选项
./build_and_run.sh info
```

## 数据路径 (容器内预建)

| 路径 | 说明 |
|------|------|
| `/data/example/geneset/` | 基因集 (含子目录) |
| `/data/example/ChIP-seq/` | ChIP-seq 数据 |
| `/data/example/ChIPseq/` | ChIPseq 数据 |
| `/data/example/metadata/` | 元数据 |
| `/data/example/SuperEnhancer/` | 超级增强子 |
| `/data/example/sequencing/` | 测序数据 |
| `/data/example/control/` | 对照组 |
| `/data/trapt/TR_bed/` | TR bed 文件 |
| `/data/human/` | 人类注释 |
| `/data/run/` | ReAct 运行时目录 |
