---
name: data-cleaner
description: Specialized in cleaning and preprocessing CSV/TSV data files.
allowed-tools: python_execute, list_files, display_file
---
# Data Cleaner Skill
## Instructions
1. Always check the file encoding before reading.
2. Handle missing values by either removing the row or imputing with the mean (for numeric) or mode (for categorical).
3. Standardize column names to lowercase and replace spaces with underscores.
