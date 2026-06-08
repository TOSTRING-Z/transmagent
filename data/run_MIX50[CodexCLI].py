#!/usr/bin/env python3
"""
Codex CLI 批量任务执行器 — MIX50 适配版
Codex CLI v0.80.0 + Codex-Relay (port 4002) + LiteLLM → DeepSeek
"""

import os, json, time, subprocess, signal, shutil, glob, uuid

CONFIG = {
    "output_file": "/home/tostring/桌面/document/NM改稿/MIX50/codex_cli_results.json",
    "data_file": "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json",
    "model": "deepseek-v3.2",
    "max_duration": 3600,
    "relay_url": "http://localhost:4002",
}

CODEX_ENV = {
    "CODEX_API_KEY": "sk-local-proxy-master-key",
    "SSL_CERT_FILE": "/etc/ssl/certs/ca-certificates.crt",
}

CODEX_CONFIG = """[model_providers.litellm]
name = "LiteLLM-DeepSeek"
type = "openai"
base_url = "http://localhost:4446/v1"
api_key = "sk-local-proxy-master-key"

[profiles.default]
model_provider = "litellm"
model = "deepseek-v3.2"
"""


def ensure_codex_config():
    """确保 Codex CLI 配置文件存在"""
    config_dir = os.path.expanduser("~/.codex")
    config_path = os.path.join(config_dir, "config.toml")
    os.makedirs(config_dir, exist_ok=True)
    if not os.path.exists(config_path):
        with open(config_path, "w") as f:
            f.write(CODEX_CONFIG)
        print(f"[CONFIG] 已写入 Codex 配置: {config_path}")

SMART_PROMPT_PREFIX = """You are in STRICT AUTONOMOUS MODE. No user interaction is possible — any question or prompt for input will fail silently. Make all decisions independently.

- Answer in the question's language.

RUN_DIR_PLACEHOLDER

QUESTION TO ANSWER:
"""


def clean_environment():
    safe_keep = {"/tmp/.X11-unix", "/tmp/.ICE-unix", "/tmp/.font-unix", "/tmp/.Test-unix"}
    patterns = ["/tmp/*.py", "/tmp/*.csv", "/tmp/*.tsv", "/tmp/*.txt", "/tmp/*.json",
                "/tmp/*.png", "/tmp/*.pdf", "/tmp/*.svg", "/tmp/*.html", "/tmp/*.log",
                "/tmp/*.gz", "/tmp/*.tar", "/tmp/*.zip", "/tmp/*.fa", "/tmp/*.fasta",
                "/tmp/*.gtf", "/tmp/*.gff", "/tmp/*.bed", "/tmp/*.bam", "/tmp/*.bai",
                "/tmp/*.vcf", "/tmp/*.npy", "/tmp/*.npz", "/tmp/*.pkl", "/tmp/*.h5ad",
                "/tmp/*.R", "/tmp/*.RData", "/tmp/*.rda", "/tmp/*.rds",
                "/tmp/bg_output_*", "/tmp/output_*", "/tmp/tool_results_*",
                "/tmp/*.sh", "/tmp/*.yml", "/tmp/*.yaml", "/tmp/*.toml"]
    for pattern in patterns:
        for path in glob.glob(pattern):
            if path not in safe_keep:
                try: os.remove(path)
                except: pass
    for item in os.listdir("/tmp"):
        full = os.path.join("/tmp", item)
        if os.path.isdir(full) and item not in {".X11-unix", ".ICE-unix", ".font-unix", ".Test-unix"}:
            try: shutil.rmtree(full, ignore_errors=True)
            except: pass


