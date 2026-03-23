#!/usr/bin/env python3
"""
Unit tests for the search functions in the biotools MCP server.

This module tests the following search functions:
- search_tr: Search for tandem repeat samples
- search_h3k27ac: Search for H3K27ac super-enhancer samples
- search_erna: Search for eRNA samples
- search_atac: Search for ATAC-seq samples
"""

import pytest
import pandas as pd
import sys
import os
from unittest.mock import Mock, patch, MagicMock

# Add the parent directory to the path to import server module
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import (
    search_tr,
    search_h3k27ac,
    search_erna,
    search_atac,
    _truncate_error
)


class TestHelperFunctions:
    """Test helper functions."""
    
    def test_truncate_error(self):
        """Test error message truncation."""
        # Test short message
        short_msg = "Short error"
        assert _truncate_error(short_msg) == short_msg
        
        # Test long message
        long_msg = "A" * 300
        truncated = _truncate_error(long_msg)
        assert len(truncated) <= 200 + 3  # 200 chars + "..."
        assert truncated.endswith("...")
        
        # Test edge cases
        assert _truncate_error("") == ""
        assert _truncate_error(None) == "Error message too long or invalid"


class TestSearchTR:
    """Test search_tr function."""
    
    @pytest.mark.asyncio
    async def test_search_tr_empty_keyword(self):
        """Test search_tr with empty keyword."""
        result = await search_tr("")
        assert "Error: Keyword cannot be empty" in result
        
        result = await search_tr("   ")
        assert "Error: Keyword cannot be empty" in result
    
    @pytest.mark.asyncio
    async def test_search_tr_single_keyword(self):
        """Test search_tr with single keyword."""
        # Mock the global variables
        with patch('server.tr_data_db', {'TR1': '/path/to/TR1.bed', 'TR2': '/path/to/TR2.bed'}):
            result = await search_tr("TR1")
            assert "Found" in result
            assert "TR1" in result
    
    @pytest.mark.asyncio
    async def test_search_tr_multi_term(self):
        """Test search_tr with multi-term keyword."""
        # Create a mock dataframe
        mock_df = pd.DataFrame({
            'tr': ['TR1', 'TR2', 'TR3'],
            'tr_base': ['Base1', 'Base2', 'Base3'],
            'Sample ID': ['Sample1', 'Sample2', 'Sample3'],
            'Biosample Type': ['Type1', 'Type2', 'Type3'],
            'Biosample Name': ['Name1', 'Name2', 'Name3'],
            'Source': ['Source1', 'Source2', 'Source3'],
            'File Accession': ['ACC1', 'ACC2', 'ACC3']
        })
        
        with patch('server.tr_info_df', mock_df), \
             patch('server.tr_data_db', {'TR1': '/path/to/TR1.bed', 'TR2': '/path/to/TR2.bed'}):
            result = await search_tr("Sample1+Type1")
            assert "Found" in result
            assert "TR1" in result
    
    @pytest.mark.asyncio
    async def test_search_tr_no_matches(self):
        """Test search_tr with no matches."""
        with patch('server.tr_data_db', {'TR1': '/path/to/TR1.bed'}):
            result = await search_tr("Nonexistent")
            assert "No matching TR found" in result


