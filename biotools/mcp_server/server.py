from fastmcp import FastMCP
import pandas as pd
from typing import Optional, Union, List
import os
import asyncio
import hashlib
import json

mcp = FastMCP("biotools")

# Configuration
data_docker = "/data"
workdir = "/app"
tmp_docker = "/tmp"

try:
    os.chdir(workdir)
except Exception as e:
    print(f"Warning: Failed to change directory to {workdir}: {str(e)}")

# Helper function to truncate error messages
def _truncate_error(msg: str, max_length: int = 200) -> str:
    """Truncate error message to specified length"""
    try:
        if len(msg) > max_length:
            return msg[:max_length] + "..."
        return msg
    except Exception:
        return "Error message too long or invalid"

# Initialize global variables with safe defaults
class_data = {}
info_class = {}
geneset_types_list = ""
bed_data_db = {}
tr_data_db = {}
exp_data_db = {}
biological_type_list = ""
data_source_list = ""
cancer_list = ""
execute_bash_md = "Execute bash commands"

# Load geneset data
try:
    with open(f"{data_docker}/geneset/json/class_data.json", "r") as f:
        class_data = json.load(f)

    with open(f"{data_docker}/geneset/json/info_class.json", "r") as f:
        info_class = json.load(f)
        geneset_types_list = ", ".join(info_class.keys())
except Exception as e:
    print(f"Warning: Failed to load geneset data: {_truncate_error(str(e))}")

# Load bed files database
try:
    bed_data_db = {
        "Super_Enhancer_SEdbv2": f"{data_docker}/human/human_Super_Enhancer_SEdbv2.bed",
        "Super_Enhancer_SEAv3": f"{data_docker}/human/human_Super_Enhancer_SEAv3.bed",
        "Super_Enhancer_dbSUPER": f"{data_docker}/human/human_Super_Enhancer_dbSUPER.bed",
        "Enhancer": f"{data_docker}/human/human_Enhancer.bed",
        "Common_SNP": f"{data_docker}/human/human_Common_SNP.bed",
        "Risk_SNP": f"{data_docker}/human/human_Risk_SNP.bed",
        "eQTL": f"{data_docker}/human/human_eQTL.bed",
        "TFBS": f"{data_docker}/human/human_TFBS.bed",
        "eRNA": f"{data_docker}/human/human_eRNA.bed",
        "RNA_Interaction": f"{data_docker}/human/human_RNA_Interaction.bed",
        "CRISPR": f"{data_docker}/human/human_CRISPR.bed",
    }
    biological_type_list = ", ".join(list(bed_data_db.keys()))
except Exception as e:
    print(f"Warning: Failed to load bed data database: {_truncate_error(str(e))}")

# Load TR data database
try:
    tr_data_db = dict(
        map(
            lambda x: (x.split(".")[0], f"{data_docker}/trapt/TR_bed/{x}"),
            os.listdir(f"{data_docker}/trapt/TR_bed"),
        )
    )
except Exception as e:
    print(f"Warning: Failed to load TR data: {_truncate_error(str(e))}")

# Configuration
bed_config = {"gene_bed_path": f"{data_docker}/human/gene.bed"}
gene_expression_TCGA = f"{data_docker}/exp/gene_expression_TCGA.feather"

# Expression data databases
try:
    exp_data_db = {
        "cancer_TCGA": f"{data_docker}/exp/cancer_TCGA.csv.gz",
        "cell_line_CCLE": f"{data_docker}/exp/cell_line_CCLE.csv.gz",
        "cell_line_ENCODE": f"{data_docker}/exp/cell_line_ENCODE.csv.gz",
        "normal_tissue_GTEx": f"{data_docker}/exp/normal_tissue_GTEx.csv.gz",
        "primary_cell_ENCODE": f"{data_docker}/exp/primary_cell_ENCODE.csv.gz",
    }
    data_source_list = ", ".join(list(exp_data_db.keys()))
