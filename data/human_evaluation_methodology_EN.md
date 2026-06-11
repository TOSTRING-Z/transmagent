# TransMAgent Human Evaluation Methodology Documentation

## I. Evaluation Purpose and Overall Design

To systematically evaluate TransMAgent's capabilities in transcriptional regulation and bioinformatics tasks, we designed a blinded human evaluation framework grounded in four binary criteria. This framework evaluates not only TransMAgent but also multiple baseline agents and state-of-the-art large language models, providing a comprehensive horizontal benchmarking baseline.

The evaluation encompasses **50 bioinformatics query tasks**, spanning diverse canonical scenarios including transcriptional regulation analysis, gene expression data processing, pathway enrichment analysis, and epigenomic data interpretation. Outputs from all agents/models were **blindly annotated by three independent domain experts**, who had no knowledge of the generative method underlying each response.

---

## II. Evaluation Criteria: Four-Dimensional Binary Scoring System

The evaluation framework defines four binary criteria anchored in the agent's core reasoning chain (each criterion scored as 0 or 1), yielding a total score range of 0–4 points.

### 2.1 Factuality & Reliability (FR)

| Aspect | Description |
|--------|-------------|
| **Definition** | Assesses whether the agent grounds its responses in authentic, verifiable data sources and maintains freedom from hallucinations |
| **Pass (1 point)** | Output explicitly references traceable, authentic experimental data (e.g., TCGA, ENCODE, JASPAR, TRRUST, GEO, and other public databases); no fabricated or unverifiable content |
| **Fail (0 points)** | Use of simulated data or unverifiable sources; citation of nonexistent literature or data; broken or insufficient provenance chain |

**Expert Review Focus**:
- Is there a clear, traceable path to the data sources?
- Are any data points, gene names, or statistical results fabricated?
- Can numerical values in the output be mapped back to original data sources?

---

### 2.2 Execution & Tool Utilization (ET)

| Aspect | Description |
|--------|-------------|
| **Definition** | Assesses whether the agent accurately invokes domain-specific tools or executes computational code, with verifiable execution records |
| **Pass (1 point)** | Tools correctly invoked; code actually executed and produced reproducible computational results; execution log complete |
| **Fail (0 points)** | Tool invocation failed; core analysis not completed through actual runs; execution incomplete or key steps missing |

**Expert Review Focus**:
- Are the tool invocation records consistent with the output content?
- Did the analysis pipeline run to completion?
- Are there instances where execution was claimed but not actually performed?

---

### 2.3 Task Planning & Robustness (TP)

| Aspect | Description |
|--------|-------------|
| **Definition** | Assesses whether the agent demonstrates comprehensive task comprehension, autonomous planning, and resilience to errors |
| **Pass (1 point)** | Reasonable task decomposition; analysis stages proceed in logical order; pipeline maintains continuity; error recovery mechanisms present and capable of recovering from execution failures |
| **Fail (0 points)** | Inadequate task decomposition; no coherent plan; pipeline collapses at the first obstacle; no error recovery path |

**Expert Review Focus**:
- Is the task decomposed into executable sub-steps in a reasonable manner?
- When intermediate steps fail, can the agent autonomously adjust its strategy?
- Does the ordering of analysis stages follow domain best practices?

---

### 2.4 Professionalism & Interpretability (PI)

| Aspect | Description |
|--------|-------------|
| **Definition** | Assesses whether the output reflects domain-specific expertise with clear, well-structured explanations |
| **Pass (1 point)** | Output reflects prior biological knowledge; interpretation is task-appropriate and evidence-supported; report is well-structured and meets field standards |
| **Fail (0 points)** | Interpretation is superficial; prior domain knowledge not adequately applied; output is poorly structured; interpretation disconnected from analytical evidence |

**Expert Review Focus**:
- Are biological interpretations grounded in domain knowledge?
- Is the report clearly organized with coherent logical flow?
- Are conclusions supported by analytical results?

---

## III. Scoring Mechanism: Majority Voting

### 3.1 Blinded Review Design

Three domain experts (Expert A, Expert B, Expert C) independently reviewed the output of each agent/model for each query. During the review:

