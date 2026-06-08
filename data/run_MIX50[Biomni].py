#!/usr/bin/env python3
"""
Biomni 自动化执行脚本 - 适配 MIX50.json
基于 run_QA100_optimized[Biomni].py 模板，使用 Biomni 完全版 (A1 agent)
"""

import os, sys, json, subprocess, time, threading, functools
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict

print = functools.partial(print, flush=True)

# ======================== 配置 ========================
API_KEY = "sk-uAG0bRv1YefsNDxO6zI3Hw4qOKJbivehSjCASkdMD3Dbd6BH"
API_BASE = "https://runapi.co/v1"
MODEL_NAME = "deepseek-v3.2"

WORK_BASE = "/home/tostring/桌面/document/NM改稿/MIX50/run_Biomni"
QUESTION_FILE = "/home/tostring/桌面/document/NM改稿/MIX50/MIX50.json"

CONDA_ENV = "agent"
CONDA_PATH = os.path.expanduser("~/miniconda3/etc/profile.d/conda.sh")
CONDA_PREFIX = "/home/tostring/miniconda3/envs/agent"
AGENT_PYTHON = "/home/tostring/miniconda3/envs/agent/bin/python"

TIMEOUT = 3600
MAX_RETRIES = 3
MAX_WORKERS = 4
LAUNCH_INTERVAL = 1

BIOMNI_DATA_PATH = "/home/tostring/桌面/document/NM改稿/QA100/data"
DOWNLOAD_DATALAKE = True
# ======================================


