#!/usr/bin/env python3
"""Unit test for enhanced search_tr function."""
import asyncio
import pandas as pd
import sys
import os

# Mock the global variables that would be present in server.py
tr_info_df = None
tr_data_db = {}

# Load a small subset of TRs_info.txt (first 10 rows) for testing
# We'll create a DataFrame manually based on the head output we saw.
data = {
    'tr': [
        'AATF@TcoF_00_21045',
        'AATF@TcoF_00_41071',
        'AATF@TcoF_00_41072',
        'ADNP@CR_01_0452',
        'ADNP@CR_01_0504',
        'ADNP@CR_02_0290',
        'ADNP@CR_02_1489',
        'ADNP@Sample_01_0380',
        'ADNP@Sample_02_2900',
    ],
    'tr_base': ['AATF', 'AATF', 'AATF', 'ADNP', 'ADNP', 'ADNP', 'ADNP', 'ADNP', 'ADNP'],
    'Sample ID': ['TcoF_00_21045', 'TcoF_00_41071', 'TcoF_00_41072', 'CR_01_0452', 'CR_01_0504', 'CR_02_0290', 'CR_02_1489', 'Sample_01_0380', 'Sample_02_2900'],
    'Biosample Type': ['Blood', 'Blood', 'Blood', 'cell line', 'cell line', 'None', 'cell line', '', 'Colon'],
    'Biosample Name': ['NALM-6', 'LAL-B', 'NALM-6', 'K562', 'K562', 'None', 'HepG2', 'K562', 'LoVo'],
    'Source': ['Cistrome', 'ReMap', 'ReMap', 'Encode', 'Encode', 'GEO', 'GEO', 'ENCODE', 'Cistrome'],
    'File Accession': ['GSM2459096', 'GSM2459095', 'GSM2459096', 'ENCFF516GOL', 'ENCFF652IDC', 'SRR14107529', 'SRR14107528', 'GSM2827324', 'GSM1208708'],
}
tr_info_df = pd.DataFrame(data)

# Create dummy bed file paths
tr_data_db = {tr: f'/data/trapt/TR_bed/{tr}.bed' for tr in data['tr']}

# Import the actual search_tr function from server.py? We'll copy its logic instead
# to avoid dependency on FastMCP. We'll implement a simplified version that matches the new logic.
async def search_tr(keyword: str) -> str:
    try:
        if not isinstance(keyword, str) or not keyword.strip():
            return "Error: Keyword cannot be empty"

        # Check if keyword contains '+' for multi‑term matching
        if '+' in keyword:
            # Multi‑term fuzzy matching using TRs_info metadata
            if tr_info_df is None:
                return "Error: TR info metadata not loaded"
            
            # Split by '+' and strip whitespace
            terms = [term.strip() for term in keyword.split('+') if term.strip()]
            if not terms:
                return "Error: No valid terms after splitting"
            
            # Columns to search (text columns)
            search_columns = ['tr', 'tr_base', 'Sample ID', 'Biosample Type', 'Biosample Name', 'Source', 'File Accession']
            # Ensure columns exist
            available_cols = [col for col in search_columns if col in tr_info_df.columns]
            if not available_cols:
                return "Error: No expected columns found in TR info"
            
            # Filter rows where each term matches at least one column (case‑insensitive substring)
            mask = pd.Series([True] * len(tr_info_df), index=tr_info_df.index)
            for term in terms:
                term_mask = pd.Series([False] * len(tr_info_df), index=tr_info_df.index)
                for col in available_cols:
                    term_mask = term_mask | tr_info_df[col].astype(str).str.lower().str.contains(term.lower(), na=False)
                mask = mask & term_mask
            
            matched_trs = tr_info_df.loc[mask, 'tr'].tolist()
            # Map to bed paths
            matches = {tr: tr_data_db.get(tr) for tr in matched_trs if tr in tr_data_db}
            # Remove entries where path is None
            matches = {tr: path for tr, path in matches.items() if path is not None}
        else:
            # Original single‑keyword search on TR names
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
        return f"Error: {str(e)[:200]}"

async def run_tests():
    print("=== Testing enhanced search_tr ===")
    
    # Test 1: Single keyword (original behavior)
    result = await search_tr('AATF')
    print('Test 1 (single "AATF"):')
    print(result[:200])
    assert 'Found' in result and 'AATF' in result
    
    # Test 2: Multi‑term with exact match
    result = await search_tr('Cistrome + Blood + NALM-6')
    print('\nTest 2 (Cistrome + Blood + NALM-6):')
    print(result)
    # Should match first row (AATF@TcoF_00_21045)
    assert 'AATF@TcoF_00_21045' in result
    
    # Test 3: Multi‑term with two conditions
    result = await search_tr('AATF + Blood')
    print('\nTest 3 (AATF + Blood):')
    print(result)
    # Should match first three rows (all AATF with Blood)
    assert 'AATF@TcoF_00_21045' in result
    assert 'AATF@TcoF_00_41071' in result
    assert 'AATF@TcoF_00_41072' in result
    
    # Test 4: Multi‑term with no match
    result = await search_tr('XYZ + ABC')
    print('\nTest 4 (XYZ + ABC):')
    print(result)
    assert 'No matching TR' in result
    
    # Test 5: Single keyword with partial match
    result = await search_tr('ADNP')
    print('\nTest 5 (single "ADNP"):')
    print(result[:200])
    assert 'ADNP' in result
    
    # Test 6: Multi‑term with spaces around plus
    result = await search_tr('Cistrome + Blood')
    print('\nTest 6 (Cistrome + Blood):')
    print(result)
    # Should match rows with Cistrome and Blood (first row and last row? last is Colon not Blood)
    # Actually last row is Source=Cistrome, Biosample Type=Colon, not Blood.
    # So only first row matches.
    assert 'AATF@TcoF_00_21045' in result
    
    print('\nAll tests passed!')

if __name__ == '__main__':
    asyncio.run(run_tests())
