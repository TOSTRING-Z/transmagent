const fs = require('fs');
const path_ = require('path');

// 动态处理 glob 导入
let globFunction;
try {
  // 尝试新版本的 glob
  const globModule = require('glob');
  globFunction = globModule.glob || globModule;
} catch {
  throw new Error('Failed to import glob module');
}

async function main({ path, regex="test$", file_pattern="*.js" }) {
  try {
    // Find all files matching the pattern using glob
    const files = await globFunction(file_pattern, { 
      cwd: path, 
      nodir: true, 
      absolute: true 
    });
    
    if (!Array.isArray(files) || files.length === 0) {
      throw new Error('No files found matching the pattern');
    }
    
    // Initialize results array and compile regex
    const results = [];
    const regexObj = new RegExp(regex, 'g');

    for (const file of files) {
      // Read file content and search for regex matches
      const content = fs.readFileSync(file, 'utf8');
      let match;
      while ((match = regexObj.exec(content)) !== null) {
        const start = Math.max(0, match.index - 10);
        const end = Math.min(content.length, match.index + match[0].length + 10);
        const context = content.substring(start, end);
        results.push({
          file: path_.relative(path, file),
          match: match[0],
          context: context,
          line: (content.substring(0, match.index).match(/\n/g) || []).length + 1
        });
      }
    }

    // Return array of match results
    return results.slice(0,100);
  } catch (error) {
    console.log(error);
    return error.message;
  }
}


function getPrompt() {
  return `## search_files

Description: Grep-like tool to search *text content* within files.
**Crucial Distinction**: Use \`regex\` to match content inside files, and \`file_pattern\` to filter filenames.
**Performance Tip**: Always restrict \`file_pattern\` (e.g., "**/*.ts") rather than scanning everything ("**/*").

Parameters:
- path: (Required, String) Root directory for the search.
- regex: (Required, String) Regular Expression for content matching.
- file_pattern: (Optional, String) Glob pattern for filename filtering (Default: "*.js").

### Usage

**1. Code Definition Search (Specific Extension)**
<root>
  <thinking>Locating the 'AuthService' class definition in TypeScript files.</thinking>
  <tool_call>
    <name>search_files</name>
    <parameters>
      <path>/app/src</path>
      <regex>class AuthService</regex>
      <file_pattern>**/*.ts</file_pattern>
    </parameters>
  </tool_call>
</root>

**2. Broad Keyword Scan (Project-wide)**
<root>
  <thinking>Scanning all files for legacy 'var' usage.</thinking>
  <tool_call>
    <name>search_files</name>
    <parameters>
      <path>/app/src</path>
      <regex>var\s+</regex>
      <file_pattern>**/*</file_pattern>
    </parameters>
  </tool_call>
</root>`;
}

if (require.main === module) {
  // 当直接运行此文件时，执行调试测试
  (async () => {
    try {
      // 示例用法
      const result = await main({
        "path": "/data/zgr/transagent/src/backend/tools",
        "regex": "file_pattern",
        "file_pattern": "**/*"
      });
      console.log('调试结果:', JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('调试错误:', error);
    }
  })();
}

module.exports = {
  main, getPrompt
};