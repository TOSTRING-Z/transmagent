import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface SearchFilesParams {
    path: string;
    regex?: string;
    file_pattern?: string;
}

export interface SearchResult {
    file: string;
    match: string;
    context: string;
    line: number;
}

/**
 * 判断文件是否为文本文件
 * @param filePath 文件绝对路径
 * @returns 是否为文本文件
 */
function isTextFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();

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
    let fd: number | null = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);

        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) return false; // 含有 null 字节，判定为二进制文件
        }
        return true; // 没有 null 字节，认为是文本文件
    } catch (error: any) {
        return false; // 读取失败则跳过
    } finally {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch (e) {
                // 忽略关闭时的错误
            }
        }
    }
}

export function main() {
    return async ({ path: targetPath, regex = "test$", file_pattern = "*.js" }: SearchFilesParams): Promise<SearchResult[] | string> => {
        try {
            // 1. 安全解析目标路径
            const resolvedTarget = path.resolve(targetPath);
            if (!fs.existsSync(resolvedTarget)) {
                throw new Error(`Directory not found: ${resolvedTarget}`);
            }

            // 2. 动态兼容加载 Glob 模块 (适配 v8 ~ v10)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const globModule = require('glob');
            const globOptions = { cwd: resolvedTarget, nodir: true, absolute: true };

            let files: string[] = [];

            if (globModule.globSync || globModule.sync) {
                // 同步接口优先 (稳定且无异步队列丢失问题)
                const syncFn = globModule.globSync || globModule.sync;
                files = syncFn(file_pattern, globOptions);
            } else {
                // 异步接口兜底
                files = await new Promise((resolve, reject) => {
                    const result = globModule(file_pattern, globOptions, (err: any, matches: string[]) => {
                        if (err) reject(err);
                        else resolve(matches);
                    });
                    // 兼容返回 Promise 的新版 Glob
                    if (result && typeof result.then === 'function') {
                        result.then(resolve).catch(reject);
                    }
                });
            }

            if (!Array.isArray(files)) files = [];

            // 3. 【终极防御机制】：强制丢弃所有逃逸出 targetPath 目录之外的文件
            const validFiles = Array.from(new Set(files))
                .map(f => path.resolve(resolvedTarget, f)) // 统一转换为绝对路径
                .filter(f => {
                    // 利用 path.relative 判定层级，杜绝 / \ 分隔符差异和大小写差异引发的漏洞
                    const rel = path.relative(resolvedTarget, f);
                    return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
                });

            if (validFiles.length === 0) {
                throw new Error('No files found matching the pattern');
            }

            const results: SearchResult[] = [];
            const regexObj = new RegExp(regex, 'g');

            // 4. 读取与正则匹配
            for (const file of validFiles) {
                if (!isTextFile(file)) continue;

                const content = fs.readFileSync(file, 'utf8');
                let match;

                regexObj.lastIndex = 0;

                // 【性能优化】：预先计算换行符位置，避免在循环内部重复对大字符串进行 substring 和正则匹配
                let currentLine = 1;
                let lastNewLineIndex = -1;

                while ((match = regexObj.exec(content)) !== null) {
                    // 防护：防止零宽度正则导致的死循环
                    if (match.index === regexObj.lastIndex) {
                        regexObj.lastIndex++;
                    }
                    if (match[0].length === 0) continue;

                    // 【修复 1】：硬性截断超长匹配，防止贪婪正则提取半个文件
                    const MAX_MATCH_LENGTH = 150; // 最大允许保留的匹配字符数
                    const isTruncated = match[0].length > MAX_MATCH_LENGTH;
                    const safeMatch = isTruncated
                        ? match[0].substring(0, MAX_MATCH_LENGTH) + '...'
                        : match[0];

                    // 【修复 2】：安全计算上下文边界，依赖截断后的长度而非原始长度
                    const CONTEXT_PADDING = 20; // 前后各保留的字符数
                    const start = Math.max(0, match.index - CONTEXT_PADDING);
                    const matchEnd = match.index + (isTruncated ? MAX_MATCH_LENGTH : match[0].length);
                    const end = Math.min(content.length, matchEnd + CONTEXT_PADDING);

                    // 提取上下文并清理换行符/多余空格，防止返回的 JSON 极其难看
                    let context = content.substring(start, end);
                    context = context.replace(/\r?\n|\r/g, ' ').replace(/\s{2,}/g, ' ');

                    // 【修复 3】：优化行号计算 (O(N) 递推，代替原版的 O(N^2) substring + regex)
                    for (let i = lastNewLineIndex + 1; i <= match.index; i++) {
                        if (content[i] === '\n') {
                            currentLine++;
                        }
                    }
                    lastNewLineIndex = match.index;

                    results.push({
                        file: path.relative(resolvedTarget, file),
                        match: safeMatch,
                        context: context,
                        line: currentLine
                    });

                    // 性能保护：防止单文件包含百万级匹配项导致 OOM
                    if (results.length >= 100) break;
                }
                if (results.length >= 100) break;
            }

            return results.slice(0, 100);
        } catch (error: any) {
            logger.error(`Search files error: ${error.message}`);
            return error.message;
        }
    }
}

export function getPrompt() {
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