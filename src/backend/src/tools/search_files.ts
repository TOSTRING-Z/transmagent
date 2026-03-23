import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface SearchFilesParams {
    path: string;
    regex?: string;
    file_pattern?: string;
    timeout_ms?: number; // [新增] 超时时间参数
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
        '.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', 
        '.mp3', '.wav', '.flac', '.aac', '.ogg',        
        '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico', 
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', 
        '.zip', '.tar', '.gz', '.rar', '.7z', '.bz2',   
        '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.pyc', '.wasm' 
    ]);

    if (BINARY_EXTENSIONS.has(ext)) return false;

    // 2. 常见文本文件白名单（直接通过，提高性能）
    const TEXT_EXTENSIONS = new Set([
        '.txt', '.md', '.js', '.jsx', '.ts', '.tsx', '.json', '.html', '.css', '.scss', '.less',
        '.vue', '.svelte', '.py', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.php', '.rb', '.swift',
        '.sql', '.sh', '.bat', '.ps1', '.yaml', '.yml', '.ini', '.env', '.xml', '.svg', '.csv', '.log', '.conf', '.toml', '.graphql'
    ]);

    if (TEXT_EXTENSIONS.has(ext)) return true;

    // 3. 未知扩展名启发式检测
    let fd: number | null = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);

        for (let i = 0; i < bytesRead; i++) {
            if (buffer[i] === 0) return false; 
        }
        return true; 
    } catch (error: any) {
        return false; 
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
    // [修改] 增加 timeout_ms 参数，默认 10000 毫秒
    return async ({ path: targetPath, regex = "test$", file_pattern = "*.js", timeout_ms = 10000 }: SearchFilesParams): Promise<SearchResult[] | string> => {
        const startTime = Date.now(); // [新增] 记录开始时间

        try {
            // 1. 安全解析目标路径
            const resolvedTarget = path.resolve(targetPath);
            if (!fs.existsSync(resolvedTarget)) {
                throw new Error(`Directory not found: ${resolvedTarget}`);
            }

            // 2. 动态兼容加载 Glob 模块
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const globModule = require('glob');
            const globOptions = { cwd: resolvedTarget, nodir: true, absolute: true };

            let files: string[] = [];

            if (globModule.globSync || globModule.sync) {
                const syncFn = globModule.globSync || globModule.sync;
                files = syncFn(file_pattern, globOptions);
            } else {
                files = await new Promise((resolve, reject) => {
                    const result = globModule(file_pattern, globOptions, (err: any, matches: string[]) => {
                        if (err) reject(err);
                        else resolve(matches);
                    });
                    if (result && typeof result.then === 'function') {
                        result.then(resolve).catch(reject);
                    }
                });
            }

            if (!Array.isArray(files)) files = [];

            // [新增] 检查 Glob 扫描是否已经超时
            if (Date.now() - startTime > timeout_ms) {
                throw new Error(`Search timed out after ${timeout_ms}ms during file gathering.`);
            }

            // 3. 【终极防御机制】：强制丢弃所有逃逸出 targetPath 目录之外的文件
            const validFiles = Array.from(new Set(files))
                .map(f => path.resolve(resolvedTarget, f)) 
                .filter(f => {
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
                // [新增] 检查文件遍历是否超时
                if (Date.now() - startTime > timeout_ms) {
                    logger.warn(`Search interrupted: Timed out after ${timeout_ms}ms. Partial results returned.`);
                    break; // 超时则中断，返回已收集到的结果
                }

                if (!isTextFile(file)) continue;

                const content = fs.readFileSync(file, 'utf8');
                let match;

                regexObj.lastIndex = 0;
                let currentLine = 1;
                let lastNewLineIndex = -1;

                while ((match = regexObj.exec(content)) !== null) {
                    // [新增] 检查正则匹配循环是否超时
                    if (Date.now() - startTime > timeout_ms) {
                        logger.warn(`Search interrupted during regex execution: Timed out after ${timeout_ms}ms.`);
                        break; 
                    }

                    if (match.index === regexObj.lastIndex) {
                        regexObj.lastIndex++;
                    }
                    if (match[0].length === 0) continue;

                    const MAX_MATCH_LENGTH = 150; 
                    const isTruncated = match[0].length > MAX_MATCH_LENGTH;
                    const safeMatch = isTruncated
                        ? match[0].substring(0, MAX_MATCH_LENGTH) + '...'
                        : match[0];

                    const CONTEXT_PADDING = 20; 
                    const start = Math.max(0, match.index - CONTEXT_PADDING);
                    const matchEnd = match.index + (isTruncated ? MAX_MATCH_LENGTH : match[0].length);
                    const end = Math.min(content.length, matchEnd + CONTEXT_PADDING);

                    let context = content.substring(start, end);
                    context = context.replace(/\r?\n|\r/g, ' ').replace(/\s{2,}/g, ' ');

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

                    if (results.length >= 100) break;
                }
                if (results.length >= 100) break;
            }

            return results; // 返回（部分或全部）结果
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