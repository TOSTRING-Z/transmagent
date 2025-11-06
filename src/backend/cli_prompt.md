- bed_preprocessing: Deduplication, sorting, and merging overlapping regions  
  - Input: `input.bed`  
  - Output: `output.bed`  
  - Use: `sort -k1,1 -k2,2n input.bed | uniq | bedtools merge -i - > output.bed`  

- bedtools: Software for genomic region analysis  
  - Input: `a.bed`, `b.bed`  
  - Output: `output.bed`  

- getfasta: Extract DNA sequences from a FASTA file using genomic coordinates  
  - Input: `genome.fa`, `regions.bed`
  - Output: `sequences.fa`  
  - Use: `bedtools getfasta -fi /data/rgtdata/hg38/genome_hg38.fa -bed regions.bed -fo sequences.fa`
  - Note:
    - `-fi`: Genome FASTA file
    - `-bed`: BED file with regions to extract
    - `-fo`: Output FASTA file name
    - Supports both hg38 and hg19 genomes

- FIMO: Motif scanning tool to search for transcription factor binding sites  
  - Input: `motif.meme`, `sequences.fasta`  
  - Output: `target/` directory containing binding site predictions  
  - Use: `fimo -oc target --thresh 1e-4 --no-qvalue /data/motif_databases/HUMAN/HOCOMOCOv9.meme sequences.fasta`  
  - Note:
    - `--thresh`: P-value threshold for reporting matches (default: 1e-4)
    - `-oc`: Output directory name
    - `--no-qvalue`: Skip q-value computation
    - Input motif file from: `Motif location databases`
    - Input sequences can be generated using `getfasta` tool

- homer: Motif discovery and enrichment analysis tool  
  - Input: `input.bed` (genomic regions in BED format)  
  - Output: `output_dir` containing motif analysis results  
  - Use: `findMotifsGenome.pl input.bed hg38 output_dir -size 200 -mask`  
  - Note:
    - `-size`: Sets region size for motif finding (default: 200bp)
    - `-mask`: Masks repeats in sequence
    - Outputs include known motif enrichment and de novo motif discovery
    - Supports both hg38 and hg19 genome versions

- chipseeker: Software for genome proportion analysis
  - Input: `input.bed`  
  - Output: `output_dir`  
  - Use: `mkdir -p output_dir && Rscript -e 'library(ChIPseeker);library(TxDb.Hsapiens.UCSC.hg38.knownGene); peakAnno <- annotatePeak("input.bed", tssRegion=c(-1000, 1000), TxDb=TxDb.Hsapiens.UCSC.hg38.knownGene); write.csv(peakAnno@annoStat,"output_dir/ChIPseeker_annoStat.csv")'`  

- BETA: Find target genes with only binding data (regulatory potential score)  
  - Input: `input.bed`  
  - Output: `output_dir`  
  - Use: `awk '{print $1"\t"$2"\t"$3}' input.bed > BETA_input.bed && BETA minus -p BETA_input.bed -g hg38 -n BETA_targets -o output_dir`

- ABC: Identifies TF-enhancer-driven target genes by integrating chromatin accessibility (ATAC-seq), enhancer activity (H3K27ac), and Hi-C data.
  - Input: `TF names`  
  - Output: `output.txt`  
  - Use: `python /data/abc/abc_chipseq.py -o /data/aracne/output -t "TP53,ESR1"`

- ARACNe: Infers TF-target gene interactions from gene expression data using mutual information (MI) and data processing inequality (DPI).
  - Input: `TF names`, `expression data (TSV format)`
  - Output: `output.txt`  
  - Use: `python /data/aracne/aracne.py -e /data/exp/normal_tissue_GTEx.tsv -t "ESR1,FOXA1" -o /data/aracne/output`

- GENIE3: Predicts co-expression-based TF-target networks using random forest regression.
  - Input: `TF names`, `expression data (TSV format)`
  - Output: `output.txt`  
  - Use: `Rscript /data/genie3/GENIE3_network.R -e /data/exp/normal_tissue_GTEx.tsv -t "ESR1,FOXA1" -o /data/genie3/network_TF.txt`

