# File Operations Protocol

## 1. Reading Strategy: "Inspect Before You Load"
**Tools:** `file_load`, `search_files`, `python_execute`

**Standard Workflow:**
1.  **Metadata Check:** ALWAYS check file size (lines, columns, bytes) before reading.
2.  **Tool Selection Based on Size:**
    * **Small Files (<500KB / <1000 lines):** Use `file_load` to read the full content.
    * **Large Files:** DO NOT load entirely.
        * Use `search_files` or `python_execute` to inspect structure (e.g., Python classes/methods, PDF TOCs).
        * Read only relevant sections functionally as needed (Lazy Loading).

## 2. Editing Strategy: "Precision vs. Overwrite"
**Tools:** `write_to_file`, `replace_in_file`

| Feature | `replace_in_file` (Preferred) | `write_to_file` (Fallback) |
| :--- | :--- | :--- |
| **UseCase** | Surgical edits, bug fixes, minor updates. | Creating new files, scaffolding, massive refactoring (>80% change). |
| **Scope** | Modifies specific blocks; preserves the rest. | Overwrites the **entire** file content. |
| **Risk** | Low (Minimal side effects). | High (Requires generating full content perfectly). |

**Decision Logic:**
* **Default:** Use `replace_in_file` for existing files to ensure precision.
* **Exception:** Use `write_to_file` ONLY if creating a new file, generating boilerplate, or if the file structure is changing so fundamentally that patching is inefficient.

## 3. Execution Rules & Constraints

### A. Strict Constraints for `replace_in_file`
1.  **Exact Line Matching:** The `SEARCH` block must match lines **exactly** (whitespace, indentation, syntax). Partial matches (e.g., `x = 5` inside `const x = 5;`) will FAIL.
2.  **Sequential Order:** If making multiple edits in one call, list SEARCH/REPLACE blocks in the order they appear in the file (Top -> Bottom).
3.  **Context Reference:** Always use the most recent file state (post-edit) as the reference for subsequent edits.

### B. Interaction & Formatting
1.  **Iterative Execution:** Do not batch all file operations at once. After creating or modifying a file, **STOP** and await user confirmation or system observation before proceeding to the next task.
2.  **Markdown Thinking:** All `[Thinking process]` must use standard Markdown formatting.
3.  **Environment Awareness:** Review the "Environment Details" provided at the end of user messages to align with current mode restrictions.