# TransAgent 模式详解

## 1. 什么是 TransAgent

**TransAgent** 是专为转录调控（Transcription Regulation）领域任务分析设计的增强模式，集成了完整的生物信息学分析工作流程。

### 核心定位
```
TransAgent = BaseAgent + CLI命令行工具 + 转录调控领域工作流
```

### 配置位置
```
src/backend/configs/config_transagent.json
```

### 与 BaseAgent 的核心区别

| 特性 | BaseAgent | TransAgent |
|------|-----------|------------|
| CLI 命令执行 | ❌ 禁用 | ✅ 启用 |
| 浏览器客户端 | ❌ 禁用 | ✅ 启用 |
| 网页爬取 | ❌ 禁用 | ✅ 启用 |
| MCP 服务器 | 可配置 | TRAPT/ARACNe 等生信工具 |
| 领域专业工作流 | ❌ 无 | ✅ 完整的转录调控分析流程 |

---

## 2. CLI Prompt 工具集

TransAgent 集成了丰富的生物信息学命令行工具。

### 2.1 序列数据处理工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `fastqc` | 测序数据质量控制 | FASTQ 文件 | QC 报告 |
| `trim_galore` | 接头 trimming | FASTQ 文件 | 清洗后的 FASTQ |
| `bowtie2` | 序列比对 | FASTQ, 基因组索引 | BAM 文件 |
| `picard` | PCR 重复标记与去除 | BAM | 去重 BAM |
| `samtools` | BAM 索引构建 | BAM | BAI 索引 |
| `macs2` | Peak calling | BAM | NARROWPEAK 文件 |

### 2.2 区域分析工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `bedtools` | 基因组区域操作 | BED 文件 | 交集、并集等 |
| `getfasta` | FASTA 序列提取 | BED, 基因组 | 序列文件 |
| `bed_preprocessing` | BED 去重排序合并 | BED | 处理后 BED |
| `bed2gff` | BED 转 GFF | BED | GFF |

### 2.3 转录因子分析工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `FIMO` | Motif 扫描 | Motif 文件, 序列 | 结合位点预测 |
| `homer` | Motif 发现与富集 | BED | Motif 分析结果 |
| `chipseeker` | 基因组区域注释 | BED | 注释统计 |

### 2.4 调控网络分析工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `TRAPT` | 转录调控因子鉴定 | 基因列表 | 关键转录因子 |
| `BETA` | 靶基因预测 | BED | 靶基因列表 |
| `ABC` | 增强子-靶基因关联 | TF 名称 | 增强子调控关系 |
| `ARACNe` | TF-靶基因网络推断 | TF, 表达矩阵 | 网络文件 |
| `GENIE3` | 共表达网络预测 | TF, 表达矩阵 | 网络文件 |

### 2.5 超级增强子分析工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `ROSE` | 超级增强子鉴定 | NARROWPEAK, BAM | SuperEnhancer 表格 |
| `CRCmapper` | 转录调控回路分析 | SuperEnhancer 表 | 调控回路 |

### 2.6 可视化工具

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `deeptools` | 热图/Profile 图 | BED, BigWig | PDF |
| `ggplot2` | R 语言可视化 | R 代码 | 图片 |
| `bamCoverage` | BAM 转 BigWig | BAM | BigWig |

### 2.7 差异表达与富集分析

| 工具 | 功能 | 输入 | 输出 |
|------|------|------|------|
| `diff_expression_analysis` | 差异表达分析 | 表达矩阵, 样本信息 | 差异基因表, MA 图 |
| `enrichment_analysis` | 富集分析 | 基因列表 | 富集结果 |
| `pathway_analysis` | 通路分析 | 基因列表 | 通路分析结果 |

---

## 3. 完整工作流程

### 3.1 序列数据处理流程

```
输入: FASTQ 文件
  ↓
1. fastqc 质量控制
  ↓
2. trim_galore 接头去除
  ↓
3. fastqc 再次质控
  ↓
4. bowtie2 序列比对
  ↓
5. picard 去重复
  ↓
6. samtools 构建索引
  ↓
7. macs2 Peak calling
  ↓
输出: peaks.narrowPeak
```

### 3.2 转录调控因子鉴定流程

```
输入: 基因列表 (genes.txt)
  ↓
1. TRAPT 鉴定核心转录因子
  ↓
2. 获取转录因子表达数据
  ↓
3. 获取结合区域文件
  ↓
4. 区域注释分析
  ↓
5. 区域可视化
  ↓
输出: 转录调控网络
```

### 3.3 超级增强子分析流程

```
输入: 实验组 + 对照组 FASTQ
  ↓
1. 序列数据处理 (双方)
  ↓
2. ROSE 超级增强子鉴定
  ↓
3. deeptools 可视化
  ↓
4. CRCmapper 调控回路分析
  ↓
5. 区域注释分析
  ↓
6. 区域可视化
  ↓
输出: 超级增强子 + 调控回路
```