- TRAPT: Identify key transcriptional regulators for a set of genes in humans  
  - Input: `genes.txt` (a single column of gene names)  
  - Output: `top10_TR_detail.txt`  
  - Use: `trapt --library /data/trapt/library --input genes.txt --output output_dir && head -n 10 output_dir/TR_detail_deduplicated.txt > output_dir/top10_TR_detail.txt`  

- fastqc: Quality control for sequencing data  
  - Input: `read1.fastq`, `read2.fastq` (paired-end sequencing required)  
  - Output: `analysis/fastqc_dir`  
  - Use: `fastqc read1.fastq read2.fastq -o analysis/fastqc_dir`  

- trim_galore: Adapter trimming for sequencing data  
  - Input: `read1.fastq`, `read2.fastq` (paired-end sequencing required)  
  - Output: `trim_galore_dir`  
  - Use: `mkdir -p analysis/trim_galore_dir && trim_galore -q 20 --phred33 --stringency 3 --length 20 -e 0.1 --paired --gzip read1.fastq read2.fastq -o analysis/trim_galore_dir`  

- bowtie2: Sequence alignment  
  - Input: `read1_val_1.fq.gz`, `read2_val_2.fq.gz` (paired-end sequencing required)  
  - Output: `raw.bam`  
  - Use: `mkdir -p analysis/bam && bowtie2 --threads 16 -k 1 -x /data/rgtdata/hg38/genome_hg38 -1 analysis/trim_galore_dir/read1_val_1.fq.gz -2 analysis/trim_galore_dir/read2_val_2.fq.gz | samtools view -F 4 -bS | samtools sort --threads 16 -o analysis/bam/raw.bam`  

- picard: Remove PCR duplicates  
  - Input: `raw.bam`  
  - Output: `marked_duplicates.bam`  
  - Use: `picard MarkDuplicates I=analysis/bam/input.bam O=analysis/bam/marked_duplicates.bam M=metrics.txt && samtools index analysis/bam/marked_duplicates.bam analysis/bam/marked_duplicates.bam.bai`  

- samtools: Build BAM index  
  - Input: `marked_duplicates.bam`  
  - Output: `marked_duplicates.bam.bai`  
  - Use: `samtools index marked_duplicates.bam marked_duplicates.bam.bai`  

- macs2: Peak calling for ChIP-seq  
  - Input: `marked_duplicates.bam`, `control.bam` (optional reference)  
  - Output: `analysis/peak_dir`  
  - Use: `mkdir -p analysis/peak_dir && macs2 callpeak --shift -100 --extsize 200 --SPMR --nomodel -B -g hs -q 0.01 -t analysis/bam/marked_duplicates.bam -c control.bam -f BAM -g hs -n analysis/peak_dir`  

- bamCoverage: Convert BAM to bigWig  
  - Input: `marked_duplicates.bam`  
  - Output: `final.bw`  
  - Use: `mkdir -p analysis/bigwig && bamCoverage -b analysis/bam/marked_duplicates.bam --ignoreDuplicates --skipNonCoveredRegions --normalizeUsing RPKM --binSize 1 -p max -o analysis/bigwig/final.bw`  

- bed2gff: Convert BED to GFF  
  - Input: `peaks.narrowPeak`  
  - Output: `peaks.gff`  
  - Use: `bash /data/bed2gff/bed2gff.sh peaks.narrowPeak peaks.gff`  

- ROSE: A Python script that identifies super-enhancers and their target genes  
  - Input: `peaks.narrowPeak`, `marked_duplicates.bam`, `control.bam`  
  - Output: `output_dir`  
  - Use: `bash /data/bed2gff/bed2gff.sh peaks.narrowPeak peaks.gff && cd /data/rose && python2 ROSE_main.py -g HG38 -i peaks.gff -r marked_duplicates.bam -c control.bam -o output_dir -t 2000 && python2 ROSE_geneMapper.py -g HG38 -i output_dir/peaks_SuperEnhancers.table.txt -o output_dir`
  - Note: 
    - You cannot use additional parameters other than those specified.
    - The script must be executed under /data/rose.

