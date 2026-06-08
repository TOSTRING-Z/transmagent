#!/usr/bin/env python3
"""
MIX50 TransMAgent 自动化执行脚本
- 模型: deepseek-v3.2
- 模式: auto / multagent
- 适配自 QA100 版本，针对 MIX50 开放式任务
"""

import json
import requests
import functools
print = functools.partial(print, flush=True)
import time
import os
import uuid
import threading
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

# ============================================================
# 配置文件
# ============================================================
CONFIG = {
    "api_base_url": "http://localhost:3005",
    "data_file": "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json",
    "output_file": "/home/tostring/桌面/document/NM改稿/MIX50/result_TransMAgent_M.json",
    "target_mode": "auto",
    "target_agent_mode": "multagent",
    "target_model": "deepseek-v3.2",
    "max_step": 1000,
    "max_retries": 1,
    "retry_delay": 5,
    "max_workers": 4,
    "launch_interval": 20,
}


# ============================================================
# 任务提示构建
# ============================================================
def build_prompt(task_data: Dict[str, Any]) -> str:
    """基于 MIX50 条目构建开放式任务提示。"""
    task_text = task_data.get("task", "")
    category = task_data.get("category", "")
    difficulty = task_data.get("difficulty", "")

    prompt = task_text
    return prompt


