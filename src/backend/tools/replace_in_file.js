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
    const prompt = `## replace_in_file  
Description: Precise file content replacement using SEARCH/REPLACE diffs  

Parameters:  
- file_path: Target file path (required)  
- diff: Replacement blocks in unified diff format (required):  
  \`\`\`  
  <<<<<<< SEARCH
  [original 1]
  =======  
  [new 1]
  >>>>>>> REPLACE
  <<<<<<< SEARCH
  [original 2]
  =======
  [new 2]
  >>>>>>> REPLACE
  \`\`\`  

Key Rules:  
✔ Exact match required (case/whitespace sensitive)  
✔ First-match only per block  
✔ Preserves original line endings  

Best Practices:  
- Include 2-3 context lines  
- Split large changes into multiple blocks  
- For deletions: leave REPLACE empty  

Usage:  
{
  "thinking": "[Thinking process]",
  "tool": "replace_in_file",
  "params": {
    "file_path": "/src/main.js",
    "diff": "<<<<<<< SEARCH\nconst API_URL = 'http://old.api';\n=======\nconst API_URL = 'https://new.api';\n>>>>>>> REPLACE"
  }
}`
    return prompt
}

// 保留原始导出部分
module.exports = {
    main, 
    getPrompt
};