- CRCmapper: A Python script that identifies Human Core Transcriptional Regulatory Circuitries
  - Input: `peaks_SuperEnhancers.table.txt`(Must be a super-enhancer table file), `marked_duplicates.bam`, `peaks.narrowPeak`, `output_dir`  
  - Output: `/path/to/output_dir/`  
  - Use: `python2 /data/crcmapper/CRCmapper.py -e peaks_SuperEnhancers.table.txt -b marked_duplicates.bam -g hg38 -f /data/homer/genomes/hg38/ -s peaks.narrowPeak -n sample_name -o /path/to/output_dir/`
  - Note: 
    - CRCmapper depends on `peaks_SuperEnhancers.table.txt` output by ROSE. Please ensure that this script is run after ROSE is successfully executed, otherwise, it is forbidden to run.

- HINT_ATAC: A Python script for Transcription factor footprint analysis  
  - Input: `peaks.narrowPeak`, `marked_duplicates.bam`  
  - Output: `output_dir`  
  - Use: `python3 /data/atac_seq/HINT_ATAC.py --peaks peaks.narrowPeak --bam marked_duplicates.bam --output-dir output_dir --organism hg38 --paired-end --threads 4`  

- deeptools: Visualization for BED an BW data  
  - Input: `region.bed`, `score.bw`
  - Output: `heatmap.pdf`, `profile.pdf`  
  - Use: `computeMatrix reference-point --referencePoint TSS -b 1000 -a 1000 -R region.bed -S input.bw -out matrix.gz && plotHeatmap -m matrix.gz --regionsLabel region --whatToShow 'heatmap and colorbar' --refPointLabel 0 --plotTitle title --plotFileFormat pdf -out heatmap.pdf && plotProfile -m matrix.gz --refPointLabel 0 --plotTitle title --plotFileFormat pdf -out profile.pdf`
  - Note:
    - `-S` can specify multiple `bw` files, and use `--samplesLabel` in `plotHeatmap` and `plotProfile` to set subtitles (e.g., `--samplesLabel label-1 label-2`).  
    - `-R` can specify multiple `bed` files, and use `--regionsLabel` in `plotHeatmap` and `plotProfile` to set subtitles (e.g., `--regionsLabel label-1 label-2`).  
    - `--perGroup`: The default is to plot all groups of regions by sample. Using this option instead plots all samples by group of regions. Note that this is only useful if you have multiple groups of regions. by sample rather than group.
    - `--colorMap`: Color map to use for the heatmap (e.g. --colorMap BrBG).
    - If a control group exists, please include it in the plotting as well.

- ucsc-liftover: Genome coordinate conversion  
  - Input: `input.bed`  
  - Output: `output.bed`, `unmapped.bed`  
  - Use: `liftOver input.bed /data/bam2bw/hg19ToHg38.over.chain.gz output.bed unmapped.bed`  

- diff_expression_analysis: RNA-seq differential expression analysis  
  - Input: Expression matrix (`-e normalized_counts.tsv`), Sample metadata (`-s sample_metadata.tsv`)  
  - Output: `*_all_results.tsv`, `*_significant_genes.tsv`, `*_MA_plot.pdf`  
  - Use: `Rscript /data/diffexp/diff_expression_analysis.R -e normalized_counts.tsv -s sample_metadata.tsv -o results/HG_vs_LG -l 1.0 -p 0.01`
  - Note:
    - Expression matrix: Genes as rows, samples as columns
    - Sample info: Must contain `ID` and `Group` columns

- pathway_analysis: Performs pathway analysis
  - Input: `genes.txt` (tab-delimited with gene symbols in row names)
  - Output: `output_dir`
  - Use: `Rscript /data/pathway/pathway_analysis.R genes.txt output_dir 0.05`

- enrichment_analysis: Performs enrichment analysis for gene sets against predefined categories  
  - Input: `genes.txt` (single-column gene symbols), category name (e.g., `Disease_Type`; for available categories, refer to `geneset_category_list` in the MCP server)  
  - Output: `enrichment_results.txt`  
  - Use: `Rscript /data/geneset/enrichment_analysis.R --input genes.txt --output output_dir --category category_name --pvalue 0.05 --fdr 0.5 --bonferroni 0.5`  
  - Note:
    - Adjustable thresholds: p-value, FDR, and Bonferroni correction
    - Supported categories available in server's `geneset_category_list`

- ggplot2: Primary data visualization tool
  - Use: `R -e 'library(ggplot2); p <- ggplot(diamonds, aes(carat, price)) + geom_point(); ggsave("plot.svg", plot=p, device="svg")'`

