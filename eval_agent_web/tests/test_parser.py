#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_parser.py — 数据解析模块单元测试
覆盖: 格式A（模型JSON）、格式B（通用CSV/JSON）、normalize、边界情况
"""

import os
import sys
import json
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from core.parser import (
    parse_model_json_files,
    parse_generic_csv,
    parse_generic_json,
    find_common_tasks,
    extract_response_text,
    truncate_text,
    normalize_records_for_evaluation,
)


class TestModelJSONFormat(unittest.TestCase):
    """格式A: transagent_result_test_set(模型名).json"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def _write_json(self, fname, data):
        path = os.path.join(self.tmpdir, fname)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return path

    def test_single_model_list_format(self):
        """测试单模型列表格式解析"""
        path = self._write_json('transagent_result_test_set(ModelA).json', [
            {"task": "任务1: 差异表达分析", "response": {"messages": [{"role": "assistant", "content": "结果: 1234个差异基因"}]}},
            {"task": "任务2: GO富集分析",     "response": {"messages": [{"role": "assistant", "content": "富集到15条通路"}]}},
        ])
        models = parse_model_json_files([path])
        self.assertIn("ModelA", models)
        self.assertEqual(len(models["ModelA"]), 2)

    def test_multi_model_list_format(self):
        """测试多模型列表格式解析"""
        p1 = self._write_json('transagent_result_test_set(GPT4).json', [
            {"task": "差异表达分析", "response": {"messages": [{"role": "assistant", "content": "OK"}]}},
        ])
        p2 = self._write_json('transagent_result_test_set(Claude).json', [
            {"task": "差异表达分析", "response": {"messages": [{"role": "assistant", "content": "Good"}]}},
        ])
        models = parse_model_json_files([p1, p2])
        self.assertEqual(len(models), 2)
        self.assertIn("GPT4", models)
        self.assertIn("Claude", models)

    def test_dict_format(self):
        """测试字典格式（key=task, value=response）"""
        path = self._write_json('transagent_result_test_set(DictModel).json', {
            "任务A": {"response": "OK"},
            "任务B": {"response": "Good"},
        })
        models = parse_model_json_files([path])
        self.assertEqual(len(models["DictModel"]), 2)
        tasks = [r.get("task") for r in models["DictModel"]]
        self.assertIn("任务A", tasks)

    def test_fallback_model_name(self):
        """测试无法从文件名提取模型名时的fallback"""
        path = self._write_json('unknown.json', [
            {"task": "test", "response": "data"}
        ])
        models = parse_model_json_files([path])
        self.assertIn("unknown", models)


class TestFindCommonTasks(unittest.TestCase):
    """公共任务查找"""

    def test_all_common(self):
        models = {
            "A": [{"task": "t1"}, {"task": "t2"}, {"task": "t3"}],
            "B": [{"task": "t1"}, {"task": "t2"}, {"task": "t3"}],
        }
        common = find_common_tasks(models)
        self.assertEqual(set(common), {"t1", "t2", "t3"})

    def test_partial_overlap(self):
        models = {
            "A": [{"task": "t1"}, {"task": "t2"}, {"task": "t3"}],
            "B": [{"task": "t1"}, {"task": "t3"}, {"task": "t4"}],
            "C": [{"task": "t1"}, {"task": "t3"}],
        }
        common = find_common_tasks(models)
        self.assertEqual(set(common), {"t1", "t3"})

    def test_no_common(self):
        models = {
            "A": [{"task": "t1"}],
            "B": [{"task": "t2"}],
        }
        common = find_common_tasks(models)
        self.assertEqual(common, [])

    def test_empty(self):
        self.assertEqual(find_common_tasks({}), [])


class TestExtractResponse(unittest.TestCase):
    """响应文本提取"""

    def test_str_response(self):
        rec = {"task": "test", "response": "直接字符串"}
        self.assertEqual(extract_response_text(rec), "直接字符串")

    def test_messages_format(self):
        rec = {
            "task": "test",
            "response": {
                "messages": [
                    {"role": "assistant", "content": "第一步分析"},
                    {"role": "assistant", "content": "第二步结论"},
                ]
            }
        }
        text = extract_response_text(rec)
        self.assertIn("第一步分析", text)
        self.assertIn("第二步结论", text)
        self.assertIn("对话分隔", text)

    def test_content_list_format(self):
        rec = {
            "task": "test",
            "response": {
                "messages": [
                    {"role": "assistant", "content": [
                        {"type": "text", "text": "  片段1  "},
                        {"type": "text", "text": "片段2"},
                    ]}
                ]
            }
        }
        text = extract_response_text(rec)
        self.assertIn("片段1", text)
        self.assertIn("片段2", text)

    def test_empty_record(self):
        self.assertEqual(extract_response_text(None), "[无记录]")


class TestTruncateText(unittest.TestCase):
    """文本截断"""

    def test_short_text(self):
        t = "短文本"
        self.assertEqual(truncate_text(t, 100), "短文本")

    def test_long_text(self):
        t = "A" * 3000
        result = truncate_text(t, 2000)
        self.assertLess(len(result), 2500)
        self.assertIn("截断", result)

    def test_none_text(self):
        self.assertEqual(truncate_text(None), "[无记录]")


class TestGenericCSV(unittest.TestCase):
    """格式B: 通用CSV"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def test_basic_csv(self):
        path = os.path.join(self.tmpdir, "test.csv")
        with open(path, 'w', encoding='utf-8-sig') as f:
            f.write("task,ModelA,ModelB\n")
            f.write("分析差异基因,8,6\n")
            f.write("GO富集分析,7,9\n")

        tasks, models = parse_generic_csv(path)
        self.assertEqual(tasks, ["分析差异基因", "GO富集分析"])
        self.assertEqual(models["ModelA"]["分析差异基因"], "8")
        self.assertEqual(models["ModelB"]["GO富集分析"], "9")


class TestGenericJSON(unittest.TestCase):
    """格式B: 通用JSON"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def test_basic_json(self):
        path = os.path.join(self.tmpdir, "test.json")
        data = [
            {"task": "Q1", "GPT4": "8", "Claude": "7"},
            {"task": "Q2", "GPT4": "9", "Claude": "8"},
        ]
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f)

        tasks, models = parse_generic_json(path)
        self.assertEqual(len(tasks), 2)
        self.assertIn("GPT4", models)
        self.assertIn("Claude", models)


class TestNormalizeRecords(unittest.TestCase):
    """标准化转换"""

    def test_list_format(self):
        models = {
            "M1": [{"task": "T1", "response": "res1"}],
            "M2": [{"task": "T1", "response": "res2"}],
        }
        result = normalize_records_for_evaluation(models)
        self.assertIn("T1", result)
        self.assertIn("M1", result["T1"])
        self.assertIn("M2", result["T1"])


if __name__ == '__main__':
    unittest.main(verbosity=2)
