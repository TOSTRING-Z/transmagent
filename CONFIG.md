# TransMAgent 配置指南

本文档详细介绍 TransMAgent 的配置文件格式与各项参数。

---

## 📁 配置文件

### 两级配置机制

| 类型 | 路径 | 说明 |
|------|------|------|
| 系统默认配置 | `src/backend/configs/config_*.json` | 出厂默认配置 |
| 用户配置 | `~/.transmagent/story.json` | 用户自定义配置 |

**加载机制**：用户配置会覆盖系统默认配置，系统自动合并增强。

### 代理模式配置

| 模式 | 系统配置文件 |
|------|-------------|
| TransAgent（默认） | `configs/config_transagent.json` |
| BaseAgent | `configs/config_baseagent.json` |
| MultiAgent | `configs/config_multagent.json` |

---

## 🤖 模型配置

### Ollama 本地模型

```json
"models": {
  "ollama": {
    "api_url": "http://localhost:11434",
    "api_type": "ollama",
    "versions": [
      "gpt-oss:20b",
      "qwen3-coder:30b",
      {
        "version": "gemma3:12b",
        "vision": ["image"]
      }
    ]
  }
}
```

### DeepSeek API（OpenAI 格式）

```json
"models": {
  "deepseek[openai]": {
    "api_url": "https://api.deepseek.com/",
    "api_key": "your-api-key",
    "api_type": "openai",
    "versions": [
      {
        "version": "deepseek-chat"
      }
    ]
  }
}
```

### DeepSeek API（Anthropic 格式）

```json
"models": {
  "deepseek[anthropic]": {
    "api_url": "https://api.deepseek.com/anthropic",
    "api_key": "your-api-key",
    "api_type": "anthropic",
    "versions": [
      {
        "version": "deepseek-chat"
      }
    ]
  }
}
```

### GLM 模型

```json
"models": {
  "chatglm": {
    "api_url": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    "api_key": "your-api-key",
    "api_type": "openai",
    "versions": [
      "glm-4-flash",
      "glm-4-long",
      {
        "version": "glm-4v-flash",
        "vision": ["image"]
      }
    ]
  }
}
```

---

## ⚙️ 核心配置

### LLM 请求参数

```json
"llm_params": {
  "max_tokens": 4000,
  "temperature": 1.5,
  "stream": true
}
```

### 重试次数

```json
"retry_time": 10
```

### 快捷键

```json
"short_cut": "CommandOrControl+Shift+Space"
```

### 快捷键显示时间

```json
"icon_time": 5
```

### 历史记录路径

```json
"history_path": null
```

---

## 📋 信息模板

```json
"info_template": "Stage: {step}, Called: {model}, Version: {version}, Output:\n\n```json\n{output_format}\n```\n\n"
```

### 可用字段

| 字段 | 说明 |
|------|------|
| `{step}` | 当前阶段编号 |
| `{model}` | 当前使用的模型 |
| `{version}` | 当前模型版本 |
| `{query}` | 初始输入 |
| `{input}` | 当前阶段格式化输入 |
| `{output}` | 当前阶段原始输出 |
| `{outputs}` | 历史原始输出 |
| `{output_format}` | 当前阶段格式化输出 |
| `{output_formats}` | 历史格式化输出 |
| `{prompt}` | 初始系统提示词 |
| `{prompt_format}` | 当前阶段格式化系统提示词 |
| `{api_url}` | API 请求地址 |
| `{api_key}` | API 密钥 |

---

## 🧠 记忆配置

### 记忆长度

```json
"memory_length": 10
```

### 向量嵌入

```json
"embedding": {
  "base_url": "https://open.bigmodel.cn/api/paas/v4",
  "api_key": "",
  "model": "embedding-3",
  "dimension": 1024,
  "enabled": false
}
```

---

## ❤️ 心跳机制

