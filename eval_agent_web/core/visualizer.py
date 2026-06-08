#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
可视化模块 - 基于评估结果生成 Nature Methods 风格图表。
  图表1: 模型性能对比柱状图 (PDF)
  图表2: 模型维度对比热力图 (PDF)
  图表3: 模型雷达对比图 (PDF)
"""

import os
import re
import json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Patch
import matplotlib.font_manager as fm

METRICS = [
    "Data Authenticity", "Response Relevance", "Tool Use Accuracy", "Hallucination Control",
    "Code Execution", "Domain Knowledge", "Result Interpretation", "Autonomous Planning",
    "Error Recovery", "Output Standardization"
]

METRICS_EN = [
    "Data\nAuthenticity", "Task\nRelevance", "Tool\nUsage",
    "Hallucination\nControl", "Code\nExecution", "Domain\nKnowledge",
    "Result\nInterpretation", "Autonomous\nPlanning",
    "Error\nRecovery", "Output\nStandardization"
]

METRICS_EN_HEATMAP = [
    "Data Authenticity", "Task Relevance", "Tool Usage",
    "Hallucination Control", "Code Execution", "Domain Knowledge",
    "Result Interpretation", "Autonomous Planning",
    "Error Recovery", "Output Standardization"
]


def _init_font():
    """初始化中文字体。"""
    font_paths = [
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            prop = fm.FontProperties(fname=fp)
            plt.rcParams['font.family'] = prop.get_name()
            return
    plt.rcParams['font.family'] = 'DejaVu Sans'


class Visualizer:
    """图表生成器。"""
    
    def __init__(self, output_dir):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        _init_font()
        plt.rcParams['axes.unicode_minus'] = False
        plt.rcParams['figure.dpi'] = 150
    
    def load_stats(self, stats_file="评估统计.json"):
        """加载评估统计 JSON。"""
        path = os.path.join(self.output_dir, stats_file)
        if not os.path.exists(path):
            raise FileNotFoundError(f"统计文件不存在: {path}")
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def generate_all(self, stats=None):
        """生成全部三张图表。返回 {chart_name: filepath}。"""
        if stats is None:
            stats = self.load_stats()
        
        results = {}
        
        bar_path = self._plot_bar_chart(stats)
        if bar_path:
            results["bar_chart"] = bar_path
        
        heatmap_path = self._plot_heatmap(stats)
        if heatmap_path:
            results["heatmap"] = heatmap_path
        
        radar_path = self._plot_radar(stats)
        if radar_path:
            results["radar"] = radar_path
        
        return results
    
    # ── 图表1: 柱状图 ──────────────────────────────────────────
    
    def _plot_bar_chart(self, stats):
        """模型总体性能柱状图（均值 ± 标准差）。"""
        model_names = stats["models"]
        totals = stats["totals"]
        
        # 计算标准差需要原始分数，这里从 metrics 推算近似值
        sorted_models = sorted(model_names, key=lambda m: -totals[m])
        
        # 按总分排序
        means = [totals[m] for m in sorted_models]
        
        # 估算标准差（从 metrics 方差推算）
        stds = []
        for m in sorted_models:
            vals = list(stats["metrics"][m].values())
            if vals:
                # 按问题数归一化
                n = stats["total_questions"]
                total_std = np.std(vals) * np.sqrt(len(vals)) if n > 0 else 0
                stds.append(total_std if total_std < max(means) * 0.3 else max(means) * 0.1)
            else:
                stds.append(0)
        
        n_models = len(sorted_models)
        if n_models == 0:
            return None
        
        cmap = plt.cm.get_cmap('Blues')
        colors = [cmap(0.4 + 0.5 * i / max(n_models - 1, 1)) for i in range(n_models)]
        
        y_max = max(means) + max(stds) + 5
        fig, ax = plt.subplots(figsize=(108.4 / 25.4, 58 / 25.4))
        fig.patch.set_alpha(0)
        ax.patch.set_alpha(0)
        
        x = np.arange(len(sorted_models))
        bars = ax.bar(
            x, means, yerr=stds,
            capsize=5, color=colors, edgecolor='none',
            alpha=0.85, width=0.55,
            error_kw={'elinewidth': 0.808, 'capthick': 0.808, 'ecolor': 'black'}
        )
        
        for i, (bar, mean) in enumerate(zip(bars, means)):
            ax.text(
                bar.get_x() + bar.get_width() / 2.,
                bar.get_height() + stds[i] + 0.12,
                f'{mean:.1f}',
                ha='center', va='bottom',
                fontsize=5.5, fontweight='normal', color='#333333'
            )
        
        ax.set_ylabel('Overall Score (0-100)', fontsize=10, fontweight='bold', labelpad=4)
        ax.set_xticks(x)
        ax.set_xticklabels(sorted_models, fontsize=10, fontweight='normal', rotation=15, ha='right')
        ax.set_ylim(0, y_max)
        ax.tick_params(axis='y', labelsize=10, width=0.340)
        ax.tick_params(axis='x', width=0.340)
        ax.yaxis.grid(True, linestyle='--', alpha=0.6, color='gray', linewidth=0.231)
        ax.set_axisbelow(True)
        
        for spine in ax.spines.values():
            spine.set_linewidth(0.340)
        
        plt.tight_layout(pad=0.5)
        out = os.path.join(self.output_dir, "bar_chart.pdf")
        plt.savefig(out, dpi=300, bbox_inches='tight', transparent=True, format='pdf')
        plt.close()
        return out
    
    # ── 图表2: 热力图 ──────────────────────────────────────────
    
    def _plot_heatmap(self, stats):
        """模型 × 维度热力图。"""
        model_names = stats["models"]
        sorted_models = sorted(model_names, key=lambda m: -stats["totals"][m])
        
        heatmap_data = []
        for m in sorted_models:
            row = [stats["metrics"][m].get(metric, 0) for metric in METRICS]
            heatmap_data.append(row)
        heatmap_data = np.array(heatmap_data)
        
        n_rows, n_cols = heatmap_data.shape
        if n_rows == 0:
            return None
        
        colors_py = ['#440154', '#482878', '#3E4A89', '#31688E', '#26838F',
                     '#1F9E89', '#35B779', '#6DCD59', '#B4DE2C', '#FDE725']
        cmap_py = LinearSegmentedColormap.from_list('purple_yellow', colors_py, N=256)
        
        width_inch = 167.236 / 25.4
        height_inch = max(80, n_rows * 25) / 25.4
        fig, ax = plt.subplots(figsize=(width_inch, height_inch))
        fig.patch.set_facecolor('white')
        ax.set_facecolor('white')
        
        im = ax.imshow(heatmap_data, cmap=cmap_py, aspect='auto', vmin=0, vmax=10)
        
        for i in range(n_rows):
            for j in range(n_cols):
                value = heatmap_data[i, j]
                text_color = 'white' if value < 5.5 else 'black'
                ax.text(j, i, f'{value:.1f}',
                        ha='center', va='center',
                        fontsize=11.1, fontweight='bold', color=text_color)
        
        ax.set_xticks(np.arange(n_cols))
        ax.set_yticks(np.arange(n_rows))
        ax.set_xticklabels(METRICS_EN_HEATMAP, fontsize=11.1, fontweight='bold',
                           rotation=30, ha='right')
        ax.set_yticklabels(sorted_models, fontsize=11.1, fontweight='bold')
        
        ax.set_xticks(np.arange(n_cols) - 0.5, minor=True)
        ax.set_yticks(np.arange(n_rows) - 0.5, minor=True)
        ax.grid(which='minor', color='white', linestyle='-', linewidth=2)
        ax.tick_params(which='minor', bottom=False, left=False)
        
        ax.xaxis.tick_bottom()
        ax.xaxis.set_label_position('bottom')
        ax.set_title('Performance Evaluation by Metric Dimension',
                     fontsize=11.1, fontweight='bold', pad=20)
        
        from mpl_toolkits.axes_grid1 import make_axes_locatable
        divider = make_axes_locatable(ax)
        cax = divider.append_axes("right", size="5%", pad=0.5)
        cbar = fig.colorbar(im, cax=cax, orientation='vertical')
        cbar.set_label('Score', fontsize=11.1, fontweight='bold')
        cbar.ax.tick_params(labelsize=11.1)
        
        plt.tight_layout()
        out = os.path.join(self.output_dir, "heatmap.pdf")
        plt.savefig(out, dpi=300, bbox_inches='tight', facecolor='white', format='pdf')
        plt.close()
        return out
    
    # ── 图表3: 雷达图 ──────────────────────────────────────────
    
    def _plot_radar(self, stats):
        """多模型雷达对比图。"""
        model_names = stats["models"]
        sorted_models = sorted(model_names, key=lambda m: -stats["totals"][m])
        
        n_metrics = len(METRICS)
        if n_metrics < 3:
            return None
        
        angles = np.linspace(0, 2 * np.pi, n_metrics, endpoint=False).tolist()
        angles += angles[:1]
        
        fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(polar=True))
        cmap = plt.cm.get_cmap('tab10')
        
        for idx, m in enumerate(sorted_models):
            values = [stats["metrics"][m].get(metric, 0) for metric in METRICS]
            values += values[:1]
            ax.plot(angles, values, 'o-', linewidth=2, label=m, color=cmap(idx % 10))
            ax.fill(angles, values, alpha=0.15, color=cmap(idx % 10))
        
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(METRICS_EN, fontsize=10)
        ax.set_ylim(0, 10)
        ax.set_title('Model Comparison Radar Chart', fontsize=14, fontweight='bold', pad=20)
        ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.0))
        plt.tight_layout()
        
        out = os.path.join(self.output_dir, "radar.pdf")
        plt.savefig(out, dpi=300, bbox_inches='tight', facecolor='white', format='pdf')
        plt.close()
        return out