class TestSearchH3K27ac:
    """Test search_h3k27ac function."""
    
    @pytest.mark.asyncio
    async def test_search_h3k27ac_empty_keyword(self):
        """Test search_h3k27ac with empty keyword."""
        result = await search_h3k27ac("")
        assert "Error: Keyword cannot be empty" in result
    
    @pytest.mark.asyncio
    async def test_search_h3k27ac_single_keyword(self):
        """Test search_h3k27ac with single keyword."""
        # Create a mock dataframe
        mock_df = pd.DataFrame({
            'Sample ID': ['H3K27ac_1', 'H3K27ac_2'],
            'Species': ['Human', 'Mouse'],
            'Data source': ['Source1', 'Source2'],
            'Biosample type': ['Cell line', 'Tissue'],
            'Tissue type': ['Blood', 'Brain'],
            'Biosample name': ['K562', 'Brain']
        })
        
        with patch('server.h3k27ac_info_df', mock_df), \
             patch('server.h3k27ac_data_db', {'H3K27ac_1': '/path/to/H3K27ac_1.bed'}):
            result = await search_h3k27ac("K562")
            assert "Found" in result
            assert "H3K27ac_1" in result
    
    @pytest.mark.asyncio
    async def test_search_h3k27ac_multi_term(self):
        """Test search_h3k27ac with multi-term keyword."""
        mock_df = pd.DataFrame({
            'Sample ID': ['H3K27ac_1', 'H3K27ac_2'],
            'Species': ['Human', 'Mouse'],
            'Data source': ['Source1', 'Source2'],
            'Biosample type': ['Cell line', 'Tissue'],
            'Tissue type': ['Blood', 'Brain'],
            'Biosample name': ['K562', 'Brain']
        })
        
        with patch('server.h3k27ac_info_df', mock_df), \
             patch('server.h3k27ac_data_db', {'H3K27ac_1': '/path/to/H3K27ac_1.bed', 'H3K27ac_2': '/path/to/H3K27ac_2.bed'}):
            result = await search_h3k27ac("Human+Cell line")
            assert "Found" in result
            assert "H3K27ac_1" in result
    
    @pytest.mark.asyncio
    async def test_search_h3k27ac_metadata_not_loaded(self):
        """Test search_h3k27ac when metadata is not loaded."""
        with patch('server.h3k27ac_info_df', None):
            result = await search_h3k27ac("test")
            assert "Error: H3K27ac info metadata not loaded" in result


class TestSearchERNA:
    """Test search_erna function."""
    
    @pytest.mark.asyncio
    async def test_search_erna_empty_keyword(self):
        """Test search_erna with empty keyword."""
        result = await search_erna("")
        assert "Error: Keyword cannot be empty" in result
    
    @pytest.mark.asyncio
    async def test_search_erna_single_keyword(self):
        """Test search_erna with single keyword."""
        mock_df = pd.DataFrame({
            'sample_id': ['ERNA_1', 'ERNA_2'],
            'biosample_type': ['Cell line', 'Tissue'],
            'biosample_name': ['K562', 'Brain'],
            'tissue_type': ['Blood', 'Brain'],
            'cell type': ['Leukemia', 'Neuron'],
            'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
            'cancer_or_disease_type': ['Leukemia', 'None'],
            'species': ['Human', 'Mouse']
        })
        
        with patch('server.erna_info_df', mock_df), \
             patch('server.erna_data_db', {'ERNA_1': '/path/to/ERNA_1.bed'}):
            result = await search_erna("K562")
            assert "Found" in result
            assert "ERNA_1" in result
    
    @pytest.mark.asyncio
    async def test_search_erna_multi_term(self):
        """Test search_erna with multi-term keyword."""
        mock_df = pd.DataFrame({
            'sample_id': ['ERNA_1', 'ERNA_2'],
            'biosample_type': ['Cell line', 'Tissue'],
            'biosample_name': ['K562', 'Brain'],
            'tissue_type': ['Blood', 'Brain'],
            'cell type': ['Leukemia', 'Neuron'],
            'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
            'cancer_or_disease_type': ['Leukemia', 'None'],
            'species': ['Human', 'Mouse']
        })
        
        with patch('server.erna_info_df', mock_df), \
             patch('server.erna_data_db', {'ERNA_1': '/path/to/ERNA_1.bed', 'ERNA_2': '/path/to/ERNA_2.bed'}):
            result = await search_erna("Human+Cancer")
            assert "Found" in result
            assert "ERNA_1" in result
    
    @pytest.mark.asyncio
    async def test_search_erna_metadata_not_loaded(self):
        """Test search_erna when metadata is not loaded."""
        with patch('server.erna_info_df', None):
            result = await search_erna("test")
            assert "Error: eRNA info metadata not loaded" in result


