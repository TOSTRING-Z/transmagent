import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

// --- 类型定义 ---
export interface ListFilesParams {
    threshold?: number;
}

export interface ListFilesArgs {
    path: string;
    recursive?: boolean;
    regex?: string | null;
}

// 过滤规则配置
const EXCLUDE_PATTERNS: RegExp[] = [
    // IDE config
    /\/\.vscode\//i,
    /\/\.idea\//i,
    // Cache
    /\/\.cache\//i,
    /\/\.npm\//i,
    // Media
    /\.(gif|png|jpe?g|mp4|mov|avi)$/i, // 扩展补充了常见的图片格式
    // Binaries
    /\.(exe|dll|so|a)$/i,
    // Documents
    /\.(pptx?)$/i,
];

/**
 * 判断是否命中过滤黑名单
 * @param filePath 绝对路径
 * @param isDir 是否为目录
 */
function shouldExclude(filePath: string, isDir: boolean): boolean {
    let normalized = filePath.replace(/\\/g, '/');
    // 如果是目录，强制补齐尾部斜杠以匹配 /\/\.vscode\// 这种强依赖斜杠的规则
    if (isDir && !normalized.endsWith('/')) {
        normalized += '/';
    }
    return EXCLUDE_PATTERNS.some(pattern => pattern.test(normalized));
}

export function main(params: ListFilesParams = {}) {
    return (args: ListFilesArgs): string[] => {
        const threshold = params.threshold || 50;
        const regexObj = args.regex ? new RegExp(args.regex) : null;
        const result: string[] = [];

        // 使用内部函数共享 result 状态，避免递归栈合并导致的 threshold 判断逻辑崩溃
        function scan(currentPath: string) {
            // 提早终止，防止超大目录拖垮性能
            if (result.length > threshold) return;

            let items: string[];
            try {
                items = fs.readdirSync(currentPath);
            } catch (err: any) {
                logger.warn(`Failed to read directory ${currentPath}: ${err.message}`);
                return;
            }

            for (const item of items) {
                if (result.length > threshold) return;

                const fullPath = path.join(currentPath, item);
                let stat: fs.Stats;

                try {
                    stat = fs.statSync(fullPath);
                } catch (e) {
                    continue; // 跳过权限不足或已损坏的软链接
                }

                // 核心修复：传入 isDirectory 辅助黑名单命中
                if (shouldExclude(fullPath, stat.isDirectory())) {
                    continue;
                }

                if (!regexObj || regexObj.test(item)) {
                    result.push(fullPath);
                }

                if (stat.isDirectory() && args.recursive) {
                    scan(fullPath);
                }
            }
        }

        try {
            const targetPath = path.resolve(args.path);
            if (!fs.existsSync(targetPath)) {
                throw new Error(`Path does not exist: ${targetPath}`);
            }

            scan(targetPath);

            // 总量拦截：当收集的内容超出阈值时，返回明确的防卡死提示
            if (result.length > threshold) {
                return ['Too much content returned, please try another solution!'];
            }

            return result;
        } catch (error: any) {
            logger.error(`Error listing files in ${args.path}: ${error.message}`);
            return [error.message]; // 保持原有的字符串返回行为，但规范包裹进数组中
        }
    };
}

export function getPrompt(): string {
    return `# list_files  
Description: Recursively scans directories with intelligent filtering (automatically excludes dev/binary files)  

Parameters:  
- path: Target directory absolute path (required)  
- recursive: Enable subdirectory scanning (default=false)  
- regex: Filename pattern filter (optional)  

Auto-excluded:  
- IDE configs (.vscode/, .idea/)  
- Cache dirs (.cache/, .npm/)  
- Media/binaries (.gif, .png, .mp4, .exe, etc)  

Best Practices:  
1. Disable recursion for large directories  
2. Use precise regex (e.g. \\.js$)

Usage:  
{
  "thinking": "[Thinking process]",
  "tool": "list_files",
  "params": {
    "path": "/project/src",
    "recursive": false,
    "regex": null
  }
}`;
}

// 本地调试入口
if (require.main === module) {
    (async () => {
        try {
            const runner = main({ threshold: 50 });
            const result = runner({
                path: process.cwd(),
                recursive: false,
                regex: null
            });
            logger.log('调试结果:', JSON.stringify(result, null, 2));
        } catch (error: any) {
            console.error('调试错误:', error);
        }
    })();
}