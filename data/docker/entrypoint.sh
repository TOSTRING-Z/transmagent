#!/bin/bash
# ============================================================
# MIX50 Docker 入口脚本 (非 root)
# 环境已由 Dockerfile 预配置
# ============================================================
set -e

echo "============================================"
echo "  MIX50 Multi-Agent Docker Test Environment"
echo "============================================"
echo "  User: $(whoami)"

AGENT_DIR="/home/tostring/miniconda3/envs/agent"
LOCAL_PKGS="/home/tostring/.local/lib/python3.12/site-packages"

if [ -d "$AGENT_DIR/bin" ]; then
    export PATH="$AGENT_DIR/bin:$PATH"
    export LD_LIBRARY_PATH="$AGENT_DIR/lib:$LD_LIBRARY_PATH"
fi
echo "  Python: $(python3 --version 2>&1)"

# ---- Codex CLI + Node.js ----
NVM_BIN="/home/tostring/.nvm/versions/node/v23.10.0/bin"
[ -d "$NVM_BIN" ] && export PATH="$NVM_BIN:$PATH"
echo "  Codex: $(codex --version 2>&1 || echo 'N/A')"

[ -d "$LOCAL_PKGS" ] && export PYTHONPATH="$LOCAL_PKGS:$PYTHONPATH"

# ---- Claude Code ----
if [ -f /usr/local/bin/claude ] && [ -x /usr/local/bin/claude ]; then
    echo "  Claude Code: $(claude --version 2>&1)"
fi

# ---- 数据目录 ----
echo ""
echo "--- 数据目录 ---"
for d in /data/example/geneset /data/example/ChIP-seq /data/trapt/TR_bed \
         /data/human /data/run; do
    if [ -d "$d" ]; then
        c=$(find "$d" -maxdepth 1 -type f 2>/dev/null | wc -l)
        echo "  [✓] $d (${c} files)"
    else
        echo "  [✗] $d"
    fi
done

echo ""
echo "============================================"
echo "  环境就绪"
echo "============================================"

exec "$@"
