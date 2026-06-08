#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
评测 Agent Web — Flask 主应用
─────────────────────────────────
提供完整的「上传 → 评估 → 可视化 → 导出」评估管道。
"""

import os
import sys
import json
import uuid
import queue
import threading
import zipfile
from flask import (
    Flask, render_template, request, jsonify,
    Response, send_file, url_for
)
from werkzeug.utils import secure_filename

# 将项目根目录加入 Python 路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core.parser import (
    parse_model_json_files,
    parse_generic_csv,
    parse_generic_json,
    normalize_records_for_evaluation,
    truncate_text
)
from core.evaluator import Evaluator
from core.visualizer import Visualizer
from core.report import generate_markdown_report, create_download_zip

# ── Flask 应用初始化 ─────────────────────────────────────────

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
OUTPUT_DIR = os.path.join(BASE_DIR, "outputs")

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 200 * 1024 * 1024  # 200MB

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# SSE 进度管理: {task_id: queue}
progress_queues = {}
# 评估锁: {task_id: threading.Thread}
eval_threads = {}


# ── 辅助函数 ─────────────────────────────────────────────────

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in {
        'json', 'csv', 'txt', 'md'
    }


def sse_format(event, data):
    """构建 SSE 格式消息。"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── 路由：页面 ───────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


# ── 路由：数据上传 ───────────────────────────────────────────

@app.route('/api/upload', methods=['POST'])
def api_upload():
    """
    上传模型数据文件。
    支持多文件上传。每个文件作为独立模型（格式A）或通用格式（格式B）。
    
    返回: {task_id, files: [{name, model_name}], tasks_count, format}
    """
    if 'files' not in request.files:
        return jsonify({"error": "No uploaded files found"}), 400
    
    uploaded = request.files.getlist('files')
    if not uploaded or all(f.filename == '' for f in uploaded):
        return jsonify({"error": "No files selected"}), 400
    
    # 创建任务目录
    task_id = uuid.uuid4().hex[:12]
    task_upload_dir = os.path.join(UPLOAD_DIR, task_id)
    task_output_dir = os.path.join(OUTPUT_DIR, task_id)
    os.makedirs(task_upload_dir, exist_ok=True)
    os.makedirs(task_output_dir, exist_ok=True)
    
    # 获取格式类型
    fmt = request.form.get('format', 'auto')  # 'auto', 'model_json', 'generic'
    
    saved_files = []
    for f in uploaded:
        if f.filename and allowed_file(f.filename):
            safe_name = secure_filename(f.filename)
            save_path = os.path.join(task_upload_dir, safe_name)
            f.save(save_path)
            saved_files.append(save_path)
    
    if not saved_files:
        return jsonify({"error": "No valid files (.json / .csv only)"}), 400
    
    # 智能检测格式
    if fmt == 'auto':
        first_ext = os.path.splitext(saved_files[0])[1].lower()
        if first_ext == '.csv':
            fmt = 'generic'
        else:
            # 检查 JSON 内容结构
            with open(saved_files[0], 'r', encoding='utf-8') as fh:
                try:
                    content = json.load(fh)
                    if isinstance(content, list) and content and 'task' in content[0]:
                        if any(k != 'task' and k != 'response' for k in content[0].keys()):
                            fmt = 'generic'
                        else:
                            fmt = 'model_json'
                    else:
                        fmt = 'generic'
                except json.JSONDecodeError:
                    return jsonify({"error": "Invalid JSON format"}), 400
    
    # 解析数据
    try:
        if fmt == 'model_json':
            models = parse_model_json_files(saved_files)
        else:
            if saved_files[0].endswith('.csv'):
                tasks, models = parse_generic_csv(saved_files[0])
            else:
                tasks, models = parse_generic_json(saved_files[0])
        
        task_data = normalize_records_for_evaluation(models)
        
        # 保存解析结果
        meta = {
            "task_id": task_id,
            "format": fmt,
            "models": list(models.keys()),
            "tasks_count": len(task_data),
            "upload_dir": task_upload_dir,
            "output_dir": task_output_dir,
            "files": [os.path.basename(f) for f in saved_files]
        }
        with open(os.path.join(task_upload_dir, "_meta.json"), 'w', encoding='utf-8') as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        
        # 保存标准化后的 task_data
        with open(os.path.join(task_upload_dir, "_task_data.json"), 'w', encoding='utf-8') as f:
            json.dump(task_data, f, ensure_ascii=False, indent=2)
        
        return jsonify({
            "task_id": task_id,
            "format": fmt,
            "models": list(models.keys()),
            "tasks_count": len(task_data),
            "files": [os.path.basename(f) for f in saved_files]
        })
    except Exception as e:
        return jsonify({"error": f"Data parsing failed: {str(e)}"}), 400