```json
"heartbeat": {
  "enabled": false,
  "interval": 300
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用心跳机制 |
| `interval` | number | 心跳间隔（秒） |

---

## 🎛️ 功能状态

```json
"func_status": {
  "react": true,
  "clip": false,
  "text": false,
  "del": false
}
```

| 字段 | 说明 |
|------|------|
| `react` | 是否启用 ReAct 模式 |
| `clip` | 剪贴板功能 |
| `text` | 文本处理功能 |
| `del` | 删除功能 |

---

## 🔧 默认配置

```json
"default": {
  "model": "deepseek",
  "version": "deepseek-chat",
  "plugin": "baidu_translate",
  "tool_format": "toolcalls",
  "compress_context": false
}
```

| 字段 | 说明 |
|------|------|
| `model` | 默认模型提供商 |
| `version` | 默认模型版本 |
| `plugin` | 默认插件 |
| `tool_format` | 工具调用格式 |
| `compress_context` | 是否压缩上下文 |

---

## 🔗 SSH 配置

```json
"tool_call": {
  "ssh_config": {
    "enabled": false,
    "host": "127.0.0.1",
    "port": 22,
    "username": "root",
    "password": ""
  }
}
```

---

## 🧩 插件配置

### Python 执行

```json
"plugins": {
  "python_execute": {
    "params": {
      "python_bin": "python",
      "timeout": 3600,
      "delay_time": 5,
      "show": true,
      "threshold": 40000
    },
    "enabled": false,
    "require_confirmation": true
  }
}
```

### CLI 执行

```json
"plugins": {
  "cli_execute": {
    "params": {
      "bashrc": "/root/.bashrc",
      "timeout": 3600
    },
    "enabled": true,
    "require_confirmation": true
  }
}
```

### 浏览器客户端

```json
"plugins": {
  "browser_client": {
    "enabled": true
  }
}
```

### 网页抓取

```json
"plugins": {
  "web_crawler_toolkit": {
    "params": {
      "topk": 15
    },
    "enabled": true
  }
}
```

### MCP 服务

```json
"plugins": {
  "mcp_server": {
    "enabled": true
  }
}
```

---

## 🔗 链式调用配置

### 参数说明

- `input_*`: 调用模型前使用配置字段值格式化
- `output_*`: 调用模型后使用配置字段值格式化

### 基础对话

```json
"chain_call": [
  {
    "model": "deepseek",
    "input_template": "Current time: {time}\nSystem: {system}\nHistory:\n{history}\nUser: {query}",
    "output_template": "Step: {step}, Model: {model}, Output:\n{output}",
    "end": false
  },
  {
    "input_template": "Based on previous context:\n- query: {query}\n- answer:",
    "end": true
  }
]
```

### PDF 文件对话

```json
"chain_call": [
  {
    "model": "plugins",
    "version": "File reading",
    "input_data": {
      "file_path": "{file_path}"
    }
  },
  {
    "input_template": "The following is the text content from the PDF:\n\n<pdf>{output_formats[0]}</pdf>\n\nThe following is the user input:\n\n<user>{query}</user>\n\nPlease respond to the user input based on the PDF content.",
    "end": true
  }
]
```

### 可用模板字段

| 字段 | 说明 |
|------|------|
| `input_template` | 当前阶段输入格式化模板 |
| `output_template` | 当前阶段输出格式化模板 |
| `prompt_template` | 系统提示词格式化模板 |
| `end` | 链式调用结束标志 |

### 可用显示组件

- `system-prompt`: 系统提示词输入框
- `file-upload`: 文件上传按钮

---

## 🌐 Web 服务器

```json
"webserver": {
  "port": 3005
}
```

---

## 📌 配置示例

完整的配置示例请参考：

- `src/backend/configs/config_transagent.json` - TransAgent 模式配置
- `src/backend/configs/config_baseagent.json` - BaseAgent 模式配置
- `src/backend/configs/config_multagent.json` - MultiAgent 模式配置

更多链式调用示例请参考：

- `resources/chain_calls/`
