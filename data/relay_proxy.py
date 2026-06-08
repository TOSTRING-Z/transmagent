#!/usr/bin/env python3
"""
API Relay Proxy — ReAct 多轮循环版
OpenAI Responses API → runapi.co (DeepSeek)
支持: 完整轨迹循环 | 工具参数可见 | 自动 ReAct 执行
"""

import http.server, json, sys, argparse, urllib.request, urllib.error
import ssl, re, uuid, subprocess, os, tempfile

RUNAPI_BASE = "https://runapi.co/v1"
RUNAPI_KEY = "sk-uAG0bRv1YefsNDxO6zI3Hw4qOKJbivehSjCASkdMD3Dbd6BH"
MAX_REACT_ROUNDS = 8
CMD_TIMEOUT = 60

GEMINI_MAP = {"gemini-2.5-flash-lite":"deepseek-chat","gemini-2.5-flash":"deepseek-chat","gemini-2.5-pro":"deepseek-chat"}

def log(msg):
    print(msg, file=sys.stderr, flush=True)

# ========== 工具执行 ==========

def execute_commands(text):
    """从文本中提取 bash 代码块并执行，返回 (executed_blocks, modified_text)"""
    pattern = r'```bash\n(.*?)```'
    matches = list(re.finditer(pattern, text, re.DOTALL))
    if not matches:
        return [], text

    results = []
    for m in matches:
        cmd = m.group(1).strip()
        if not cmd:
            continue
        try:
            r = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                             timeout=CMD_TIMEOUT, cwd='/tmp',
                             env={**os.environ, 'HOME': '/home/tostring'})
            out = (r.stdout + r.stderr).strip()
            results.append({
                "command": cmd,
                "stdout": out[:5000],
                "exit_code": r.returncode,
            })
        except subprocess.TimeoutExpired:
            results.append({"command": cmd, "stdout": "[Timeout]", "exit_code": -1})
        except Exception as e:
            results.append({"command": cmd, "stdout": str(e)[:500], "exit_code": -1})

    return results, text


# ========== API 调用 ==========

def call_chat(messages, max_tokens=4096):
    """调用 runapi.co Chat Completions"""
    url = f"{RUNAPI_BASE}/chat/completions"
    body = {
        "model": "deepseek-chat",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    headers = {"Authorization": f"Bearer {RUNAPI_KEY}", "Content-Type": "application/json"}
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=300, context=ctx) as resp:
            return 200, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())
    except Exception as e:
        return 502, {"error": str(e)}


# ========== ReAct 循环 ==========

def react_loop(user_input, instructions=""):
    """ReAct 多轮循环：执行工具 → 反馈结果 → 继续 → 直到完成"""
    trace = []  # 完整轨迹

    # 初始消息
    messages = []
    if instructions:
        messages.append({"role": "system", "content": instructions})
    messages.append({"role": "user", "content": user_input})

    for round_idx in range(MAX_REACT_ROUNDS):
        log(f"ReAct round {round_idx + 1}")

        # 调用模型
        status, resp = call_chat(messages)
        if status != 200:
            trace.append({"round": round_idx, "error": resp})
            break

        # 提取模型回复
        choice = resp.get("choices", [{}])[0]
        msg = choice.get("message", {})
        response_text = msg.get("content", "")

        # 记录本轮轨迹
        trace.append({
            "round": round_idx,
            "model_response": response_text[:8000],
            "finish_reason": choice.get("finish_reason", "?"),
        })

        # 添加 assistant 消息到对话历史
        messages.append({"role": "assistant", "content": response_text})

        # 检查是否有代码块需要执行
        results, _ = execute_commands(response_text)

        if not results:
            # 没有代码块 → 任务完成
            break

        # 执行工具并记录参数
        tool_results_text_parts = []
        for r in results:
            cmd = r["command"]
            out = r["stdout"]
            ec = r["exit_code"]

            tool_results_text_parts.append(
                f"[TOOL EXECUTED]\n"
                f"Command: {cmd}\n"
                f"Exit Code: {ec}\n"
                f"Output:\n{out}"
            )

            trace[-1]["tools"] = trace[-1].get("tools", [])
            trace[-1]["tools"].append({
                "command": cmd,
                "exit_code": ec,
                "output_preview": out[:2000],
            })

        tool_result_text = "\n\n".join(tool_results_text_parts)

        # 将工具结果添加到对话历史
        messages.append({
            "role": "user",
            "content": f"[TOOL EXECUTION RESULTS]\n{tool_result_text}\n\nPlease continue based on these results."
        })

        trace[-1]["tool_results_fed"] = True

    # 编译最终轨迹文本
    final_text_parts = []
    for t in trace:
        rn = t.get("round", 0)
        resp = t.get("model_response", "")
        tools = t.get("tools", [])

        final_text_parts.append(f"=== ROUND {rn + 1} ===")
        final_text_parts.append(resp)

        if tools:
            final_text_parts.append("\n[TOOLS EXECUTED]")
            for ti, tool in enumerate(tools):
                final_text_parts.append(f"  Tool {ti+1}: {tool['command']}")
                final_text_parts.append(f"  Exit: {tool['exit_code']}")
                final_text_parts.append(f"  Output: {tool['output_preview'][:3000]}")

    final_text = "\n\n".join(final_text_parts)

    return {
        "trace": trace,
        "final_text": final_text,
        "rounds": len(trace),
        "total_tools": sum(len(t.get("tools", [])) for t in trace),
    }


