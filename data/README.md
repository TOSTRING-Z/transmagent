# Construction of a Multidimensional Hierarchical Benchmark Dataset

## Overview

To rigorously and comprehensively evaluate an agent's capabilities in task planning, tool orchestration, and long-context processing within transcriptional regulation analysis workflows, we constructed a **multidimensional hierarchical benchmark dataset** comprising **366 independent test cases**. The design of this dataset accounts for both the diversity of real-world interactions and the complexity of biological logic, and is composed of four hierarchical evaluation modules.

## Dataset at a Glance

| Tier | Name | Count | Core Evaluation Dimension |
|------|------|-------|---------------------------|
| T1 | Multi-complexity Synthetic Task Cohort | 50 | Task planning & tool orchestration |
| T2 | Single-step Subtask Cohort | 166 | Fine-grained atomic operation precision |
| T3 | Complex Biological Reasoning Task Cohort | 50 | High-order logical reasoning & autonomous decision-making |
| T4 | Strictly Tool-Dependent Binary Reasoning Task Cohort | 100 | Multi-step tool-chain invocation & data integration |

**Total: 366 test cases**

---

## T1: Multi-complexity Synthetic Task Cohort

**Data files**: [`T1-0.json`](./T1-0.json), [`T1-1.json`](./T1-1.json)  
**Sample size**: n = 50

### Design Objective
To comprehensively evaluate the system's stability and generalization capability when facing complex, heterogeneous real-world demands, we constructed a multi-complexity synthetic task cohort containing 50 tasks spanning varying difficulty gradients.

### Construction Methodology
The core of this task cohort's generation is an LLM-based **automated data synthesis method**. To ensure that the synthesized tasks conform to both biological logic and computational executability, we incorporated stringent domain knowledge constraints during the data generation process.

#### Dual Core Prior Injection
The system introduces two categories of core priors when conceptualizing tasks:

1. **Transcriptional Regulation Knowledge Base**: A pre-built domain knowledge system
2. **Tool Function Definition Dictionary**: Comprehensive functional definitions of **29 commonly used bioinformatics tools**, including `bedtools`, `macs2`, `deeptools`, `homer`, `rose`, `beta`, `trapt`, `fimo`, `meme`, `bowtie2`, `samtools`, `picard`, `bamCoverage`, `computeMatrix`, `plotHeatmap`, `plotProfile`, `chipseeker`, `clustProfiler`, `enrichGO`, `enrichKEGG`, `gseGO`, `gseKEGG`, `findMotifsGenome`, `annotatePeaks`, `getDiffExpression`, `aracne`, `viper`, `bedtools intersect`, and `bedtools closest`, matched with authentic local file paths

#### Bottom-Up Task Construction Logic
When constructing individual tasks, the automated script employs a **random sampling mechanism** to select one or more tool combinations from the tool dictionary, simultaneously and randomly matching corresponding datasets (e.g., specific gene lists or sequencing files). The LLM then uses this combination as a framework to **reverse-derive** and generate natural language task descriptions that align with the analysis logic.

#### User Persona Simulation
To make the generated tasks more closely resemble real-world research scenarios, the system uses parameterized prompt engineering to simulate the linguistic habits and thinking patterns of users from diverse professional backgrounds:

- Bioinformatics researchers
- Clinicians
- Students
- Other research roles

#### Illustrative Generation Example
When the script randomly selects the tool combination of `DESeq2` (differential expression analysis) and `TRAPT` (transcription factor enrichment analysis), associated with a breast cancer dataset, the LLM transforms this into a typical academic user request:

> *"Given the local file path /data/example/geneset/BRCA.csv, please analyze the transcriptional regulatory mechanisms underlying this BRCA breast cancer differentially expressed gene list and identify potential upstream key transcription factors."*

In this manner, the data generation process naturally translates rigid command-line tool invocations into high-fidelity user queries.

### Data Format
Ultimately, this method strictly pairs the generated natural language task prompts with the expected standard analysis steps, all standardized into structured **JSON format** output.

```json
[
  {
    "task": "Natural language task description"
  }
]
```

### Examples