# ── 路由：启动评估 (SSE) ─────────────────────────────────────

@app.route('/api/evaluate', methods=['POST'])
def api_evaluate():
    """
    启动评估任务，返回 SSE 流端点。
    
    请求体: {task_id, api_key, api_url?}
    """
    data = request.get_json() or {}
    task_id = data.get('task_id')
    api_key = data.get('api_key', '').strip()
    api_url = data.get('api_url', 'https://api.deepseek.com').strip()
    
    if not task_id:
        return jsonify({"error": "Missing task_id"}), 400
    if not api_key:
        return jsonify({"error": "Please enter API Key"}), 400
    
    task_upload_dir = os.path.join(UPLOAD_DIR, task_id)
    task_output_dir = os.path.join(OUTPUT_DIR, task_id)
    
    task_data_path = os.path.join(task_upload_dir, "_task_data.json")
    if not os.path.exists(task_data_path):
        return jsonify({"error": "Task data not found, please upload files first"}), 404
    
    # 检查是否已在运行
    if task_id in eval_threads and eval_threads[task_id].is_alive():
        return jsonify({
            "status": "running",
            "stream_url": f"/api/stream/{task_id}"
        })
    
    # 创建进度队列
    q = queue.Queue()
    progress_queues[task_id] = q
    
    with open(task_data_path, 'r', encoding='utf-8') as f:
        task_data = json.load(f)
    
    os.makedirs(task_output_dir, exist_ok=True)
    
    def progress_cb(current, total, task):
        q.put(sse_format("progress", {
            "current": current, "total": total,
            "task": task[:100],
            "percent": round(current / total * 100, 1)
        }))
    
    def run_eval():
        try:
            evaluator = Evaluator(api_key, api_url, task_output_dir)
            eval_files, stats = evaluator.run(task_data, progress_callback=progress_cb)
            
            # 生成图表
            viz = Visualizer(task_output_dir)
            charts = viz.generate_all(stats)
            
            # 生成报告
            report_path = generate_markdown_report(stats, task_output_dir)
            
            # 保存最终统计
            stats["charts"] = {k: os.path.basename(v) for k, v in charts.items()}
            stats["report"] = os.path.basename(report_path)
            stats_path = os.path.join(task_output_dir, "评估统计.json")
            with open(stats_path, 'w', encoding='utf-8') as f:
                json.dump(stats, f, ensure_ascii=False, indent=2)
            
            q.put(sse_format("complete", {
                "stats": stats,
                "charts": {k: f"/api/charts/{task_id}/{os.path.basename(v)}"
                          for k, v in charts.items()},
                "download_url": f"/api/download/{task_id}"
            }))
        except Exception as e:
            q.put(sse_format("error", {"message": str(e)}))
        finally:
            q.put(sse_format("done", {}))
    
    thread = threading.Thread(target=run_eval, daemon=True)
    eval_threads[task_id] = thread
    thread.start()
    
    return jsonify({
        "status": "started",
        "stream_url": f"/api/stream/{task_id}"
    })


# ── 路由：SSE 进度流 ─────────────────────────────────────────

@app.route('/api/stream/<task_id>')
def api_stream(task_id):
    """Server-Sent Events 端点，实时推送评估进度。"""
    if task_id not in progress_queues:
        return Response(sse_format("error", {"message": "Task not found"}), 
                       mimetype='text/event-stream')
    
    q = progress_queues[task_id]
    
    def generate():
        while True:
            try:
                msg = q.get(timeout=60)
                yield msg
                if 'event: done' in msg or 'event: error' in msg:
                    break
            except queue.Empty:
                yield sse_format("ping", {})
    
    return Response(generate(), mimetype='text/event-stream',
                    headers={
                        'Cache-Control': 'no-cache',
                        'X-Accel-Buffering': 'no'
                    })