# ========== SSE 构建 ==========

def build_sse(rid, model, text, usage):
    te = json.dumps(text)
    uj = json.dumps(usage)
    mid = "msg_" + uuid.uuid4().hex[:16]
    out = []
    def sse(ev, d):
        out.append("event: " + ev + "\ndata: " + d + "\n\n")
    sse("response.created", '{"type":"response.created","response":{"id":"'+rid+'","object":"response","model":"'+model+'","status":"in_progress","output":[]}}')
    sse("response.in_progress", '{"type":"response.in_progress","response":{"id":"'+rid+'","object":"response","model":"'+model+'","status":"in_progress"}}')
    sse("response.output_item.added", '{"type":"response.output_item.added","output_index":0,"item":{"id":"'+mid+'","type":"message","role":"assistant","status":"in_progress","content":[]}}')
    sse("response.content_part.added", '{"type":"response.content_part.added","item_id":"'+mid+'","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}')
    sse("response.output_text.delta", '{"type":"response.output_text.delta","item_id":"'+mid+'","output_index":0,"content_index":0,"delta":'+te+'}')
    sse("response.output_item.done", '{"type":"response.output_item.done","output_index":0,"item":{"id":"'+mid+'","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":'+te+',"annotations":[]}]}}')
    sse("response.completed", '{"type":"response.completed","response":{"id":"'+rid+'","object":"response","model":"'+model+'","status":"completed","output":[{"id":"'+mid+'","type":"message","role":"assistant","status":"completed","content":[{"type":"output_text","text":'+te+',"annotations":[]}]}],"usage":'+uj+'}}')
    return "".join(out)


# ========== Gemini 翻译 ==========

def gemini_to_chat(body):
    msgs = []
    si = body.get("systemInstruction", {})
    if si:
        msgs.append({"role": "system", "content": " ".join(p.get("text", "") for p in si.get("parts", []))})
    for c in body.get("contents", []):
        r = "assistant" if c.get("role") == "model" else c.get("role", "user")
        t = " ".join(p.get("text", "") if isinstance(p, dict) else str(p) for p in c.get("parts", []))
        if t:
            msgs.append({"role": r, "content": t})
    if not msgs:
        msgs = [{"role": "user", "content": "Hello"}]
    cb = {"model": "deepseek-chat", "messages": msgs}
    gc = body.get("generationConfig", {})
    if "maxOutputTokens" in gc:
        cb["max_tokens"] = gc["maxOutputTokens"]
    return cb