- **Complete blinding**: Experts had no knowledge of which agent or model generated each response
- **Independent review**: No communication or coordination among the three experts
- **Four-dimensional scoring**: Each expert independently assigned 0/1 scores to the FR, ET, TP, and PI dimensions

### 3.2 Majority Voting Rule

Final criterion-level scores were determined by **majority voting** across the three expert annotations:

- If ≥ 2 out of 3 experts deemed the criterion as passed, it scores **1 point**
- Otherwise, it scores **0 points**

Total score per query = FR + ET + TP + PI, ranging from 0 to 4.

**Example**:

| Criterion | Expert A | Expert B | Expert C | Majority Result | Score |
|-----------|----------|----------|----------|-----------------|-------|
| FR | 1 (Pass) | 0 (Fail) | 1 (Pass) | 2 Pass / 1 Fail | **1** |
| ET | 1 (Pass) | 1 (Pass) | 1 (Pass) | 3 Pass | **1** |
| TP | 0 (Fail) | 0 (Fail) | 1 (Pass) | 2 Fail / 1 Pass | **0** |
| PI | 1 (Pass) | 1 (Pass) | 1 (Pass) | 3 Pass | **1** |
| **Total** | | | | | **3** |

---

## IV. Evaluation Subjects by Group

The evaluation covered **three groups of subjects**, corresponding to different sheets in the Excel file:

### 4.1 General Agents (GA)

Agents evaluated on **general bioinformatics tasks**:

| Agent | Description |
|-------|-------------|
| **TransMAgent** | The core agent of this study, designed for transcriptional regulation and bioinformatics tasks |
| **BioMni** | Bioinformatics benchmark agent |
| **SpatialAgent** | Spatial transcriptomics-oriented agent |

### 4.2 Biomedical Agents (BA)

Agents evaluated on **biomedicine-specific tasks**:

| Agent | Description |
|-------|-------------|
| **TransMAgent** | The core agent of this study |
| **BioMni** | Bioinformatics benchmark agent |
| **SpatialAgent** | Spatial transcriptomics-oriented agent |

### 4.3 LLMs and General-Purpose Tools (LLM & Model Comparison)

Evaluated mainstream large language models and general-purpose coding assistants for bioinformatics capability:

| Model / Tool | Type | Description |
|-------------|------|-------------|
| **Claude Code / claude-sonnet-4-6** | LLM Agent | Anthropic's coding assistant |
| **Codex CLI** | LLM Agent | OpenAI's command-line coding assistant |
| **GPT-5.4** | LLM | OpenAI's latest model |
| **Gemini 3.1 Pro Preview** | LLM | Google DeepMind model |
| **DeepSeek V3.2** | LLM | DeepSeek latest model |
| **MiniMax M2.7** | LLM | MiniMax model |
| **BioChatter** | Bio-tool | Bioinformatics chatbot |
| **ChatGSE** | Bio-tool | Gene expression analysis chat tool |
| **GeneGPT** | Bio-tool | Gene-related GPT tool |

### 4.4 50-Question Comprehensive Evaluation

A separate sheet contains the complete per-question, per-expert review results for 6 agents (multagent, transagent, claude, codex, gemini, react) across all 50 tasks.

---

## V. Evaluation Task Design

### 5.1 Task Sources

The 50 evaluation query tasks span the following bioinformatics domains:

1. **Transcription factor regulation analysis**: TF-target gene prediction, binding site identification
2. **Differential gene expression analysis**: Microarray / RNA-seq data processing
3. **Pathway and functional enrichment analysis**: GO / KEGG enrichment
4. **Epigenomic data interpretation**: ChIP-seq, ATAC-seq data analysis
5. **Gene set variation analysis**: Application of GSVA and related methods
6. **Literature retrieval and knowledge integration**: PubMed literature query and summarization

### 5.2 Task Distribution

Each evaluation task was distributed to all agents/models under evaluation using a uniform prompt format, ensuring identical input conditions. Agents were required to autonomously complete the full pipeline of data retrieval, analysis execution, result interpretation, and report generation.

---

## VI. Expert Review Process

### 6.1 Expert Selection

The three independent domain experts (Expert A, Expert B, Expert C) met the following criteria:

- Doctoral degree or equivalent research experience in bioinformatics, computational biology, or related fields
- Familiarity with transcriptional regulation analysis and high-throughput sequencing data processing
- Experience in publishing peer-reviewed bioinformatics research papers
- No conflicts of interest with the development teams of the evaluation subjects

### 6.2 Review Materials

Each expert received:

1. The complete text of all 50 original queries
2. The complete output of each agent/model for each query
3. The criteria documentation (i.e., Sections II and III of this document)
4. Standardized scoring sheets

**Key blinding safeguard**: All outputs were presented in randomized order, with any source-identifying information (e.g., tool names, distinctive formatting markers) removed.

### 6.3 Review Steps

1. **Training phase**: Experts familiarized themselves with the four scoring criteria and their operational definitions
2. **Independent review**: Each expert independently completed the review of all 50 queries × N agents
3. **Score submission**: Experts submitted their 0/1 scores for each dimension along with brief comments
4. **Majority voting**: The researchers aggregated the three experts' scores and applied majority voting to determine final scores

---

## VII. Scoring Data Record Format

Each review record contains the following fields:

| Field | Description |
|-------|-------------|
| **Task ID** | Query task number (1–50) |
| **Model / Agent** | Name of the evaluated agent or model |
| **Expert A — Review** | Expert A's review comments and judgments across the four dimensions |
| **Expert B — Review** | Expert B's review comments and judgments across the four dimensions |
| **Expert C — Review** | Expert C's review comments and judgments across the four dimensions |
| **Score (0–4)** | Final total score determined by majority voting |

Each expert's comment contains per-dimension judgments for FR, ET, TP, and PI, accompanied by brief justifications and a summary assessment.

**Example expert comment** (Expert A's review of TransMAgent on a given query):

> - FR: Data sourced from public databases; traceability confirmed
> - ET: tools correctly invoked; execution log confirmed
> - TP: analysis stages covered in logical order; pipeline maintained continuity
> - PI: output reflects prior biological knowledge; interpretation is task-appropriate and evidence-supported

Corresponding four-dimensional judgments: FR = Pass (1), ET = Pass (1), TP = Pass (1), PI = Pass (1), yielding a total score of 4.

---

## VIII. Evaluation Results Summary

Complete per-query, per-expert, per-dimension review data are provided in **Supplementary Table 9**, which contains six sheets:

| Sheet Name | Content | Data Scale |
|------------|---------|------------|
| **50-Question Evaluation** | Complete three-expert reviews for 6 agents across 50 query tasks | 302 rows (including headers) |
| **Model Comparison Evaluation** | Comparative review of mainstream LLMs and general-purpose tools | 252 rows (including headers) |
| **LLM Evaluation** | Specialized LLM evaluation | — |
| **GA** | General Agent comparison (BioMni, SpatialAgent, TransMAgent) | — |
| **BA** | Biomedical Agent comparison (BioMni, SpatialAgent, TransMAgent) | 153 rows (including headers) |

---

## IX. Methodological Strengths and Limitations

### 9.1 Strengths

1. **Blinded design**: Eliminates review bias and ensures scoring objectivity
2. **Multi-expert panel**: Three independent experts with majority voting reduce the impact of single-rater subjectivity
3. **Multi-dimensional criteria**: Four dimensions cover the complete evaluation chain — data foundation, tool execution, planning capability, and professional competence
4. **Precise binary scoring**: 0/1 scoring facilitates more consistent operational definitions compared to Likert scales, reducing scoring ambiguity
5. **End-to-end evaluation**: Assesses holistic task-completion capability rather than isolated knowledge retrieval

### 9.2 Limitations

1. **Task scope**: While the 50 queries cover major scenarios, they cannot exhaustively represent all bioinformatics task types
2. **Expert panel size**: Three experts satisfy statistical robustness requirements, though a larger panel could further improve reliability
3. **Binary constraint**: While 0/1 scoring provides clarity, it may fail to capture performance nuances where outputs partially meet criteria without full satisfaction

---

## X. Data and Code Availability

File path: `data/human_evaluation.xlsx`

---

*Last updated: 2026-06-10*
