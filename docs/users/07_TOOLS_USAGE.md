# 工具使用指南

## 1. 工具概览

TransMAgent 提供多种内置工具，帮助智能体完成文件操作、代码执行、网页浏览等任务。

### 1.1 工具分类

| 类别 | 工具 | 说明 |
|------|------|------|
| 文件操作 | `list_dir` | 递归扫描目录 |
| 文件操作 | `write_to_file` | 创建或覆写文件 |
| 文件操作 | `search_files` | 正则表达式搜索文件内容 |
| 文件操作 | `display_file` | 读取并格式化显示文件 |
| 文件操作 | `replace_in_file` | 替换文件内容 |
| 代码执行 | `python_execute` | 执行 Python 代码 |
| 代码执行 | `cli_execute` | 执行命令行命令 |
| 浏览器 | `browser_client` | 浏览器自动化 |
| 浏览器 | `web_crawler_toolkit` | 网页内容抓取 |
| 图像处理 | `image_vision` | 图像识别与分析 |
| 错误处理 | `error_solution_search` | 搜索错误解决方案 |
| MCP 服务 | `mcp_server` | 调用 BioTools 等 MCP 服务 |

---

## 2. 文件操作工具

### 2.1 list_dir - 目录扫描

**功能**：递归扫描指定目录，返回文件和目录列表。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string | 目标目录路径 |
| `recursive` | boolean | 是否递归扫描子目录（默认 false） |
| `regex` | string | 文件名正则过滤模式 |

**示例**：
```json
{
  "path": "C:\\Users\\project\\src",
  "recursive": true,
  "regex": "\\.ts$"
}
```

**返回值**：
```json
{
  "files": ["file1.ts", "file2.ts"],
  "directories": ["utils", "core"]
}
```

### 2.2 write_to_file - 文件写入

**功能**：创建新文件或覆写现有文件内容。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 目标文件路径 |
| `content` | string | 文件内容 |
| `mode` | string | 写入模式：`overwrite` 或 `append` |
| `sshConfig` | object | SSH 配置（可选，用于远程写入） |

**示例**：
```json
{
  "file_path": "C:\\Users\\project\\test.txt",
  "content": "Hello, TransMAgent!",
  "mode": "overwrite"
}
```

### 2.3 search_files - 文件内容搜索

**功能**：使用正则表达式搜索文件内容。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `path` | string | 搜索起始目录 |
| `regex` | string | 正则表达式模式 |
| `file_pattern` | string | 文件名过滤模式（如 `*.ts`） |
| `timeout_ms` | number | 超时时间（毫秒） |

**示例**：
```json
{
  "path": "C:\\Users\\project\\src",
  "regex": "class\\s+\\w+",
  "file_pattern": "**/*.ts"
}
```

### 2.4 display_file - 文件读取

**功能**：读取并格式化显示文件内容。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 目标文件路径 |
| `start_line` | number | 起始行号（1-indexed） |
| `end_line` | number | 结束行号 |
| `format` | string | 强制特定格式（auto/text/table/image/pdf） |

**示例**：
```json
{
  "file_path": "C:\\Users\\project\\README.md",
  "start_line": 1,
  "end_line": 50
}
```

### 2.5 replace_in_file - 文本替换

**功能**：在文件中进行精确的文本替换。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 目标文件路径 |
| `diff` | string | 替换规则（包含 SEARCH 和 REPLACE 块） |
| `sshConfig` | object | SSH 配置（可选） |

**diff 格式**：
```
<<<<<<< SEARCH
[要替换的原始文本]
=======
[替换后的新文本]
>>>>>>> REPLACE
```

**示例**：
```
<<<<<<< SEARCH
const version = "1.0.0";
=======
const version = "2.0.0";
>>>>>>> REPLACE
```

---

## 3. 代码执行工具

### 3.1 python_execute - Python 执行

**功能**：在隔离环境中执行 Python 代码。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `code` | string | Python 代码 |
| `timeout` | number | 超时时间（秒，默认 3600） |

**示例**：
```json
{
  "code": "print('Hello from Python!')\nimport numpy as np\narr = np.array([1, 2, 3])\nprint(arr.sum())",
  "timeout": 60
}
```

**返回值**：
```json
{
  "output": "Hello from Python!\n6",
  "error": null
}
```

### 3.2 cli_execute - 命令行执行

**功能**：执行系统命令行命令。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `command` | string | 要执行的命令 |
| `timeout` | number | 超时时间（秒） |
| `cwd` | string | 工作目录 |

**示例**：
```json
{
  "command": "pnpm install",
  "timeout": 300,
  "cwd": "C:\\Users\\project"
}
```

---

## 4. 浏览器工具

### 4.1 browser_client - 浏览器自动化

**功能**：控制浏览器进行网页操作。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `operation` | string | 操作类型（open/close/navigate/execute_js/get_content） |
| `url` | string | 目标 URL |
| `action` | string | 具体动作（click/type/hover/scroll/screenshot） |
| `selector` | string | CSS 选择器 |

**示例**：
```json
{
  "operation": "navigate",
  "url": "https://www.example.com"
}
```

### 4.2 web_crawler_toolkit - 网页抓取

**功能**：抓取网页文本内容。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `action` | string | 操作类型（search/read_url） |
| `query` | array | 搜索关键词 |
| `url` | string | 目标 URL |
| `topk` | number | 返回结果数量 |

**示例**：
```json
{
  "action": "search",
  "query": ["transcription factor analysis"],
  "topk": 10
}
```

---

## 5. 图像处理工具

### 5.1 image_vision - 图像识别

**功能**：分析图像内容。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `file_path` | string | 图像文件路径 |
| `prompt` | string | 分析指令 |

**示例**：
```json
{
  "file_path": "C:\\Users\\project\\image.png",
  "prompt": "描述这张图片的内容"
}
```

---

## 6. MCP 服务工具

### 6.1 mcp_server - MCP 服务调用

**功能**：调用 BioTools 等 MCP 服务。

**参数**：
| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | string | MCP 服务名称 |
| `args` | object | 服务参数 |

**示例**：
```json
{
  "name": "biotools",
  "args": {
    "tool": "homer_findMotifs",
    "genome": "hg38",
    "input": "peaks.bed"
  }
}
```

---

## 7. 任务管理工具

### 7.1 add_subtasks - 添加子任务

**功能**：将复杂任务分解为可管理的子任务。

**示例**：
```json
{
  "task": "分析转录因子结合位点",
  "subtasks": [
    "数据预处理",
    "peak calling",
    "motif 分析",
    "结果可视化"
  ]
}
```

### 7.2 record_subtasks - 记录任务状态

**功能**：更新子任务执行状态。

**示例**：
```json
{
  "subtask_ids": [1, 2],
  "status": "completed",
  "reflection": "前两个步骤已完成"
}
```

---

## 8. 下一步

- 查看常见问题？请阅读 `08_FAQ.md`
