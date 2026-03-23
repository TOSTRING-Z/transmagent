"""
Pytest configuration file for biotools MCP server tests.

This file provides fixtures and configuration for all tests.
"""

import pytest
import pandas as pd
import sys
import os
from unittest.mock import Mock, patch

# Add the parent directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def mock_tr_data():
    """Fixture for mock TR data."""
    return {
        'TR1': '/data/trapt/TR_bed/TR1.bed',
        'TR2': '/data/trapt/TR_bed/TR2.bed',
        'TR3': '/data/trapt/TR_bed/TR3.bed'
    }


@pytest.fixture
def mock_tr_info_df():
    """Fixture for mock TR info dataframe."""
    return pd.DataFrame({
        'tr': ['TR1', 'TR2', 'TR3'],
        'tr_base': ['Base1', 'Base2', 'Base3'],
        'Sample ID': ['Sample1', 'Sample2', 'Sample3'],
        'Biosample Type': ['Cell line', 'Tissue', 'Organoid'],
        'Biosample Name': ['K562', 'Brain', 'Liver'],
        'Source': ['ENCODE', 'Roadmap', 'GEO'],
        'File Accession': ['ENCFF001', 'ENCFF002', 'ENCFF003']
    })


@pytest.fixture
def mock_h3k27ac_data():
    """Fixture for mock H3K27ac data."""
    return {
        'H3K27ac_1': '/data/sedb/bed/H3K27ac_1.bed',
        'H3K27ac_2': '/data/sedb/bed/H3K27ac_2.bed',
        'H3K27ac_3': '/data/sedb/bed/H3K27ac_3.bed'
    }


@pytest.fixture
def mock_h3k27ac_info_df():
    """Fixture for mock H3K27ac info dataframe."""
    return pd.DataFrame({
        'Sample ID': ['H3K27ac_1', 'H3K27ac_2', 'H3K27ac_3'],
        'Species': ['Human', 'Human', 'Mouse'],
        'Data source': ['ENCODE', 'Roadmap', 'GEO'],
        'Biosample type': ['Cell line', 'Tissue', 'Cell line'],
        'Tissue type': ['Blood', 'Brain', 'Liver'],
        'Biosample name': ['K562', 'Brain', 'HepG2']
    })


@pytest.fixture
def mock_erna_data():
    """Fixture for mock eRNA data."""
    return {
        'ERNA_1': '/data/ernabase/bed/ERNA_1.bed',
        'ERNA_2': '/data/ernabase/bed/ERNA_2.bed',
        'ERNA_3': '/data/ernabase/bed/ERNA_3.bed'
    }


@pytest.fixture
def mock_erna_info_df():
    """Fixture for mock eRNA info dataframe."""
    return pd.DataFrame({
        'sample_id': ['ERNA_1', 'ERNA_2', 'ERNA_3'],
        'biosample_type': ['Cell line', 'Tissue', 'Organoid'],
        'biosample_name': ['K562', 'Brain', 'Liver'],
        'tissue_type': ['Blood', 'Brain', 'Liver'],
        'cell type': ['Leukemia', 'Neuron', 'Hepatocyte'],
        'cancer_or_disease_or_normal': ['Cancer', 'Normal', 'Disease'],
        'cancer_or_disease_type': ['Leukemia', 'None', 'Cirrhosis'],
        'species': ['Human', 'Human', 'Mouse']
    })


@pytest.fixture
def mock_atac_data():
    """Fixture for mock ATAC-seq data."""
    return {
        'ATAC_1': '/data/atacdb/bed/ATAC_1.bed',
        'ATAC_2': '/data/atacdb/bed/ATAC_2.bed',
        'ATAC_3': '/data/atacdb/bed/ATAC_3.bed'
    }


@pytest.fixture
def mock_atac_info_df():
    """Fixture for mock ATAC-seq info dataframe."""
    return pd.DataFrame({
        'sample_id': ['ATAC_1', 'ATAC_2', 'ATAC_3'],
        'biosample_type': ['Cell line', 'Tissue', 'Organoid'],
        'biosample_name': ['K562', 'Brain', 'Liver'],
        'tissue_type': ['Blood', 'Brain', 'Liver'],
        'cell type': ['Leukemia', 'Neuron', 'Hepatocyte'],
        'cancer_or_disease_or_normal': ['Cancer', 'Normal', 'Disease'],
        'cancer_or_disease_type': ['Leukemia', 'None', 'Cirrhosis'],
        'species': ['Human', 'Human', 'Mouse']
    })


@pytest.fixture
def mock_atac_pseudo_data():
    """Fixture for mock pseudo-bulk ATAC-seq data."""
    return {
        'ATAC_Pseudo_1': '/data/atacdb/bed/pseudo/ATAC_Pseudo_1.bed',
        'ATAC_Pseudo_2': '/data/atacdb/bed/pseudo/ATAC_Pseudo_2.bed'
    }


@pytest.fixture
def mock_atac_pseudo_info_df():
    """Fixture for mock pseudo-bulk ATAC-seq info dataframe."""
    return pd.DataFrame({
        'sample_id': ['ATAC_Pseudo_1', 'ATAC_Pseudo_2'],
        'biosample_type': ['Cell line', 'Tissue'],
        'biosample_name': ['K562', 'Brain'],
        'tissue_type': ['Blood', 'Brain'],
        'cell type': ['Leukemia', 'Neuron'],
        'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
        'cancer_or_disease_type': ['Leukemia', 'None'],
        'species': ['Human', 'Mouse']
    })