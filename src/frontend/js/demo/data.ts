// @ts-nocheck
// 内置示例会话数据 - 生物信息学转录调控分析场景

export interface DemoMessage {
  role: 'user' | 'system' | 'tool';
  icon?: string;
  content: string;
  delay?: number;          // 单条覆盖默认间隔（ms）
  info?: string;          // tool 角色附加的工具调用信息
  reasoning?: string;     // system 角色的思考过程（演示时不显示）
}

export interface DemoScript {
  title: string;
  scenario: string;
  totalDurationHint: string;
  messages: DemoMessage[];
}

export const BUILT_IN_SCRIPT: DemoScript = {
  title: 'TransMAgent · 演示模式',
  scenario: '单细胞转录组细胞类型注释 · 8 条消息 · 默认间隔 2s',
  totalDurationHint: '约 16 秒',
  messages: [
    {
      role: 'user',
      content:
        '我有一个 **10x Genomics** 单细胞 RNA-seq 数据集（PBMC，~3000 个细胞）。请帮我做下游分析，重点识别 T 细胞亚群。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '好的！我将使用 **scanpy** 框架进行标准分析。整体流程如下：\n\n```mermaid\nflowchart TD\n  A[原始数据 .h5ad] --> B[质控 QC]\n  B --> C[归一化与对数化]\n  C --> D[高变基因 HVG]\n  D --> E[PCA 降维]\n  E --> F[构建邻接图]\n  F --> G[UMAP 可视化]\n  G --> H[Leiden 聚类]\n  H --> I[细胞类型注释]\n```\n\n让我先扫描一下可用的工具。'
    },
    {
      role: 'tool',
      icon: 'tool',
      info:
        '```python\n# 扫描 MCP 工具列表\ntools = mcp.scanpy.list_tools()\n# 返回: scanpy.pp, scanpy.tl, scanpy.pl (共 42 个)\n```',
      content:
        '已加载 **42 个** scanpy 相关工具。下一步我将执行完整分析管线。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '### 第一步：质量控制\n\n| 指标 | 过滤前 | 过滤后 |\n|------|--------|--------|\n| 细胞数 | 3,247 | 2,891 |\n| 基因中位数 | 1,847 | 1,623 |\n| 线粒体基因 % | 8.4% | 2.1% |\n\n> 通过 `nFeature_RNA > 200`、`nFeature_RNA < 5000`、`percent.mt < 10` 三重过滤，移除了 **356 个** 低质量细胞。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '### 第二步：聚类与可视化\n\n完成 Leiden 聚类后共识别出 **7 个** 主要细胞群。结合差异表达基因进行自动注释，结果如下：\n\n- **CD3D+, CD3E+, TRAC+** → T 细胞（占总细胞 42.3%）\n- **CD14+, LYZ+** → 单核细胞（18.7%）\n- **MS4A1+, CD79A+** → B 细胞（15.2%）\n- **NKG7+, GNLY+** → NK 细胞（9.1%）\n- **FCGR3A+, MS4A7+** → CD16+ 单核（6.4%）\n- **PPBP+, PF4+** → 血小板（4.8%）\n- **IL3RA+, LILRA4+** → 树突状细胞（3.5%）'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '### 第三步：T 细胞亚群细分\n\n对 T 细胞群进行亚聚类，得到 **4 个** 亚群。关键差异表达基因：\n\n- **CD4+ T**：`IL7R`, `CCR7`, `TCF7`\n- **CD8+ T (naive)**：`CD8A`, `CD8B`, `CCR7`\n- **CD8+ T (effector)**：`GZMB`, `PRF1`, `NKG7`\n- **Treg**：`FOXP3`, `IL2RA`, `CTLA4`\n\n差异表达统计显著性采用 Wilcoxon 秩和检验，调整后 p 值阈值为 $p_{adj} < 0.05$。'
    },
    {
      role: 'user',
      content:
        '太棒了！能给我展示一下 **CD8+ T 细胞**的差异表达基因热图吗？\n\n公式参考：\n\n$$\n\\mathrm{score}_i = \\frac{1}{|G|}\\sum_{g \\in G} \\log_2\\left(\\frac{x_{i,g} + 1}{\\bar{x}_{g} + 1}\\right)\n$$\n\n其中 $G$ 为标记基因集合。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '```python\nimport scanpy as sc\n\n# 选取 CD8+ T 细胞亚群\ncd8 = adata[adata.obs["cell_type"].isin([\n    "CD8+ T (naive)", "CD8+ T (effector)"\n])]\n\n# 找差异基因\nsc.tl.rank_genes_groups(cd8, groupby="cell_type", method="wilcoxon")\n\n# 绘制热图\nsc.pl.rank_genes_groups_heatmap(\n    cd8, n_genes=10, show_gene_labels=True,\n    figsize=(8, 6), save="_cd8_heatmap.pdf"\n)\n```\n\n热图已生成至 `./figures/cd8_heatmap.pdf`。可以看到 effector 群体显著上调 **GZMB、PRF1、GZMA、NKG7** 等细胞毒性基因，naive 群体则高表达 **CCR7、SELL、TCF7** 等归巢相关基因——这与免疫学预期一致。\n\n> 📊 分析报告与全部图表已保存至工作区，可通过「Environment Variables」面板查看路径。'
    }
  ]
};

// 备用脚本：转录因子调控网络
export const TF_NETWORK_SCRIPT: DemoScript = {
  title: 'TransMAgent · 演示模式 · 转录因子调控',
  scenario: 'TF 调控网络推断 · 6 条消息',
  totalDurationHint: '约 12 秒',
  messages: [
    {
      role: 'user',
      content: '请帮我从这份 ATAC-seq 数据推断 **关键转录因子 (TF)** 及其靶基因网络。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '我将采用 **pycistopic** + **GRNBoost2** 的组合方案：\n\n```python\nfrom pycistarget.utils import calculate_pseudobulk\n# 1. 伪批量 ATAC\n# 2. cisTopic 主题建模\n# 3. 主题-基序关联\n# 4. GRNBoost2 构建调控网络\n```'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '### 候选 TF 排名（前 5）\n\n| 排名 | TF | NES | 靶基因数 | 调控方向 |\n|------|-----|------|---------|---------|\n| 1 | **MYC** | 5.82 | 1,247 | 激活 |\n| 2 | **STAT1** | 4.96 | 892 | 激活 |\n| 3 | **E2F1** | 4.31 | 763 | 激活 |\n| 4 | **NFKB1** | 3.78 | 1,103 | 激活/抑制 |\n| 5 | **FOXP3** | 3.21 | 412 | 抑制 |'
    },
    {
      role: 'tool',
      icon: 'tool',
      info:
        'GRNBoost2 已完成基于 50,000 个 ATAC peaks 的调控推断，运行耗时 18.4s。',
      content: '调控网络推断完成，节点数 2,341，边数 8,927。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '### 可视化\n\n```mermaid\ngraph LR\n  MYC --> CCNA2\n  MYC --> CDK4\n  MYC --> CCND1\n  STAT1 --> IFIT1\n  STAT1 --> OAS1\n  NFKB1 --> TNFAIP3\n  NFKB1 --> BCL2L1\n```\n\n关键反馈回路 **MYC → CCND1 → CDK4** 提示细胞周期 G1/S 转换活跃。'
    },
    {
      role: 'system',
      icon: 'agent',
      content:
        '分析完成。已识别 **MYC/STAT1/NFKB1** 为该数据集的核心调控节点，建议下游进行 ChIP-seq 验证。\n\n> 📁 结果文件：`output/grn_network.html`（交互式网络图）'
    }
  ]
};