### 3.4 RNA-seq 差异表达流程

```
输入: 表达矩阵 + 样本元数据
  ↓
1. diff_expression_analysis 差异分析
  ↓
2. pathway_analysis 通路分析
  ↓
3. enrichment_analysis 富集分析
  ↓
4. ggplot2 可视化
  ↓
输出: 差异基因 + 通路富集结果
```

---

## 4. 适用场景

### ✅ 适合的场景

| 场景 | 描述 |
|------|------|
| ChIP-seq 分析 | 转录因子结合位点鉴定 |
| ATAC-seq 分析 | 染色质开放区域分析 + TF footprint |
| RNA-seq 分析 | 差异表达 + 富集分析 |
| 超级增强子研究 | 超级增强子鉴定 + 调控回路 |
| 转录调控网络 | TF-靶基因网络构建 |
| 区域注释 | BED 文件功能注释 |
| 多组学整合 | 联合分析多种数据类型 |

### ❌ 不适合的场景

- 纯软件开发任务（建议使用 BaseAgent）
- 非生物信息学领域的通用任务

---

## 5. 使用示例

### 示例 1：转录因子 ChIP-seq 分析

```
用户: 我有一组 H3K27ac ChIP-seq 数据，帮我分析转录因子富集

TransAgent:
正在执行序列数据处理流程...

1. [fastqc] 质量控制完成
   - Q30 > 95%
   
2. [trim_galore] 接头去除完成
   - 去除比例: 3.2%

3. [bowtie2] 序列比对完成
   - 比对率: 92.5%

4. [macs2] Peak calling 完成
   - 获得 15,000 个 peaks

5. [homer] Motif 富集分析
   - Top Motif: CTCF, p65, REST
   
输出: peak 分析报告已完成
```

### 示例 2：转录调控因子鉴定

```
用户: 帮我鉴定这批基因的转录调控因子: TP53, BRCA1, ESR1

TransAgent:
[TRAPT] 开始鉴定转录调控因子...

关键转录因子列表:
1. TP63 (调控 score: 0.95)
2. ETS1 (调控 score: 0.89)
3. RELA (调控 score: 0.87)
...

是否继续进行靶基因预测和富集分析？
```

### 示例 3：RNA-seq 差异表达

```
用户: 对比肿瘤样本和正常样本的差异表达基因

TransAgent:
请提供:
1. 表达矩阵文件 (genes x samples)
2. 样本分组信息 (包含 ID 和 Group 列)

用户: [上传文件]

[diff_expression_analysis] 开始分析...

差异表达结果:
- 上调基因: 1,234 个
- 下调基因: 856 个
- 显著基因 (p<0.01): 2,090 个

[enrichment_analysis] 通路富集...
- PI3K-Akt signaling (FDR: 1.2e-8)
- p53 signaling (FDR: 3.4e-6)
```

---

## 6. 数据完整性约束

TransAgent 严格遵守数据完整性原则：

```
⚠️ 禁止生成模拟数据
   - 永远不要生成 placeholder, mock, dummy 数据
   - 永远不要硬编码生物学实体

⚠️ 必须使用真实数据
   - 脚本必须通过官方 API 或本地磁盘获取真实数据
   - 如果数据缺失，必须报告错误

⚠️ Fail Fast 原则
   - 如果数据缺失或损坏，必须立即抛出异常
   - 禁止生成伪造结果来掩盖问题
```

---

## 7. 工具使用注意事项

### 环境检查
```bash
# 使用前检查工具是否可用
which tool-name

# 例如检查 fastqc
which fastqc
# 输出: /usr/local/bin/fastqc
```

### 工具限制
```
1. 输入文件必须是单个文件，不支持通配符
2. 部分工具输出文件但不返回消息，请检查输出目录
3. 工具间有强依赖关系，错误步骤不能跳过
4. 如果多次重试失败，必须请求用户协助
```

### 基因组版本
```
hg38: /data/rgtdata/hg38/genome_hg38.fa
hg19: /data/rgtdata/hg19/genome_hg19.fa
```

---

## 8. 快速开始

### 步骤 1：选择模式
在设置中选择 **Agent Mode: TransAgent**

### 步骤 2：配置 MCP 服务器（可选）
```json
{
  "mcp_server": {
    "trapt": {
      "command": "trapt",
      "args": ["--library", "/data/trapt/library"]
    }
  }
}
```

### 步骤 3：开始分析
```
输入: "帮我分析这组基因的转录调控网络: MYC, CCND1, CDK4"
```

---

## 9. 下一步

- 了解 MultiAgent 多智能体协作？查看 `05_MULTAGENT.md`
- 了解运行模式（自动/行动/计划/闪速）？查看 `06_RUNNING_MODES.md`