| Type | Task Example |
|------|-------------|
| Simple query | `Use the BRCA differentially expressed genes from /data/example/geneset/BRCA.csv to perform pathway enrichment analysis` |
| Multi-step workflow | `I want to analyze differential gene expression in BRCA cancer samples from TCGA database and perform pathway enrichment analysis on the significant genes` |
| Path + Directive | `/data/trapt/TR_bed/ADNP@Sample_01_0380.bed [Analyze target genes and functional annotation of the ADNP transcription factor]` |

---

## T2: Single-step Subtask Cohort

**Data file**: [`T2.json`](./T2.json)  
**Sample size**: n = 166

### Design Objective
To quantitatively evaluate an agent's precision on **fine-grained atomic operations**, we constructed a single-step subtask cohort comprising 166 independent single-step tasks.

### Construction Methodology
The data for this task cohort is primarily sourced from the system's **authentic historical execution logs** during multi-step analyses. Through deep parsing of these continuous operation records, we systematically stripped away redundant information belonging to macro-level planning or multi-turn dialogues, thereby precisely extracting the core single-step actions within the execution workflow.

#### Four Fundamental Operation Categories
The extracted core actions are classified into four fundamental categories:

| Category | Description |
|----------|-------------|
| **Data Acquisition** | Reading raw data from databases or file systems |
| **Data Preprocessing** | Format conversion, quality control, filtering and cleaning |
| **Analysis & Computation** | Core bioinformatics algorithm execution |
| **Result Output** | Generating reports, visualizations, and result files |

#### Bottom-Up Single-Step Extraction Logic
When extracting individual tasks, the system captures the **input and output states of a specific step** from a multi-step actual analysis log. To make these atomic tasks align with authentic daily bioinformatics analysis scenarios, we transform abstract log records into concrete biological function requirements.

#### Illustrative Extraction Example
When the system parses a historical log containing a complex transcription factor analysis, it accurately captures the single-step action of using a specific tool to segment genomic regions, and transforms it into a concrete, independently meaningful academic user request:

> *"Given the available data at /data/esr1_promoter_regions.bed, please extract the DNA sequences of the estrogen receptor 1 (ESR1) promoter region from the reference genome."*

In this manner, log records originally interwoven within multi-step workflows are naturally translated into clear, standalone single-step tasks.

#### Data Cleaning and Verification
To ensure the rigor of the evaluation baseline and the purity of the data, we introduced stringent validation and cleaning mechanisms during the generation process:

- Automatic verification of file extension and storage path legality
- Removal of all invalid records caused by execution interruptions or configuration errors
- Manual verification to filter out ambiguous data

### Standard Triplet Structure
Each confirmed qualified subtask is strictly standardized into a triplet structure composed of the following three components, uniformly output in structured JSON format:

| Component | Description |
|-----------|-------------|
| **Requirement Description** | Specific operation instruction |
| **Input Data Path** | Data files on which the operation depends |
| **Result Summary** | Expected output and verification criteria |

```json
[
  {
    "id": 1,
    "category": "Disease/biological category",
    "task": "Subtask description: specific operation instruction\nAvailable data: data paths",
    "difficulty": "Difficulty level"
  }
]
```

### Examples

| ID | Category | Task |
|----|----------|------|
| 5 | Type 2 Diabetes | Perform precise overlap analysis of variants with transcription factor binding sites. Available data: `/tmp/footprint_eqtl_simplified.bed`, `/tmp/islet_tf_footprints.bed` |
| 16 | ER+ Breast Cancer | Extract promoter region coordinates of ESR1 target genes. Available data: `/data/esr1_target_genes.bed` |
| 4 | (Category II) | Process paired-end ChIP-seq data from `/data/example/ChIP-seq/sample1_R1.fastq` and `/data/example/ChIP-seq/sample1_R2.fastq` with control data for peak calling and quality assessment |

---

## T3: Complex Biological Reasoning Task Cohort

**Data file**: [`T3.json`](./T3.json)  
**Sample size**: n = 50

### Design Objective
To examine the multi-agent system's high-order logical reasoning and autonomous decision-making capabilities in the **absence of explicit instructions**, we engaged human experts to meticulously curate and construct a complex biological reasoning task cohort containing 50 high-complexity integrative biological use cases.

### Construction Methodology

#### "Information Redaction" Strategy
During the construction of this task cohort, we implemented a strict **information redaction strategy**:

- **Deliberately redacted**: All specific software names, function parameters, and algorithmic hints
- **Exclusively retained**: Pure biological background assumptions and final research objectives

