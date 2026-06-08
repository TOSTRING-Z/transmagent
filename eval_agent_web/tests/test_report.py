#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_report.py — 报告生成 + ZIP打包 单元测试
"""

import os
import sys
import json
import tempfile
import zipfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from core.report import generate_markdown_report, create_download_zip


class TestMarkdownReport(unittest.TestCase):
    """Markdown 报告生成"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.stats = {
            "total_questions": 5,
            "models": ["ModelA", "ModelB", "ModelC"],
            "totals": {"ModelA": 85.5, "ModelB": 78.2, "ModelC": 72.0},
            "wins": {"ModelA": 3, "ModelB": 1, "ModelC": 0},
            "ties": 1,
            "metrics": {
                "ModelA": {"数据真实性": 8.5, "任务回答匹配性": 9.0, "工具调用能力": 8.0,
                         "幻觉抑制能力": 8.5, "代码执行能力": 9.0, "领域知识深度": 8.5,
                         "结果解释能力": 9.0, "自主规划能力": 8.0, "错误恢复能力": 7.5,
                         "输出规范性": 9.5},
                "ModelB": {"数据真实性": 8.0, "任务回答匹配性": 8.0, "工具调用能力": 7.5,
                         "幻觉抑制能力": 8.0, "代码执行能力": 7.5, "领域知识深度": 8.5,
                         "结果解释能力": 8.0, "自主规划能力": 7.5, "错误恢复能力": 7.0,
                         "输出规范性": 8.2},
                "ModelC": {"数据真实性": 7.0, "任务回答匹配性": 7.5, "工具调用能力": 6.5,
                         "幻觉抑制能力": 7.5, "代码执行能力": 7.0, "领域知识深度": 7.5,
                         "结果解释能力": 7.5, "自主规划能力": 7.0, "错误恢复能力": 6.5,
                         "输出规范性": 8.0},
            }
        }

    def test_generates_markdown(self):
        """测试 Markdown 报告生成"""
        path = generate_markdown_report(self.stats, self.tmpdir)
        self.assertTrue(os.path.exists(path))

        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 核心内容检查
        self.assertIn("# 🧠 AI Agent 多模型对比评估报告", content)
        self.assertIn("ModelA", content)
        self.assertIn("85.5", content)
        self.assertIn("总分 (0-100)", content)
        self.assertIn("🏆 胜出统计", content)
        self.assertIn("模型性能对比柱状图", content)
        self.assertIn("模型维度对比热力图", content)
        self.assertIn("模型雷达对比图", content)

    def test_models_sorted_by_total(self):
        """测试模型按总分降序排列"""
        path = generate_markdown_report(self.stats, self.tmpdir)
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()

        # ModelA (85.5) 应该出现在 ModelC (72.0) 之前
        a_pos = content.index("ModelA")
        c_pos = content.index("ModelC")
        self.assertLess(a_pos, c_pos)


class TestDownloadZip(unittest.TestCase):
    """ZIP 打包下载"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

        # 创建模拟评估输出文件
        files = {
            "评估统计.json": '{"test": true}',
            "评估汇总.md": "# 汇总",
            "评估报告.md": "# 报告",
            "eval_000.md": "# 任务1",
            "eval_001.md": "# 任务2",
            "模型性能对比图.pdf": "%PDF-1.4 mock",
            "模型维度对比热力图.pdf": "%PDF-1.4 mock",
            "模型雷达对比图.pdf": "%PDF-1.4 mock",
        }
        for fname, content in files.items():
            with open(os.path.join(self.tmpdir, fname), 'w', encoding='utf-8') as f:
                f.write(content)

        # 添加无关文件（不应被打包）
        with open(os.path.join(self.tmpdir, "checkpoint.json"), 'w') as f:
            f.write("{}")

    def test_zip_contains_core_files(self):
        """测试 ZIP 包含核心文件"""
        zip_path = create_download_zip(self.tmpdir, "test123")
        self.assertTrue(os.path.exists(zip_path))
        self.assertTrue(zip_path.endswith(".zip"))

        with zipfile.ZipFile(zip_path, 'r') as zf:
            names = zf.namelist()
            self.assertIn("评估统计.json", names)
            self.assertIn("评估报告.md", names)
            self.assertIn("eval_000.md", names)
            self.assertIn("eval_001.md", names)
            self.assertIn("模型性能对比图.pdf", names)
            # 无关文件不应被打包
            self.assertNotIn("checkpoint.json", names)

    def test_zip_excludes_itself(self):
        """测试 ZIP 不包含自身"""
        zip_path = create_download_zip(self.tmpdir, "test456")
        with zipfile.ZipFile(zip_path, 'r') as zf:
            names = zf.namelist()
            zip_basename = os.path.basename(zip_path)
            self.assertNotIn(zip_basename, names)


if __name__ == '__main__':
    unittest.main(verbosity=2)
