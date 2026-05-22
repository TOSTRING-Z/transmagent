import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Client, ConnectConfig } from 'ssh2';
import { Skill } from '../types';
import { getDefault } from '../utils/public';
import { logger } from '../utils/logger';

// 定义 SSH 配置项类型
export interface SshConfig extends ConnectConfig {
  enabled?: boolean;
  host: string;
  port: number;
  username: string;
  password: string;
}

/**
 * 将 ~/ 展开为本地当前用户 home 目录（支持跨平台）
 */
function expandLocalHomeDir(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', os.homedir());
  }
  return p;
}

class SkillManager {
  skillsPath: string;
  skills: Skill[] = [];
  sshConfig?: SshConfig;
  
  // 热加载管理状态
  private isRemote: boolean;
  private isRefreshing = false;
  private lastRefreshTime = 0;
  private readonly CACHE_TTL = 3000; // 远程缓存有效期 3 秒，避免短时间内高频并发建立 SSH 连接

  constructor(skillsPath?: string | null, sshConfig?: SshConfig) {
    this.sshConfig = sshConfig;
    this.isRemote = !!(this.sshConfig?.enabled && this.sshConfig?.host);

    if (skillsPath) {
      this.skillsPath = skillsPath;
    } else {
      // 远程模式与本地模式使用不同的默认路径
      this.skillsPath = this.isRemote ? '~/.transmagent/skills' : getDefault("skills");
    }

    if (!this.isRemote) {
      // 本地模式：直接展开本地 Home 路径
      this.skillsPath = expandLocalHomeDir(this.skillsPath);
      // 本地模式可以安全的在构造函数中同步初始化
      this.loadLocalSkillsSync();
    } else {
      // 远程模式：统一转换为 POSIX 路径风格，等待连接后动态解析
      this.skillsPath = this.skillsPath.replace(/\\/g, '/');
      // 触发首轮后台异步预加载
      this.refreshRemoteSkillsBackground();
    }
  }

  getSkillsPath() {
    return this.skillsPath;
  }

  /**
   * 解析 SKILL.md 的核心逻辑
   */
  private parseSkillContent(content: string, folderName: string, folderPath: string): Skill | null {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) return null;

