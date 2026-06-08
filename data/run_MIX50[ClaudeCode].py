#!/usr/bin/env python3
"""
Claude Code CLI v2.1.158 批量任务执行器 — MIX50 适配版
直连 runapi.co，模型映射 deepseek-v3.2
"""

import os, json, time, subprocess, signal, shutil, glob, uuid

CONFIG = {
    "output_file": "/home/tostring/桌面/document/NM改稿/MIX50/claude_code_results.json",
    "data_file": "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json",
    "model": "deepseek-v3.2",
    "max_duration": 3600,
}

CLAUDE_ENV = {
    "ANTHROPIC_AUTH_TOKEN": "sk-uAG0bRv1YefsNDxO6zI3Hw4qOKJbivehSjCASkdMD3Dbd6BH",
    "ANTHROPIC_BASE_URL": "https://runapi.co",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v3.2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "deepseek-v3.2",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v3.2",
    "ANTHROPIC_MODEL": "deepseek-v3.2",
}


def ensure_claude_config():
    """确保 Claude Code 配置文件就绪"""
    claude_json = os.path.expanduser("~/.claude.json")
    if not os.path.exists(claude_json):
        config = {
            "customApiKeyResponses": {},
            "tipsHistory": {},
            "promptQueueUseCount": 0,
            "cachedGrowthBookFeatures": {
                "tengu_disable_bypass_permissions_mode": False,
                "tengu_attribution_header": True,
            },
            "userID": "",
            "firstStartTime": "",
            "sonnet45MigrationComplete": True,
            "opus45MigrationComplete": True,
            "opusProMigrationComplete": True,
            "thinkingMigrationComplete": True,
            "hasCompletedOnboarding": True,
            "officialMarketplaceAutoInstallAttempted": True,
            "officialMarketplaceAutoInstalled": True,
            "skillUsage": {}
        }
        with open(claude_json, "w") as f:
            json.dump(config, f, indent=2)

    settings_path = os.path.expanduser("~/.claude/settings.json")
    settings = {
        "env": {
            "ANTHROPIC_AUTH_TOKEN": CLAUDE_ENV["ANTHROPIC_AUTH_TOKEN"],
            "ANTHROPIC_BASE_URL": CLAUDE_ENV["ANTHROPIC_BASE_URL"],
            "ANTHROPIC_DEFAULT_HAIKU_MODEL": CLAUDE_ENV["ANTHROPIC_DEFAULT_HAIKU_MODEL"],
            "ANTHROPIC_DEFAULT_SONNET_MODEL": CLAUDE_ENV["ANTHROPIC_DEFAULT_SONNET_MODEL"],
            "ANTHROPIC_DEFAULT_OPUS_MODEL": CLAUDE_ENV["ANTHROPIC_DEFAULT_OPUS_MODEL"],
            "ANTHROPIC_MODEL": CLAUDE_ENV["ANTHROPIC_MODEL"],
        }
    }
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)


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


def parse_stream_json(raw):
    events = []
    for line in raw.split("\n"):
        line = line.strip()
        if not line: continue
        try: events.append(json.loads(line))
        except: continue
    return events


def merge_messages(events):
    msgs = []
    cur_role, cur_text = None, ""
    for e in events:
        t = e.get("type", "")
        if t == "assistant":
            blocks = e.get("message", {}).get("content", [])
            if isinstance(blocks, list):
                for b in blocks:
                    if isinstance(b, dict):
                        if b.get("type") == "text":
                            if "assistant" == cur_role: cur_text += b.get("text", "")
                            else:
                                if cur_role: msgs.append({"role": cur_role, "content": cur_text})
                                cur_role, cur_text = "assistant", b.get("text", "")
                        elif b.get("type") == "tool_use":
                            if cur_role: msgs.append({"role": cur_role, "content": cur_text})
                            cur_role, cur_text = None, ""
                            tool_name = b.get('name', '?')
                            tool_input = b.get('input', {})
                            if isinstance(tool_input, dict):
                                params = json.dumps(tool_input, ensure_ascii=False)
                            else:
                                params = str(tool_input)
                            msgs.append({"role": "assistant",
                                "content": f"[Tool: {tool_name} | params: {params}]"})
                        elif b.get("type") == "tool_result":
                            if cur_role: msgs.append({"role": cur_role, "content": cur_text})
                            cur_role, cur_text = None, ""
                            result_content = b.get('content', '')
                            if isinstance(result_content, list):
                                result_content = '\n'.join(
                                    c.get('text', '') if isinstance(c, dict) else str(c)
                                    for c in result_content
                                )
                            msgs.append({"role": "user", "content": f"[Tool Result]\n{str(result_content)[:5000]}"})
        elif t == "result":
            if cur_role: msgs.append({"role": cur_role, "content": cur_text})
            cur_role, cur_text = None, ""
            r = e.get("result", e.get("output", ""))
            if r: msgs.append({"role": "assistant", "content": str(r)})
        elif t in ("error", "system"):
            if cur_role: msgs.append({"role": cur_role, "content": cur_text})
            cur_role, cur_text = None, ""
    if cur_role: msgs.append({"role": cur_role, "content": cur_text})
    return msgs


