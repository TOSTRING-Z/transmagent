# Hook Examples

本目录提供最小可用的外部钩子脚本示例。

## 文件

- `python_hook.py`：读取事件名与 JSON 负载，按事件名写入 `jsonl` 日志
- `bash_hook.sh`：读取事件名与 JSON 负载，按事件名追加纯文本日志
- `heartbeat_hook.py`：演示在 heartbeat 事件中返回 `tasks` 与 `env`，并将返回结果记录到日志

## 输入约定

脚本运行时可读取以下环境变量：

- `TRANSMAGENT_HOOK_EVENT`
- `TRANSMAGENT_HOOK_PAYLOAD`
- `TRANSMAGENT_HOOK_OUTPUT_DIR`（可选）

## 运行时配置提示

启用这些示例时，请把 Hook 配置写入用户安装目录下的运行时配置副本，例如：

- `~/.transmagent/configs/config_transagent.json`
- `~/.transmagent/configs/config_<agent>.json`

正确落点是 `tool_call.external_hooks`。不要把是否生效建立在直接修改仓库内 `configs/...` 示例文件之上。

## 快速试用

### Python

```bash
TRANSMAGENT_HOOK_EVENT=tool_call_after \
TRANSMAGENT_HOOK_PAYLOAD='{"payload":{"tool_name":"display_file"}}' \
python ./examples/hooks/python_hook.py
```

### Bash

```bash
TRANSMAGENT_HOOK_EVENT=react_loop_before \
TRANSMAGENT_HOOK_PAYLOAD='{"payload":{"query":"hello"}}' \
bash ./examples/hooks/bash_hook.sh
```

### Heartbeat

`heartbeat_hook.py` 主要演示两件事：

- 在 `heartbeat_before` 返回 JSON，向当前会话注入 `tasks` 与 `env`
- 在 `heartbeat_after` 返回 JSON，回写调度结果相关的 `env`

这也是当前调度器接受外部任务注入的唯一事件层；普通工具事件不会把脚本 stdout 当成任务注入源。

```bash
TRANSMAGENT_HOOK_EVENT=heartbeat_before \
TRANSMAGENT_HOOK_PAYLOAD='{"payload":{"triggered_at":"2026-07-08T16:40:00Z"}}' \
python ./examples/hooks/heartbeat_hook.py
```

示例输出：

```json
{"env":{"last_heartbeat_triggered_at":"2026-07-08T16:40:00Z","last_heartbeat_source":"examples/hooks/heartbeat_hook.py"},"tasks":[{"task":"Heartbeat hook injected task","task_type":"standard","subtasks":["Review scheduler heartbeat triggered at 2026-07-08T16:40:00Z","Confirm hook-based task injection is working"],"update_mode":"append"}]}
```