except Exception as e:
    print(f"Warning: Failed to load expression data databases: {_truncate_error(str(e))}")

# Global lists
try:
    with open("cli_prompt.md", "r", encoding="utf8") as file:
        execute_bash_md = file.read()
except Exception as e:
    print(f"Warning: Failed to load CLI prompt: {_truncate_error(str(e))}")

try:
    cancer_list = ", ".join(pd.read_csv(exp_data_db["cancer_TCGA"], index_col=0).columns)
except Exception as e:
    print(f"Warning: Failed to load cancer list: {_truncate_error(str(e))}")


def _validate_file_path(file_path: str) -> bool:
    """Validate if file path exists"""
    try:
        return os.path.exists(file_path)
    except Exception:
        return False


def _validate_genes_input(genes: Union[List[str], str]) -> Union[List[str], str]:
    """Validate genes input parameter"""
    try:
        if isinstance(genes, str):
            if genes == "all":
                return genes
            elif _validate_file_path(genes):
                return genes
            else:
                return f"Error: Genes parameter must be gene list, 'all' or a valid file path, got: {genes}"
        elif isinstance(genes, list):
            if not all(isinstance(gene, str) for gene in genes):
                return "Error: All elements in genes list must be strings"
            return genes
        else:
            return f"Error: Genes parameter must be list or string, got: {type(genes).__name__}"
    except Exception as e:
        return f"Error validating genes input: {_truncate_error(str(e))}"


def _validate_trs_input(trs: Union[List[str], str]) -> Union[List[str], str]:
    """Validate TRs input parameter"""
    try:
        if isinstance(trs, str):
            if not _validate_file_path(trs):
                return f"Error: File path does not exist: {trs}"
            try:
                trs_list = pd.read_csv(trs, header=None).iloc[:, 0].tolist()
                if not all(isinstance(tr, str) for tr in trs_list):
                    return "Error: All TR names in the file must be strings"
                return trs_list
            except Exception as e:
                return f"Error: Failed to read CSV file: {_truncate_error(str(e))}"
        elif isinstance(trs, list):
            if not all(isinstance(tr, str) for tr in trs):
                return "Error: All elements in TR list must be strings"
            return trs
        else:
            return f"Error: TRs parameter must be list or string, got: {type(trs).__name__}"
    except Exception as e:
        return f"Error validating TRs input: {_truncate_error(str(e))}"


@mcp.tool(
    description=f"""
{execute_bash_md}

Args:
    command: The bash command to execute
    timeout: Timeout time (seconds), None means no timeout
"""
)
async def execute_bash(
    command: str = "echo hello!", timeout: Optional[float] = 6000.0
) -> str:
    try:
        if not isinstance(command, str) or not command.strip():
            return "Error: Command cannot be empty"

        print(f"Executing: {command}")

        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        try:
            output, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            output_str = output.decode("utf-8", errors="replace").strip()

            if proc.returncode != 0:
                return f"Command failed (exit code {proc.returncode}):\n{output_str}"

            return (
                output_str
                if output_str
                else "Command executed successfully (no output)"
            )

        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            return f"Command timed out after {timeout} seconds"

    except Exception as e:
        return f"Execution error: {_truncate_error(str(e))}"


@mcp.tool(
    description="""
List all available geneset categories and their descriptions.

Returns:
    A string containing all geneset categories and their descriptions.
"""
)
async def geneset_category_list() -> str:
    try:
        if not info_class:
            return "Error: No geneset categories available"
            
        output = []
        for geneset_type, info in info_class.items():
            output.append(f"{geneset_type}: {info['text']}")
        return "\n".join(output)
    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


@mcp.tool(
    description=f"""
Get annotation bed file for a given biological type from the local database (hg38).

Args:
    biological_type: Biological types in local database (must be one of: {biological_type_list})

Returns:
    The path to the annotation bed file.
"""
)
async def get_annotation_bed(biological_type: str) -> str:
    try:
        if not isinstance(biological_type, str):
            return f"Error: Biological type must be a string, got: {type(biological_type).__name__}"

        if biological_type not in bed_data_db:
            available_types = ", ".join(bed_data_db.keys()) if bed_data_db else "None available"
            return f"Error: Biological type '{biological_type}' not found. Available: {available_types}"

        return bed_data_db[biological_type]
    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


