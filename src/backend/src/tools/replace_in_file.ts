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
    } catch (error: any) {
        return `File ${file_path} modification failed: ${error.message}`;
    }
}

// 保留原始脚本中的getPrompt函数
function getPrompt() {
    return {
    "name": "replace_in_file",
    "description": "Precise file content replacement using SEARCH/REPLACE diffs",
    "parameters": {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Target file path (required)"
            },
            "diff": {
                "type": "string",
                "description": "Replacement blocks in unified diff format (required)"
            }
        },
        "required": [
            "file_path",
            "diff"
        ]
    }
};
}

// 保留原始导出部分
export {
    main, 
    getPrompt
};