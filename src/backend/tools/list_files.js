const fs = require('fs');
const path_ = require('path');

const EXCLUDE_PATTERNS = [
  // IDE config
  /\/\.vscode\//i,
  /\/\.idea\//i,
  // Cache
  /\/\.cache\//i,
  /\/\.npm\//i,
  // Media
  /\.(gif|mp4|mov|avi)$/i,
  // Binaries
  /\.(exe|dll|so|a)$/i,
  // Documents
  /\.(pptx?)$/i,
];


function shouldExclude(path) {
  return EXCLUDE_PATTERNS.some(pattern => pattern.test(path.replaceAll("\\", "/")));
}


function main(params) {
  return ({ path, recursive = false, regex = null }) => {
    const regexObj = regex ? new RegExp(regex) : null;
    try {
      const items = fs.readdirSync(path);
      const result = [];

      items.forEach(item => {
        const fullPath = path_.join(path, item);
        if (shouldExclude(fullPath)) return;
        if ((regexObj && regexObj.test(item)) || !regexObj) {
          result.push(fullPath);
        }
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && recursive) {
          const subResult = main(params)({ path: fullPath, recursive, regex });
          if (Array.isArray(subResult)) {
            result.push(...subResult);
          }
        }
      });
      if (result.length > (params?.threshold || 50)) {
        return ['Too much content returned, please try another solution!'];
      }
      // console.log(result)
      return result;
    } catch (error) {
      console.error(`Error listing files in ${path}:`, error);
      return error.message;
    }
  }
}

function getPrompt() {
  return `## list_files

Description: Smart directory scanner with built-in noise filtering.
**Auto-Excludes**: node_modules, .git, .vscode, binaries, images, cache.
**Best Practice**: Use 'regex' to pinpoint files in large codebases. Avoid recursive scans on root directories.

Parameters:
- path: (Required, String) Absolute directory path.
- recursive: (Optional, Bool) Enable deep scan (Default: false).
- regex: (Optional, String) Pattern to match filenames (e.g., "\\.ts$").

### Usage

**1. Quick Structure Check (Non-recursive)**
<root>
  <thinking>Checking project root to identify project type (package.json, requirements.txt).</thinking>
  <tool_call>
    <name>list_files</name>
    <parameters>
      <path>/app/project</path>
    </parameters>
  </tool_call>
</root>

**2. Targeted Deep Search**
<root>
  <thinking>Finding all TypeScript controllers in the src folder.</thinking>
  <tool_call>
    <name>list_files</name>
    <parameters>
      <path>/app/project/src</path>
      <recursive>true</recursive>
      <regex>.*Controller\.ts$</regex>
    </parameters>
  </tool_call>
</root>`;
}

if (require.main === module) {
  // 当直接运行此文件时，执行调试测试
  (async () => {
    try {
      // 示例用法
      const result = await main()({
        "path": "C:\\Users\\tostring\\Desktop\\document\\transagent",
        "recursive": false,
        "regex": null
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