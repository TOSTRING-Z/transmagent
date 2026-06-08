# ============================================================
# MIX50 Docker 测试环境
# 极简空环境 (78MB) + 非 root 用户
# ============================================================

FROM ubuntu:22.04

LABEL description="MIX50 多 Agent 测试环境"

# ---- 系统基础 ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ---- 预建数据目录 ----
RUN mkdir -p /data/example/geneset \
    /data/example/ChIP-seq \
    /data/example/ChIPseq \
    /data/example/metadata \
    /data/example/SuperEnhancer \
    /data/example/sequencing \
    /data/example/control \
    /data/run && \
    chown 1000:1000 /data/run

# ---- Claude Code symlink (目标在运行时挂载) ----
RUN ln -sf /usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe /usr/local/bin/claude

# ---- 非 root 用户 (UID 1000 匹配宿主机) ----
RUN useradd -m -u 1000 -s /bin/bash appuser && \
    mkdir -p /home/appuser/.claude && \
    chown -R appuser:appuser /home/appuser

# ---- 入口 ----
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER appuser
WORKDIR /home/tostring/桌面/document/NM改稿/MIX50
ENTRYPOINT ["/entrypoint.sh"]
CMD ["bash"]