    try {
      const yamlText = match[1];
      const meta: Record<string, string> = {};
      yamlText.split('\n').forEach(line => {
        const [key, ...val] = line.split(':');
        if (key && val) meta[key.trim()] = val.join(':').trim();
      });

      return {
        name: meta['name'] || folderName,
        description: meta['description'] || '',
        instructions: match[2].trim(),
        path: folderPath
      };
    } catch (e: any) {
      logger.error(`Failed to parse skill in ${folderName}: ${e.message}`);
      return null;
    }
  }

  /**
   * 同步本地加载
   */
  private loadLocalSkillsSync(): void {
    this.skills = [];
    try {
      fs.accessSync(this.skillsPath);
    } catch {
      fs.mkdirSync(this.skillsPath, { recursive: true });
      return;
    }

    try {
      const folders = fs.readdirSync(this.skillsPath, { withFileTypes: true });
      const loadedSkills: Skill[] = [];
      for (const item of folders) {
        if (!item.isDirectory()) continue;
        const folder = item.name;
        const skillPath = path.join(this.skillsPath, folder);
        const skillMdPath = path.join(skillPath, 'SKILL.md');
        try {
          const content = fs.readFileSync(skillMdPath, 'utf-8');
          const skill = this.parseSkillContent(content, folder, skillPath);
          if (skill) loadedSkills.push(skill);
        } catch {
          continue;
        }
      }
      this.skills = loadedSkills;
    } catch (err: any) {
      logger.error(`Failed to read local skills directory: ${err.message}`);
    }
  }

  /**
   * 异步加载：本地
   */
  private async loadLocalSkills(): Promise<void> {
    try {
      await fs.promises.access(this.skillsPath);
    } catch {
      await fs.promises.mkdir(this.skillsPath, { recursive: true });
      return;
    }

    try {
      const folders = await fs.promises.readdir(this.skillsPath, { withFileTypes: true });
      const loadedSkills: Skill[] = [];

      for (const item of folders) {
        if (!item.isDirectory()) continue;

        const folder = item.name;
        const skillPath = path.join(this.skillsPath, folder);
        const skillMdPath = path.join(skillPath, 'SKILL.md');

        try {
          const content = await fs.promises.readFile(skillMdPath, 'utf-8');
          const skill = this.parseSkillContent(content, folder, skillPath);
          if (skill) loadedSkills.push(skill);
        } catch {
          continue;
        }
      }
      this.skills = loadedSkills;
    } catch (err: any) {
      logger.error(`Failed to load local skills asynchronously: ${err.message}`);
    }
  }

  /**
   * 核心远程加载逻辑（支持动态解析远程家目录 + 路径递归创建）
   */
  private loadRemoteSkills(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sshClient = new Client();
      let isResolved = false;

      const safeResolve = () => {
        if (!isResolved) {
          isResolved = true;
          try { sshClient.end(); } catch { }
          resolve();
        }
      };

      const safeReject = (error: Error) => {
        if (!isResolved) {
          isResolved = true;
          try { sshClient.end(); } catch { }
          reject(error);
        }
      };

      sshClient.on('error', (err) => {
        safeReject(new Error(`SSH Connection Error: ${err.message}`));
      });

      sshClient.on('ready', () => {
        sshClient.sftp(async (err, sftp) => {
          if (err) {
            safeReject(new Error(`SFTP Error: ${err.message}`));
            return;
          }

          const statAsync = (p: string) => new Promise<any>((res, rej) => sftp.stat(p, (e, stats) => e ? rej(e) : res(stats)));
          const mkdirAsync = (p: string) => new Promise<void>((res, rej) => sftp.mkdir(p, (e) => e ? rej(e) : res()));
          const readdirAsync = (p: string) => new Promise<any[]>((res, rej) => sftp.readdir(p, (e, list) => e ? rej(e) : res(list)));
          const readFileAsync = (p: string) => new Promise<Buffer>((res, rej) => sftp.readFile(p, (e, data) => e ? rej(e) : res(data)));
          const realpathAsync = (p: string) => new Promise<string>((res, rej) => sftp.realpath(p, (e, absPath) => e ? rej(e) : res(absPath)));

          try {
            // 🌟 修复点：动态获取远程真正的 Home 绝对路径，避免使用宿主机的 os.homedir()
            let targetPath = this.skillsPath;
            if (targetPath.startsWith('~/') || targetPath === '~') {
              try {
                const remoteHome = await realpathAsync('.');
                targetPath = targetPath.replace('~', remoteHome);
              } catch {
                targetPath = targetPath.replace('~', '/home/' + (this.sshConfig?.username || 'root'));
              }
            }

            // 递归创建远程目录方法
            const mkdirRecursiveAsync = async (targetDir: string) => {
              const parts = targetDir.split('/');
              let currentPath = '';
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                if (i === 0 && part === '') {
                  currentPath = '/';
                  continue;
                }
                currentPath = currentPath === '/' ? `/${part}` : (currentPath ? `${currentPath}/${part}` : part);
                if (!currentPath || currentPath === '.') continue;
                try {
                  await statAsync(currentPath);
                } catch {
                  try {
                    await mkdirAsync(currentPath);
                  } catch (mkdirErr: any) {
                    if (mkdirErr.code !== 4) throw mkdirErr;
                  }
                }
              }
            };

            // 检查并确保远程目录存在
            try {
              await statAsync(targetPath);
            } catch {
              await mkdirRecursiveAsync(targetPath);
              this.skills = []; // 新创建的目录必然为空
              safeResolve();
              return;
            }

            // 读取远程目录下的技能包
            const items = await readdirAsync(targetPath);
            const loadedSkills: Skill[] = [];

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
                  loadedSkills.push(skill);
                }
              } catch {
                // 忽略没有或无法读取 SKILL.md 的无效目录
              }
            }

            // 🌟 热加载核心：数据就绪后执行原子替换，确保内存中的数据最新
            this.skills = loadedSkills;
            this.lastRefreshTime = Date.now();
            safeResolve();
          } catch (error: any) {
            logger.error(`Failed to load remote skills from ${this.skillsPath}: ${error.message}`);
            safeReject(error);
          }
        });
      });

      try {
        sshClient.connect({ ...this.sshConfig, readyTimeout: 20000 } as ConnectConfig);
      } catch (connectErr: any) {
        safeReject(new Error(`SSH Connection Error: ${connectErr.message}`));
      }
    });
  }

  /**
   * 内部私有方法：非阻塞的远程热加载触发器
   */
  private refreshRemoteSkillsBackground(): void {
    if (this.isRefreshing || Date.now() - this.lastRefreshTime < this.CACHE_TTL) {
      return;
    }
    this.isRefreshing = true;
    this.loadRemoteSkills()
      .catch((err) => logger.error(`Background remote skill refresh failed: ${err.message}`))
      .finally(() => {
        this.isRefreshing = false;
      });
  }

  /**
   * 🔴 供同步生命周期调用的查询入口
   * 本地模式直接重扫磁盘；远程模式返回当前高速缓存，并利用防抖机制在后台静默热加载最新数据。
   */
  findRelevantSkills() {
    if (this.isRemote) {
      // 🌟 核心改进：大模型每次向系统索要 Prompt 时，同步返回内存数据，同时悄悄在后台刷新远程文件系统。
      // 一旦异步刷新完成，下一轮对话或下一个 Tool 调度将无缝采用最新的 Skill 设定。
      this.refreshRemoteSkillsBackground();
      return this.skills;
    }

    // 本地模式：直接同步扫描
    this.loadLocalSkillsSync();
    return this.skills;
  }

  /**
   * ✅ 供 Tool 入口函数显式调用的强同步/强刷新方法
   * 例如在 `read_skill_instructions` 或者某些需要立竿见影的写操作后，执行强制刷新等待。
   */
  async loadRemoteSkillsAsync(): Promise<void> {
    if (!this.isRemote) {
      await this.loadLocalSkills();
      return;
    }
    this.isRefreshing = true;
    try {
      await this.loadRemoteSkills();
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 获取新技能的安装与规约指南提示词
   */
  private getSkillCreationGuide(): string {
    return `
### 🛠️ Skill Directory & Creation Guide
- **Active Skills Base Path**: \`${this.skillsPath}\`
- **How to install/create a new skill**:
  1. Create a subfolder inside the base path named after your skill (e.g., \`${this.skillsPath}/your-skill-name\`).
  2. Inside that subfolder, you MUST create a \`SKILL.md\` file.
  3. The \`SKILL.md\` file MUST strictly follow this layout with front-matter delimiters (\`---\`):
     \`\`\`markdown
     ---
     name: Concise Skill Name
     description: Short overview of what this skill enables the agent to do.
     ---
     Detailed, step-by-step instructions, behavioral constraints, or script usage documentation for this skill.
     \`\`\`
  4. **Verify format compliance**: After creating the SKILL.md, you MUST verify it:
     - Use your file inspection tools or \`read_skill_instructions\` tool on the new skill path to confirm it parses correctly.
     - A SKILL.md without proper \`---\` front-matter delimiters will be silently ignored by the loader.
`;
  }

  getSkillContent(relevantSkills: Skill[], instructions = true) {
    if (relevantSkills.length === 0) return '';

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

  getSkillDescription() {
    const relevantSkills = this.findRelevantSkills();
    const skillsPrompt = this.getSkillContent(relevantSkills, false);

    // ✨ 核心修复：避免把整个 Creation Guide 的大段文本错误塞进 Base Path 的反引号中
    if (!skillsPrompt) {
      return `\n*No active skills detected.*\n- **Base Path**: \`${this.skillsPath}\`\n${this.getSkillCreationGuide()}`;
    }

    return `${skillsPrompt}\n- **Base Path**: \`${this.skillsPath}\`\n${this.getSkillCreationGuide()}`;
  }
}

export { SkillManager };