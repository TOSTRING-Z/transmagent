const fs = require('fs');
const path = require('path');

async function main({ file_path, content }) {
    try {
        const dir = path.dirname(file_path);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        await fs.writeFileSync(file_path, content);
        return `File ${file_path} saved successfully`;
    } catch (error) {
        return `File ${file_path} save failed: ${error.message}`;
    }
}

function getPrompt() {
    const prompt = `## write_to_file

Description: Writes text content to files (UTF-8 only) with automatic path handling

Parameters:
- file_path: Absolute destination path (required)
- content: Text content to write (supports multiline)

Usage:
{
  "thinking": "[Thinking process]",
  "tool": "write_to_file",
  "params": {
    "file_path": "/path/to/file.txt",
    "content": "Text content\nwith formatting"
  }
}`
    return prompt
}

module.exports = {
    main, getPrompt
};