#!/usr/bin/env python3
"""
Gemini CLI 批量任务执行器 — MIX50 适配版
Gemini CLI + LiteLLM 适配器 (port 4001) → DeepSeek
基于 run_gemini_cli.md 架构文档重建
"""

import os, json, time, subprocess, signal, shutil, glob, uuid

CONFIG = {
    "output_file": "/home/tostring/桌面/document/NM改稿/MIX50/gemini_cli_results.json",
    "data_file": "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json",
    "model": "deepseek-chat",
    "max_duration": 3600,
}

GEMINI_ENV = {
    "GOOGLE_GEMINI_BASE_URL": "http://localhost:4001",
    "GEMINI_API_KEY": "dummy",
    "GEMINI_CLI_TRUST_WORKSPACE": "true",
}

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
    # 清理工具结果缓存
    cache = "/tmp/tool_results_store.json"
    if os.path.exists(cache):
        try: os.remove(cache)
        except: pass


def load_tool_outputs():
    cache = "/tmp/tool_results_store.json"
    if os.path.exists(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                return json.load(f)
        except:
            pass
    return {}


def parse_gemini_events(raw_output):
    events = []
    for line in raw_output.split("\n"):
        line = line.strip()
        if not line: continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events


def merge_messages(events):
    messages = []
    cur_role, cur_content = None, ""
    tool_outputs = load_tool_outputs()

    for evt in events:
        t = evt.get("type", "")

        if t == "message":
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
            tool_name = evt.get("tool_name", "unknown")
            params = evt.get("parameters", {})
            messages.append({"role": "assistant",
                             "content": f"[Tool: {tool_name} | params: {json.dumps(params, ensure_ascii=False)}]"})

        elif t == "tool_result":
            if cur_role and cur_content:
                messages.append({"role": cur_role, "content": cur_content})
                cur_role, cur_content = None, ""
            tool_id = evt.get("tool_id", "")
            status = evt.get("status", "?")
            output = tool_outputs.get(tool_id, evt.get("output", ""))
            if isinstance(output, (list, dict)): output = json.dumps(output, ensure_ascii=False)
            messages.append({"role": "user", "content": f"[Tool Result: {status}]\n{str(output)[:5000]}"})

        elif t in ("system", "init"):
            c = evt.get("content", evt.get("message", ""))
            if c:
                if cur_role and cur_content:
                    messages.append({"role": cur_role, "content": cur_content})
                    cur_role, cur_content = None, ""
                messages.append({"role": "system", "content": str(c)})

        elif t in ("error", "exception"):
            if cur_role and cur_content:
                messages.append({"role": cur_role, "content": cur_content})
                cur_role, cur_content = None, ""
            messages.append({"role": "system",
                             "content": f"[Error] {evt.get('message', evt.get('error', str(evt)))}"})

    if cur_role and cur_content:
        messages.append({"role": cur_role, "content": cur_content})
    return messages


def extract_final(messages):
    for msg in reversed(messages):
        if msg["role"] != "assistant": continue
        c = msg["content"].strip()
        if c.startswith("[Tool:"): continue
        if len(c) > 0: return c
    return "[No response]"


def run_one(task, model="deepseek-chat", timeout=3600):
    run_id = uuid.uuid4().hex[:12]
    run_dir = f"/data/run/{run_id}"
    os.makedirs(run_dir, exist_ok=True)

    env = os.environ.copy(); env.update(GEMINI_ENV)
    store_file = "/tmp/tool_results_store.json"
    if os.path.exists(store_file):
        try: os.remove(store_file)
        except: pass
    constraint = f"【目录限制】所有探索过程、中间文件和结果文件必须严格保存在 {run_dir} 下，严禁读写其他路径，避免环境数据相互泄露。"
    full_prompt = SMART_PROMPT_PREFIX.replace("RUN_DIR_PLACEHOLDER", constraint) + task
    cmd = ["gemini", "--model", model, "-p", full_prompt, "--output-format", "stream-json", "--yolo", "--sandbox", "false", "--skip-trust"]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, env=env, start_new_session=True, cwd="/")
        try: out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            try: out, err = proc.communicate(timeout=5)
            except: os.killpg(os.getpgid(proc.pid), signal.SIGKILL); proc.wait()
            return {"final_response": f"[Timeout] {timeout}s", "messages": [], "exit_code": -1, "timed_out": True}
        events = []
        for line in out.split("\n"):
            line = line.strip()
            if not line: continue
            try: events.append(json.loads(line))
            except json.JSONDecodeError: continue
        tool_outputs = load_tool_outputs()
        messages = merge_messages(events)
        final = extract_final(messages)
        if not final or final == "[No response]":
            err_lines = [l for l in err.split("\n") if "Debugger" not in l and "ws://" not in l and "YOLO" not in l and "For help" not in l and "Waiting" not in l and "Ignore file" not in l and "Hook" not in l and "STARTUP" not in l and "Experiments" not in l and "heap" not in l]
            err_text = "\n".join(err_lines).strip()
            if err_text and len(err_text) > 50: messages.append({"role": "assistant", "content": err_text}); final = err_text
        if not final or len(final) < 50: final = "[Short response]"
        return {"final_response": final, "messages": messages, "exit_code": proc.returncode, "timed_out": False}
    except FileNotFoundError:
        return {"final_response": "[Error] gemini CLI not found", "messages": [], "exit_code": -1, "timed_out": False}
    except Exception as e:
        return {"final_response": f"[Error] {e}", "messages": [], "exit_code": -1, "timed_out": False}


def main():
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

        question = task_entry.get("task") or task_entry.get("question", "")
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
