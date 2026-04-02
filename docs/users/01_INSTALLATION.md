# 安装与配置指南

## 1. 系统要求

### 1.1 硬件要求

| 组件 | 最低配置 | 推荐配置 |
|------|---------|---------|
| 处理器 | 4 核 | 8 核或以上 |
| 内存 | 8 GB | 16 GB 或以上 |
| 硬盘 | 10 GB 可用空间 | 50 GB SSD |

### 1.2 软件要求

| 组件 | 版本要求 |
|------|---------|
| 操作系统 | Windows 10/11, macOS 10.14+, Linux |
| Node.js | 18+（推荐 23.x） |
| pnpm | 最新版本 |
| Python | 3.10+（用于脚本执行） |

---

## 2. 安装步骤

### 2.1 克隆项目

```bash
git clone https://github.com/TOSTRING-Z/TransMAgent.git
cd TransMAgent
```

### 2.2 安装依赖

```bash
pnpm install
```

### 2.3 构建项目

```bash
pnpm run build
```

### 2.4 启动应用

```bash
pnpm start
```

### 2.5 打包应用（可选）

```bash
pnpm run dist
```

---

## 3. 配置文件

### 3.1 配置文件位置

TransMAgent 使用两级配置文件机制：

| 类型 | 路径 | 说明 |
|------|------|------|
| 系统默认配置 | `src/backend/configs/config_*.json` | 出厂默认配置 |
| 用户配置 | `~/.transmagent/story.json` | 用户自定义配置 |

### 3.2 配置文件加载机制

```
系统默认配置 + 用户配置 → 合并增强配置
```

- 用户配置会覆盖系统默认配置
- 如果用户配置文件不存在，系统会自动创建

### 3.3 代理模式配置文件

| 模式 | 系统配置文件 |
|------|-------------|
| TransAgent（默认） | `configs/config_transagent.json` |
| BaseAgent | `configs/config_baseagent.json` |
| MultiAgent | `configs/config_multagent.json` |

---

## 4. 配置项详解

### 4.1 核心配置

```json
{
  "retry_time": 10,
  "icon_time": 5,
  "short_cut": "CommandOrControl+Shift+Space",
  "backend_url": "http://www.licpathway.net/transmagent_web",
  "history_path": null,
  "webserver": {
    "port": 3005
  }
}
```

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `retry_time` | number | API 请求失败重试次数 |
| `icon_time` | number | 图标相关时间参数 |
| `short_cut` | string | 全局快捷键 |
| `backend_url` | string | 后端服务地址 |
| `history_path` | string/null | 历史记录保存路径 |
| `webserver.port` | number | 本地 Web 服务器端口 |

### 4.2 向量嵌入配置

```json
{
  "embedding": {
    "base_url": "https://open.bigmodel.cn/api/paas/v4",
    "api_key": "",
    "model": "embedding-3",
    "dimension": 1024,
    "enabled": false
  }
}
```

| 配置项 | 说明 |
|--------|------|
| `base_url` | 向量服务 API 地址 |
| `api_key` | API 密钥 |
| `model` | 向量模型名称 |
| `dimension` | 向量维度 |
| `enabled` | 是否启用 |

### 4.3 心跳机制配置

```json
{
  "heartbeat": {
    "enabled": false,
    "interval": 300
  }
}
```

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `enabled` | boolean | 是否启用心跳机制 |
| `interval` | number | 心跳间隔（秒） |

### 4.4 功能状态配置

```json
{
  "func_status": {
    "react": true,
    "clip": false,
    "text": false,
    "del": false
  }
}
```

| 配置项 | 说明 |
|--------|------|
| `react` | 是否启用 ReAct 模式 |
| `clip` | 剪贴板功能 |
| `text` | 文本处理功能 |
| `del` | 删除功能 |

### 4.5 默认模型配置

```json
{
  "default": {
    "model": "deepseek",
    "version": "deepseek-chat",
    "plugin": "baidu_translate",
    "tool_format": "toolcalls",
    "compress_context": false
  }
}
```

| 配置项 | 说明 |
|--------|------|
| `model` | 默认模型提供商 |
| `version` | 默认模型版本 |
| `plugin` | 默认插件 |
| `tool_format` | 工具调用格式（toolcalls） |
| `compress_context` | 是否压缩上下文 |

### 4.6 支持的模型

```json
{
  "models": {
    "ollama": {
      "api_url": "http://localhost:11434",
      "api_type": "ollama",
      "versions": ["gpt-oss:20b", "qwen3-coder:30b"]
    },
    "deepseek[openai]": {
      "api_url": "https://api.deepseek.com/",
      "api_key": "",
      "api_type": "openai",
      "versions": ["deepseek-chat"]
    }
  }
}
```

**支持的模型类型**：
- `ollama`: 本地 Ollama 模型
- `deepseek[openai]`: DeepSeek API（OpenAI 兼容格式）
- `deepseek[anthropic]`: DeepSeek API（Anthropic 兼容格式）

### 4.7 插件配置

```json
{
  "plugins": {
    "browser_client": {
      "enabled": true
    },
    "web_crawler_toolkit": {
      "params": {
        "topk": 15
      },
      "enabled": true
    },
    "python_execute": {
      "params": {
        "python_bin": "python",
        "timeout": 3600
      },
      "enabled": false,
      "require_confirmation": true
    },
    "cli_execute": {
      "params": {
        "bashrc": "/root/.bashrc",
        "timeout": 3600
      },
      "enabled": true,
      "require_confirmation": true
    }
  }
}
```

---

## 5. LLM API 配置

### 5.1 配置 DeepSeek API

```json
{
  "models": {
    "deepseek[openai]": {
      "api_url": "https://api.deepseek.com/",
      "api_key": "your-api-key-here",
      "api_type": "openai",
      "versions": ["deepseek-chat"]
    }
  }
}
```

### 5.2 配置 Ollama 本地模型

```json
{
  "models": {
    "ollama": {
      "api_url": "http://localhost:11434",
      "api_type": "ollama",
      "versions": ["llama2", "qwen3-coder:30b"]
    }
  }
}
```

---

## 6. API 接口

### 6.1 获取会话列表

```bash
curl -X POST http://localhost:3005/chat/list \
  -H "Content-Type: application/json"
```

### 6.2 开启新会话

```bash
curl -X POST http://localhost:3005/chat/checkout \
  -H "Content-Type: application/json"
```

### 6.3 切换会话

```bash
curl -X POST http://localhost:3005/chat/checkout \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "your-chat-id"}'
```

### 6.4 切换模式

```bash
curl -X POST http://localhost:3005/chat/mode \
  -H "Content-Type: application/json" \
  -d '{"mode": "auto|act|plan|flash"}'
```

---

## 7. 常见问题

### 问题 1：配置文件未生效

**解决**：
1. 确认配置文件位于 `~/.transmagent/story.json`
2. 检查 JSON 格式是否正确
3. 重启应用使配置生效

### 问题 2：API 调用失败

**解决**：
1. 检查 `api_key` 是否正确配置
2. 确认网络可以访问 API 服务
3. 检查 `retry_time` 设置

### 问题 3：端口被占用

**解决**：
```bash
# 查找占用端口的进程
lsof -i :3005

# 杀死进程
kill -9 <pid>
```

---

## 8. 下一步

- 查看界面介绍？请阅读 `02_INTERFACE.md`
- 了解 BaseAgent 模式？请阅读 `03_BASEAGENT.md`
- 了解 TransAgent 模式？请阅读 `04_TRANSAGENT.md`
- 了解 MultiAgent 模式？请阅读 `05_MULTAGENT.md`
