#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据解析模块 - 支持两种输入格式：
  格式A: 模型结果 JSON（transagent_result_test_set(模型名).json 兼容格式）
  格式B: 通用 CSV / JSON（用户自定义列名映射）
"""

import os
import re
import json
import csv
from collections import defaultdict
from werkzeug.utils import secure_filename

# ── 格式A：模型结果 JSON ──────────────────────────────────────────

def parse_model_json_files(filepaths):
    """
    解析多个 transagent_result_test_set(模型名).json 文件。
    返回: {model_name: [records]}, 其中每个 record 含 task 字段。
    
    支持两种 JSON 结构：
      1. 列表格式: [{"task": "...", "response": {...}}, ...]
      2. 字典格式: {"task1": {...}, "task2": {...}}
    """
    models = {}
    
    for fp in filepaths:
        fname = os.path.basename(fp)
        
        # 尝试从文件名推导模型名
        match = re.search(r'transagent_result_test_set\((.+)\)\.json', fname)
        if match:
            model_name = match.group(1)
        else:
            # fallback: 使用安全文件名（去掉扩展名）
            model_name = os.path.splitext(fname)[0]
        
        with open(fp, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        if isinstance(data, list):
            models[model_name] = data
        elif isinstance(data, dict):
            # 字典格式：将 key 作为 task
            records = []
            for task_key, value in data.items():
                if isinstance(value, dict):
                    value['task'] = task_key
                    records.append(value)
                else:
                    records.append({'task': task_key, 'response': value})
            models[model_name] = records
        else:
            raise ValueError(f"无法解析文件 {fname}: 期望列表或字典，实际为 {type(data)}")
    
    return models


def find_common_tasks(models):
    """找出所有模型共有的 task 列表。"""
    if not models:
        return []
    
    task_sets = []
    for model_name, records in models.items():
        tasks = set()
        for r in records:
            task = r.get('task', '')
            if task:
                tasks.add(task)
        task_sets.append(tasks)
    
    common = task_sets[0]
    for ts in task_sets[1:]:
        common = common & ts
    
    return sorted(common)


def extract_response_text(record):
    """从 record 中提取完整的模型响应文本（供 LLM 评估阅读）。"""
    if not record:
        return "[无记录]"
    
    response = record.get('response', record)
    
    if isinstance(response, str):
        return response
    
    if isinstance(response, dict):
        messages = response.get('messages', [])
        if messages:
            full_text = []
            for msg in messages:
                if msg.get('role') == 'assistant':
                    content = msg.get('content', '')
                    if isinstance(content, list):
                        for item in content:
                            if isinstance(item, dict) and item.get('type') == 'text':
                                text = item.get('text', '').strip()
                                if text:
                                    full_text.append(text)
                    elif isinstance(content, str) and content.strip():
                        full_text.append(content.strip())
            if full_text:
                return '\n\n=== 对话分隔 ===\n\n'.join(full_text)
        return json.dumps(response, ensure_ascii=False, indent=2)[:50000]
    
    return str(response)


def truncate_text(text, max_chars=20000):
    """截断过长文本（保留首尾各一半）。"""
    if text is None or text == "[无记录]":
        return "[无记录]"
    if not text:
        return text
    if len(text) <= max_chars:
        return text
    half = max_chars // 2
    return text[:half] + "\n\n[... 内容已截断 ...]\n\n" + text[-half:]


# ── 格式B：通用 CSV / JSON ────────────────────────────────────────

def parse_generic_csv(filepath):
    """
    解析通用 CSV 文件。第一列应为 task，其余列每列代表一个模型。
    返回: (task_list, {model_name: {task: value}})
    """
    tasks = []
    model_data = defaultdict(dict)
    
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            raise ValueError("CSV 文件缺少表头")
        
        model_names = [fn.strip() for fn in reader.fieldnames[1:]]
        
        for row in reader:
            task = row[reader.fieldnames[0]].strip()
            if not task:
                continue
            tasks.append(task)
            for mn in model_names:
                model_data[mn][task] = row.get(mn, '').strip()
    
    return tasks, dict(model_data)


def parse_generic_json(filepath):
    """
    解析通用 JSON 文件。
    支持格式: [{"task": "...", "modelA": "...", "modelB": "..."}, ...]
    """
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    if not isinstance(data, list):
        raise ValueError("通用 JSON 格式错误：期望列表")
    
    tasks = []
    all_models = set()
    rows = []
    
    for row in data:
        task = row.get('task', '')
        if not task:
            continue
        tasks.append(task)
        for key, value in row.items():
            if key != 'task':
                all_models.add(key)
        rows.append(row)
    
    model_data = {m: {} for m in all_models}
    for row in rows:
        task = row['task']
        for m in all_models:
            model_data[m][task] = row.get(m, '')
    
    return tasks, model_data


def normalize_records_for_evaluation(models_data):
    """
    将任意格式的模型数据标准化为评估引擎所需格式。
    输入: {model_name: records_or_dict}
    输出: {task: {model_name: response_text}}
    """
    model_names = list(models_data.keys())
    
    # 判断输入类型：records（来自 parse_model_json_files）或 dict（来自通用格式）
    first_val = next(iter(models_data.values())) if models_data else None
    
    if isinstance(first_val, list):
        # 格式A: records 列表
        task_data = defaultdict(dict)
        for mn, records in models_data.items():
            for r in records:
                task = r.get('task', '')
                if task:
                    task_data[task][mn] = extract_response_text(r)
        return dict(task_data)
    elif isinstance(first_val, dict):
        # 格式B: 已按 task->model 组织
        task_data = defaultdict(dict)
        for mn, task_dict in models_data.items():
            for task, value in task_dict.items():
                task_data[task][mn] = str(value) if not isinstance(value, str) else value
        return dict(task_data)
    else:
        raise ValueError(f"无法识别的数据格式: {type(first_val)}")
