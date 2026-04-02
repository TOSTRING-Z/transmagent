# 常见问题（FAQ）

## 1. 安装与配置

### Q1.1：如何安装 TransMAgent？

**答**：
```bash
# 1. 克隆项目
git clone https://github.com/TOSTRING-Z/TransMAgent.git
cd TransMAgent

# 2. 安装依赖
pnpm install

# 3. 构建项目
pnpm run build

# 4. 启动应用
pnpm start
```

### Q1.2：配置文件位于哪里？

**答**：
TransMAgent 使用两级配置文件机制：

| 类型 | 路径 |
|------|------|
| 系统默认配置 | `src/backend/configs/config_*.json` |
| 用户配置 | `~/.transmagent/story.json` |

用户配置会自动覆盖系统默认配置。

### Q1.3：如何配置 API 密钥？

**答**：在配置面板或 `~/.transmagent/story.json` 中添加：

```json
{
  "models": {
    "deepseek[openai]": {
      "api_key": "your-api-key-here"
    }
  }
}
```

### Q1.4：如何启用 Ollama 本地模型？

**答**：
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

## 2. 运行与使用

### Q2.1：四种行为模式有什么区别？

| 模式 | 说明 |
|------|------|
| **AUTO** | 全流程自动执行，无需人工干预 |
| **ACT** | 允许交互与中途反馈 |
| **PLAN** | 生成完整分析计划后再执行 |
| **FLASH** | 快速响应简单问题 |

### Q2.2：三种代理模式分别适用于什么场景？

| 模式 | 适用场景 |
|------|---------|
| **TransAgent** | 转录调控领域任务分析（默认） |
| **MultiAgent** | 复杂多步骤任务，需要多智能体协作 |
| **BaseAgent** | 通用指令处理，简单任务 |

### Q2.3：如何切换代理模式？

**答**：
1. 通过侧边栏选择代理模式
2. 或在配置文件中设置 `~/.transmagent/story.json`

### Q2.4：上下文压缩有什么用？

**答**：
启用上下文压缩后，系统会自动移除历史对话中的思考过程，仅保留最终结果，从而节省 tokens 使用量。

---

## 3. 工具使用

### Q3.1：内置工具有哪些？

| 类别 | 工具 |
|------|------|
| 文件操作 | `list_dir`, `write_to_file`, `search_files`, `display_file`, `replace_in_file` |
| 代码执行 | `python_execute`, `cli_execute` |
| 浏览器 | `browser_client`, `web_crawler_toolkit` |
| 图像处理 | `image_vision` |
| MCP 服务 | `mcp_server` |

### Q3.2：如何启用 Python 执行？

**答**：
```json
{
  "plugins": {
    "python_execute": {
      "enabled": true
    }
  }
}
```

### Q3.3：如何配置 SSH 远程执行？

**答**：
```json
{
  "tool_call": {
    "ssh_config": {
      "enabled": true,
      "host": "your-server-ip",
      "port": 22,
      "username": "root",
      "password": "your-password"
    }
  }
}
```

### Q3.4：如何调用 BioTools MCP 服务？

**答**：
```json
{
  "plugins": {
    "mcp_server": {
      "enabled": true,
      "params": {
        "url": "http://localhost:3000"
      }
    }
  }
}
```

---

## 4. 数据与记忆

### Q4.1：记忆存储在哪里？

**答**：
- 精确记忆（PM）：`~/.transmagent/memory_precise.json`
- 模糊记忆（FM）：`~/.transmagent/memory_fuzzy.json`
- 会话历史：`~/.transmagent/history.json`

### Q4.2：如何清除记忆？

**答**：
删除记忆文件并重启应用：
```bash
rm ~/.transmagent/memory_*.json
rm ~/.transmagent/history.json
```

### Q4.3：向量搜索有什么用？

**答**：
向量搜索允许通过语义相似度检索历史记忆，提高复杂任务中的信息回溯能力。

---

## 5. 错误处理

### Q5.1：API 调用失败怎么办？

**答**：
1. 检查 API 密钥是否正确配置
2. 确认网络可以访问 API 服务
3. 查看配置文件中的 `retry_time` 设置
4. 检查日志文件中的详细错误信息

### Q5.2：端口被占用怎么办？

**答**：
```bash
# Linux/macOS
lsof -i :3005
kill -9 <pid>

# Windows
netstat -ano | findstr :3005
taskkill /PID <pid> /F
```

### Q5.3：文件操作失败怎么办？

**答**：
1. 检查文件路径是否正确
2. 确认有足够的读写权限
3. 检查磁盘空间是否充足
4. 对于远程文件，确认 SSH 配置正确

### Q5.4：模型输出被截断怎么办？

**答**：
TransMAgent 内置智能续传机制：
- 自动检测截断（`finish_reason: length`）
- 自动恢复并继续执行
- 最多自动重试 3 次

---

## 6. 性能优化

### Q6.1：如何减少 token 消耗？

**答**：
1. 启用上下文压缩：`compress_context: true`
2. 使用较短的对话历史
3. 定期清理不再需要的会话
4. 使用本地模型替代云端 API

### Q6.2：如何提升响应速度？

**答**：
1. 使用本地 Ollama 模型
2. 减少 `max_step` 设置
3. 关闭不必要的插件
4. 使用性能更好的硬件

### Q6.3：内存占用过高怎么办？

**答**：
1. 减少历史记录保留数量
2. 启用上下文压缩
3. 定期重启应用清理内存
4. 限制单次任务的最大步骤数

---

## 7. 开发与扩展

### Q7.1：如何添加自定义工具？

**答**：
1. 在 `src/backend/src/tools/` 目录下创建新的工具文件
2. 在 `base_tools.ts` 中注册工具定义
3. 在技能配置文件中添加工具说明

### Q7.2：如何创建新的代理模式？

**答**：
1. 在 `src/backend/prompts/` 下创建新的提示词文件
2. 在 `src/backend/configs/` 下创建对应的配置文件
3. 在 `src/backend/src/utils/globals.ts` 中注册新模式

### Q7.3：如何调试工具调用？

**答**：
1. 开启日志记录
2. 使用 `display_file` 工具查看日志文件
3. 检查工具返回的 JSON 格式是否正确

---

## 8. 其他问题

### Q8.1：如何查看版本信息？

**答**：
```bash
# 查看 package.json
cat package.json | grep version
```

### Q8.2：如何联系开发者？

**答**：
- Email: mp798378522@gmail.com
- GitHub Issues: https://github.com/TOSTRING-Z/TransMAgent/issues

### Q8.3：如何贡献代码？

**答**：
1. Fork 项目仓库
2. 创建新分支
3. 提交代码变更
4. 创建 Pull Request

---

## 9. 参考链接

| 资源 | 链接 |
|------|------|
| 项目仓库 | https://github.com/TOSTRING-Z/TransMAgent |
| BioTools MCP | `./biotools/mcp_server` |
| 插件文档 | `./resources/plugins` |
| 配置示例 | `CONFIG.md` |