# ── 路由：获取状态/结果 ──────────────────────────────────────

@app.route('/api/status/<task_id>')
def api_status(task_id):
    """获取评估状态和统计结果。"""
    stats_path = os.path.join(OUTPUT_DIR, task_id, "评估统计.json")
    
    if os.path.exists(stats_path):
        with open(stats_path, 'r', encoding='utf-8') as f:
            stats = json.load(f)
        return jsonify({"status": "completed", "stats": stats})
    
    if task_id in eval_threads and eval_threads[task_id].is_alive():
        return jsonify({"status": "running"})
    
    return jsonify({"status": "not_found"})


@app.route('/api/charts/<task_id>/<filename>')
def api_chart(task_id, filename):
    """返回图表 PDF 文件。"""
    safe_name = secure_filename(filename)
    chart_path = os.path.join(OUTPUT_DIR, task_id, safe_name)
    if os.path.exists(chart_path):
        return send_file(chart_path, mimetype='application/pdf')
    return jsonify({"error": "Chart not found"}), 404


@app.route('/api/download/<task_id>')
def api_download(task_id):
    """打包下载评估结果 ZIP。"""
    task_output_dir = os.path.join(OUTPUT_DIR, task_id)
    if not os.path.exists(task_output_dir):
        return jsonify({"error": "Task not found"}), 404
    
    zip_path = create_download_zip(task_output_dir, task_id)
    return send_file(zip_path, as_attachment=True,
                     download_name=os.path.basename(zip_path),
                     mimetype='application/zip')


# ── 路由：列出评估详情 ───────────────────────────────────────

@app.route('/api/eval_detail/<task_id>/<int:idx>')
def api_eval_detail(task_id, idx):
    """返回单题评估详情 Markdown 内容。"""
    fpath = os.path.join(OUTPUT_DIR, task_id, f"eval_{idx:03d}.md")
    if os.path.exists(fpath):
        with open(fpath, 'r', encoding='utf-8') as f:
            content = f.read()
        return jsonify({"content": content})
    return jsonify({"error": "Detail not found"}), 404


# ── 路由：示例数据 ───────────────────────────────────────────

EXAMPLES_DIR = os.path.join(BASE_DIR, "examples")

@app.route('/api/examples')
def api_examples():
    """列出可下载的示例数据文件。"""
    if not os.path.exists(EXAMPLES_DIR):
        return jsonify({"files": []})
    files = sorted([
        f for f in os.listdir(EXAMPLES_DIR)
        if f.endswith('.json') or f.endswith('.csv')
    ])
    return jsonify({
        "files": files,
        "count": len(files),
        "description": "Sample data: 3 models × 5 bioinformatics tasks"
    })


@app.route('/api/examples/<filename>')
def api_example_download(filename):
    """下载单个示例数据文件。"""
    # 安全过滤文件名，并尝试匹配（括号等字符可能被 secure_filename 剥离）
    safe_name = secure_filename(filename)
    filepath = os.path.join(EXAMPLES_DIR, safe_name)
    
    if not os.path.exists(filepath) and os.path.exists(EXAMPLES_DIR):
        # Fallback: 在目录中查找实际文件（括号、空格等被剥离后匹配）
        for f in os.listdir(EXAMPLES_DIR):
            if secure_filename(f) == safe_name:
                filepath = os.path.join(EXAMPLES_DIR, f)
                safe_name = f
                break
    
    if os.path.exists(filepath):
        return send_file(filepath, as_attachment=True,
                        download_name=safe_name,
                        mimetype='application/json')
    return jsonify({"error": "Sample file not found"}), 404


@app.route('/api/examples/download_all')
def api_example_download_all():
    """打包下载所有示例文件。"""
    import tempfile
    if not os.path.exists(EXAMPLES_DIR):
        return jsonify({"error": "Sample directory not found"}), 404
    
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
    with zipfile.ZipFile(tmp.name, 'w', zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(EXAMPLES_DIR):
            if fname.endswith('.json') or fname.endswith('.csv'):
                zf.write(os.path.join(EXAMPLES_DIR, fname), fname)
    
    return send_file(tmp.name, as_attachment=True,
                    download_name='EvalAgent_Sample_Data.zip',
                    mimetype='application/zip')


# ── 启动 ─────────────────────────────────────────────────────

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
