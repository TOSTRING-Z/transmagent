#!/usr/bin/env python3
"""
ReAct Agent 批量任务执行器 — MIX50 并行版 (FIXED v10)
修复内容:
1. 字段级JSON清洗 — 处理API返回的数字字段值污染（中文/罗马数字等）
2. 中文逗号→ASCII逗号预处理 — 保证JSON结构完整
3. 正则兜底提取command — JSON完全损坏时直接提取命令
4. 孤立重复键行删除 — 智能处理API重复生成timeout等字段
5. matplotlib Agg后端提示
6. max_iter 提升至 30
"""

import os, json, re, subprocess, time, uuid, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List

for k in list(os.environ.keys()):
    if k.lower() in ["http_proxy", "https_proxy", "all_proxy", "ftp_proxy",
                      "socks_proxy", "no_proxy", "all_proxy"]:
        del os.environ[k]
os.environ['no_proxy'] = '*'

from openai import OpenAI

CONFIG = {
    "output_file": "/home/tostring/桌面/document/NM改稿/MIX50/react_results.json",
    "data_file": "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json",
    "work_base": "/home/tostring/桌面/document/NM改稿/MIX50/run_ReAct",
}

API_KEY = "sk-uAG0bRv1YefsNDxO6zI3Hw4qOKJbivehSjCASkdMD3Dbd6BH"
API_BASE = "https://runapi.co/v1"
MODEL = "deepseek-v3.2"

MAX_WORKERS = 10
MAX_RETRIES = 3
LAUNCH_INTERVAL = 4
TIMEOUT = 3600
MAX_ITER = 30

NUMERIC_KEYS = {"timeout", "max_iter", "retries", "top_n",
                "limit", "count", "topk", "max_results"}
NUMERIC_DEFAULTS = {"timeout": 60, "max_iter": 20, "retries": 3,
                    "top_n": 10, "limit": 100, "count": 10,
                    "topk": 10, "max_results": 20}


class TaskStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


def execute_shell_command(command: str, timeout: int = 60) -> str:
    try:
        result = subprocess.run(command, shell=True, capture_output=True,
                                text=True, timeout=timeout, executable='/bin/bash')
        output = result.stdout
        if result.stderr:
            output += f"\n[STDERR]\n{result.stderr}"
        if result.returncode != 0:
            output += f"\n[EXIT CODE: {result.returncode}]"
        return output.strip() or "[命令执行完成，无输出]"
    except subprocess.TimeoutExpired:
        return f"[错误] 命令执行超时 (timeout={timeout}s)"
    except Exception as e:
        return f"[错误] {str(e)}"


TOOL_FUNCTIONS = {"execute_shell_command": execute_shell_command}

TOOLS_DESCRIPTION = """# 可用工具：
1. execute_shell_command - 执行bash代码
   参数：
   - command (string, 必需): 要执行的bash代码
   - timeout (integer, 可选): 超时时间（秒），默认60秒"""