#### Design Rationale
This testing paradigm requires the evaluated system to possess deep domain knowledge, enabling it to autonomously transform abstract macro-level biological intents into concrete, executable bioinformatics workflows.

#### Bottom-Up Task Design Logic
When designing individual tasks, we constructed scenarios with **multi-step reasoning space** centered on cutting-edge biological scientific hypotheses. To endow these high-order tasks with clear scientific logic, we translated research intents into narratives oriented purely toward biological function investigation.

#### Illustrative Design Example
In an evaluation case targeting immune disease regulatory mechanisms, the task is framed as a specific academic inquiry objective:

> *"Analyze the overlap between super-enhancer regions identified in B cells and known disease-risk single nucleotide polymorphisms (SNPs), to identify pathogenic variants that disrupt autoimmune homeostasis."*

Under this framing, the system cannot directly obtain explicit hints such as using specific software or performing interval intersection operations. Instead, it must autonomously understand the intrinsic biological connections among super-enhancers, non-coding region mutations, and autoimmune diseases, and then independently plan the complete analysis steps from data alignment and positional comparison to functional variant annotation.

#### Manual Verification
To ensure the rigor and challenge of this benchmark, all selected tasks underwent meticulous manual verification:

- Exclusion of all routine tasks solvable through simple keyword matching or a single tool
- Guarantee of input data authenticity and analysis workflow complexity

### Data Format

```json
[
  {
    "id": 1,
    "category": "Disease/biological category",
    "task": "Pure biological objective description (no tool/method hints)",
    "difficulty": "Difficulty level"
  }
]
```

### Examples

| ID | Category | Task (no tool hints) |
|----|----------|---------------------|
| 1 | Breast Cancer | Extract the differentially expressed gene set comparing BRCA tumor versus adjacent normal tissue, identify the core transcriptional regulators driving this malignant phenotype, and output a detail file of the top 10 ranked regulators |
| 7 | Metastatic Melanoma | Obtain a set of unknown transcription factor binding peak data derived from a melanoma metastasis, identify significantly enriched known motifs within it, and infer the most likely transcription factor family (e.g., MITF) |
| 14 | Type 2 Diabetes | Compare continuous signal files from wild-type versus PDX1-knockout mouse islet cells, and plot the binding signal decay trend curves over the diabetes-associated target gene set |

---

## T4: Strictly Tool-Dependent Binary Reasoning Task Cohort

**Data file**: [`T4.json`](./T4.json)  
**Sample size**: n = 100

### Design Objective
To specifically evaluate an agent's core capabilities in **real tool invocation, multi-source data integration, and multi-step analysis orchestration**, we constructed a strictly tool-dependent binary reasoning task cohort containing 100 "Yes/No" binary test cases.

### Core Design Principle: "Anti-reasoning"

The core design principle of this evaluation cohort is to **block the large language model from relying on its built-in memory or general biological common sense to directly infer answers**.

#### Anti-Leakage Measures

| Measure | Implementation |
|---------|---------------|
| **Gene Selection** | Thoroughly eliminate common genes such as TP53 and ESR1; instead employ less-studied transcription factors and rare pathways |
| **Comparison Logic** | Replace easily estimable absolute area calculations with signal density and coverage rate |
| **Attribute Judgment** | Narrow high-cost family-wide attribute judgments precisely to specific pairwise gene comparisons |
| **Data Provenance** | Comprehensively discard well-known co-regulatory relationships and classical tissue expression signatures |

#### Bottom-Up Strong-Dependency Design Logic
When designing individual tasks, we place heavy emphasis on the **strong dependency** on tool computation results, ensuring that correct conclusions cannot be obtained without actually running bioinformatics tools. To endow these purely tool-dependent tasks with clear scientific significance, we wrap the computational logic as concrete biological spatial and abundance comparison requirements.

#### Illustrative Design Example
In an evaluation case targeting chromatin three-dimensional structure and spatial distance, the task is framed as a concrete numerical comparison problem:

> *"Is the median distance from the transcription start sites of zinc finger protein family genes to the nearest super-enhancer smaller than that of HIC2/TRIM66 domain family genes?"*

Under this framing, since the distributions of the genes and regulatory elements being compared fall within obscure genomic intervals, the system is completely unable to perform logical inference through common sense. It must autonomously invoke tools to read genomic coordinate files, precisely calculate the spatial distances from both gene groups to super-enhancers, compute the medians, and finally provide a binary answer through numerical comparison.

