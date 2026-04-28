"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssh2_1 = require("ssh2");
const public_1 = require("../utils/public");
const logger_1 = require("../utils/logger");
class SkillManager {
    constructor(skillsPath, sshConfig) {
        this.sshConfig = sshConfig;
        this.skills = [];
        const isRemote = !!(this.sshConfig?.enabled && this.sshConfig?.host);
        if (skillsPath) {
            this.skillsPath = skillsPath;
        }
        else {
            // 远程模式与本地模式使用不同的默认路径
            this.skillsPath = isRemote ? '~/.transmagent/skills' : (0, public_1.getDefault)("skills");
        }
        this.loadSkills();
    }
    getSkillsPath() {
        return this.skillsPath;
    }
    // 修改点 2：将核心解析逻辑抽离，以便本地和远程共用
    parseSkillContent(content, folderName, folderPath) {
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
        if (!match)
            return null;
        try {
            const yamlText = match[1];
            const meta = {};
            yamlText.split('\n').forEach(line => {
                const [key, ...val] = line.split(':');
                if (key && val)
                    meta[key.trim()] = val.join(':').trim();
            });
            return {
                name: meta['name'],
                description: meta['description'],
                instructions: match[2].trim(),
                path: folderPath
            };
        }
        catch (e) {
            logger_1.logger.error(`Failed to parse skill in ${folderName}`);
            return null;
        }
    }
    // 修改点 3：主入口变为 async，并分发本地/远程模式
    async loadSkills() {
        this.skills = [];
        const isRemote = !!(this.sshConfig?.enabled && this.sshConfig?.host);
        if (isRemote) {
            await this.loadRemoteSkills();
        }
        else {
            await this.loadLocalSkills();
        }
    }
    // 修改点 4：本地加载逻辑（使用 fs.promises 保持异步风格统一）
    async loadLocalSkills() {
        try {
            await fs.promises.access(this.skillsPath);
        }
        catch {
            await fs.promises.mkdir(this.skillsPath, { recursive: true });
            return;
        }
        const folders = await fs.promises.readdir(this.skillsPath, { withFileTypes: true });
        for (const item of folders) {
            if (!item.isDirectory())
                continue;
            const folder = item.name;
            const skillPath = path.join(this.skillsPath, folder);
            const skillMdPath = path.join(skillPath, 'SKILL.md');
            try {
                const content = await fs.promises.readFile(skillMdPath, 'utf-8');
                const skill = this.parseSkillContent(content, folder, skillPath);
                if (skill)
                    this.skills.push(skill);
            }
            catch (err) {
                // SKILL.md 不存在或无法读取，忽略该目录
                continue;
            }
        }
    }
    // 修改点 5：远程加载逻辑（使用 ssh2 + sftp）
    async loadRemoteSkills() {
        return new Promise((resolve, reject) => {
            const sshClient = new ssh2_1.Client();
            let isResolved = false;
            sshClient.on('error', (err) => {
                if (!isResolved) {
                    isResolved = true;
                    try {
                        sshClient.end();
                    }
                    catch { }
                    reject(new Error(`SSH Connection Error: ${err.message}`));
                }
            });
            sshClient.on('ready', () => {
                sshClient.sftp(async (err, sftp) => {
                    if (err) {
                        if (!isResolved) {
                            isResolved = true;
                            sshClient.end();
                            reject(new Error(`SFTP Error: ${err.message}`));
                        }
                        return;
                    }
                    // 封装 sftp 回调为 Promise
                    const statAsync = (p) => new Promise((res, rej) => sftp.stat(p, (e, stats) => e ? rej(e) : res(stats)));
                    const mkdirAsync = (p) => new Promise((res, rej) => sftp.mkdir(p, (e) => e ? rej(e) : res()));
                    const readdirAsync = (p) => new Promise((res, rej) => sftp.readdir(p, (e, list) => e ? rej(e) : res(list)));
                    const readFileAsync = (p) => new Promise((res, rej) => sftp.readFile(p, (e, data) => e ? rej(e) : res(data)));
                    // 🆕 新增：递归创建目录方法 (等同于 mkdir -p)
                    const mkdirRecursiveAsync = async (targetDir) => {
                        const parts = targetDir.split('/');
                        let currentPath = '';
                        for (let i = 0; i < parts.length; i++) {
                            const part = parts[i];
                            // 处理绝对路径的根目录 '/'
                            if (i === 0 && part === '') {
                                currentPath = '/';
                                continue;
                            }
                            // 逐级拼接路径
                            currentPath = currentPath === '/' ? `/${part}` : (currentPath ? `${currentPath}/${part}` : part);
                            // 跳过空路径和当前相对目录 '.'
                            if (!currentPath || currentPath === '.')
                                continue;
                            try {
                                await statAsync(currentPath);
                            }
                            catch {
                                // stat 失败说明目录不存在，执行创建
                                try {
                                    await mkdirAsync(currentPath);
                                }
                                catch (mkdirErr) {
                                    // 忽略可能由并发创建引发的已存在错误 (SFTP failure code 4)
                                    if (mkdirErr.code !== 4)
                                        throw mkdirErr;
                                }
                            }
                        }
                    };
                    // 统一路径格式为 POSIX 风格
                    let rawPath = this.skillsPath.replace(/\\/g, '/');
                    if (rawPath.startsWith('~/')) {
                        rawPath = rawPath.replace('~/', './');
                    }
                    const targetPath = rawPath;
                    try {
                        // 检查目录是否存在
                        try {
                            await statAsync(targetPath);
                        }
                        catch {
                            // ⚠️ 修复点：使用递归创建代替原先的 mkdirAsync
                            await mkdirRecursiveAsync(targetPath);
                            if (!isResolved) {
                                isResolved = true;
                                sshClient.end();
                                resolve();
                            }
                            return;
                        }
                        const items = await readdirAsync(targetPath);
                        for (const item of items) {
                            if (!item.attrs.isDirectory() || item.filename === '.' || item.filename === '..') {
                                continue;
                            }
                            const folder = item.filename;
                            const skillPath = path.posix.join(targetPath, folder);
                            const skillMdPath = path.posix.join(skillPath, 'SKILL.md');
                            try {
                                const buffer = await readFileAsync(skillMdPath);
                                const content = buffer.toString('utf-8');
                                const skill = this.parseSkillContent(content, folder, skillPath);
                                if (skill) {
                                    this.skills.push(skill);
                                }
                            }
                            catch (readErr) {
                                // 忽略没有 SKILL.md 的目录
                            }
                        }
                        if (!isResolved) {
                            isResolved = true;
                            sshClient.end();
                            resolve();
                        }
                    }
                    catch (error) {
                        if (!isResolved) {
                            isResolved = true;
                            sshClient.end();
                            logger_1.logger.error(`Failed to load remote skills from ${targetPath}`);
                            reject(error);
                        }
                    }
                });
            });
            try {
                sshClient.connect({ ...this.sshConfig, readyTimeout: 20000 });
            }
            catch (connectErr) {
                if (!isResolved) {
                    isResolved = true;
                    try {
                        sshClient.end();
                    }
                    catch { }
                    reject(new Error(`SSH Connection Error: ${connectErr.message}`));
                }
            }
        });
    }
    findRelevantSkills() {
        return this.skills;
    }
    getSkillContent(relevantSkills, instructions = true) {
        if (relevantSkills.length === 0)
            return '';
        let prompt = `\n`;
        relevantSkills.forEach(skill => {
            prompt += `## Skill: ${skill.name}\n**Skill Path**: ${skill.path}\n`;
            if (instructions)
                prompt += `${skill.instructions}\n`;
            else
                prompt += `${skill.description}\n`;
        });
        return prompt;
    }
    getSkillPrompt() {
        const relevantSkills = this.findRelevantSkills();
        const skillsPrompt = this.getSkillContent(relevantSkills);
        return skillsPrompt || "\n*No active skills detected.*";
    }
    getSkillDescription() {
        const relevantSkills = this.findRelevantSkills();
        const skillsPrompt = this.getSkillContent(relevantSkills, false);
        return skillsPrompt || "\n*No active skills detected.*";
    }
}
exports.SkillManager = SkillManager;