def chat_to_gemini(cr, model):
    cands = []
    for ch in cr.get("choices", []):
        t = ch.get("message", {}).get("content", "")
        cands.append({"content": {"role": "model", "parts": [{"text": t}]},
                       "finishReason": ch.get("finish_reason", "STOP").upper(),
                       "index": ch.get("index", 0)})
    return {"candidates": cands,
            "usageMetadata": {"promptTokenCount": cr.get("usage", {}).get("prompt_tokens", 0),
                              "candidatesTokenCount": cr.get("usage", {}).get("completion_tokens", 0),
                              "totalTokenCount": cr.get("usage", {}).get("total_tokens", 0)},
            "modelVersion": model}


# ========== HTTP Handler ==========

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, f, *a):
        pass

    def _json(self, code, data):
        b = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()
        self.wfile.write(b)

    def _sse(self, text):
        b = text.encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _body(self):
        cl = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(cl) if cl else b"{}"

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/"):
            self._json(200, {"status": "ok"})
        elif self.path.startswith("/v1beta/models/"):
            model = self.path.split("/")[-1]
            self._json(200, {"name": "models/" + model, "displayName": model,
                             "supportedGenerationMethods": ["generateContent", "streamGenerateContent"]})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        log(f"POST {self.path}")
        raw = self._body()

        # Gemini
        gm = re.match(r"^/v1beta/models/([^:]+):(stream)?generateContent$", self.path)
        if gm:
            try:
                gb = json.loads(raw)
            except:
                self._json(400, {"error": "Invalid JSON"}); return
            m = GEMINI_MAP.get(gm.group(1), "deepseek-chat")
            cb = gemini_to_chat(gb); cb["model"] = m
            s, rb = call_chat(cb["messages"], cb.get("max_tokens", 4096))
            if s == 200:
                self._json(200, chat_to_gemini(rb, m))
            else:
                self._json(s, rb)
            return

        # Responses API — ReAct 多轮循环
        if self.path == "/v1/responses" or self.path.endswith("/responses"):
            try:
                rb = json.loads(raw)
            except:
                self._json(400, {"error": "Invalid JSON"}); return

            inp = rb.get("input", "")
            if isinstance(inp, list):
                inp = "\n".join(
                    it.get("content", "") if isinstance(it.get("content"), str)
                    else " ".join(c.get("text", "") for c in it.get("content", []) if c.get("type") == "input_text")
                    for it in inp
                )
            instructions = rb.get("instructions", "")

            # ReAct 循环
            log(f"ReAct: input={len(str(inp))} chars, instructions={len(str(instructions))} chars")
            react_result = react_loop(str(inp), str(instructions))

            rid = "resp_" + uuid.uuid4().hex[:24]
            model = rb.get("model", "deepseek-chat")
            usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

            if rb.get("stream", False):
                self._sse(build_sse(rid, model, react_result["final_text"], usage))
            else:
                mid = "msg_" + uuid.uuid4().hex[:16]
                self._json(200, {
                    "id": rid, "object": "response", "model": model,
                    "status": "completed",
                    "output": [{"id": mid, "type": "message", "role": "assistant", "status": "completed",
                                "content": [{"type": "output_text", "text": react_result["final_text"],
                                             "annotations": []}]}],
                    "usage": usage,
                    "_react_meta": {"rounds": react_result["rounds"],
                                    "total_tools": react_result["total_tools"]},
                })
            return

        # 通用 OpenAI 转发（兼容 /v1/chat/completions 和 /chat/completions）
        try:
            body = json.loads(raw)
        except:
            self._json(400, {"error": "Invalid JSON"}); return
        if self.path.endswith("/chat/completions") or self.path.startswith("/v1/"):
            s, rb = call_chat(body.get("messages", []), body.get("max_tokens", 4096))
            if s == 200:
                self._json(200, rb)
            else:
                self._json(s, rb)
        else:
            self._json(404, {"error": "not found"})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, required=True)
    p.add_argument("--host", default="0.0.0.0")
    a = p.parse_args()
    s = http.server.HTTPServer((a.host, a.port), H)
    print(f"ReAct Relay on {a.host}:{a.port}", flush=True)
    try:
        s.serve_forever()
    except KeyboardInterrupt:
        s.shutdown()


if __name__ == "__main__":
    main()
