import * as fs from 'fs';
import * as path from 'path';
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

class SkillManager {
  skillsPath: string;
  skills: Skill[];
  sshConfig?: SshConfig;

  constructor(skillsPath?: string | null, sshConfig?: SshConfig) {
    this.sshConfig = sshConfig;
    this.skills = [];

    const isRemote = !!(this.sshConfig?.enabled && this.sshConfig?.host);

    if (skillsPath) {
      this.skillsPath = skillsPath;
    } else {
      // 远程模式与本地模式使用不同的默认路径
      this.skillsPath = isRemote ? '~/.transmagent/skills' : getDefault("skills");
    }
    this.loadSkills();
  }

  getSkillsPath() {
    return this.skillsPath;
  }

  // 修改点 2：将核心解析逻辑抽离，以便本地和远程共用
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
        name: meta['name'],
        description: meta['description'],
        instructions: match[2].trim(),
        path: folderPath
      };
    } catch (e: any) {
      logger.error(`Failed to parse skill in ${folderName}`);
      return null;
    }
  }

  // 同步本地加载，供 findRelevantSkills 每次调用时动态刷新
  private loadLocalSkillsSync(): void {
    this.skills = [];
    try {
      fs.accessSync(this.skillsPath);
    } catch {
      fs.mkdirSync(this.skillsPath, { recursive: true });
      return;
    }

    const folders = fs.readdirSync(this.skillsPath, { withFileTypes: true });
    for (const item of folders) {
      if (!item.isDirectory()) continue;
      const folder = item.name;
      const skillPath = path.join(this.skillsPath, folder);
      const skillMdPath = path.join(skillPath, 'SKILL.md');
      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8');
        const skill = this.parseSkillContent(content, folder, skillPath);
        if (skill) this.skills.push(skill);
      } catch {
        continue;
      }
    }
  }

  // 修改点 3：主入口变为 async，并分发本地/远程模式
  async loadSkills(): Promise<void> {
    this.skills = [];
    const isRemote = !!(this.sshConfig?.enabled && this.sshConfig?.host);

    if (isRemote) {
      await this.loadRemoteSkills();
    } else {
      await this.loadLocalSkills();
    }
  }

  // 修改点 4：本地加载逻辑（使用 fs.promises 保持异步风格统一）
  private async loadLocalSkills(): Promise<void> {
    try {
      await fs.promises.access(this.skillsPath);
    } catch {
      await fs.promises.mkdir(this.skillsPath, { recursive: true });
      return;
    }

    const folders = await fs.promises.readdir(this.skillsPath, { withFileTypes: true });

    for (const item of folders) {
      if (!item.isDirectory()) continue;

      const folder = item.name;
      const skillPath = path.join(this.skillsPath, folder);
      const skillMdPath = path.join(skillPath, 'SKILL.md');

      try {
        const content = await fs.promises.readFile(skillMdPath, 'utf-8');
        const skill = this.parseSkillContent(content, folder, skillPath);
        if (skill) this.skills.push(skill);
      } catch (err) {
        // SKILL.md 不存在或无法读取，忽略该目录
        continue;
      }
    }
  }

  // 修改点 5：远程加载逻辑（使用 ssh2 + sftp）
  private async loadRemoteSkills(): Promise<void> {
    return new Promise((resolve, reject) => {
      const sshClient = new Client();
      let isResolved = false;

      sshClient.on('error', (err) => {
        if (!isResolved) {
          isResolved = true;
          try { sshClient.end(); } catch { }
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
          const statAsync = (p: string) => new Promise<any>((res, rej) => sftp.stat(p, (e, stats) => e ? rej(e) : res(stats)));
          const mkdirAsync = (p: string) => new Promise<void>((res, rej) => sftp.mkdir(p, (e) => e ? rej(e) : res()));
          const readdirAsync = (p: string) => new Promise<any[]>((res, rej) => sftp.readdir(p, (e, list) => e ? rej(e) : res(list)));
          const readFileAsync = (p: string) => new Promise<Buffer>((res, rej) => sftp.readFile(p, (e, data) => e ? rej(e) : res(data)));

          // 🆕 新增：递归创建目录方法 (等同于 mkdir -p)
          const mkdirRecursiveAsync = async (targetDir: string) => {
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
              if (!currentPath || currentPath === '.') continue;

              try {
                await statAsync(currentPath);
              } catch {
                // stat 失败说明目录不存在，执行创建
                try {
                  await mkdirAsync(currentPath);
                } catch (mkdirErr: any) {
                  // 忽略可能由并发创建引发的已存在错误 (SFTP failure code 4)
                  if (mkdirErr.code !== 4) throw mkdirErr;
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
            } catch {
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
              } catch (readErr) {
                // 忽略没有 SKILL.md 的目录
              }
            }
            if (!isResolved) {
              isResolved = true;
              sshClient.end();
              resolve();
            }
          } catch (error) {
            if (!isResolved) {
              isResolved = true;
              sshClient.end();
              logger.error(`Failed to load remote skills from ${targetPath}`);
              reject(error);
            }
          }
        });
      });

      try {
        sshClient.connect({ ...this.sshConfig, readyTimeout: 20000 } as ConnectConfig);
      } catch (connectErr: any) {
        if (!isResolved) {
          isResolved = true;
          try { sshClient.end(); } catch { }
          reject(new Error(`SSH Connection Error: ${connectErr.message}`));
        }
      }
    });
  }

  findRelevantSkills() {
    const isRemote = !!(this.sshConfig?.enabled && this.sshConfig?.host);
    if (isRemote) {
      this.loadSkills(); // 触发异步重载，不等待，下次调用获取最新
    } else {
      this.loadLocalSkillsSync();
    }
    return this.skills;
  }

  /**
   * 获取技能目录的元数据创建规范提示，供 LLM 想要新建技能时参考
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

  getSkillPrompt() {
    const relevantSkills = this.findRelevantSkills();
    const skillsPrompt = this.getSkillContent(relevantSkills);

    if (!skillsPrompt) {
      return `\n*No active skills detected.*`;
    }

    return skillsPrompt;
  }

  getSkillDescription() {
    const relevantSkills = this.findRelevantSkills();
    const skillsPrompt = this.getSkillContent(relevantSkills, false);

    if (!skillsPrompt) {
      return `\n*No active skills detected.*\n- **Base Path**: \`${this.getSkillCreationGuide()}\``;
    }

    return `${skillsPrompt}\n- **Base Path**: \`${this.getSkillCreationGuide()}\``;
  }
}

export { SkillManager };