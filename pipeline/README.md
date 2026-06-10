# Bioinformatics Analysis Pipelines

This directory contains standardized bioinformatics analysis pipeline specifications for **Supplementary Data 7** of the manuscript. Each JSON file records the complete conversation history between the user and the AI agent, documenting the pipeline design process, tool selections, and methodological decisions.

---

## File Inventory

| # | File | Description |
|---|------|-------------|
| 1 | `16S rRNA Amplicon Sequencing.json` | 16S rRNA amplicon sequencing analysis |
| 2 | `RNA-seq.json` | Bulk RNA-seq differential expression analysis |
| 3 | `scRNA-seq.json` | Single-cell RNA-seq analysis |
| 4 | `ChIP-seq.json` | ChIP-seq data analysis |
| 5 | `Spatial Transcriptomics Sequencing.json` | Spatial transcriptomics (10x Visium) |
| 6 | `Gene Regulatory Network  Inference.json` | GRN inference from transcriptomic data |
| 7 | `Multi-omics Data Integration.json` | scRNA-seq + scATAC-seq integration |
| 8 | `bioinfo_pipeline.xlsx` | Overview spreadsheet (all pipelines summary) |

---

## Pipeline Details

### 1. 16S rRNA Amplicon Sequencing (`16S rRNA Amplicon Sequencing.json`)

**Objective**: Process raw 16S rRNA sequencing reads through a standard microbiome analysis workflow.

**Key Steps Covered**:
- Raw sequence quality control (e.g., FastQC, DADA2)
- ASV (Amplicon Sequence Variant) or OTU (Operational Taxonomic Unit) table generation
- Taxonomic classification against reference databases (SILVA, Greengenes)
- Alpha diversity analysis (Shannon, Chao1, Simpson indices)
- Beta diversity analysis (PCoA, NMDS with Bray-Curtis / UniFrac distances)

---

### 2. Bulk RNA-seq (`RNA-seq.json`)

**Objective**: Differential expression analysis pipeline for conventional bulk RNA-sequencing data.

**Key Steps Covered**:
- Raw read quality control (FastQC, MultiQC)
- Read alignment (STAR / HISAT2)
- Expression quantification (featureCounts / RSEM)
- Differential expression analysis (DESeq2 / edgeR)
- Functional enrichment analysis (GO, KEGG pathway)

---

### 3. Single-cell RNA-seq (`scRNA-seq.json`)

**Objective**: Standard single-cell RNA sequencing data analysis workflow.

**Key Steps Covered**:
- Preprocessing and quality filtering (Seurat / Scanpy)
- Normalization and highly variable gene selection
- Dimensionality reduction (PCA, t-SNE, UMAP)
- Cell clustering and annotation
- Differential expression and marker gene identification
- Downstream analyses (trajectory inference, cell-cell communication)

---

### 4. ChIP-seq (`ChIP-seq.json`)

**Objective**: Complete ChIP-seq (Chromatin Immunoprecipitation Sequencing) analysis pipeline.

**Key Steps Covered**:
- Raw read QC and adapter trimming
- Read alignment to reference genome (Bowtie2 / BWA)
- Peak calling (MACS2 / MACS3)
- Peak annotation and motif discovery
- Differential binding analysis
- Visualization (IGV tracks, heatmaps)

---

### 5. Spatial Transcriptomics (`Spatial Transcriptomics Sequencing.json`)

**Objective**: Spatial transcriptomics analysis pipeline for 10x Visium technology.

**Key Steps Covered**:
- Alignment of tissue H&E images with expression matrices
- Spot-level quality control and normalization
- Detection of spatially highly variable genes (e.g., SpatialDE, SPARK-X)
- Spatial domain / region clustering
- Cell-cell communication and spatial interaction analysis

---

### 6. Gene Regulatory Network Inference (`Gene Regulatory Network  Inference.json`)

**Objective**: Infer and construct Gene Regulatory Networks (GRN) from transcriptomic data.

**Key Steps Covered**:
- Gene expression matrix preprocessing
- Co-expression network construction
- Transcription factor (TF) — target gene relationship inference
- GRN inference algorithms (e.g., GENIE3, GRNBoost2, SCENIC)
- Network visualization and hub gene analysis

---

### 7. Multi-omics Data Integration (`Multi-omics Data Integration.json`)

**Objective**: Multi-omics integration workflow combining single-cell transcriptome (scRNA-seq) and single-cell chromatin accessibility (scATAC-seq) data.

**Key Steps Covered**:
- Individual modality preprocessing (scRNA-seq + scATAC-seq)
- Cross-modality anchoring and integration (e.g., Seurat v5, Signac)
- Joint dimensionality reduction and visualization
- Multi-modal regulatory relationship analysis
- Linked gene-peak association identification

---

### 8. Pipeline Overview (`bioinfo_pipeline.xlsx`)

Excel spreadsheet providing a summary overview of all the above bioinformatics pipelines, including tool comparisons, parameter settings, and workflow diagrams.

---

## Usage Notes

- **Format**: All JSON files follow a conversational format with `messages` array containing `user`, `assistant`, and `tool` roles.
- **Tool Calls**: The assistant messages include `tool_calls` fields documenting the actual tools and parameters used during pipeline design.
- **Reference**: These pipelines were designed following best practices as of 2024–2025 and serve as standardized workflows for the associated manuscript.

---

*Generated for Supplementary Data 7 — Bioinformatics Pipeline Documentation*
