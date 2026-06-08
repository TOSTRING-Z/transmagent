#!/usr/bin/env python3
"""
Gemini CLI → DeepSeek 代理 v3
修复：正确转换 functionCall/functionResponse 为 OpenAI tool_calls/tool role
"""

import json, sys, os, urllib.request, urllib.error, time
from http.server import HTTPServer, BaseHTTPRequestHandler

API_KEY = "sk-uAG0bRv1YefsNDxO6zI3Hw4qOKJbivehSjCASkdMD3Dbd6BH"
API_BASE = "https://runapi.co/v1"
MODEL = "deepseek-chat"


def gemini_to_openai(gemini_req):
    """Gemini → OpenAI: 正确保留 tool_calls 结构"""
    messages = []

    # 系统指令
    sys_inst = gemini_req.get("systemInstruction", {})
    if sys_inst:
        parts = sys_inst.get("parts", [])
        sys_text = "\n".join(p.get("text", "") for p in parts if "text" in p)
        if sys_text.strip():
            messages.append({"role": "system", "content": sys_text})

    # 对话内容
    for item in gemini_req.get("contents", []):
        role = item.get("role", "user")
        if role == "model":
            role = "assistant"

        parts = item.get("parts", [])
        texts = []
        tool_calls = []
        tool_responses = []

        for part in parts:
            if "text" in part:
                texts.append(part["text"])
            elif "functionCall" in part:
                fc = part["functionCall"]
                call_id = f"call_{int(time.time()*1000000)}"
                tool_calls.append({
                    "id": call_id,
                    "type": "function",
                    "function": {
                        "name": fc.get("name", ""),
                        "arguments": json.dumps(fc.get("args", {}), ensure_ascii=False)
                    }
                })
            elif "functionResponse" in part:
                fr = part["functionResponse"]
                resp_content = fr.get("response", {})
                if isinstance(resp_content, (dict, list)):
                    resp_content = json.dumps(resp_content, ensure_ascii=False)
                tool_responses.append({
                    "role": "tool",
                    "tool_call_id": f"call_{int(time.time()*1000000)}",
                    "content": str(resp_content)[:8000]
                })

        # 构建消息
        if role == "assistant" and tool_calls:
            msg = {"role": "assistant", "tool_calls": tool_calls}
            if texts:
                msg["content"] = "\n".join(texts)
            messages.append(msg)
        elif tool_responses:
            for tr in tool_responses:
                messages.append(tr)
            if texts:
                messages.append({"role": "user", "content": "\n".join(texts)})
        elif texts:
            messages.append({"role": role, "content": "\n".join(texts)})

    # 生成配置
    gen_config = gemini_req.get("generationConfig", {})
    max_tokens = gen_config.get("maxOutputTokens", 8192)
    temperature = gen_config.get("temperature", 0.3)

    # 工具声明
    gemini_tools = gemini_req.get("tools", [])
    openai_tools = None
    if gemini_tools:
        openai_tools = []
        for tool_group in gemini_tools:
            for fd in tool_group.get("functionDeclarations", []):
                openai_tools.append({
                    "type": "function",
                    "function": {
                        "name": fd.get("name", ""),
                        "description": fd.get("description", ""),
                        "parameters": fd.get("parameters", {"type": "object", "properties": {}})
                    }
                })

    req = {
        "model": MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    if openai_tools:
        req["tools"] = openai_tools
        req["tool_choice"] = "auto"

    return req


def call_deepseek(openai_req):
    """调用 API (非流式)"""
    req = urllib.request.Request(
        f"{API_BASE}/chat/completions",
        data=json.dumps(openai_req).encode('utf-8'),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        }
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.loads(resp.read().decode('utf-8'))


def openai_to_gemini(openai_resp):
    """OpenAI → Gemini: 正确还原 functionCall"""
    choice = openai_resp.get("choices", [{}])[0]
    message = choice.get("message", {})
    text = message.get("content", "") or ""
    finish = choice.get("finish_reason", "stop")

    parts = []
    if text:
        parts.append({"text": text})

    # 将 tool_calls 转为 Gemini functionCall
    for tc in message.get("tool_calls", []):
        func = tc.get("function", {})
        try:
            args = json.loads(func.get("arguments", "{}"))
        except:
            args = {}
        parts.append({"functionCall": {"name": func.get("name", ""), "args": args}})

    return {
        "candidates": [{
            "content": {"role": "model", "parts": parts},
            "finishReason": "STOP" if finish in ("stop", "tool_calls", None) else finish.upper(),
            "index": 0,
        }],
        "usageMetadata": {
            "promptTokenCount": openai_resp.get("usage", {}).get("prompt_tokens", 0),
            "candidatesTokenCount": openai_resp.get("usage", {}).get("completion_tokens", 0),
            "totalTokenCount": openai_resp.get("usage", {}).get("total_tokens", 0),
        }
    }


class ProxyHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if "/v1beta/models" in self.path:
            self._respond(200, {"models": [{"name": f"models/{MODEL}", "displayName": MODEL,
                "supportedGenerationMethods": ["generateContent", "streamGenerateContent"]}]})
        else:
            self._respond(200, {"status": "ok", "service": "gemini-proxy-v3"})

    def do_OPTIONS(self):
        self._respond(200, {})

    def do_POST(self):
        t0 = time.time()
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length).decode('utf-8')
            gemini_req = json.loads(body)

            # 转换请求
            openai_req = gemini_to_openai(gemini_req)

            # 请求 DeepSeek (始终非流式)
            openai_resp = call_deepseek(openai_req)
            gemini_resp = openai_to_gemini(openai_resp)

            is_streaming = "streamGenerateContent" in self.path

            if is_streaming:
                # SSE 单事件包装
                sse_body = f"data: {json.dumps(gemini_resp, ensure_ascii=False)}\n\n".encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Content-Length', len(sse_body))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(sse_body)
                self.wfile.flush()
            else:
                self._respond(200, gemini_resp)

            # 日志
            elapsed = time.time() - t0
            msg_count = len(openai_req.get("messages", []))
            resp_parts = len(gemini_resp.get("candidates", [{}])[0].get("content", {}).get("parts", []))
            has_tool = any("functionCall" in p for p in gemini_resp.get("candidates",[{}])[0].get("content",{}).get("parts",[]))
            print(f"[{elapsed:.1f}s] POST msgs={msg_count} parts={resp_parts} tool={has_tool} | {self.path[:80]}")

        except urllib.error.HTTPError as e:
            err_body = e.read().decode('utf-8') if e.fp else str(e)
            print(f"[ERR] HTTP {e.code}: {err_body[:200]}")
            self._respond(e.code, {"error": {"message": err_body[:1000]}})
        except Exception as e:
            import traceback
            print(f"[ERR] {e}")
            self._respond(500, {"error": {"message": str(e), "trace": traceback.format_exc()[:500]}})

    def _respond(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(body))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4001
    host = sys.argv[2] if len(sys.argv) > 2 else '127.0.0.1'
    server = HTTPServer((host, port), ProxyHandler)
    print(f"Proxy v3 on {host}:{port} (tool_calls fixed)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