def extract_final(msgs):
    for m in reversed(msgs):
        if m["role"] != "assistant": continue
        c = m["content"].strip()
        if c.startswith("[Tool:"): continue
        if len(c) > 0: return c
    return "[No response]"


def run_one(task, timeout=3600):
    run_id = uuid.uuid4().hex[:12]
    run_dir = f"/data/run/{run_id}"
    os.makedirs(run_dir, exist_ok=True)

    env = os.environ.copy()
    for k in list(env.keys()):
        if k.lower() in ["http_proxy","https_proxy","all_proxy","ftp_proxy","socks_proxy","no_proxy"]:
            del env[k]
    env['no_proxy'] = '*'
    env.update(CLAUDE_ENV)

    full_task = f"【目录限制】所有探索过程、中间文件和结果文件必须严格保存在 {run_dir} 下，严禁读写其他路径，避免环境数据相互泄露。\n\n{task}"
    cmd = [
        "claude", "--print", "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        "-p", full_task,
    ]

    try:
        import threading
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, env=env, start_new_session=True)
        out_lines, err_lines = [], []

        def _read(f, lst):
            for line in f: lst.append(line)

        t1 = threading.Thread(target=_read, args=(proc.stdout, out_lines), daemon=True)
        t2 = threading.Thread(target=_read, args=(proc.stderr, err_lines), daemon=True)
        t1.start(); t2.start()

        timed_out = False
        try: proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired: timed_out = True

        t1.join(timeout=5); t2.join(timeout=5)

        if timed_out:
            try: os.killpg(os.getpgid(proc.pid), signal.SIGTERM); proc.wait(timeout=5)
            except:
                try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except: pass
            return {"final_response": f"[Timeout] {timeout}s", "messages": [], "exit_code": -1, "timed_out": True}

        proc.wait()
        events = parse_stream_json("".join(out_lines))
        msgs = merge_messages(events)
        final = extract_final(msgs)

        if not final or final == "[No response]":
            err = "".join(err_lines).strip()
            if err and len(err) > 20:
                msgs.append({"role": "assistant", "content": err})
                final = err

        return {"final_response": final, "messages": msgs, "exit_code": proc.returncode, "timed_out": False}

    except FileNotFoundError:
        return {"final_response": "[Error] claude CLI not found", "messages": [], "exit_code": -1, "timed_out": False}
    except Exception as e:
        return {"final_response": f"[Error] {e}", "messages": [], "exit_code": -1, "timed_out": False}


def main():
    ensure_claude_config()

    with open(CONFIG["data_file"], encoding="utf-8") as f:
        tasks = json.load(f)

    out = CONFIG["output_file"]
    existing = json.load(open(out, encoding="utf-8")) if os.path.exists(out) else []
    done_ids = {d["id"] for d in existing if d["status"] == "success"}
    results = existing.copy()
    by_id = {d["id"]: d for d in results}

    for i, t in enumerate(tasks):
        tid = t["id"]
        if tid in done_ids:
            print(f"[SKIP] Task {tid}")
            continue

        task_text = t.get("task", "")
        print(f"\n[{i+1}/{len(tasks)}] Task {tid} ({t.get('category','?')})")

        clean_environment()
        t0 = time.time()
        resp = run_one(task_text, CONFIG["max_duration"])
        elapsed = time.time() - t0

        rec = {
            "id": tid, "task": task_text, "category": t.get("category", ""),
            "difficulty": t.get("difficulty", ""),
            "response": resp, "duration_sec": round(elapsed, 1),
            "status": "success" if resp["final_response"] and len(resp["final_response"]) > 50 else "failed",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

        if tid in by_id:
            idx = next(j for j, d in enumerate(results) if d["id"] == tid)
            results[idx] = rec
        else:
            results.append(rec)
        by_id[tid] = rec

        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

    succ = [d for d in results if d["status"] == "success"]
    print(f"\nFINAL: {len(succ)}/{len(results)} success")


if __name__ == "__main__":
    main()
