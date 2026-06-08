#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_visualizer.py — 图表生成 单元测试
"""

import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from core.visualizer import Visualizer


class TestVisualizer(unittest.TestCase):
    """图表生成测试"""

    @classmethod
    def setUpClass(cls):
        cls.tmpdir = tempfile.mkdtemp()
        cls.stats = {
            "total_questions": 5,
            "models": ["GPT-4o", "Claude-3.5", "Gemini-Pro"],
            "totals": {"GPT-4o": 88.5, "Claude-3.5": 82.0, "Gemini-Pro": 74.5},
            "wins": {"GPT-4o": 3, "Claude-3.5": 1, "Gemini-Pro": 0},
            "ties": 1,
            "metrics": {
                "GPT-4o": {
                    "数据真实性": 9.0, "任务回答匹配性": 9.5, "工具调用能力": 8.5,
                    "幻觉抑制能力": 9.0, "代码执行能力": 9.0, "领域知识深度": 8.5,
                    "结果解释能力": 9.0, "自主规划能力": 8.5, "错误恢复能力": 8.0,
                    "输出规范性": 9.5
                },
                "Claude-3.5": {
                    "数据真实性": 8.5, "任务回答匹配性": 8.5, "工具调用能力": 7.5,
                    "幻觉抑制能力": 8.5, "代码执行能力": 8.0, "领域知识深度": 9.0,
                    "结果解释能力": 8.5, "自主规划能力": 8.0, "错误恢复能力": 7.5,
                    "输出规范性": 8.0
                },
                "Gemini-Pro": {
                    "数据真实性": 7.5, "任务回答匹配性": 7.5, "工具调用能力": 6.5,
                    "幻觉抑制能力": 7.0, "代码执行能力": 7.5, "领域知识深度": 7.5,
                    "结果解释能力": 7.5, "自主规划能力": 7.0, "错误恢复能力": 6.5,
                    "输出规范性": 8.0
                }
            }
        }

        # 保存 stats JSON 到临时目录
        stats_path = os.path.join(cls.tmpdir, "评估统计.json")
        with open(stats_path, 'w', encoding='utf-8') as f:
            json.dump(cls.stats, f, ensure_ascii=False, indent=2)

    def setUp(self):
        self.viz = Visualizer(self.tmpdir)

    def test_load_stats_from_file(self):
        """测试从文件加载统计数据"""
        stats = self.viz.load_stats()
        self.assertEqual(stats["total_questions"], 5)
        self.assertEqual(len(stats["models"]), 3)
        self.assertAlmostEqual(stats["totals"]["GPT-4o"], 88.5, places=1)

    def test_generate_bar_chart(self):
        """测试柱状图生成"""
        charts = self.viz.generate_all(self.__class__.stats)
        self.assertIn("bar_chart", charts)
        self.assertTrue(os.path.exists(charts["bar_chart"]))
        self.assertTrue(charts["bar_chart"].endswith(".pdf"))

    def test_generate_heatmap(self):
        """测试热力图生成"""
        charts = self.viz.generate_all(self.__class__.stats)
        self.assertIn("heatmap", charts)
        self.assertTrue(os.path.exists(charts["heatmap"]))
        self.assertTrue(charts["heatmap"].endswith(".pdf"))

    def test_generate_radar(self):
        """测试雷达图生成"""
        charts = self.viz.generate_all(self.__class__.stats)
        self.assertIn("radar", charts)
        self.assertTrue(os.path.exists(charts["radar"]))
        self.assertTrue(charts["radar"].endswith(".pdf"))

    def test_generate_all_returns_three(self):
        """测试 generate_all 返回 3 张图表"""
        charts = self.viz.generate_all(self.__class__.stats)
        self.assertEqual(len(charts), 3)

    def test_stats_file_not_found(self):
        """测试统计文件不存在时抛出异常"""
        viz2 = Visualizer(tempfile.mkdtemp())
        with self.assertRaises(FileNotFoundError):
            viz2.load_stats()


if __name__ == '__main__':
    unittest.main(verbosity=2)
