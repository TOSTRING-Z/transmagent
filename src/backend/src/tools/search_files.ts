import { logger } from '../utils/logger';
const fs = require('fs');
const path_ = require('path');

// 动态处理 glob 导入
let globFunction;
try {
  // 尝试新版本的 glob
  const globModule = require('glob');
  globFunction = globModule.glob || globModule;
} catch (e: any) {
  throw new Error('Failed to import glob module');
}

/**
 * 判断文件是否为文本文件
 * @param {string} filePath 文件绝对路径
 * @returns {boolean}
 */
function isTextFile(filePath) {
  const ext = path_.extname(filePath).toLowerCase();

  // 1. 常见二进制/多媒体文件黑名单（直接跳过，提高性能）
  const BINARY_EXTENSIONS = new Set([
    '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', // 视频
    '.mp3', '.wav', '.flac', '.aac', '.ogg',        // 音频
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', // 图片
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', // 办公文档
    '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',   // 压缩包
    '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc', '.wasm' // 可执行文件与字节码
  ]);

  if (BINARY_EXTENSIONS.has(ext)) return false;

  // 2. 常见文本文件白名单（直接通过，提高性能）
  const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.less',
    '.vue', '.svelte', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift',
    '.sql', '.sh', '.bat', '.ps1', '.yaml', '.yml', '.ini', '.env', '.xml', '.svg', '.csv', '.log', '.conf', '.toml', '.graphql'
  ]);

  if (TEXT_EXTENSIONS.has(ext)) return true;

  // 3. 未知扩展名（如 Dockerfile, Makefile, .gitignore 等）
  // 启发式检测：读取前 4096 字节，检查是否包含 null 字节 (0x00)
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    fs.closeSync(fd);
    
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return false; // 含有 null 字节，判定为二进制文件
    }
    return true; // 没有 null 字节，认为是文本文件
  } catch (error: any) {
    return false; // 读取失败则跳过
  }
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
    const results: any[] = [];
    const regexObj = new RegExp(regex, 'g');

    for (const file of files) {
      // 过滤非文本文件
      if (!isTextFile(file)) continue;

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
    return results.slice(0, 100);
  } catch (error: any) {
    logger.log(error);
    return error.message;
  }
}

function getPrompt() {
  return {
    "name": "search_files",
    "description": "Recursively search text file contents under a specified directory, match using a regular expression, and return matches with surrounding context (up to 100 results).\nNote: regex matches file contents, not filenames. If you want to filter by filename, use file_pattern (glob).\nNotes: - In JSON strings, escape backslashes twice (see example).\n- file_pattern uses glob syntax; \"**\" means recursive.\n- regex is used to search file contents, not filenames. To filter by name, adjust file_pattern.\n- To avoid performance issues, narrow the path or restrict file_pattern. Binary files are automatically ignored.",
    "parameters": {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "(required): starting directory path, absolute or relative"
            },
            "regex": {
                "type": "string",
                "description": "(required): regular expression to match file contents (must be escaped properly in JSON strings)"
            },
            "file_pattern": {
                "type": "string",
                "description": "(optional): glob pattern for files to scan (default \"*.js\"). Examples: \"**/*\" (all files), \"**/*.ts\" (all ts files), \"*.env\" (env files in current dir)"
            },
            "file": {
                "type": "string",
                "description": "file path relative to path"
            },
            "match": {
                "type": "string",
                "description": "matched text (from file content)"
            },
            "context": {
                "type": "string",
                "description": "about 10 characters before and after the match"
            },
            "line": {
                "type": "number",
                "description": "line number of the match (1-based)"
            }
        },
        "required": [
            "path",
            "regex"
        ]
    }
  };
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
      logger.log('调试结果:', JSON.stringify(result, null, 2));
    } catch (error: any) {
      console.error('调试错误:', error);
    }
  })();
}

export {
  main, getPrompt
};