def parse_codex_events(raw_output):
    events = []
    for line in raw_output.split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def merge_messages(events):
    messages = []
    cur_role, cur_content = None, ""

    for evt in events:
        t = evt.get("type", "")

        if t == "item.started":
            item = evt.get("item", {})
            if item.get("type") == "command_execution":
                if cur_role and cur_content:
                    messages.append({"role": cur_role, "content": cur_content})
                    cur_role, cur_content = None, ""
                messages.append({"role": "assistant", "content": f"[Tool: run_shell_command] {item.get('command', '???')}"})

        elif t == "item.completed":
            item = evt.get("item", {})
            item_type = item.get("type", "")

            if item_type == "agent_message":
                role = item.get("role", "assistant")
                text = item.get("text", item.get("content", ""))
                if isinstance(text, list):
                    text = "".join(b.get("text", "") if isinstance(b, dict) else str(b) for b in text)
                if text:
                    if role == cur_role:
                        cur_content += text
                    else:
                        if cur_role and cur_content:
                            messages.append({"role": cur_role, "content": cur_content})
                        cur_role, cur_content = role, text

            elif item_type == "command_execution":
                if cur_role and cur_content:
                    messages.append({"role": cur_role, "content": cur_content})
                    cur_role, cur_content = None, ""
                exit_code = item.get("exit_code", "?")
                output = item.get("aggregated_output", "")
                status = item.get("status", "completed")
                result = f"[Tool Result: exit={exit_code}, status={status}]"
                if output:
                    result += f"\n{str(output)[:5000]}"
                messages.append({"role": "user", "content": result})

            elif item_type == "function_call":
                if cur_role and cur_content:
                    messages.append({"role": cur_role, "content": cur_content})
                    cur_role, cur_content = None, ""
                tool_name = item.get("name", "unknown")
                params = item.get("arguments", item.get("input", ""))
                if isinstance(params, str):
                    try: params = json.loads(params)
                    except: pass
                messages.append({"role": "assistant", "content": f"[Tool: {tool_name} | params: {json.dumps(params, ensure_ascii=False)}]"})

            elif item_type == "function_call_output":
                if cur_role and cur_content:
                    messages.append({"role": cur_role, "content": cur_content})
                    cur_role, cur_content = None, ""
                output = item.get("output", item.get("result", ""))
                if isinstance(output, (list, dict)):
                    output = json.dumps(output, ensure_ascii=False)
                messages.append({"role": "user", "content": f"[Tool Result]\n{str(output)[:5000]}"})

        elif t in ("message", "assistant"):
            role = evt.get("role", "assistant")
            if role == "model": role = "assistant"
            content = ""
            if "content" in evt:
                c = evt["content"]
                if isinstance(c, list):
                    for block in c:
                        if isinstance(block, dict) and block.get("type") == "text":
                            content += block.get("text", "")
                        elif isinstance(block, str): content += block
                elif isinstance(c, str): content = c
            if not content and "text" in evt: content = evt["text"]
            if not content and "delta" in evt:
                d = evt["delta"]
                content = d.get("text", d.get("content", "")) if isinstance(d, dict) else str(d)
            if role == cur_role:
                cur_content += content
            else:
                if cur_role and cur_content:
                    messages.append({"role": cur_role, "content": cur_content})
                cur_role, cur_content = role, content

        elif t == "tool_use":
            if cur_role and cur_content:
                messages.append({"role": cur_role, "content": cur_content})
                cur_role, cur_content = None, ""
            messages.append({"role": "assistant", "content": f"[Tool: {evt.get('name', 'unknown')}]"})

        elif t == "tool_result":
            if cur_role and cur_content:
                messages.append({"role": cur_role, "content": cur_content})
                cur_role, cur_content = None, ""
            output = evt.get("output", evt.get("content", ""))
            messages.append({"role": "user", "content": f"[Tool Result]\n{str(output)[:5000]}"})

        elif t in ("error", "exception"):
            if cur_role and cur_content:
                messages.append({"role": cur_role, "content": cur_content})
                cur_role, cur_content = None, ""
            messages.append({"role": "system", "content": f"[Error] {evt.get('message', str(evt))}"})

    if cur_role and cur_content:
        messages.append({"role": cur_role, "content": cur_content})
    return messages


def extract_final(messages):
    for msg in reversed(messages):
        if msg["role"] != "assistant": continue
        c = msg["content"].strip()
        if c.startswith("[Tool:") or c.startswith("{") or c.startswith("<"): continue
        if len(c) > 0: return c
    return "[No response]"


def parse_react_trajectory(text):
    """
    解析 ReAct relay 输出的轨迹文本，拆分为多步消息。
    格式匹配 claude_code_results.json: 每条思考/工具调用单独一条消息
    """
    import re as _re
    messages = []
    
    # 按 ROUND 分割
    round_blocks = _re.split(r'=== ROUND \d+ ===\n?', text)
    round_blocks = [b.strip() for b in round_blocks if b.strip()]
    
    for block in round_blocks:
        # 分离代码块和文本
        parts = _re.split(r'(```bash\n.*?```)', block, flags=_re.DOTALL)
        
        for part in parts:
            part = part.strip()
            if not part:
                continue
            
            # 工具执行结果块
            if part.startswith('[TOOLS EXECUTED]'):
                # 解析每个工具结果
                tool_results = _re.split(r'\n\s*Tool \d+: ', part)
                for tr in tool_results:
                    tr = tr.strip()
                    if not tr or tr.startswith('[TOOLS'):
                        continue
                    # 提取命令
                    cmd_match = _re.match(r'(.*?)\n\s*Exit:', tr)
                    cmd = cmd_match.group(1).strip() if cmd_match else tr[:100]
                    # 提取 exit code
                    ec_match = _re.search(r'Exit:\s*(-?\d+)', tr)
                    ec = ec_match.group(1) if ec_match else '?'
                    # 提取输出
                    out_match = _re.search(r'Output:\n(.*?)$', tr, _re.DOTALL)
                    out = out_match.group(1).strip() if out_match else ''
                    
                    messages.append({
                        "role": "user",
                        "content": f"[Tool Result: exit={ec}]\n{out[:5000]}"
                    })
                continue
            
            # 代码块 → 工具调用
            if part.startswith('```bash'):
                code = part[7:-3].strip()  # 去掉 ```bash 和 ```
                for cmd_line in code.split('\n'):
                    cmd_line = cmd_line.strip()
                    if cmd_line and not cmd_line.startswith('#'):
                        messages.append({
                            "role": "assistant",
                            "content": f'[Tool: Bash | params: {{"command": {json.dumps(cmd_line)}}}]'
                        })
                continue
            
            # 普通文本 → 分段
            paragraphs = [p.strip() for p in part.split('\n\n') if p.strip()]
            for para in paragraphs:
                if len(para) > 0:
                    messages.append({
                        "role": "assistant",
                        "content": para[:10000]
                    })
    
    # 构建 final_response: 取最后一条有实质内容的 assistant 消息
    final = ""
    for msg in reversed(messages):
        if msg["role"] == "assistant" and not msg["content"].startswith("[Tool:"):
            final = msg["content"]
            break
    if not final and messages:
        final = messages[-1]["content"]
    
    return messages, final


