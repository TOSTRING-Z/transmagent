#!/bin/bash
# ============================================================
# MIX50 Docker — 多 Agent 运行脚本
# 
# 用法: ./build_and_run.sh {build|biomni|react|daemon|exec|clean|info}
# ============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="mix50-agents:latest"
CONTAINER_NAME="mix50_agents_test"

# ---- 通用环境变量 ----
ENV_ARGS=(
    -e no_proxy='*'
    -e NO_PROXY='*'
    -e PYTHONIOENCODING=utf-8
    -e PYTHONUNBUFFERED=1
)
[ -n "$OPENAI_API_KEY" ] && ENV_ARGS+=(-e OPENAI_API_KEY="$OPENAI_API_KEY")
[ -n "$CUSTOM_MODEL_BASE_URL" ] && ENV_ARGS+=(-e CUSTOM_MODEL_BASE_URL="$CUSTOM_MODEL_BASE_URL")
[ -n "$CUSTOM_MODEL_API_KEY" ] && ENV_ARGS+=(-e CUSTOM_MODEL_API_KEY="$CUSTOM_MODEL_API_KEY")

# ---- 共享挂载卷 (与宿主机路径完全一致) ----
# 注意: 所有路径必须与脚本内硬编码路径完全一致!
SHARED_VOLUMES=(
    # Conda 环境 + base (etc/profile.d/conda.sh 等)
    -v /home/tostring/miniconda3:/home/tostring/miniconda3:ro
    # .local 包
    -v /home/tostring/.local/lib/python3.12/site-packages:/home/tostring/.local/lib/python3.12/site-packages:ro
    # SpatialAgent 代码仓库
    -v /home/tostring/桌面/document/NM改稿/tmp/run_spatialagent/SpatialAgent:/home/tostring/桌面/document/NM改稿/tmp/run_spatialagent/SpatialAgent:ro
    # MIX50 示例数据 (BRCA.csv, ChIP-seq FASTQ 等)
    -v /data/zgr/transagent/biotools/data/example:/data/example:ro
    # TR 结合区 + 人类注释
    -v /data/zgr/transagent/biotools/data/trapt:/data/trapt:ro
    -v /data/zgr/transagent/biotools/data/human:/data/human:ro
    # Claude Code CLI
    -v /usr/local/lib/node_modules:/usr/local/lib/node_modules:ro
    # Codex CLI (nvm + relay + litellm)
    -v /home/tostring/.nvm:/home/tostring/.nvm:ro
    -v /home/tostring/.local/bin/codex-relay:/home/tostring/.local/bin/codex-relay:ro
    -v /home/tostring/.local/bin/litellm:/home/tostring/.local/bin/litellm:ro
    # 数据湖 (BiOmni 元数据)
    -v /home/tostring/桌面/document/NM改稿/QA100/data:/home/tostring/桌面/document/NM改稿/QA100/data:ro
    # MIX50 脚本与问题集 (只读)
    -v /home/tostring/桌面/document/NM改稿/MIX50/MIX50.json:/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json:ro
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[Biomni].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[Biomni].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[ReAct].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[ReAct].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[GeminiCLI].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[GeminiCLI].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[CodexCLI].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[CodexCLI].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[ClaudeCode].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[ClaudeCode].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[SpatialAgent].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[SpatialAgent].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[TransMAgent_T].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[TransMAgent_T].py:ro"
    -v "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[TransMAgent_M].py:/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[TransMAgent_M].py:ro"
    # 工作目录 (读写 — 确保属主正确)
    -v /home/tostring/桌面/document/NM改稿/MIX50/run_Biomni:/home/tostring/桌面/document/NM改稿/MIX50/run_Biomni
    -v /home/tostring/桌面/document/NM改稿/MIX50/run_SpatialAgent:/home/tostring/桌面/document/NM改稿/MIX50/run_SpatialAgent
    -v /home/tostring/桌面/document/NM改稿/MIX50/react_results.json:/home/tostring/桌面/document/NM改稿/MIX50/react_results.json
)

# ---- 辅助函数 ----
docker_cmd() {
    docker run --rm --network host "${ENV_ARGS[@]}" "${SHARED_VOLUMES[@]}" "$IMAGE_NAME" "$@"
}

