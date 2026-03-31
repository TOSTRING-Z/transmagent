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
    return async ({ path: targetPath, regex = "", file_pattern = "**/*", timeout_ms = 30000 }: SearchFilesParams): Promise<SearchResult[] | string> => {
        const startTime = Date.now();
        const MAX_RESULTS = 100;

        try {
            // 1. 安全解析目标路径
            const resolvedTarget = path.resolve(targetPath);
            
            // 2. 判断是单文件还是目录
            const stats = fs.statSync(resolvedTarget);
            let files: string[] = [];
            
            if (stats.isFile()) {
                // 如果是单文件，直接使用该文件
                files = [resolvedTarget];
            } else if (stats.isDirectory()) {
                // 如果是目录，使用 glob 扫描
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const globModule = require('glob');
                const globOptions = { cwd: resolvedTarget, nodir: true, absolute: true };

                // 处理不同的 glob 版本 API
                if (typeof globModule.globSync === 'function') {
                    files = globModule.globSync(file_pattern, globOptions);
                } else if (typeof globModule.sync === 'function') {
                    files = globModule.sync(file_pattern, globOptions);
                } else {
                    // Promise-based API (glob v10+)
                    files = await globModule(file_pattern, globOptions);
                }

                // 确保 files 是数组
                if (!Array.isArray(files)) {
                    files = [];
                }
            } else {
                throw new Error(`Path is neither a file nor a directory: ${resolvedTarget}`);
            }

            // 检查 Glob 扫描是否超时
            if (Date.now() - startTime > timeout_ms) {
                throw new Error(`Search timed out after ${timeout_ms}ms during file gathering.`);
            }

            // 3. 防御机制：过滤出 targetPath 内的文件
            const validFiles = Array.from(new Set(files))
                .map(f => path.isAbsolute(f) ? f : path.resolve(resolvedTarget, f))
                .filter(f => {
                    const rel = path.relative(resolvedTarget, f);
                    // 单文件情况下 rel 为空字符串，也应该保留
                    // 目录情况下要确保文件在目录内（不是父目录的..路径）
                    return (rel === '' || (rel && !rel.startsWith('..') && !path.isAbsolute(rel)));
                });

            if (validFiles.length === 0) {
                throw new Error('No files found matching the pattern');
            }

            const results: SearchResult[] = [];
            const regexObj = new RegExp(regex, 'g');
            let match: RegExpExecArray | null;
            let fileProcessingTimedOut = false;

            // 4. 读取与正则匹配
            for (const file of validFiles) {
                if (fileProcessingTimedOut) break;

                // 检查文件遍历是否超时
                if (Date.now() - startTime > timeout_ms) {
                    logger.warn(`Search interrupted: Timed out after ${timeout_ms}ms. Partial results returned.`);
                    fileProcessingTimedOut = true;
                    break;
                }

                if (!isTextFile(file)) continue;

                // 单独捕获文件读取错误，避免一个文件失败影响其他文件
                let content: string;
                try {
                    content = fs.readFileSync(file, 'utf8');
                } catch (readError: any) {
                    logger.warn(`Skipping file due to read error: ${file}, Error: ${readError.message}`);
                    continue;
                }

                regexObj.lastIndex = 0;
                let currentLine = 1;
                let lastNewLineIndex = -1;
                let regexTimedOut = false;

                while ((match = regexObj.exec(content)) !== null) {
                    // 检查正则匹配循环是否超时
                    if (Date.now() - startTime > timeout_ms) {
                        logger.warn(`Search interrupted during regex execution: Timed out after ${timeout_ms}ms.`);
                        regexTimedOut = true;
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

                    if (results.length >= MAX_RESULTS) {
                        fileProcessingTimedOut = true;
                        break;
                    }
                }

                if (regexTimedOut) {
                    fileProcessingTimedOut = true;
                    break;
                }
            }

            return results;
        } catch (error: any) {
            logger.error(`Search files error: ${error.message}`);
            return error.message;
        }
    };
}

export function getPrompt() {
    return {
        "name": "search_files",
        "description": "Recursively search text file contents under a specified directory, match using a regular expression, and return matches with surrounding context (up to 100 results).\nNote: regex matches file contents, not filenames. If you want to filter by filename, use file_pattern (glob).\nNotes: - In JSON strings, escape backslashes twice (see example).\n- file_pattern uses glob syntax; \"**\" means recursive.\n- To avoid performance issues, narrow the path or restrict file_pattern. Binary files are automatically ignored.",
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
                    "description": "(optional): glob pattern for files to scan (default \"**/*\"). Examples: \"**/*\" (all files), \"**/*.ts\" (all ts files), \"*.env\" (env files in current dir)"
                },
                "timeout_ms": {
                    "type": "number",
                    "description": "(optional): timeout in milliseconds for the entire search operation (default 30000)"
                }
            },
            "required": [
                "path",
                "regex"
            ]
        }
    };
}