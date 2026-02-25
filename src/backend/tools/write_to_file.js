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
    return {
    "name": "write_to_file",
    "description": "Writes text content to files (UTF-8 only) with automatic path handling",
    "parameters": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Absolute destination path (required)"
            },
            "content": {
                "type": "string",
                "description": "Text content to write (supports multiline)"
            }
        },
        "required": [
            "file_path"
        ]
    }
};
}

module.exports = {
    main, getPrompt
};