class TaskStatus:
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class BiomniRunner:

    REQUIRED_DEPS = [
        ('esm', 'genomics (archs4 表达数据)'),
        ('torch', 'genetics (深度学习模型)'),
        ('Bio', 'database + molecular_biology'),
        ('nibabel', 'bioimaging (医学影像)'),
        ('h5py', 'HDF5 文件 (scanpy/anndata)'),
        ('scanpy', 'single-cell 分析'),
        ('sklearn', '机器学习 (scikit-learn)'),
        ('numba', 'JIT 加速'),
        ('patsy', '统计公式 (statsmodels)'),
        ('scipy', '科学计算'),
        ('pysam', '基因组文件 I/O'),
        ('plotly', '可视化'),
        ('igraph', '图分析'),
        ('leidenalg', 'Leiden 聚类'),
        ('PyPDF2', 'literature (PDF 解析)'),
    ]

    def __init__(self):
        self.work_base = WORK_BASE
        os.makedirs(self.work_base, exist_ok=True)
        self.questions = []
        self.status_file = os.path.join(WORK_BASE, "task_status.json")

    def verify_dependencies(self) -> bool:
        import importlib
        print("=" * 60)
        print("🔍 依赖检查 (Biomni 完全版)")
        print("=" * 60)
        missing = []
        ok = 0
        for pkg, purpose in self.REQUIRED_DEPS:
            try:
                importlib.import_module(pkg)
                ok += 1
            except ImportError:
                print(f"  ✗ {pkg} ({purpose})")
                missing.append(pkg)
        total = len(self.REQUIRED_DEPS)
        print(f"\n结果: {ok}/{total} 就绪")
        if missing:
            print(f"缺失 ({len(missing)}): {', '.join(missing)}")
            print(f"\n⚠️  请运行: conda activate {CONDA_ENV} && pip install {' '.join(missing)}")
            return False
        else:
            print("✅ 所有依赖就绪!\n")
            return True

    def load_questions(self) -> List[Dict]:
        with open(QUESTION_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        elif isinstance(data, dict) and 'questions' in data:
            return data['questions']
        else:
            return [data]

    def load_status(self) -> Dict[str, Dict]:
        if os.path.exists(self.status_file):
            with open(self.status_file, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}

    def save_status(self, status: Dict[str, Dict]):
        with open(self.status_file, 'w', encoding='utf-8') as f:
            json.dump(status, f, ensure_ascii=False, indent=2)

    def get_task_work_dir(self, q: Dict) -> str:
        task_id = q.get('id', 'unknown')
        category = q.get('category', 'unknown')
        category = str(category).replace('/', '_').replace('\\', '_').replace(' ', '_')
        return os.path.join(self.work_base, f"{task_id}_{category}")

    def create_script(self, q: Dict, work_dir: str) -> str:
        task_raw = q.get('task', '')
        task = (
            f"{task_raw}\n\n"
            "你的最终回答必须包括如下内容：\n"
            "[完整分析结果和结论]\n\n"
        )
        task_id = q.get('id', 'unknown')
        category = q.get('category', 'unknown')

        task_escaped = task.replace('\\', '\\\\').replace('"""', '\\"\\"\\"')

        script_content = f'''#!/bin/bash
set -e

export PYTHONIOENCODING=utf-8
export PYTHONPATH="/tmp/langchain_lib:/tmp/pyyaml_lib:$PYTHONPATH"
export PATH="{CONDA_PREFIX}/bin:$PATH"
export CONDA_PREFIX="{CONDA_PREFIX}"
export CONDA_DEFAULT_ENV="{CONDA_ENV}"
export OPENAI_API_KEY="{API_KEY}"
export CUSTOM_MODEL_BASE_URL="{API_BASE}"
export CUSTOM_MODEL_API_KEY="{API_KEY}"
export BIOMNI_DATA_PATH="{BIOMNI_DATA_PATH}"
export BIOMNI_TIMEOUT_SECONDS="1200"
export OPENBLAS_NUM_THREADS="1"
export OMP_NUM_THREADS="1"
export MKL_NUM_THREADS="1"
export NUMEXPR_NUM_THREADS="1"
export VECLIB_MAXIMUM_THREADS="1"
export BLIS_NUM_THREADS="1"

unset ALL_PROXY  all_proxy
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy
unset NO_PROXY   no_proxy
unset REQUESTS_CA_BUNDLE
unset CURL_CA_BUNDLE

{AGENT_PYTHON} << 'PYEOF'
import os, sys, json, traceback, io
sys.path.insert(0, '/tmp/langchain_lib')
sys.path.insert(1, '/tmp/pyyaml_lib')
from datetime import datetime

_proxy_vars = (
    'HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
    'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy',
    'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
)
for _k in _proxy_vars:
    os.environ.pop(_k, None)

os.environ['no_proxy'] = '*'
os.environ['NO_PROXY'] = '*'

os.environ['OPENAI_API_KEY'] = '{API_KEY}'
os.environ['CUSTOM_MODEL_BASE_URL'] = '{API_BASE}'
os.environ['CUSTOM_MODEL_API_KEY'] = '{API_KEY}'
os.environ['BIOMNI_DATA_PATH'] = '{BIOMNI_DATA_PATH}'
os.environ['BIOMNI_TIMEOUT_SECONDS'] = '1200'

print("=" * 60)
print(f"🔬 Biomni 任务执行")
print(f"   任务 ID: {task_id}")
print(f"   类别: {category}")
print(f"   模型: {MODEL_NAME}")
print("=" * 60)

from biomni.agent import A1
from biomni.config import default_config

default_config.llm = "{MODEL_NAME}"
default_config.source = "Custom"
default_config.base_url = "{API_BASE}"
default_config.api_key = "{API_KEY}"
default_config.timeout_seconds = 1200
default_config.path = "{BIOMNI_DATA_PATH}"

try:
    print("\\n🚀 正在初始化 Biomni A1 Agent...")
    _datalake_files = None if {DOWNLOAD_DATALAKE} else []
    agent = A1(
        path="{BIOMNI_DATA_PATH}",
        llm="{MODEL_NAME}",
        source="Custom",
        base_url="{API_BASE}",
        api_key="{API_KEY}",
        timeout_seconds=1200,
        expected_data_lake_files=_datalake_files,
        use_tool_retriever=True,
        commercial_mode=False,
    )
    print("✅ Biomni A1 Agent 初始化完成\\n")

    task_query = """{task_escaped}"""

    print("📋 任务描述:")
    print("-" * 40)
    print(task_query[:500])
    if len(task_query) > 500:
        print(f"... (共 {{len(task_query)}} 字符)")
    print("-" * 40)
    print("\\n⏳ 开始执行分析（Biomni 全工具链）...\\n")

    captured_output = io.StringIO()
    original_stdout = sys.stdout
    sys.stdout = captured_output

    try:
        agent.go(task_query)
    finally:
        sys.stdout = original_stdout

    full_output = captured_output.getvalue()
    print(full_output)

    status_val = "completed"
    completed_at = datetime.now().isoformat()

    result_data = {{
        "status": status_val,
        "question_id": "{task_id}",
        "category": "{category}",
        "task": task_query,
        "completed_at": completed_at,
        "full_output_length": len(full_output),
        "model": "{MODEL_NAME}",
        "agent": "Biomni-A1",
    }}

    output_file = os.path.join("{work_dir}", "full_output.txt")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(full_output)
    print(f"\\n📄 完整输出已保存: {{output_file}}")

    result_file = os.path.join("{work_dir}", "result.json")
    with open(result_file, 'w', encoding='utf-8') as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)

    print(f"📊 结果已保存: {{result_file}}")
    print(f"   状态: {{status_val}}")
    print("\\n" + "=" * 60)
    print("✅ 任务执行完成!")
    print("=" * 60)

except Exception as e:
    print(f"\\n❌ 执行出错: {{e}}")
    traceback.print_exc()

    result_file = os.path.join("{work_dir}", "result.json")
    with open(result_file, 'w', encoding='utf-8') as f:
        json.dump({{
            "status": "failed",
            "question_id": "{task_id}",
            "category": "{category}",
            "error": str(e),
            "failed_at": datetime.now().isoformat(),
            "model": "{MODEL_NAME}",
            "agent": "Biomni-A1",
        }}, f, ensure_ascii=False, indent=2)

    sys.exit(1)
PYEOF
'''

        script_path = os.path.join(work_dir, "run_task.sh")
        with open(script_path, 'w', encoding='utf-8') as f:
            f.write(script_content)
        os.chmod(script_path, 0o755)
        return script_path

    def run_task(self, q: Dict, status: Dict[str, Dict]) -> bool:
        task_id = str(q.get('id', 'unknown'))
        category = q.get('category', 'unknown')
        work_dir = self.get_task_work_dir(q)

        if status.get(task_id, {}).get('status') == TaskStatus.COMPLETED:
            print(f"[跳过] 已完成任务 [{task_id}] {category}")
            return True

        os.makedirs(work_dir, exist_ok=True)

        print(f"\n{'='*60}")
        print(f"[执行] 任务 [{task_id}] {category}")
        print(f"  工作目录: {work_dir}")
        print(f"{'='*60}")

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
        env.update({
            'PYTHONIOENCODING': 'utf-8',
            'OPENAI_API_KEY': API_KEY,
            'CUSTOM_MODEL_BASE_URL': API_BASE,
            'CUSTOM_MODEL_API_KEY': API_KEY,
            'no_proxy': '*',
            'NO_PROXY': '*',
        })
        for k in ('ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'HTTPS_PROXY',
                  'http_proxy', 'https_proxy', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE'):
            env.pop(k, None)

        try:
            result = subprocess.run(
                ['bash', script_path],
                capture_output=True, text=True, env=env, timeout=TIMEOUT,
                cwd=work_dir, stdin=subprocess.DEVNULL
            )

            result_file = os.path.join(work_dir, "result.json")
            if os.path.exists(result_file):
                with open(result_file, 'r', encoding='utf-8') as f:
                    result_data = json.load(f)
                rstatus = result_data.get('status', '')
                if rstatus == 'completed':
                    status[task_id]['status'] = TaskStatus.COMPLETED
                    status[task_id]['completed_at'] = datetime.now().isoformat()
                    self.save_status(status)
                    print(f"[成功] 任务 [{task_id}]")
                    return True
                else:
                    status[task_id]['status'] = TaskStatus.FAILED
                    status[task_id]['error'] = result_data.get('error', 'Unknown error')
                    self.save_status(status)
                    print(f"[失败] 任务 [{task_id}]: {result_data.get('error', 'Unknown')}")
                    return False
            else:
                if result.returncode == 0:
                    stdout_file = os.path.join(work_dir, "stdout_dump.txt")
                    with open(stdout_file, 'w', encoding='utf-8') as f:
                        f.write(result.stdout)
                    status[task_id]['status'] = TaskStatus.FAILED
                    status[task_id]['error'] = 'No result.json generated (exit 0)'
                    self.save_status(status)
                    print(f"[失败] 任务 [{task_id}]: 无 result.json")
                    return False
                else:
                    stderr_tail = result.stderr[-500:] if result.stderr else '(empty)'
                    status[task_id]['status'] = TaskStatus.FAILED
                    status[task_id]['error'] = f"Exit {result.returncode}: {stderr_tail}"
                    self.save_status(status)
                    print(f"[失败] 任务 [{task_id}] (退出码: {result.returncode})")
                    return False

        except subprocess.TimeoutExpired:
            status[task_id]['status'] = TaskStatus.FAILED
            status[task_id]['error'] = f"Timeout after {TIMEOUT}s"
            self.save_status(status)
            print(f"[超时] 任务 [{task_id}]")
            return False
        except Exception as e:
            status[task_id]['status'] = TaskStatus.FAILED
            status[task_id]['error'] = str(e)
            self.save_status(status)
            print(f"[异常] 任务 [{task_id}]: {e}")
            return False

    def run_all(self):
        print("=" * 60)
        print("🧬 Biomni 自动化执行脚本 (MIX50)")
        print("   适配 Biomni 完全版 (A1 agent)")
        print("=" * 60)
        print(f"问题文件: {QUESTION_FILE}")
        print(f"工作目录: {WORK_BASE}")
        print(f"模型: {MODEL_NAME}")
        print(f"API Base: {API_BASE}")
        print(f"Conda 环境: {CONDA_ENV}")
        print("=" * 60)

        if not self.verify_dependencies():
            print("\n❌ 依赖缺失，无法继续。请安装缺失包后重试。")
            return 0, 0

        self.questions = self.load_questions()
        print(f"共 {len(self.questions)} 个问题待执行")

        status = self.load_status()
        print(f"已加载 {len(status)} 个任务状态（断点续传）")

        completed = sum(1 for s in status.values() if s.get('status') == TaskStatus.COMPLETED)
        failed = sum(1 for s in status.values() if s.get('status') == TaskStatus.FAILED)
        print(f"状态统计: 已完成 {completed}, 失败 {failed}, 待执行 {len(self.questions) - completed - failed}\n")

        pending = []
        for q in self.questions:
            task_id = str(q.get('id', 'unknown'))
            if status.get(task_id, {}).get('status') != TaskStatus.COMPLETED:
                pending.append(q)

        if not pending:
            print("所有任务已完成!")
            final_status = self.load_status()
            final_completed = sum(1 for s in final_status.values()
                                  if s.get('status') == TaskStatus.COMPLETED)
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
        print("\n" + "=" * 60)
        print("🎉 执行完成!")
        print("=" * 60)

        final_status = self.load_status()
        final_completed = sum(1 for s in final_status.values()
                              if s.get('status') == TaskStatus.COMPLETED)
        final_failed = sum(1 for s in final_status.values()
                           if s.get('status') in [TaskStatus.FAILED, TaskStatus.SKIPPED])

        print(f"最终结果: 成功 {final_completed}, 失败 {final_failed}")
        print(f"总耗时: {total_elapsed:.0f} 秒 ({total_elapsed/60:.1f} 分钟)")
        return final_completed, final_failed


def main():
    runner = BiomniRunner()
    success, failed = runner.run_all()
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