class TestSearchATAC:
    """Test search_atac function."""
    
    @pytest.mark.asyncio
    async def test_search_atac_empty_keyword(self):
        """Test search_atac with empty keyword."""
        result = await search_atac("")
        assert "Error: Keyword cannot be empty" in result
    
    @pytest.mark.asyncio
    async def test_search_atac_single_keyword(self):
        """Test search_atac with single keyword."""
        # Mock regular ATAC-seq data
        mock_atac_df = pd.DataFrame({
            'sample_id': ['ATAC_1', 'ATAC_2'],
            'biosample_type': ['Cell line', 'Tissue'],
            'biosample_name': ['K562', 'Brain'],
            'tissue_type': ['Blood', 'Brain'],
            'cell type': ['Leukemia', 'Neuron'],
            'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
            'cancer_or_disease_type': ['Leukemia', 'None'],
            'species': ['Human', 'Mouse']
        })
        
        # Mock pseudo-bulk ATAC-seq data
        mock_atac_pseudo_df = pd.DataFrame({
            'sample_id': ['ATAC_Pseudo_1', 'ATAC_Pseudo_2'],
            'biosample_type': ['Cell line', 'Tissue'],
            'biosample_name': ['K562', 'Brain'],
            'tissue_type': ['Blood', 'Brain'],
            'cell type': ['Leukemia', 'Neuron'],
            'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
            'cancer_or_disease_type': ['Leukemia', 'None'],
            'species': ['Human', 'Mouse']
        })
        
        with patch('server.atac_info_df', mock_atac_df), \
             patch('server.atac_pseudo_info_df', mock_atac_pseudo_df), \
             patch('server.atac_data_db', {'ATAC_1': '/path/to/ATAC_1.bed'}), \
             patch('server.atac_pseudo_data_db', {'ATAC_Pseudo_1': '/path/to/ATAC_Pseudo_1.bed'}):
            result = await search_atac("K562")
            assert "Found" in result
            # Should find both regular and pseudo-bulk samples
            assert "ATAC_1" in result or "ATAC_Pseudo_1" in result
    
    @pytest.mark.asyncio
    async def test_search_atac_multi_term(self):
        """Test search_atac with multi-term keyword."""
        mock_atac_df = pd.DataFrame({
            'sample_id': ['ATAC_1', 'ATAC_2'],
            'biosample_type': ['Cell line', 'Tissue'],
            'biosample_name': ['K562', 'Brain'],
            'tissue_type': ['Blood', 'Brain'],
            'cell type': ['Leukemia', 'Neuron'],
            'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
            'cancer_or_disease_type': ['Leukemia', 'None'],
            'species': ['Human', 'Mouse']
        })
        
        mock_atac_pseudo_df = pd.DataFrame({
            'sample_id': ['ATAC_Pseudo_1', 'ATAC_Pseudo_2'],
            'biosample_type': ['Cell line', 'Tissue'],
            'biosample_name': ['K562', 'Brain'],
            'tissue_type': ['Blood', 'Brain'],
            'cell type': ['Leukemia', 'Neuron'],
            'cancer_or_disease_or_normal': ['Cancer', 'Normal'],
            'cancer_or_disease_type': ['Leukemia', 'None'],
            'species': ['Human', 'Mouse']
        })
        
        with patch('server.atac_info_df', mock_atac_df), \
             patch('server.atac_pseudo_info_df', mock_atac_pseudo_df), \
             patch('server.atac_data_db', {'ATAC_1': '/path/to/ATAC_1.bed'}), \
             patch('server.atac_pseudo_data_db', {'ATAC_Pseudo_1': '/path/to/ATAC_Pseudo_1.bed'}):
            result = await search_atac("Human+Cancer")
            assert "Found" in result
            # Should find samples matching both terms
    
    @pytest.mark.asyncio
    async def test_search_atac_no_matches(self):
        """Test search_atac with no matches."""
        mock_atac_df = pd.DataFrame({
            'sample_id': ['ATAC_1'],
            'biosample_type': ['Cell line'],
            'biosample_name': ['K562'],
            'tissue_type': ['Blood'],
            'cell type': ['Leukemia'],
            'cancer_or_disease_or_normal': ['Cancer'],
            'cancer_or_disease_type': ['Leukemia'],
            'species': ['Human']
        })
        
        with patch('server.atac_info_df', mock_atac_df), \
             patch('server.atac_data_db', {'ATAC_1': '/path/to/ATAC_1.bed'}):
            result = await search_atac("Nonexistent")
            assert "No matching ATAC-seq samples found" in result


if __name__ == "__main__":
    # Run tests
    import asyncio
    
    async def run_tests():
        # Test helper functions
        helper = TestHelperFunctions()
        helper.test_truncate_error()
        print("✓ Helper functions passed")
        
        # Note: The actual async tests would need pytest to run properly
        print("\nTo run all tests, use: pytest test_search_functions.py -v")
    
    asyncio.run(run_tests())