def run_one(task, model, timeout=3600):
    run_id = uuid.uuid4().hex[:12]
    run_dir = f"/data/run/{run_id}"
    os.makedirs(run_dir, exist_ok=True)

    env = os.environ.copy()
    env.update(CODEX_ENV)
    constraint = f"【目录限制】所有探索过程、中间文件和结果文件必须严格保存在 {run_dir} 下，严禁读写其他路径，避免环境数据相互泄露。"
    full_prompt = SMART_PROMPT_PREFIX.replace("RUN_DIR_PLACEHOLDER", constraint) + task

    cmd = ["codex", "exec", full_prompt,
           "--dangerously-bypass-approvals-and-sandbox",
           "--json", "--model", model, "--skip-git-repo-check"]

    try:
        import threading
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, env=env, start_new_session=True)
        raw_lines, stderr_lines = [], []

        def read_stdout():
            for line in proc.stdout:
                raw_lines.append(line)
        def read_stderr():
            for line in proc.stderr:
                stderr_lines.append(line)

        t1 = threading.Thread(target=read_stdout, daemon=True)
        t2 = threading.Thread(target=read_stderr, daemon=True)
        t1.start(); t2.start()

        timed_out = False
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True

        t1.join(timeout=5); t2.join(timeout=5)

        if timed_out:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                proc.wait(timeout=5)
            except:
                try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except: pass
            return {"final_response": f"[Timeout] {timeout}s", "messages": [], "exit_code": -1, "timed_out": True}

        proc.wait()
        stdout_text = "".join(raw_lines).strip()
        stderr_text = "".join(stderr_lines).strip()

        # 原始管道：解析 JSONL → 合并消息 → 提取最终回复
        events = parse_codex_events("".join(raw_lines))
        messages = merge_messages(events)
        final = extract_final(messages)

        if not final or final == "[No response]":
            err_text = "\n".join([l for l in "".join(stderr_lines).split("\n")
                                  if "Debugger" not in l and "ws://" not in l
                                  and "STARTUP" not in l and "Deprecation" not in l
                                  and "heap" not in l and "hook" not in l and "STDERR" not in l]).strip()
            if err_text and len(err_text) > 50:
                messages.append({"role": "assistant", "content": err_text})
                final = err_text

        return {"final_response": final, "messages": messages, "exit_code": proc.returncode, "timed_out": False}
    except FileNotFoundError:
        return {"final_response": "[Error] codex CLI not found", "messages": [], "exit_code": -1, "timed_out": False}
    except Exception as e:
        return {"final_response": f"[Error] {e}", "messages": [], "exit_code": -1, "timed_out": False}


def main():
    ensure_codex_config()

    with open(CONFIG["data_file"], encoding="utf-8") as f:
        tasks = json.load(f)

    out = CONFIG["output_file"]
    existing = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else []
    done_ids = {d["id"] for d in existing if d["status"] == "success"}
    results = existing.copy()
    results_by_id = {d["id"]: d for d in results}

    for i, task_entry in enumerate(tasks):
        tid = task_entry["id"]
        if tid in done_ids:
            print(f"[SKIP] Task {tid}")
            continue

        question = task_entry.get("task", "")
        print(f"\n[{i+1}/{len(tasks)}] Task {tid} ({task_entry.get('category', 'N/A')})")

        clean_environment()
        t0 = time.time()
        resp = run_one(question, CONFIG["model"], CONFIG["max_duration"])
        elapsed = time.time() - t0

        record = {
            "id": tid, "question": question, "category": task_entry.get("category", ""),
            "response": resp, "duration_sec": round(elapsed, 1),
            "status": "success" if resp["final_response"] and len(resp["final_response"]) > 50 else "failed",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

        if tid in results_by_id:
            idx = next(j for j, d in enumerate(results) if d["id"] == tid)
            results[idx] = record
        else:
            results.append(record)
        results_by_id[tid] = record

        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    succ = [d for d in results if d["status"] == "success"]
    print(f"\nFINAL: {len(succ)}/{len(results)} success")


if __name__ == "__main__":
    main()
