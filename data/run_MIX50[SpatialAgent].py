#!/usr/bin/env python3
"""
SpatialAgent 自动化执行脚本 - 适配 MIX50.json
基于已验证成功的 run_QA100_optimized[SpatialAgent].py 模板
"""

import os
import sys
import json
import subprocess
import time
import threading
import functools
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# 强制行缓冲，避免管道输出堆积
print = functools.partial(print, flush=True)

# ======================== 配置 ========================
API_KEY = "sk-uAG0bRv1YefsNDxO6zI3Hw4qOKJbivehSjCASkdMD3Dbd6BH"
API_BASE = "https://runapi.co/v1"
MODEL_NAME = "deepseek-v3.2"

WORK_BASE = "/home/tostring/桌面/document/NM改稿/MIX50/run_SpatialAgent"
REPO_DIR = "/home/tostring/桌面/document/NM改稿/tmp/run_spatialagent/SpatialAgent"
QUESTION_FILE = "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json"

CONDA_ENV = "agent"
AGENT_PYTHON = "/home/tostring/miniconda3/envs/agent/bin/python"

TIMEOUT = 3600
MAX_RETRIES = 3
RECURSION_LIMIT = 80
MAX_WORKERS = 10
LAUNCH_INTERVAL = 4
# ======================================


class TaskStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class SpatialAgentRunner:
    
    def __init__(self):
        self.work_base = WORK_BASE
        os.makedirs(self.work_base, exist_ok=True)
        self.repo_dir = REPO_DIR
        self.questions = []
        self.status_file = os.path.join(WORK_BASE, "task_status.json")
        self._status_lock = threading.RLock()
        
    def load_questions(self) -> list:
        with open(QUESTION_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and 'questions' in data:
            return data['questions']
        else:
            return [data]
    
    def load_status(self) -> dict:
        if os.path.exists(self.status_file):
            with open(self.status_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def save_status(self, status: dict):
        with self._status_lock:
            with open(self.status_file, 'w', encoding='utf-8') as f:
                json.dump(status, f, ensure_ascii=False, indent=2)
    
    def get_task_work_dir(self, q: dict) -> str:
        task_id = q.get('id', 'unknown')
        category = q.get('category', 'unknown')
        category = str(category).replace('/', '_').replace('\\', '_').replace(' ', '_')
        return os.path.join(self.work_base, f"{task_id}_{category}")
    
    def create_script(self, q: dict, work_dir: str) -> str:
        task_raw = q.get('task', '')
        task = task_raw + "\n你的最终回答必须包括如下内容：\n[完整分析结果和结论]\n\n注意：不要使用web_search工具（会报错）"
        task_id = q.get('id', 'unknown')
        category = q.get('category', 'unknown')
        
        script_content = f'''#!/bin/bash
export PATH="/home/tostring/miniconda3/envs/agent/bin:$PATH"
export PYTHONPATH="/home/tostring/.local/lib/python3.12/site-packages:$PYTHONPATH"
export PYTHONPATH="{self.repo_dir}:$PYTHONPATH"
export PYTHONIOENCODING=utf-8
export OPENAI_API_KEY="{API_KEY}"
export OPENAI_API_BASE="{API_BASE}"
unset ALL_PROXY all_proxy

python << 'PYEOF'
import os, sys, json, traceback

os.environ['OPENAI_API_KEY'] = '{API_KEY}'
os.environ['OPENAI_API_BASE'] = '{API_BASE}'
for _k in ('ALL_PROXY', 'all_proxy'):
    os.environ.pop(_k, None)

sys.path.insert(0, "{self.repo_dir}")

print(f"[SpatialAgent] 任务 {task_id} 初始化中...", flush=True)
from langchain_openai import ChatOpenAI
print(f"[SpatialAgent] 模型加载完成", flush=True)
from spatialagent.agent.spatialagent import SpatialAgent

print("="*60)
print(f"任务 ID: {task_id}")
print(f"类别: {category}")
print("="*60)

try:
    llm = ChatOpenAI(
        model="{MODEL_NAME}",
        api_key="{API_KEY}",
        base_url="{API_BASE}",
        temperature=0.3,
        max_tokens=4096
    )
    
    agent = SpatialAgent(
        llm=llm,
        data_path=os.path.join("{self.work_base}", "data"),
        save_path="{work_dir}",
        tool_retrieval=True,
        tool_retrieval_method="all",
        skill_retrieval=True,
        num_skills=1,
        auto_interpret_figures=True,
        act_timeout=1800,
        web_search_model="{MODEL_NAME}"
    )
    
    task_query = """{task}"""
    
    print("开始执行分析...")
    result = agent.run(
        user_query=task_query,
        config={{"recursion_limit": {RECURSION_LIMIT}}}
    )
    
    print("\\n" + "="*60)
    print("任务执行完成!")
    print("="*60)
    
    final_answer = str(result)
    
    result_file = os.path.join("{work_dir}", "result.json")
    with open(result_file, 'w', encoding='utf-8') as f:
        json.dump({{
            "status": "completed",
            "question_id": "{task_id}",
            "category": "{category}",
            "task": task_query,
            "result": final_answer,
            "completed_at": "{datetime.now().isoformat()}"
        }}, f, ensure_ascii=False, indent=2)
    
    print(f"结果已保存: {{result_file}}")
    
except Exception as e:
    print(f"\\n执行出错: {{e}}")
    traceback.print_exc()
    
    result_file = os.path.join("{work_dir}", "result.json")
    with open(result_file, 'w', encoding='utf-8') as f:
        json.dump({{
            "status": "failed",
            "question_id": "{task_id}",
            "category": "{category}",
            "error": str(e),
            "failed_at": "{datetime.now().isoformat()}"
        }}, f, ensure_ascii=False, indent=2)
    
    sys.exit(1)
PYEOF
'''
        
        script_path = os.path.join(work_dir, "run_task.sh")
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(script_content)
        os.chmod(script_path, 0o755)
        return script_path
    
    def run_task(self, q: dict, status: dict) -> bool:
        task_id = str(q.get('id', 'unknown'))
        category = q.get('category', 'unknown')
        work_dir = self.get_task_work_dir(q)
        
        with self._status_lock:
            if status.get(task_id, {}).get('status') == TaskStatus.COMPLETED:
                print(f"[跳过] 已完成任务 [{task_id}] {category}")
                return True
        
        os.makedirs(work_dir, exist_ok=True)
        
        print(f"\n{'='*60}")
        print(f"[执行] 任务 [{task_id}] {category}")
        print(f"  工作目录: {work_dir}")
        print(f"{'='*60}")
        
        with self._status_lock:
            status[task_id] = {
                "status": TaskStatus.RUNNING,
                "category": category,
                "work_dir": work_dir,
                "started_at": datetime.now().isoformat(),
                "retries": status.get(task_id, {}).get('retries', 0)
            }
            self.save_status(status)
        
        script_path = self.create_script(q, work_dir)
        
        env = os.environ.copy()
        env.update({'PYTHONIOENCODING': 'utf-8'})
        for k in ['all_proxy', 'ALL_PROXY']:
            env.pop(k, None)
        
        try:
            result = subprocess.run(
                ['bash', script_path],
                capture_output=True,
                text=True,
                env=env,
                timeout=TIMEOUT,
                cwd=work_dir,
                stdin=subprocess.DEVNULL
            )
            
            result_file = os.path.join(work_dir, "result.json")
            if os.path.exists(result_file):
                with open(result_file, 'r', encoding='utf-8') as f:
                    result_data = json.load(f)
                    rstatus = result_data.get('status', '')
                    if rstatus == 'completed':
                        with self._status_lock:
                            status[task_id]['status'] = TaskStatus.COMPLETED
                            status[task_id]['completed_at'] = datetime.now().isoformat()
                            self.save_status(status)
                        print(f"[成功] 任务 [{task_id}]")
                        return True
                    else:
                        with self._status_lock:
                            status[task_id]['status'] = TaskStatus.FAILED
                            status[task_id]['error'] = result_data.get('error', 'Unknown error')
                            self.save_status(status)
                        print(f"[失败] 任务 [{task_id}]: {result_data.get('error', 'Unknown error')}")
                        return False
            else:
                with self._status_lock:
                    if result.returncode == 0:
                        status[task_id]['status'] = TaskStatus.COMPLETED
                        status[task_id]['completed_at'] = datetime.now().isoformat()
                        self.save_status(status)
                    else:
                        stderr_tail = result.stderr[-500:] if result.stderr else '(empty)'
                        status[task_id]['status'] = TaskStatus.FAILED
                        status[task_id]['error'] = f"Exit {result.returncode}: {stderr_tail}"
                        self.save_status(status)
                if result.returncode == 0:
                    print(f"[成功] 任务 [{task_id}]")
                else:
                    print(f"[失败] 任务 [{task_id}] (退出码: {result.returncode})")
                return result.returncode == 0
                    
        except subprocess.TimeoutExpired:
            with self._status_lock:
                status[task_id]['status'] = TaskStatus.FAILED
                status[task_id]['error'] = f"Timeout after {TIMEOUT}s"
                self.save_status(status)
            print(f"[超时] 任务 [{task_id}]")
            return False
        except Exception as e:
            with self._status_lock:
                status[task_id]['status'] = TaskStatus.FAILED
                status[task_id]['error'] = str(e)
                self.save_status(status)
            print(f"[异常] 任务 [{task_id}]: {e}")
            return False
    
    def run_all(self):
        print("="*60)
        print("SpatialAgent 自动化执行脚本 (MIX50)")
        print("="*60)
        print(f"问题文件: {QUESTION_FILE}")
        print(f"工作目录: {WORK_BASE}")
        print(f"API: {API_BASE}")
        print("="*60)
        
        self.questions = self.load_questions()
        print(f"共 {len(self.questions)} 个问题待执行")
        
        status = self.load_status()
        print(f"已加载 {len(status)} 个任务状态（断点续传）")
        
        completed = sum(1 for s in status.values() if s.get('status') == TaskStatus.COMPLETED)
        failed = sum(1 for s in status.values() if s.get('status') == TaskStatus.FAILED)
        pending = len(self.questions) - completed - failed
        print(f"状态统计: 已完成 {completed}, 失败 {failed}, 待执行 {pending}\n")
        
        pending = []
        for q in self.questions:
            task_id = str(q.get('id', 'unknown'))
            if status.get(task_id, {}).get('status') != TaskStatus.COMPLETED:
                pending.append(q)

        if not pending:
            print("所有任务已完成!")
            final_status = self.load_status()
            final_completed = sum(1 for s in final_status.values() if s.get('status') == TaskStatus.COMPLETED)
            return final_completed, 0

        print(f"\n{'='*60}")
        print(f"⚡ 并行模式: 最大 {MAX_WORKERS} 并发 | 提交间隔 {LAUNCH_INTERVAL}s")
        print(f"待处理: {len(pending)} 个任务")
        print(f"{'='*60}\n")

        _exec_sem = threading.Semaphore(MAX_WORKERS)

        def _run_with_retry(q):
            task_id = str(q.get('id', 'unknown'))
            cat = str(q.get('category', ''))[:18]
            task_preview = q.get('task', '')[:60]

            _exec_sem.acquire()
            try:
                print(f"  🚀 [#{task_id}] 开始 | {cat} | {task_preview}...")
                for attempt in range(MAX_RETRIES + 1):
                    if attempt > 0:
                        print(f"  [重试] 任务 [{task_id}] ({attempt}/{MAX_RETRIES})")
                    success = self.run_task(q, status)
                    if success:
                        return task_id, True
                with self._status_lock:
                    status[task_id]['status'] = TaskStatus.SKIPPED
                    self.save_status(status)
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
                task_id = str(q.get('id', 'unknown'))
                future = executor.submit(_run_with_retry, q)
                futures[future] = task_id
                if i < len(pending) - 1:
                    time.sleep(LAUNCH_INTERVAL)

            for future in as_completed(futures):
                try:
                    task_id, success = future.result()
                    if success:
                        success_count += 1
                        print(f"  ✅ [#{task_id}] 完成 ✓")
                    else:
                        fail_count += 1
                        print(f"  ❌ [#{task_id}] 失败")
                except Exception as e:
                    fail_count += 1
                    task_id = futures[future]
                    print(f"  ❌ [#{task_id}] 异常: {e}")

        total_elapsed = time.time() - total_time_start
        
        print("\n" + "="*60)
        print("执行完成!")
        print("="*60)
        
        final_status = self.load_status()
        final_completed = sum(1 for s in final_status.values() if s.get('status') == TaskStatus.COMPLETED)
        final_failed = sum(1 for s in final_status.values() if s.get('status') in [TaskStatus.FAILED, TaskStatus.SKIPPED])
        print(f"最终结果: 成功 {final_completed}, 失败 {final_failed}")
        print(f"总耗时: {total_elapsed:.0f} 秒 ({total_elapsed/60:.1f} 分钟)")
        
        return final_completed, final_failed


def main():
    runner = SpatialAgentRunner()
    success, failed = runner.run_all()
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
