# 外部钩子开发说明

本文说明如何为 TransmAgent 接入外部脚本钩子，以及如何为智能体设计配套提示词。

## 1. 设计目标

当前钩子系统采用：

- **全局配置**：所有会话共享 `tool_call.external_hooks`
- **会话级触发**：每次触发时都会注入当前会话上下文
- **异步执行**：通过子进程异步启动，不阻塞主流程
- **脚本无关**：支持 Python、Bash、Shell 或任意可执行程序

## 2. 配置结构

运行时配置应写入用户安装目录下的配置副本，而不是直接修改仓库里的示例配置文件。

常见落点：

- `~/.transmagent/configs/config_transagent.json`
- `~/.transmagent/configs/config_<agent>.json`

其中 Hook 配置必须放在 `tool_call.external_hooks` 下。仓库内的 `configs/config_transagent.json` 仅适合作为结构参考。

```json
{
  "tool_call": {
    "external_hooks": {
      "react_loop_before": {
        "enabled": true,
        "command": "python ./examples/hooks/python_hook.py",
        "cwd": "."
      },
      "tool_call_after": {
        "enabled": true,
        "command": "bash ./examples/hooks/bash_hook.sh",
        "cwd": "."
      },
      "heartbeat_before": {
        "enabled": true,
        "command": "python ./examples/hooks/heartbeat_hook.py",
        "cwd": "."
      },
      "heartbeat_after": {
        "enabled": true,
        "command": "python ./examples/hooks/heartbeat_hook.py",
        "cwd": "."
      }
    }
  }
}
```

字段说明：

- `enabled`：是否启用该事件钩子
- `command`：要执行的命令字符串
- `cwd`：子进程工作目录，可选
- `shell`：可选；默认启用 shell 执行
- `env`：可选；附加环境变量对象

## 3. 生命周期事件

### ReAct 主循环级别
- `react_loop_before`
- `react_loop_after`

适合：
- 整轮 trace 开始/结束打点
- 统计单轮耗时
- 汇总轮级别上下文

### 单步 step 级别
- `react_step_before`
- `react_step_after`

适合：
- 单步推理观察
- 中断、暂停、报错、完成状态审计
- 构建 step 级监控

### 工具调用级别
- `tool_call_before`
- `tool_call_after`

适合：
- 工具调用审计
- 参数检查
- 结果摘要记录
- 调用成本统计

### 后台任务级别
- `background_task_before`
- `background_task_after`

适合：
- 后台任务结果回流监控
- 多智能体消息注入观察
- 唤醒链路埋点

### 调度心跳级别
- `heartbeat_before`
- `heartbeat_after`

适合：
- 周期调度前注入任务
- 回写调度态环境变量
- 为 recurring 任务提供外部编排入口

说明：
- 外部任务注入入口只发生在 heartbeat 事件层，而不是普通 tool call 或 step 事件层
- `heartbeat_before` 更适合返回待执行 `tasks`
- `heartbeat_after` 更适合回写本轮调度结果相关的 `env`

## 4. 环境变量契约

每次触发时，外部脚本都会收到：

- `TRANSMAGENT_HOOK_EVENT`
- `TRANSMAGENT_HOOK_PAYLOAD`

其中 `TRANSMAGENT_HOOK_PAYLOAD` 是 JSON 字符串，通常包含：

- `event`
- `timestamp`
- `agent_name`
- `session_id`
- `group_id`
- `context_id`
- `step`
- `state`
- `mode`
- `payload`

不同事件的 `payload` 不同，例如：

- `tool_call_before/after`：通常包含 `tool_name`、`tool_call_id`、`params`
- `react_step_after`：通常包含 `status`、`error_message`、`tool_count`
- `background_task_after`：通常包含 `wake_reason`、`task_id`

## 5. heartbeat 返回值约定

`heartbeat_before` 与 `heartbeat_after` 支持脚本通过标准输出返回 JSON，系统会解析并注入当前会话。

调度器行为约定：

- `heartbeat_before` 返回的 `tasks` 会在本轮调度中追加到当前会话任务系统
- `heartbeat_before` 或 `heartbeat_after` 返回的 `env` 会写入当前会话环境变量
- 非 heartbeat 事件即使脚本输出 JSON，也不作为任务注入入口使用

返回结构示例：

```json
{
  "env": {
    "last_heartbeat_triggered_at": "2026-07-08T16:40:00Z"
  },
  "tasks": [
    {
      "task": "Heartbeat hook injected task",
      "task_type": "standard",
      "subtasks": [
        "Review scheduler heartbeat triggered at 2026-07-08T16:40:00Z"
      ],
      "update_mode": "append"
    }
  ]
}
```

字段约定：

- `env`：键值对对象；会写入当前会话环境变量
- `tasks`：任务数组；每项会注入当前会话任务系统
- `task`：新建任务标题；当未提供 `task_id` 时必填
- `task_id`：可选；用于更新已有任务
- `subtasks`：字符串数组；会被注入为待处理子任务
- `task_type`：可选；支持 `standard` 与 `recurring`
- `trigger_condition`：可选；为 recurring 任务补充触发条件
- `update_mode`：可选；支持 `append` 与 `replace_pending`

最小示例可参考：`examples/hooks/heartbeat_hook.py`

## 6. 推荐开发规范

1. **快速返回**：不要在钩子内执行长时阻塞逻辑。
2. **容错解析**：必须处理 JSON 解析失败场景。
3. **幂等输出**：优先追加日志，不要覆盖关键文件。
4. **外部依赖隔离**：脚本自身依赖应独立维护。
5. **避免反向控制主流程**：当前设计是观察者模型，不应假设能阻断主执行。

## 7. 推荐用途

- 运行审计与安全留痕
- Prompt / Tool trace 采样
- Langfuse / ELK / ClickHouse / Kafka 等外部观测系统桥接
- 会话级统计、成本汇总、错误告警
- 子智能体与后台结果链路分析

## 8. 不推荐用途

- 在钩子内直接做重型数据处理
- 在钩子里等待主系统返回结果
- 把钩子当成同步审批闸门
- 依赖钩子写入才能保证主流程正确性

## 9. 智能体接入建议

如果希望某个智能体“理解自己处于钩子观测系统中”，建议在它的提示词中明确说明：

- 哪些事件会被外部观察
- 钩子只做观察，不保证回调结果参与推理
- 哪些字段会进入外部系统
- 何时应输出简明、结构化、稳定的结果，便于下游消费

可直接参考：`src/backend/src/core/prompts/hook_aware_agent.ts`
