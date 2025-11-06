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
  const prompt = `## search_files
Description:
Recursively search file contents under a specified directory, match using a regular expression, and return matches with surrounding context (up to 100 results).
Note: regex matches file contents, not filenames. If you want to filter by filename, use file_pattern (glob).

Parameters:
- path (required): starting directory path, absolute or relative
- regex (required): regular expression to match file contents (must be escaped properly in JSON strings")
- file_pattern (optional): glob pattern for files to scan (default "*.js"). Examples: "**/*" (all files), "**/*.ts" (all ts files), "*.env" (env files in current dir)

Return format (array, each item):
- file: file path relative to path
- match: matched text (from file content)
- context: about 10 characters before and after the match
- line: line number of the match (1-based)

Example usage:
{
  "thinking": "[optional notes/intents/filters]",
  "tool": "search_files",
  "params": {
    "path": "/project/src",
    "regex": "test$",
    "file_pattern": "**/*"
  }
}

Notes:
- In JSON strings, escape backslashes twice (see example).
- file_pattern uses glob syntax; "**" means recursive.
- regex is used to search file contents, not filenames. To filter by name, adjust file_pattern.
- To avoid performance issues, narrow the path or restrict file_pattern.`;

  return prompt
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