#### The 9 Transcriptional Regulation Analysis Primitives Covered

| Category | Subtype | Description |
|----------|---------|-------------|
| T1-Expression Comparison | Cross-tissue expression comparison | Determine whether a transcription factor's expression in tissue A is higher than in tissue B |
| T2-Dual Feature Overlap | Genomic region overlap | Determine whether the cumulative base-pair overlap between two classes of genomic annotation regions and genetic variants is larger or smaller |
| T3-Spatial Distance | Binding site distance | Compute the spatial distance between variants and transcription factor binding centers |
| T4-ChIP-seq Statistics | Peak statistics | ChIP-seq peak statistics and comparison |
| T5-Motif Analysis | Sequence motifs | Motif enrichment and scanning analysis |
| T6-Functional Enrichment | Pathway/GO enrichment | Functional enrichment comparison of gene sets |
| T7-Genomic Annotation | Region annotation | Distributional annotation of genomic regions |
| T8-Signal Intensity | Signal comparison | Quantitative comparison of continuous signals |
| T9-Regulatory Network | Network topology | Regulatory network relationship inference |

### Mandatory Tool-Chain Requirement
The T4 task cohort mandates that the agent must traverse **2 to 5 steps of real tool-chain invocations and data computation** before deriving the final biological conclusion (Yes/No). This design excludes all routine tasks that could be answered through parametric memory alone, providing a high-quality means of accurately evaluating an agent's workflow execution and data processing capabilities when facing complex, real computational demands.

### Data Format

```json
[
  {
    "id": 0,
    "category": "T1-Expression Comparison",
    "task": "Is the expression level of transcription factor ZNF768 in stomach tissue higher than its expression level in kidney tissue?",
    "difficulty": "Basic",
    "answer": "Yes"
  }
]
```

| Field | Description |
|-------|-------------|
| `id` | Test case identifier |
| `category` | Analysis primitive category |
| `task` | Yes/No binary question |
| `difficulty` | Difficulty level (Basic / Medium / Advanced) |
| `answer` | Ground-truth answer (Yes / No) |

### Examples

| ID | Category | Task | Answer |
|----|----------|------|--------|
| 0 | T1-Expression Comparison | Is the expression level of transcription factor ZNF768 in stomach tissue higher than its expression level in kidney tissue? | Yes |
| 12 | T2-Dual Feature Overlap | Within the 100 kb upstream to 100 kb downstream region of the human ZNF132 gene transcription start site (chr7:55019000-55219000), is the cumulative base-pair overlap between enhancer RNA annotation regions and common genetic variants greater than the cumulative base-pair overlap between super-enhancer regions and common genetic variants? | No |
| 19 | T2-Dual Feature Overlap | Within the 100 kb upstream and downstream regions flanking the disease risk genetic variant rs1002456 (near LMX1A), is the cumulative base-pair count of disease risk variants located within transcription factor binding site regions greater than the cumulative base-pair count of disease risk variants located within expression quantitative trait loci regions? | No |

---

## File Inventory

| Filename | Description | Records |
|----------|-------------|---------|
| [`T1-0.json`](./T1-0.json) | T1 Synthetic Task Cohort — mixed Chinese/English original user tasks | 50 |
| [`T1-1.json`](./T1-1.json) | T1 Synthetic Task Cohort — tasks with category annotations | 50 |
| [`T2.json`](./T2.json) | T2 Single-step Subtask Cohort | 166 |
| [`T3.json`](./T3.json) | T3 Complex Biological Reasoning Task Cohort | 50 |
| [`T4.json`](./T4.json) | T4 Strictly Tool-Dependent Binary Reasoning Task Cohort | 100 |
| [`T1-0_en.json`](./T1-0_en.json) | T1-0 English translation | 50 |
| [`T1-1_en.json`](./T1-1_en.json) | T1-1 English translation | 50 |
| [`T2_en.json`](./T2_en.json) | T2 English translation | 166 |
| [`T3_en.json`](./T3_en.json) | T3 English translation | 50 |
| [`T4_en.json`](./T4_en.json) | T4 English translation | 100 |
| [`summary.xlsx`](./summary.xlsx) | Dataset summary statistics | — |