@mcp.tool(
    description="""
Get TR (including transcription factors, transcription co-factors, and chromatin regulators)
binding region ChIP-seq bed files for a given list of TRs from the local database (hg38).

Note: The bed files provided are derived from ChIP-seq data.
      TR names can be obtained via search_tr or TRAPT.
      If a TR name without '@' is provided, fuzzy matching will be performed and return top 10 matches.

Args:
    trs: Transcriptional regulators. Can be either:
        - A list of TR names from TRAPT prediction (e.g., ['GATA4@Sample_03_0174', 'TBX5@Sample_03_0173'])
        - A path to a CSV file containing TR names (one name per line)

Returns:
    The paths to the TR binding region bed files.
"""
)
async def get_tr_bed(trs: Optional[Union[List[str], str]] = None) -> str:
    try:
        if trs is None:
            return "Error: TR list cannot be empty"

        validated_trs = _validate_trs_input(trs)
        if isinstance(validated_trs, str) and validated_trs.startswith("Error:"):
            return validated_trs

        trs_list = validated_trs
        if not trs_list:
            return "Error: TR list cannot be empty"

        md5_value = hashlib.md5("get_tr_bed".join(trs_list).encode("utf-8")).hexdigest()
        try:
            os.makedirs(f"/tmp/md5_{md5_value}", exist_ok=True)
        except Exception as e:
            return f"Error creating temporary directory: {_truncate_error(str(e))}"

        tr_beds = []
        missing_trs = []
        fuzzy_matches_info = []
        
        for tr in trs_list:
            # Exact match
            if '@' in tr:
                tr_bed = tr_data_db.get(tr)
                if tr_bed:
                    try:
                        basename = os.path.basename(tr_bed)
                        os.system(f"cp {tr_bed} /tmp/md5_{md5_value}/{basename}")
                        tr_beds.append(f"/tmp/md5_{md5_value}/{basename}")
                    except Exception as e:
                        missing_trs.append(f"{tr} (copy failed: {_truncate_error(str(e))})")
                else:
                    missing_trs.append(tr)
            # Fuzzy match
            else:
                try:
                    matching_keys = [key for key in tr_data_db.keys() if tr in key and '@' in key][:10]
                    if matching_keys:
                        fuzzy_matches_info.append(f"'{tr}' matched: {', '.join(matching_keys)}")
                        for matched_tr in matching_keys:
                            tr_bed = tr_data_db.get(matched_tr)
                            if tr_bed:
                                try:
                                    basename = os.path.basename(tr_bed)
                                    os.system(f"cp {tr_bed} /tmp/md5_{md5_value}/{basename}")
                                    tr_beds.append(f"/tmp/md5_{md5_value}/{basename}")
                                except Exception as e:
                                    missing_trs.append(f"{matched_tr} (copy failed: {_truncate_error(str(e))})")
                    else:
                        missing_trs.append(tr)
                except Exception as e:
                    missing_trs.append(f"{tr} (search failed: {_truncate_error(str(e))})")

        # Build output
        output = []
        if fuzzy_matches_info:
            output.append("Fuzzy matching results:")
            output.extend(fuzzy_matches_info)
            output.append("")
        
        if missing_trs:
            error_msg = f"Error: TRs not found or failed: {', '.join(missing_trs[:10])}"
            if len(missing_trs) > 10:
                error_msg += f" and {len(missing_trs)-10} more"
            return error_msg
        
        if not tr_beds:
            return "Error: No BED files found"

        output.append("Output BED files:")
        output.extend(tr_beds[:20])  # Limit output
        if len(tr_beds) > 20:
            output.append(f"... and {len(tr_beds)-20} more files")
        return "\n".join(output)
        
    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