# ============================================================
# 核心处理类
# ============================================================
class TransAgentProcessor:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.results: List[Dict[str, Any]] = []
        self.processed_ids: set = set()
        self.headers = {"Content-Type": "application/json"}
        self._lock = threading.RLock()

        os.makedirs(os.path.dirname(self.config["output_file"]), exist_ok=True)
        self._load_existing_results()

    def _load_existing_results(self):
        if not os.path.exists(self.config["output_file"]):
            return
        try:
            with open(self.config["output_file"], "r", encoding="utf-8") as f:
                existing_data = json.load(f)
            self.processed_ids = {
                r["id"]
                for r in existing_data
                if r.get("status") == "success"
            }
            self.results = existing_data
            self._save_results()
            print(f"✅ 断点续跑：已完成 {len(self.processed_ids)} 题")
        except Exception as e:
            print(f"❌ 加载现有结果失败: {e}")

    def _save_results(self):
        with self._lock:
            try:
                with open(self.config["output_file"], "w", encoding="utf-8") as f:
                    json.dump(self.results, f, ensure_ascii=False, indent=2)
            except Exception as e:
                print(f"❌ 保存结果失败: {e}")

    def _prepare_session(self, task_name: str) -> Optional[str]:
        base_url = self.config["api_base_url"]
        try:
            create_res = requests.post(
                f"{base_url}/chat/checkout",
                headers=self.headers,
                json={"chat_name": task_name[:50]},
                timeout=30,
            )
            chat_id = create_res.json().get("chat", {}).get("id")
            if not chat_id:
                raise Exception("无法获取 Chat ID")

            requests.post(f"{base_url}/chat/checkout", headers=self.headers,
                          json={"chat_id": chat_id}, timeout=30)
            requests.post(f"{base_url}/chat/mode", headers=self.headers,
                          json={"mode": self.config["target_mode"]}, timeout=30)
            requests.post(f"{base_url}/chat/agent_mode", headers=self.headers,
                          json={"agent_mode": self.config["target_agent_mode"]}, timeout=30)
            model_res = requests.post(f"{base_url}/chat/model", headers=self.headers,
                                      json={"model": self.config["target_model"]}, timeout=30)

            status = "✓" if model_res.status_code == 200 else f"模型切换:{model_res.status_code}"
            print(f"🚀 会话 {chat_id[:8]}... 已就绪 | {status}")
            return chat_id
        except Exception as e:
            print(f"❌ 初始化会话失败: {e}")
            return f"error-{uuid.uuid4()}"

    def _call_transagent_api(self, prompt: str, retry_count: int = 0) -> Dict[str, Any]:
        if retry_count >= self.config["max_retries"]:
            return {"error": "MAX_RETRIES_REACHED"}
        try:
            payload = {
                "messages": [{"role": "user", "content": prompt}],
                "max_step": self.config["max_step"],
            }
            response = requests.post(
                f"{self.config['api_base_url']}/chat/completions",
                headers=self.headers, json=payload, timeout=36000,
            )
            if response.status_code == 200:
                return response.json()
            else:
                raise Exception(f"API Error {response.status_code}")
        except requests.exceptions.Timeout:
            print(f"⏰ API 调用超时（第 {retry_count + 1} 次）")
            time.sleep(self.config["retry_delay"])
            return self._call_transagent_api(prompt, retry_count + 1)
        except Exception as e:
            print(f"🔄 重试中 ({retry_count + 1}/{self.config['max_retries']}): {str(e)[:100]}")
            time.sleep(self.config["retry_delay"])
            return self._call_transagent_api(prompt, retry_count + 1)

    def _process_single_task(self, task_data: Dict[str, Any], total: int) -> Dict[str, Any]:
        qid = task_data.get("id", -1)
        task_text = task_data.get("task", "")
        category = task_data.get("category", "")
        difficulty = task_data.get("difficulty", "")

        print(f"  🚀 [#{qid}] 启动 | {category} | {difficulty} | {task_text[:60]}...")

        prompt = build_prompt(task_data)
        chat_id = self._prepare_session(f"[{category}] {task_text}")

        start_time = time.time()
        raw_result = self._call_transagent_api(prompt)
        duration = round(time.time() - start_time, 2)

        status = "success" if "error" not in raw_result else "failed"

        record = {
            "id": qid,
            "category": category,
            "task": task_text,
            "difficulty": difficulty,
            "chat_id": chat_id,
            "response": raw_result,
            "duration_sec": duration,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "status": status,
        }

        with self._lock:
            self.results.append(record)
            if status == "success":
                self.processed_ids.add(qid)
            self._save_results()

        print(f"  ✅ [#{qid}] 耗时: {duration}s | 进度: {len(self.processed_ids)}/{total} | 状态: {status}")
        return record

    def process_tasks(self):
        try:
            with open(self.config["data_file"], "r", encoding="utf-8") as f:
                tasks_data = json.load(f)
        except Exception as e:
            print(f"❌ 加载任务文件失败: {e}")
            return

        total = len(tasks_data)
        print(f"📋 共加载 {total} 道题目")

        pending_tasks = []
        skipped = 0
        for task_data in tasks_data:
            qid = task_data.get("id", -1)
            if qid in self.processed_ids:
                skipped += 1
            else:
                pending_tasks.append(task_data)

        if not pending_tasks:
            print(f"🎉 所有题目已完成！成功: {len(self.processed_ids)}/{total}")
            return

        print(f"🔥 待处理: {len(pending_tasks)} 题 | 已完成: {skipped} 题")

        max_workers = self.config.get("max_workers", 20)
        launch_interval = self.config.get("launch_interval", 4)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            pending_queue = list(pending_tasks)
            futures_dict = {}

            # 初始提交：最多 max_workers 个任务（每个之间间隔 launch_interval）
            initial_count = min(max_workers, len(pending_queue))
            for i in range(initial_count):
                task_data = pending_queue.pop(0)
                future = executor.submit(self._process_single_task, task_data, total)
                futures_dict[future] = task_data.get("id", -1)
                if i < initial_count - 1:
                    time.sleep(launch_interval)
            print(f"🚀 初始提交 {initial_count} 个任务，等待完成...")

            # 每当一个任务完成，等待 launch_interval，再提交下一个
            while futures_dict:
                for future in as_completed(futures_dict):
                    try:
                        future.result()
                    except Exception as e:
                        qid = futures_dict[future]
                        print(f"  ❌ [#{qid}] 异常: {str(e)[:200]}")
                    del futures_dict[future]
                    break

                if pending_queue:
                    time.sleep(launch_interval)
                    task_data = pending_queue.pop(0)
                    future = executor.submit(self._process_single_task, task_data, total)
                    futures_dict[future] = task_data.get("id", -1)
                    print(f"  ➕ 补充提交 [#{task_data.get('id', -1)}]，队列剩余: {len(pending_queue)}")

        print(f"\n🎉 全部处理完成！成功: {len(self.processed_ids)}/{total}")

    def print_summary(self):
        if not self.results:
            print("⚠️  无结果可统计")
            return
        total = len(self.results)
        success = sum(1 for r in self.results if r.get("status") == "success")
        failed = total - success
        print(f"""
{'='*60}
📊 最终统计
{'='*60}
  总题目:    {total}
  成功:      {success}
  失败:      {failed}
  输出文件:  {self.config['output_file']}
{'='*60}
""")


def main():
    processor = TransAgentProcessor(CONFIG)
    try:
        processor.process_tasks()
    except KeyboardInterrupt:
        print("\n🛑 收到中断信号，进度已保存。")
    except Exception as e:
        print(f"🔥 程序异常: {e}")
    finally:
        processor.print_summary()


if __name__ == "__main__":
    main()