# ========================
case "${1:-help}" in
    # ---- 构建 ----
    build)
        echo "=== 构建 $IMAGE_NAME ==="
        docker build -t "$IMAGE_NAME" -f "$SCRIPT_DIR/Dockerfile" "$SCRIPT_DIR"
        echo "[OK] 构建完成"
        ;;

    # ---- Biomni Agent ----
    biomni|run)
        echo "=== 运行 Biomni Agent ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[Biomni].py"
        ;;

    # ---- ReAct Agent ----
    react)
        echo "=== 运行 ReAct Agent ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[ReAct].py"
        ;;

    # ---- Gemini CLI ----
    gemini)
        echo "=== 运行 Gemini CLI Agent ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[GeminiCLI].py"
        ;;

    # ---- Codex CLI ----
    codex)
        echo "=== 运行 Codex CLI Agent ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[CodexCLI].py"
        ;;

    # ---- Claude Code ----
    claude)
        echo "=== 运行 Claude Code Agent ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[ClaudeCode].py"
        ;;

    # ---- SpatialAgent ----
    spatial)
        echo "=== 运行 SpatialAgent ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[SpatialAgent].py"
        ;;

    # ---- TransMAgent ----
    transm_t)
        echo "=== 运行 TransMAgent T ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[TransMAgent_T].py"
        ;;
    transm_m)
        echo "=== 运行 TransMAgent M ==="
        docker_cmd python3 "/home/tostring/桌面/document/NM改稿/MIX50/run_MIX50[TransMAgent_M].py"
        ;;

    # ---- 后台守护 ----
    daemon)
        echo "=== 后台启动 ==="
        docker run -d --name "$CONTAINER_NAME" --network host \
            "${ENV_ARGS[@]}" "${SHARED_VOLUMES[@]}" \
            "$IMAGE_NAME" sleep infinity
        echo "[OK] 容器 $CONTAINER_NAME 已启动"
        ;;

    # ---- 交互式 shell ----
    exec|shell)
        echo "=== 交互式 Shell ==="
        docker_cmd bash
        ;;

    # ---- 清理 ----
    clean)
        echo "=== 清理 ==="
        docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
        docker rmi "$IMAGE_NAME" 2>/dev/null || true
        echo "[OK] 清理完成"
        ;;

    # ---- 信息 ----
    info)
        echo "=== 镜像 ==="
        docker images "$IMAGE_NAME" 2>/dev/null || echo "  (未构建)"
        echo ""
        echo "=== 可用 Agent ==="
        echo "  build      构建镜像"
        echo "  biomni     运行 Biomni Agent (完整版 A1)"
        echo "  react      运行 ReAct Agent (DeepSeek)"
        echo "  gemini     运行 Gemini CLI Agent"
        echo "  codex      运行 Codex CLI Agent"
        echo "  claude     运行 Claude Code Agent"
        echo "  spatial    运行 SpatialAgent"
        echo "  transm_t   运行 TransMAgent T"
        echo "  transm_m   运行 TransMAgent M"
        echo "  daemon     后台启动容器"
        echo "  exec       交互式 shell"
        echo "  clean      清理镜像和容器"
        echo ""
        echo "=== 挂载卷 ==="
        for v in "${SHARED_VOLUMES[@]}"; do echo "  $v"; done
        ;;

    *)
        echo "MIX50 Multi-Agent Docker 测试环境"
        echo ""
        echo "用法: $0 <命令>"
        echo ""
        echo "命令:"
        echo "  build      构建 Docker 镜像"
        echo "  biomni     运行 Biomni Agent"
        echo "  react      运行 ReAct Agent"
        echo "  gemini     运行 Gemini CLI Agent"
        echo "  codex      运行 Codex CLI Agent"
        echo "  claude     运行 Claude Code Agent"
        echo "  spatial    运行 SpatialAgent"
        echo "  transm_t   运行 TransMAgent T"
        echo "  transm_m   运行 TransMAgent M"
        echo "  daemon     后台启动容器"
        echo "  exec       交互式 shell"
        echo "  clean      清理"
        echo "  info       查看详情"
        ;;
esac