@mcp.tool(
    description="""
Search transcriptional regulators (TRs) in the local TR database (hg38) by a keyword.

Note:
    For obtaining ChIP-seq data, use the search_tr function to locate TR names and then use get_tr_bed
    to retrieve their binding region bed files.

Args:
    keyword: A partial or full name of a TR to search for.

Returns:
    A list of matching TR names and their corresponding bed file paths.
"""
)
async def search_tr(keyword: str) -> str:
    try:
        if not isinstance(keyword, str) or not keyword.strip():
            return "Error: Keyword cannot be empty"

        matches = {
            tr: path for tr, path in tr_data_db.items() if keyword.lower() in tr.lower()
        }

        if not matches:
            return f"No matching TR found for keyword: {keyword}"

        output_lines = [f"{tr}: {path}" for tr, path in list(matches.items())[:20]]  # Limit output
        if len(matches) > 20:
            output_lines.append(f"... and {len(matches)-20} more matches")
        return f"Found {len(matches)} matching TR(s):\n" + "\n".join(output_lines)

    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


@mcp.tool(
    description="""
Query the positions of genes and return a Gene-bed file path (hg38).

Args:
    genes: Gene names. Can be either:
        - Gene name list (e.g., ['TP53'])
        - CSV file containing a list of gene names
        - The string "all" to return all genes

Returns:
    The path to the gene bed file.
"""
)
async def get_gene_position(genes: Optional[Union[List[str], str]] = None) -> str:
    try:
        if genes is None:
            return "Error: Genes parameter cannot be empty"

        validated_genes = _validate_genes_input(genes)
        if isinstance(validated_genes, str) and validated_genes.startswith("Error:"):
            return validated_genes

        genes = validated_genes

        try:
            gene_bed = pd.read_csv(
                bed_config["gene_bed_path"], index_col=None, header=None, sep="\t"
            )
        except Exception as e:
            return f"Error reading gene bed file: {_truncate_error(str(e))}"

        if genes == "all":
            gene_position = gene_bed
            genes_list = ["all"]
        else:
            if isinstance(genes, str):  # file path
                try:
                    genes_list = pd.read_csv(genes, header=None).iloc[:, 0].tolist()
                except Exception as e:
                    return f"Error reading genes file: {_truncate_error(str(e))}"
            else:  # list
                genes_list = genes

            gene_position = gene_bed[gene_bed[4].map(lambda gene: gene in genes_list)]

            if gene_position.empty:
                error_msg = f"Error: No position information found for genes: {', '.join(genes_list[:10])}"
                if len(genes_list) > 10:
                    error_msg += f" and {len(genes_list)-10} more"
                return error_msg

        md5_value = hashlib.md5(
            "get_gene_position".join(genes_list).encode("utf-8")
        ).hexdigest()

        docker_gene_position_path = f"{tmp_docker}/gene_position_md5_{md5_value}.bed"
        try:
            gene_position.to_csv(
                docker_gene_position_path, header=False, index=False, sep="\t"
            )
        except Exception as e:
            return f"Error writing gene position file: {_truncate_error(str(e))}"

        return docker_gene_position_path

    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


