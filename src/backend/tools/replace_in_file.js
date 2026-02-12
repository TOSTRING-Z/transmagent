const fs = require('fs');

function main({ file_path, diff }) {
    try {
        // 新改进的函数实现
        const originalContent = fs.readFileSync(file_path, 'utf8');
        let content = originalContent;
        
        // 更健壮的块分割处理
        const blocks = diff.split(/<<<<<<< SEARCH/g);
        blocks.shift(); // 移除第一个空元素
        
        blocks.forEach(block => {
            const [search, replaceBlock] = block.split(/=======/);
            const searchContent = search.trim();
            const replaceContent = replaceBlock.split(/>>>>>>> REPLACE/)[0].trim();
            
            // 更精确的内容匹配
            if (!content.includes(searchContent)) {
                throw new Error(`Search content not found: "${searchContent.replace(/\n/g, '\\n')}"`);
            }
            
            content = content.replace(searchContent, replaceContent);
        });
        
        if (content === originalContent) {
            return `File ${file_path} not modified: The content in SEARCH block may not exactly match the actual content in the file`;
        }
        
        fs.writeFileSync(file_path, content);
        return `File ${file_path} modified successfully`;
    } catch (error) {
        return `File ${file_path} modification failed: ${error.message}`;
    }
}

// 保留原始脚本中的getPrompt函数
function getPrompt() {
    return `## replace_in_file

Description: Surgical file editor using exact string matching.
**Mechanism**: Locates text via \`SEARCH\` block and swaps it with \`REPLACE\` block.
**Critical Rules**:
1. **Exact Match**: Whitespace and indentation in \`SEARCH\` must match the file *exactly*.
2. **Context**: Include 1-2 lines of surrounding code to ensure uniqueness.
3. **Multiple Edits**: You can stack multiple SEARCH/REPLACE blocks in one call.

Parameters:
- file_path: (Required) Absolute path.
- diff: (Required) The change block(s). Format:
  \`\`\`
  <<<<<<< SEARCH
  [Original Code with Context]
  =======
  [New Code]
  >>>>>>> REPLACE
  \`\`\`

### Usage

**1. Modifying Code (Standard)**
<root>
  <thinking>Updating the API endpoint and adding a timeout parameter.</thinking>
  <tool_call>
    <name>replace_in_file</name>
    <parameters>
      <file_path>/src/config.js</file_path>
      <diff>
<<<<<<< SEARCH
    const API_URL = 'http://old.example.com';
    const TIMEOUT = 1000;
=======
    const API_URL = 'https://new.example.com';
    const TIMEOUT = 5000;
>>>>>>> REPLACE
      </diff>
    </parameters>
  </tool_call>
</root>

**2. Deleting Code (Empty Replace)**
<root>
  <thinking>Removing the deprecated logging function.</thinking>
  <tool_call>
    <name>replace_in_file</name>
    <parameters>
      <file_path>/src/utils.js</file_path>
      <diff>
<<<<<<< SEARCH
function oldLog(msg) {
    console.log("DEPRECATED: " + msg);
}
=======
>>>>>>> REPLACE
      </diff>
    </parameters>
  </tool_call>
</root>`;
}

// 保留原始导出部分
module.exports = {
    main, 
    getPrompt
};