class ReActAgent:
    def __init__(self):
        self.client = OpenAI(api_key=API_KEY, base_url=API_BASE)

    def parse_json_response(self, content: str) -> dict:
        import unicodedata

        def _fix_numeric_field_values(text: str) -> str:
            for key in NUMERIC_KEYS:
                default = str(NUMERIC_DEFAULTS.get(key, 0))
                text = re.sub(rf'("{key}"\s*:\s*"[^"]*?)，([^"]*?")',
                             r'\1,\2', text)
                text = re.sub(rf'("{key}"\s*:\s*)([^,\n\r}}]*?)，',
                             r'\1\2,', text)
                pattern = (rf'("{key}"\s*:\s*)"?([^,\n\r}}]*?)"?'
                          rf'(\s*(?:,|\n|(?=}})|$))')
                def _repl(m):
                    prefix, vc, suffix = m.group(1), m.group(2), m.group(3)
                    digits = re.findall(r'\d+', vc)
                    if digits:
                        return f'{prefix} {digits[0]}{suffix}'
                    else:
                        return f'{prefix} {default}{suffix}'
                text = re.sub(pattern, _repl, text)
            return text

        def _fix_missing_commas(text: str) -> str:
            text = re.sub(r'([^,\s\n\r}])\s*\n\s*(")', r'\1,\n    \2', text)
            return text

        def _remove_orphan_duplicate_keys(text: str) -> str:
            lines = text.split('\n')
            for key in NUMERIC_KEYS:
                key_lines = []
                for i, line in enumerate(lines):
                    if line == '':
                        continue
                    if re.search(rf'"{key}"\s*:', line):
                        is_orphan = bool(re.match(
                            rf'^\s*"{key}"\s*:\s*\d+\s*,?\s*$', line))
                        has_structure = bool(re.search(r'[{{}}]', line))
                        key_lines.append((i, is_orphan, has_structure))
                if len(key_lines) <= 1:
                    continue
                structural = [(i, o, h) for i, o, h in key_lines if h]
                orphans = [(i, o, h) for i, o, h in key_lines if o and not h]
                if structural:
                    keep_idx = structural[-1][0]
                    for i, o, h in key_lines:
                        if i != keep_idx and o:
                            lines[i] = ''
                else:
                    for i, o, h in key_lines[:-1]:
                        if o:
                            lines[i] = ''
            return '\n'.join(l for l in lines if l != '')

        def _regex_extract_command(text: str) -> dict:
            tm = re.search(r'"thinking"\s*:\s*"([^"]*)"', text)
            thinking = tm.group(1)[:200] if tm else ""
            cmds = re.findall(r'"command"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
            if not cmds:
                return None
            command = None
            for c in cmds:
                c = c.replace('\\"', '"').replace('\\n', '\n')
                if len(c) > 5:
                    command = c
                    break
            if not command and cmds:
                command = cmds[0]
            if not command:
                return None
            timeout = 60
            tms = re.findall(r'"timeout"\s*:\s*"?(\d+)"?', text)
            if tms:
                try:
                    timeout = int(tms[-1])
                except ValueError:
                    pass
            return {"thinking": thinking, "tool": "execute_shell_command",
                    "params": {"command": command, "timeout": timeout}}

        def _clean(text):
            text = ''.join(c for c in text
                          if unicodedata.category(c)[0] != 'C' or c in '\n\r\t ')
            text = _fix_numeric_field_values(text)
            text = _remove_orphan_duplicate_keys(text)
            text = _fix_missing_commas(text)
            text = re.sub(r'\n{3,}', '\n\n', text)
            return text

        def _try_parse_json(text):
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                pass
            cleaned = _clean(text)
            if cleaned != text:
                try:
                    return json.loads(cleaned)
                except json.JSONDecodeError:
                    pass
            return None

        result = _try_parse_json(content)
        if result is not None and "tool" in result:
            return result
        for pat in [r'```json\s*([\s\S]*?)\s*```', r'```\s*([\s\S]*?)\s*```']:
            for m in re.findall(pat, content):
                if isinstance(m, str):
                    result = _try_parse_json(m)
                    if result is not None and "tool" in result:
                        return result
        brace = re.search(r'\{[\s\S]*\}', content)
        if brace:
            result = _try_parse_json(brace.group())
            if result is not None and "tool" in result:
                return result
        result = _regex_extract_command(content)
        if result is not None:
            return result
        return None

    def run(self, task: str, run_dir: str, max_iter: int = MAX_ITER) -> dict:
        os.makedirs(run_dir, exist_ok=True)

        messages = [
            {"role": "system", "content": f"""你是一个自主任务执行智能体，请按照ReAct模式完成任务：思考 -> 行动 -> 观察。
当需要使用工具时，请严格按照以下JSON格式回复：
```json
{{
    "thinking": "这里是你的思考过程，分析当前情况和下一步计划",
    "tool": "execute_shell_command",
    "params": {{
        "command": "要执行的命令",
        "timeout": 60
    }}
}}
```
当任务完成时，直接回复最终答案，不需要JSON格式。

【目录限制】所有探索过程、中间文件和结果文件必须严格保存在 {run_dir} 下，严禁读写其他路径。

⚠️ 绘图注意事项：
1. 使用Python绘图前，必须先执行: export MPLBACKEND=Agg
2. Python脚本中必须在import matplotlib之前加: import matplotlib; matplotlib.use('Agg')
3. timeout值必须是纯数字，如 60、120、300

{TOOLS_DESCRIPTION}
"""},
            {"role": "user", "content": task}
        ]

        for i in range(max_iter):
            response = self.client.chat.completions.create(
                model=MODEL, messages=messages)
            msg = response.choices[0].message
            content = msg.content or ""
            messages.append({"role": "assistant", "content": content})

            parsed = self.parse_json_response(content)
            if parsed is None:
                return {"final_response": content, "messages": messages}

            if "tool" not in parsed or "params" not in parsed:
                return {"final_response": content, "messages": messages}

            tool_name = parsed.get("tool")
            params = parsed.get("params", {})
            if tool_name in TOOL_FUNCTIONS:
                tool_result = TOOL_FUNCTIONS[tool_name](**params)
                messages.append(
                    {"role": "user", "content": f"[观察结果]\n{tool_result}"})
            else:
                messages.append(
                    {"role": "user", "content": f"[错误] 未知工具: {tool_name}"})

        return {"final_response": "[达到最大迭代次数]", "messages": messages}


class TaskProcessor:
    def __init__(self, config: dict):
        self.config = config
        self.work_base = config.get("work_base")
        self.results = []
        self.processed_tasks = set()
        self.results_lock = threading.Lock()

        os.makedirs(self.work_base, exist_ok=True)
        os.makedirs(os.path.dirname(self.config["output_file"]), exist_ok=True)

        self._load_existing_results()

    def _load_existing_results(self):
        """断点续传：从 react_results.json 加载已完成的任务"""
        if os.path.exists(self.config["output_file"]):
            try:
                with open(self.config["output_file"], "r", encoding="utf-8") as f:
                    existing_data = json.load(f)
                    self.results = existing_data
                    self.processed_tasks = {r["task"] for r in existing_data
                                            if r.get("status") == "success"}
                    print(f"✅ 断点续传: 已加载 {len(self.processed_tasks)} 个已完成任务")
            except Exception as e:
                print(f"⚠️  加载聚合结果失败: {e}")

    def _save_results(self):
        with self.results_lock:
            try:
                with open(self.config["output_file"], "w", encoding="utf-8") as f:
                    json.dump(self.results, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"❌ 保存结果失败: {e}")

    def get_task_work_dir(self, task_data: dict) -> str:
        task_id = str(task_data.get("id", uuid.uuid4().hex[:8]))
        category = str(task_data.get("category", "unknown")).replace(
            "/", "_").replace("\\", "_").replace(" ", "_")
        return os.path.join(self.work_base, f"{task_id}_{category}")

    def run_task(self, task_data: dict) -> bool:
        task_id = str(task_data.get("id", "unknown"))
        task_text = task_data.get("task", "")
        category = task_data.get("category", "unknown")
        work_dir = self.get_task_work_dir(task_data)

        # 断点续传：已完成则跳过
        if task_text in self.processed_tasks:
            print(f"  [跳过] 任务 [{task_id}] 已完成")
            return True

        os.makedirs(work_dir, exist_ok=True)
        start_time = time.time()

        try:
            agent = ReActAgent()
            result = agent.run(task_text, run_dir=work_dir)
            duration = round(time.time() - start_time, 2)

            final_response = result.get("final_response", "")
            is_success = bool(
                final_response and "[达到最大迭代次数]" not in final_response)

            record_status = (TaskStatus.COMPLETED if is_success
                           else TaskStatus.FAILED)
        except Exception as e:
            duration = round(time.time() - start_time, 2)
            result = {"final_response": f"[执行错误] {e}", "messages": []}
            final_response = result["final_response"]
            record_status = TaskStatus.FAILED
            print(f"  ❌ [#{task_id}] 异常: {e}")

        # 保存单任务结果
        per_task_result = {
            "task_id": task_id, "category": str(category),
            "task": task_text, "final_response": final_response,
            "duration_sec": duration,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": record_status,
            "messages": result.get("messages", []),
        }
        per_result_path = os.path.join(work_dir, "result.json")
        try:
            with open(per_result_path, "w", encoding="utf-8") as f:
                json.dump(per_task_result, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

        # 追加到聚合结果（断点续传的唯一依据）
        record = {
            **task_data,
            "response": {"final_response": final_response,
                         "messages": result.get("messages", [])},
            "duration_sec": duration,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": "success" if record_status == TaskStatus.COMPLETED
                      else "failed",
        }
        with self.results_lock:
            self.results.append(record)
            if record_status == TaskStatus.COMPLETED:
                self.processed_tasks.add(task_text)
        self._save_results()

        if record_status == TaskStatus.COMPLETED:
            print(f"  ✅ [#{task_id}] 完成 ({duration}s)")
        else:
            print(f"  ❌ [#{task_id}] 失败 ({duration}s)")

        return record_status == TaskStatus.COMPLETED

    def run_all(self):
        print("=" * 60)
        print("🧠 ReAct Agent 批量执行器 — MIX50 并行版 (FIXED)")
        print("=" * 60)
        print(f"数据文件: {self.config['data_file']}")
        print(f"工作目录: {self.work_base}")
        print(f"输出文件: {self.config['output_file']}")
        print(f"模型: {MODEL}")
        print(f"API Base: {API_BASE}")
        print(f"Max Iter: {MAX_ITER}")
        print("=" * 60)

        try:
            with open(self.config["data_file"], "r", encoding="utf-8") as f:
                tasks_data = json.load(f)
        except Exception as e:
            print(f"❌ 加载任务文件失败: {e}")
            return 0, 0

        # 断点续传: 基于 react_results.json 中的 processed_tasks
        already_done = len(self.processed_tasks)
        print(f"共 {len(tasks_data)} 个任务 | 已完成 {already_done} | "
              f"待执行 {len(tasks_data) - already_done}")

        pending = []
        for q in tasks_data:
            task_text = q.get("task", "")
            if not task_text:
                continue
            if task_text in self.processed_tasks:
                continue
            pending.append(q)

        if not pending:
            print("所有任务已完成!")
            return already_done, 0

        print(f"\n{'='*60}")
        print(f"⚡ 并行模式: 最大 {MAX_WORKERS} 并发 | 提交间隔 {LAUNCH_INTERVAL}s")
        print(f"待处理: {len(pending)} 个任务")
        print(f"{'='*60}\n")

        _exec_sem = threading.Semaphore(MAX_WORKERS)

        def _run_with_retry(q):
            task_id = str(q.get("id", "unknown"))
            cat = str(q.get("category", ""))[:18]
            task_preview = q.get("task", "")[:60]

            _exec_sem.acquire()
            try:
                print(f"  🚀 [#{task_id}] 开始 | {cat} | {task_preview}...")
                for attempt in range(MAX_RETRIES + 1):
                    if attempt > 0:
                        print(f"  [重试] 任务 [{task_id}] ({attempt}/{MAX_RETRIES})")
                    success = self.run_task(q)
                    if success:
                        return task_id, True
                print(f"  [跳过] 任务 [{task_id}] 已达最大重试次数")
                return task_id, False
            finally:
                _exec_sem.release()

        success_count = 0
        fail_count = 0
        total_time_start = time.time()

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {}
            for i, q in enumerate(pending):
                task_id = str(q.get("id", "unknown"))
                future = executor.submit(_run_with_retry, q)
                futures[future] = task_id
                if i < len(pending) - 1:
                    time.sleep(LAUNCH_INTERVAL)

            for future in as_completed(futures):
                try:
                    task_id, success = future.result()
                    if success:
                        success_count += 1
                    else:
                        fail_count += 1
                except Exception as e:
                    fail_count += 1
                    task_id = futures[future]
                    print(f"  ❌ [#{task_id}] 异常: {e}")

        total_elapsed = time.time() - total_time_start
        print("\n" + "=" * 60)
        print("🎉 执行完成!")
        final_done = len(self.processed_tasks)
        final_fail = fail_count
        print(f"最终结果: 成功 {final_done}, 失败 {final_fail}")
        print(f"总耗时: {total_elapsed:.0f}s ({total_elapsed/60:.1f}min)")
        return final_done, final_fail


if __name__ == "__main__":
    processor = TaskProcessor(CONFIG)
    try:
        processor.run_all()
    except KeyboardInterrupt:
        print("\n🛑 收到中断信号，进度已保存。")