@mcp.tool(
    description=f"""
Get multi-sample expression data for a given TCGA cancer type from the local TCGA database.

Args:
    cancer: Cancer types in local database (must be one of: {cancer_list})
    genes: Gene names. Can be either:
        - Gene name list (e.g., ['TP53'])
        - CSV file containing a list of gene names
        - The string "all" to return all genes

Returns:
    The TCGA cancer genes expression file.
"""
)
async def get_tcga_cancer_express(
    cancer: str, genes: Optional[Union[List[str], str]] = "all"
) -> str:
    try:
        if not isinstance(cancer, str):
            return f"Error: Cancer type must be a string, got: {type(cancer).__name__}"

        if cancer not in cancer_list.split(", "):
            return f"Error: Cancer type '{cancer}' not found. Available: {cancer_list}"

        validated_genes = _validate_genes_input(genes)
        if isinstance(validated_genes, str) and validated_genes.startswith("Error:"):
            return validated_genes

        genes = validated_genes

        try:
            exp = pd.read_feather(gene_expression_TCGA)
        except Exception as e:
            return f"Error reading expression data: {_truncate_error(str(e))}"

        if genes == "all":
            exp_genes = exp
            genes_list = ["all"]
        else:
            if isinstance(genes, str):  # file path
                try:
                    genes_list = pd.read_csv(genes, header=None).iloc[:, 0].tolist()
                except Exception as e:
                    return f"Error reading genes file: {_truncate_error(str(e))}"
            else:  # list
                genes_list = genes

            exp_genes = exp[exp.index.map(lambda gene: gene in genes_list)]

            if exp_genes.empty:
                return f"Error: No expression data found for specified genes in TCGA database"

        exp_genes = exp_genes.filter(regex=f"^{cancer}")

        if exp_genes.empty:
            return f"Error: No expression data found for cancer type '{cancer}'"

        md5_value = hashlib.md5(cancer.join(genes_list).encode("utf-8")).hexdigest()
        exp_genes_path = f"{tmp_docker}/TCGA_{cancer}_exp_md5_{md5_value}.csv"
        try:
            exp_genes.to_csv(exp_genes_path)
        except Exception as e:
            return f"Error writing expression file: {_truncate_error(str(e))}"

        return exp_genes_path

    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


@mcp.tool(
    description=f"""
Get average gene expression data for a given data source from the local database.

Args:
    data_source: Data sources in local database (must be one of: {data_source_list})
    genes: Gene names. Can be either:
        - Gene name list (e.g., ['TP53'])
        - CSV file containing a list of gene names
        - The string "all" to return all genes

Returns:
    The average gene expression file.
"""
)
async def get_mean_express_data(
    data_source: str, genes: Optional[Union[List[str], str]] = "all"
) -> str:
    try:
        if not isinstance(data_source, str):
            return f"Error: Data source must be a string, got: {type(data_source).__name__}"

        if data_source not in exp_data_db:
            return f"Error: Data source '{data_source}' not found. Available: {data_source_list}"

        validated_genes = _validate_genes_input(genes)
        if isinstance(validated_genes, str) and validated_genes.startswith("Error:"):
            return validated_genes

        genes = validated_genes

        exp_file = exp_data_db[data_source]
        try:
            exp = pd.read_csv(exp_file, index_col=0)
        except Exception as e:
            return f"Error reading expression file: {_truncate_error(str(e))}"

        if genes == "all":
            exp_genes = exp
            genes_list = ["all"]
        else:
            if isinstance(genes, str):  # file path
                try:
                    genes_list = pd.read_csv(genes, header=None).iloc[:, 0].tolist()
                except Exception as e:
                    return f"Error reading genes file: {_truncate_error(str(e))}"
            else:  # list
                genes_list = genes

            exp_genes = exp[exp.index.map(lambda gene: gene in genes_list)]

            if exp_genes.empty:
                return f"Error: No expression data found for specified genes in {data_source}"

        md5_value = hashlib.md5(
            data_source.join(genes_list).encode("utf-8")
        ).hexdigest()
        exp_genes_path = f"{tmp_docker}/exp_genes_md5_{md5_value}.csv"
        try:
            exp_genes.to_csv(exp_genes_path)
        except Exception as e:
            return f"Error writing expression file: {_truncate_error(str(e))}"

        return exp_genes_path

    except Exception as e:
        return f"Error: {_truncate_error(str(e))}"


if __name__ == "__main__":
    try:
        mcp.run(transport="streamable-http", host="0.0.0.0", port=3001, path="/biotools")
    except Exception as e:
        print(f"Fatal error starting MCP server: {_truncate_error(str(e))}")
        exit(1)