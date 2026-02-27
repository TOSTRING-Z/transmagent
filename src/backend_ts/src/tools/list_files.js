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
  const prompt = `# list_files  
Description: Recursively scans directories with intelligent filtering (automatically excludes dev/binary files)  

Parameters:  
- path: Target directory absolute path (required)  
- recursive: Enable subdirectory scanning (default=false)  
- regex: Filename pattern filter (optional)  

Auto-excluded:  
- IDE configs (.vscode/, .idea/)  
- Cache dirs (.cache/, .npm/)  
- Media/binaries (.gif, .mp4, .exe, etc)  

Best Practices:  
1. Disable recursion for large directories  
2. Use precise regex (e.g. .js$)

Usage:  
{
  "thinking": "[Thinking process]",
  "tool": "list_files",
  "params": {
    "path": "/project/src",
    "recursive": false,
    "regex": null
  }
}`
  return prompt
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