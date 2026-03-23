#!/usr/bin/env python3
"""
Integration tests for the biotools MCP server.

These tests verify that the search functions work correctly with mocked data.
"""

import pytest
import pandas as pd
import sys
import os
from unittest.mock import patch

# Add the parent directory to the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server import (
    search_tr,
    search_h3k27ac,
    search_erna,
    search_atac,
    _truncate_error
)


class TestSearchIntegration:
    """Integration tests for search functions."""
    
    @pytest.mark.asyncio
    async def test_search_tr_integration(self, mock_tr_data, mock_tr_info_df):
        """Test search_tr integration with mocked data."""
        with patch('server.tr_data_db', mock_tr_data), \
             patch('server.tr_info_df', mock_tr_info_df):
            
            # Test single keyword search
            result = await search_tr("TR1")
            assert "Found" in result
            assert "TR1" in result
            assert "/data/trapt/TR_bed/TR1.bed" in result
            
            # Test multi-term search
            result = await search_tr("K562+Cell line")
            assert "Found" in result
            assert "TR1" in result
            
            # Test no matches
            result = await search_tr("Nonexistent")
            assert "No matching TR found" in result
    
    @pytest.mark.asyncio
    async def test_search_h3k27ac_integration(self, mock_h3k27ac_data, mock_h3k27ac_info_df):
        """Test search_h3k27ac integration with mocked data."""
        with patch('server.h3k27ac_data_db', mock_h3k27ac_data), \
             patch('server.h3k27ac_info_df', mock_h3k27ac_info_df):
            
            # Test single keyword search
            result = await search_h3k27ac("K562")
            assert "Found" in result
            assert "H3K27ac_1" in result
            assert "/data/sedb/bed/H3K27ac_1.bed" in result
            
            # Test multi-term search
            result = await search_h3k27ac("Human+Cell line")
            assert "Found" in result
            # Should find H3K27ac_1 and H3K27ac_3
            assert "H3K27ac_1" in result or "H3K27ac_3" in result
            
            # Test tissue search
            result = await search_h3k27ac("Brain")
            assert "Found" in result
            assert "H3K27ac_2" in result
    
    @pytest.mark.asyncio
    async def test_search_erna_integration(self, mock_erna_data, mock_erna_info_df):
        """Test search_erna integration with mocked data."""
        with patch('server.erna_data_db', mock_erna_data), \
             patch('server.erna_info_df', mock_erna_info_df):
            
            # Test single keyword search
            result = await search_erna("K562")
            assert "Found" in result
            assert "ERNA_1" in result
            assert "/data/ernabase/bed/ERNA_1.bed" in result
            
            # Test multi-term search
            result = await search_erna("Human+Cancer")
            assert "Found" in result
            assert "ERNA_1" in result
            
            # Test disease type search
            result = await search_erna("Leukemia")
            assert "Found" in result
            assert "ERNA_1" in result
    
    @pytest.mark.asyncio
    async def test_search_atac_integration(self, mock_atac_data, mock_atac_info_df, 
                                          mock_atac_pseudo_data, mock_atac_pseudo_info_df):
        """Test search_atac integration with mocked data."""
        with patch('server.atac_data_db', mock_atac_data), \
             patch('server.atac_info_df', mock_atac_info_df), \
             patch('server.atac_pseudo_data_db', mock_atac_pseudo_data), \
             patch('server.atac_pseudo_info_df', mock_atac_pseudo_info_df):
            
            # Test single keyword search (should search both regular and pseudo-bulk)
            result = await search_atac("K562")
            assert "Found" in result
            # Should find ATAC_1 and ATAC_Pseudo_1
            assert "ATAC_1" in result or "ATAC_Pseudo_1" in result
            
            # Test multi-term search
            result = await search_atac("Human+Cancer")
            assert "Found" in result
            # Should find ATAC_1 and ATAC_Pseudo_1
            
            # Test species search
            result = await search_atac("Mouse")
            assert "Found" in result
            # Should find ATAC_3 and ATAC_Pseudo_2
    
    @pytest.mark.asyncio
    async def test_search_functions_error_handling(self):
        """Test error handling in search functions."""
        # Test empty keyword
        result = await search_tr("")
        assert "Error: Keyword cannot be empty" in result
        
        result = await search_h3k27ac("   ")
        assert "Error: Keyword cannot be empty" in result
        
        result = await search_erna("")
        assert "Error: Keyword cannot be empty" in result
        
        result = await search_atac("   ")
        assert "Error: Keyword cannot be empty" in result
        
        # Test with None metadata
        with patch('server.h3k27ac_info_df', None):
            result = await search_h3k27ac("test")
            assert "Error: H3K27ac info metadata not loaded" in result
        
        with patch('server.erna_info_df', None):
            result = await search_erna("test")
            assert "Error: eRNA info metadata not loaded" in result
    
    @pytest.mark.asyncio
    async def test_search_output_format(self, mock_tr_data, mock_tr_info_df):
        """Test that search output format is consistent."""
        with patch('server.tr_data_db', mock_tr_data), \
             patch('server.tr_info_df', mock_tr_info_df):
            
            result = await search_tr("TR")
            # Should start with "Found X matching"
            assert result.startswith("Found")
            # Should contain sample: path format
            assert "TR1: /data/trapt/TR_bed/TR1.bed" in result or "TR1:/data/trapt/TR_bed/TR1.bed" in result
            
            # Test that output is limited to 20 matches
            # Create many mock TRs
            many_trs = {f'TR{i}': f'/path/to/TR{i}.bed' for i in range(30)}
            with patch('server.tr_data_db', many_trs):
                result = await search_tr("TR")
                assert "... and 10 more matches" in result


def test_truncate_error_function():
    """Test the _truncate_error helper function."""
    # Test normal truncation
    long_msg = "A" * 300
    truncated = _truncate_error(long_msg)
    assert len(truncated) <= 203  # 200 + "..."
    assert truncated.endswith("...")
    
    # Test short message
    short_msg = "Short error"
    assert _truncate_error(short_msg) == short_msg
    
    # Test edge cases
    assert _truncate_error("") == ""
    # Test with non-string input
    assert _truncate_error(None) == "Error message too long or invalid"


if __name__ == "__main__":
    # Simple test runner
    import asyncio
    
    async def run_integration_tests():
        """Run integration tests manually."""
        print("Running integration tests...")
        
        # Test truncate error
        test_truncate_error_function()
        print("✓ truncate_error tests passed")
        
        # Note: Full integration tests require pytest fixtures
        print("\nTo run all tests, use: pytest test_integration.py -v")
    
    asyncio.run(run_integration_tests())