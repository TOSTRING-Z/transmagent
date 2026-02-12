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
    return `## write_to_file

Description: Creates or overwrites a file with new content.
**Capabilities**: Automatically creates missing parent directories. Supports UTF-8.
**Critical Warning**: This action **completely replaces** existing file content. For partial edits, use 'replace_in_file'.

Parameters:
- file_path: (Required, String) Absolute path to the destination.
- content: (Required, String) The full text body. Preserve newlines and indentation.

### Usage

**1. Creating a Config File (Standard)**
<root>
  <thinking>Initializing the Docker setup with a docker-compose file.</thinking>
  <tool_call>
    <name>write_to_file</name>
    <parameters>
      <file_path>/app/docker-compose.yml</file_path>
      <content>
version: '3'
services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
      </content>
    </parameters>
  </tool_call>
</root>

**2. Overwriting with Empty Content (Clear File)**
<root>
  <thinking>Clearing the log file before starting a new run.</thinking>
  <tool_call>
    <name>write_to_file</name>
    <parameters>
      <file_path>/var/log/app.log</file_path>
      <content></content>
    </parameters>
  </tool_call>
</root>`;
}

module.exports = {
    main, getPrompt
};