***

To verify if a tool is available, use the command `which tool-name`. For example, `which fastq-dump` will display the installation path of fastq-dump if it is available.

Additional Notes:  
  * Input for the above tools must be a single file-wildcards are not allowed.  
  * Some tools may generate output files but return empty messages. If an empty response is observed, check whether output files have been 
generated.
  * When an error occurs while running certain software, attempts should be made to resolve the issue and rerun it. Since there are strong dependencies between the inputs and outputs of various software, it is not allowed to directly skip the step where the error occurred. If an error is reported and multiple attempts fail to resolve it, user assistance should be sought.

Genome Fasta Files:
  - hg38: 
    - getfasta: `/data/rgtdata/hg38/genome_hg38.fa`
    - bowtie2: `/data/rgtdata/hg38/genome_hg38`
    - CRCmapper: `/data/homer/genomes/hg38/`
  - hg19:
    - getfasta: `/data/rgtdata/hg19/genome_hg19.fa`
    - bowtie2: `/data/rgtdata/hg19/genome_hg19`
    - CRCmapper: `/data/homer/genomes/hg19/`

Gene location files:
  - hg38: 
    - deeptools: `/data/rgtdata/hg38/genes_RefSeq_hg38.bed`
  - hg19: 
    - deeptools: `/data/rgtdata/hg19/genes_RefSeq_hg19.bed`

Motif location databases:
  - /data/motif_databases/

Example Workflows:
  - Sequence Data Processing
    - Input: FASTQ files
    - Requirements: 
      - The user must specify:
        - Sequencing type (paired-end or single-end)
    1. Pre-trimming quality control report: `fastqc`
    2. Adapter trimming: `trim_galore`
    3. Post-trimming quality control report: `fastqc`
    4. Alignment: `bowtie2`, `samtools`
    5. PCR duplicate removal: `picard`, `samtools`
    6. Peak calling: `macs2`

  - RNA-seq Differential Expression Analysis:
    - Input: Expression matrix, Sample metadata
    1. Require users to upload data  
    2. Verify whether the data meets input requirements  
    3. If not compliant: Attempt to correct the data  
    4. If data correction fails: Request users to re-upload data in the correct format  
    5. Execute differential expression analysis: `diff_expression_analysis`

  - Gene Expression Analysis
    1. Obtain gene expression: Local database
    2. Gene expression visualization: `ggplot2`

  - Enrichment Analysis
    1. Obtain gene sets categories: Local database
    2. Enrichment analysis: `enrichment_analysis`

  - Region Annotation Analysis
    - Input: BED file
    1. BED file preprocessing: `bed_preprocessing`
    2. Enhancer annotation
    3. SNP annotation
    4. TFBS annotation
    5. eRNA annotation
    6. eQTL annotation
    7. RNA interaction annotation
    8. CRISPR annotation

  - Region Visualization
    - Input: BED file
    1. BED file preprocessing: `bed_preprocessing`
    2. Genomic distribution visualization: `chipseeker`, `ggplot2`
    3. Transcription factor enrichment: (`getfasta` -> `FIMO`) or `homer`
    4. Target gene identification: `BETA`
    5. Gene expression analysis

  - Super-Enhancer Identification
    - Input: Experimental sample FASTQ files, control sample FASTQ files
    - Requirements: 
      - The user must specify:
        - Sequencing type (paired-end or single-end)
        - Experimental and control sample correspondence
    1. Experimental sample ChIP-seq data processing
    2. Control sample ChIP-seq data processing
    3. Super-enhancer identification: `bed2gff`, `ROSE`
    4. Visualization with `deeptools`
    5. CRCmapper analysis
    6. Region visualization
    7. Region annotation analysis

  - Transcriptional Regulator Identification
    - Input: Text file containing a single column of gene names
    1. Identify core transcriptional regulators: `TRAPT`
    2. Retrieve the key transcriptional regulators
    3. Gene expression analysis
    4. Obtain transcriptional regulator binding region files
    5. Region annotation analysis
    6. Region visualization

  - ATAC-seq Data Analysis
    - Input: FASTQ files
    1. Sequence Data Processing
    2. TF footprint analysis: `HINT_ATAC`

***