#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LLM 评估引擎 - 调用 DeepSeek（兼容 OpenAI 接口）对多模型输出进行 10 维度评分。
"""

import os
import re
import time
import json
import hashlib
from openai import OpenAI


METRICS = [
    "Data Authenticity", "Response Relevance", "Tool Use Accuracy", "Hallucination Control",
    "Code Execution", "Domain Knowledge", "Result Interpretation", "Autonomous Planning",
    "Error Recovery", "Output Standardization"
]

METRICS_EN = METRICS


class CheckpointManager:
    """断点续传管理器（基于 JSON 文件）。"""
    
    def __init__(self, output_dir):
        self.path = os.path.join(output_dir, "checkpoint.json")
        self._ensure()
    
    def _ensure(self):
        if not os.path.exists(self.path):
            self.save({"completed": [], "failed": []})
    
    def load(self):
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, FileNotFoundError):
            return {"completed": [], "failed": []}
    
    def save(self, data):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    
    def mark(self, task_hash, success=True):
        cp = self.load()
        if success:
            if task_hash not in cp["completed"]:
                cp["completed"].append(task_hash)
            if task_hash in cp["failed"]:
                cp["failed"].remove(task_hash)
        else:
            if task_hash not in cp["failed"]:
                cp["failed"].append(task_hash)
        self.save(cp)
    
    def is_done(self, task_hash):
        return task_hash in self.load()["completed"]
    
    def clear(self):
        self.save({"completed": [], "failed": []})


class Evaluator:
    """封装评估逻辑与 DeepSeek API 调用。"""
    
    def __init__(self, api_key, api_url="https://api.deepseek.com", output_dir="./outputs"):
        self.client = self._init_client(api_key, api_url)
        self.output_dir = output_dir
        self.checkpoint = CheckpointManager(output_dir)
    
    @staticmethod
    def _init_client(api_key, api_url):
        import httpx
        for key in ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
                     'ALL_PROXY', 'all_proxy', 'SOCKS_PROXY']:
            os.environ.pop(key, None)
        transport = httpx.HTTPTransport(retries=3)
        http_client = httpx.Client(transport=transport, timeout=120.0)
        return OpenAI(api_key=api_key, base_url=api_url, http_client=http_client)
    
    def _make_task_hash(self, task):
        return hashlib.md5(task.encode('utf-8')).hexdigest()
    
    def build_evaluation_prompt(self, task_idx, task, models_data):
        """构造 LLM 评估 prompt。"""
        model_names = list(models_data.keys())
        sep = "=" * 20
        
        header_line = "| 评价指标 | " + " | ".join(model_names) + " |"
        separator_line = "|" + "|".join(["----------" for _ in range(len(model_names) + 1)]) + "|"
        
        prompt = "严格评估AI Agent在不同运行模式下的生物信息学任务表现。\n\n"
        prompt += "【重要】本评估仅关注任务完成质量，不考虑资源消耗（如执行时间、token使用量、内存占用等）。\n\n"
        prompt += "问题编号:" + str(task_idx + 1) + "\n"
        prompt += "任务:" + task + "\n\n"
        prompt += "【重要】以下展示了同一问题在不同运行模式下的完整运行记录，请仔细对比分析。\n"
        
        for model_name, content in models_data.items():
            prompt += "\n" + sep + " " + model_name + " " + sep + "\n" + content + "\n"
        
        prompt += "\nEvaluation Metrics (0-10 points):\n"
        prompt += "1.Data Authenticity 2.Response Relevance 3.Tool Use Accuracy 4.Hallucination Control 5.Code Execution\n"
        prompt += "6.Domain Knowledge 7.Result Interpretation 8.Autonomous Planning 9.Error Recovery 10.Output Standardization\n\n"
        
        prompt += "【输出格式 - 必须严格遵守表格格式】\n"
        prompt += "第一部分：评分表格\n"
        prompt += header_line + "\n"
        prompt += separator_line + "\n"
        
        for metric in METRICS:
            prompt += "| " + metric + " | " + " | ".join(["[0-10]"] * len(model_names)) + " |\n"
        
        prompt += "注: 只填写数值\n\n"
        prompt += "第二部分：模式对比分析（200字以内）\n"
        prompt += "第三部分：推荐最佳、次佳、最差模式及原因\n"
        
        return prompt
    
    def evaluate_one(self, task_idx, task, models_data):
        """评估单个 task。返回 (result_text, error_message)。"""
        prompt = self.build_evaluation_prompt(task_idx, task, models_data)
        
        try:
            response = self.client.chat.completions.create(
                model="deepseek-chat",
                messages=[
                    {"role": "system", "content": "你是专业的生物信息学专家和AI评估师。"},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=4000,
                temperature=0.3
            )
            return response.choices[0].message.content, None
        except Exception as e:
            return None, str(e)
    
    def run(self, task_data, progress_callback=None):
        """
        主评估流程。
        
        参数:
          task_data: {task_string: {model_name: response_text}}
          progress_callback: callable(current, total, task) 用于 SSE 推送进度
        
        返回:
          eval_files: [output_filepath, ...]
          stats: dict 汇总统计
        """
        tasks = list(task_data.keys())
        model_names = list(set().union(*[set(d.keys()) for d in task_data.values()]))
        
        if not tasks:
            raise ValueError("没有可评估的任务数据")
        
        eval_files = []
        success_count = 0
        fail_count = 0
        total = len(tasks)
        
        for idx, task in enumerate(tasks):
            th = self._make_task_hash(task)
            
            # 断点续传
            if self.checkpoint.is_done(th):
                output_file = os.path.join(self.output_dir, f"eval_{idx:03d}.md")
                if os.path.exists(output_file):
                    eval_files.append(output_file)
                    success_count += 1
                    if progress_callback:
                        progress_callback(idx + 1, total, task)
                    continue
            
            if progress_callback:
                progress_callback(idx + 1, total, task)
            
            # 调用 LLM
            result, error = self.evaluate_one(idx, task, task_data[task])
            
            if result:
                output_file = os.path.join(self.output_dir, f"eval_{idx:03d}.md")
                with open(output_file, 'w', encoding='utf-8') as f:
                    f.write(f"# 多模型对比评估 - 任务 {idx + 1}\n\n")
                    f.write(f"**任务**: {task}\n\n")
                    f.write("---\n\n")
                    f.write(result)
                eval_files.append(output_file)
                self.checkpoint.mark(th, success=True)
                success_count += 1
            else:
                self.checkpoint.mark(th, success=False)
                fail_count += 1
            
            # API 速率限制
            time.sleep(1)
        
        # 生成汇总
        stats = self._generate_summary(eval_files, model_names)
        
        return eval_files, stats
    
    def _generate_summary(self, eval_files, model_names):
        """汇总所有评估结果，生成统计 JSON。"""
        all_scores = {m: {metric: [] for metric in METRICS} for m in model_names}
        wins = {m: 0 for m in model_names}
        ties = 0
        
        for fpath in eval_files:
            with open(fpath, 'r', encoding='utf-8') as f:
                content = f.read()
            scores = self._parse_scores(content, model_names)
            
            for mn in model_names:
                for metric in METRICS:
                    if metric in scores.get(mn, {}):
                        all_scores[mn][metric].append(scores[mn][metric])
            
            totals = {m: sum(scores.get(m, {}).values()) for m in model_names}
            if totals:
                max_score = max(totals.values())
                winners = [m for m, s in totals.items() if s == max_score]
                if len(winners) == 1:
                    wins[winners[0]] += 1
                else:
                    ties += 1
        
        summary = {m: {} for m in model_names}
        for m in model_names:
            for metric in METRICS:
                s_list = all_scores[m][metric]
                summary[m][metric] = round(sum(s_list) / len(s_list), 2) if s_list else 0
        
        mode_totals = {m: round(sum(summary[m].values()), 2) for m in model_names}
        
        stats = {
            "total_questions": len(eval_files),
            "models": model_names,
            "totals": mode_totals,
            "wins": wins,
            "ties": ties,
            "metrics": summary
        }
        
        stats_file = os.path.join(self.output_dir, "评估统计.json")
        with open(stats_file, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
        
        # 同时生成 Markdown 汇总
        self._generate_markdown_summary(stats)
        
        return stats
    
    def _parse_scores(self, result_text, model_names):
        """从评估结果文本中解析各模型各指标分数。"""
        scores = {m: {} for m in model_names}
        
        for line in result_text.split('\n'):
            line = line.strip()
            if '|' not in line:
                continue
            parts = [p.strip() for p in line.split('|')]
            if len(parts) < 2:
                continue
            
            metric_name = parts[1].strip()
            if metric_name in METRICS:
                for i, mn in enumerate(model_names):
                    if i + 2 < len(parts) and parts[i + 2]:
                        try:
                            score = int(re.search(r'\d+', parts[i + 2]).group())
                            scores[mn][metric_name] = score
                        except (AttributeError, ValueError):
                            pass
        return scores
    
    def _generate_markdown_summary(self, stats):
        """生成 Markdown 格式的汇总报告。"""
        model_names = stats["models"]
        
        header_line = "| 评价指标 | " + " | ".join(model_names) + " |"
        sep_line = "|" + "|".join(["----------" for _ in range(len(model_names) + 1)]) + "|"
        
        report = "# 多模型对比评估汇总\n\n"
        report += f"评估时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
        report += f"共评估 {stats['total_questions']} 个问题\n\n"
        report += "## 各模型综合得分\n\n"
        report += header_line + "\n" + sep_line + "\n"
        
        for metric in METRICS:
            row = f"| {metric} | "
            row += " | ".join([str(stats["metrics"][m][metric]) for m in model_names])
            row += " |\n"
            report += row
        
        total_row = "| **总分** | "
        total_row += " | ".join([f"**{stats['totals'][m]}**" for m in model_names])
        total_row += " |\n"
        report += "\n" + total_row
        
        report += "\n## 胜出统计\n\n"
        for m in model_names:
            report += f"- **{m}**: {stats['wins'][m]} 题\n"
        report += f"- **平局**: {stats['ties']} 题\n\n"
        
        summary_file = os.path.join(self.output_dir, "评估汇总.md")
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write(report)
