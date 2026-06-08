#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
报告生成模块 - 将评估结果汇总为 Markdown 报告并支持导出。
"""

import os
import json
import time
import zipfile


METRICS = [
    "Data Authenticity", "Response Relevance", "Tool Use Accuracy", "Hallucination Control",
    "Code Execution", "Domain Knowledge", "Result Interpretation", "Autonomous Planning",
    "Error Recovery", "Output Standardization"
]


def generate_markdown_report(stats, output_dir):
    """生成完整的 Markdown 评估报告。"""
    model_names = stats["models"]
    sorted_models = sorted(model_names, key=lambda m: -stats["totals"][m])
    
    header_line = "| 评价指标 | " + " | ".join(sorted_models) + " |"
    sep_line = "|" + "|".join(["----------" for _ in range(len(sorted_models) + 1)]) + "|"
    
    report = "# 🧠 AI Agent 多模型对比评估报告\n\n"
    report += f"**评估时间**: {time.strftime('%Y-%m-%d %H:%M:%S')}\n\n"
    report += f"**评估问题数**: {stats['total_questions']}\n\n"
    report += f"**参评模型**: {', '.join(sorted_models)}\n\n"
    
    report += "---\n\n"
    report += "## 📊 各模型综合得分\n\n"
    report += header_line + "\n" + sep_line + "\n"
    
    for metric in METRICS:
        row = f"| {metric} | "
        row += " | ".join([str(stats["metrics"][m].get(metric, 0)) for m in sorted_models])
        row += " |\n"
        report += row
    
    total_row = "| **总分 (0-100)** | "
    total_row += " | ".join([f"**{stats['totals'][m]}**" for m in sorted_models])
    total_row += " |\n"
    report += "\n" + total_row
    
    report += "\n---\n\n"
    report += "## 🏆 胜出统计（按题目计）\n\n"
    for m in sorted_models:
        report += f"- **{m}**: 胜出 {stats['wins'].get(m, 0)} 题\n"
    report += f"- **平局**: {stats['ties']} 题\n\n"
    
    report += "---\n\n"
    report += "## 📈 可视化图表\n\n"
    report += "| 图表 | 文件 |\n"
    report += "|------|------|\n"
    report += "| 模型性能对比柱状图 | `bar_chart.pdf` |\n"
    report += "| 模型维度对比热力图 | `heatmap.pdf` |\n"
    report += "| 模型雷达对比图 | `radar.pdf` |\n\n"
    
    report += "---\n\n"
    report += "## 📎 附录：各题详细评估\n\n"
    report += "详见各 `eval_*.md` 文件，包含每题 10 维度评分及模式对比分析。\n"
    
    report_path = os.path.join(output_dir, "评估报告.md")
    with open(report_path, 'w', encoding='utf-8') as f:
        f.write(report)
    
    return report_path


def create_download_zip(output_dir, task_id=None):
    """
    将评估结果打包为 ZIP 供下载。
    包含: 统计 JSON、汇总 Markdown、逐题评估 Markdown、三张 PDF 图表。
    """
    zip_name = f"eval_results_{task_id or time.strftime('%Y%m%d_%H%M%S')}.zip"
    zip_path = os.path.join(output_dir, zip_name)
    
    include_patterns = [
        "评估统计.json",
        "评估汇总.md",
        "评估报告.md",
        "eval_*.md",
        "*.pdf",
    ]
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for fname in os.listdir(output_dir):
            if fname == zip_name:
                continue
            matched = False
            for pat in include_patterns:
                if pat.startswith("eval_") and fname.startswith("eval_") and fname.endswith(".md"):
                    matched = True
                    break
                elif fname == pat:
                    matched = True
                    break
                elif pat == "*.pdf" and fname.endswith(".pdf"):
                    matched = True
                    break
            if matched:
                zf.write(os.path.join(output_dir, fname), fname)
    
    return zip_path
