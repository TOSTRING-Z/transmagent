import * as fs from 'fs';
import * as path from 'path';
import { Client, ConnectConfig } from 'ssh2';
import { Skill } from '../types';
import { getDefault } from '../utils/public';

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
      console.error(`Failed to parse skill in ${folderName}:`, e);
      return null;
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

      sshClient.on('ready', () => {
        sshClient.sftp(async (err, sftp) => {
          if (err) {
            sshClient.end();
            return reject(new Error(`SFTP Error: ${err.message}`));
          }

          // 封装 sftp 回调为 Promise
          const statAsync = (p: string) => new Promise<any>((res, rej) => sftp.stat(p, (e, stats) => e ? rej(e) : res(stats)));
          const mkdirAsync = (p: string) => new Promise<void>((res, rej) => sftp.mkdir(p, (e) => e ? rej(e) : res()));
          const readdirAsync = (p: string) => new Promise<any[]>((res, rej) => sftp.readdir(p, (e, list) => e ? rej(e) : res(list)));
          const readFileAsync = (p: string) => new Promise<Buffer>((res, rej) => sftp.readFile(p, (e, data) => e ? rej(e) : res(data)));

          // 统一路径格式为 POSIX 风格
          let rawPath = this.skillsPath.replace(/\\/g, '/');

          // ⚠️ 核心修复：SFTP 协议不支持 '~' 符号展开。
          // 默认登录目录即为 Home 目录，因此将 '~/' 替换为相对路径 './'
          if (rawPath.startsWith('~/')) {
            rawPath = rawPath.replace('~/', './');
          }
          const targetPath = rawPath;

          try {
            // 检查目录是否存在
            try {
              await statAsync(targetPath);
            } catch {
              // 目录不存在则创建
              await mkdirAsync(targetPath);
              return resolve();
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
                // 同样忽略没有 SKILL.md 的目录
              }
            }
            resolve();
          } catch (error) {
            console.error(`Failed to load remote skills from ${targetPath}:`, error);
            reject(error);
          } finally {
            sshClient.end();
          }
        });
      }).on('error', (err) => {
        reject(new Error(`SSH Connection Error: ${err.message}`));
      }).connect({ ...this.sshConfig, readyTimeout: 20000 } as ConnectConfig);
    });
  }

  findRelevantSkills() {
    return this.skills;
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
    return skillsPrompt || "\n*No active skills detected.*";
  }

  getSkillDescription() {
    const relevantSkills = this.findRelevantSkills();
    const skillsPrompt = this.getSkillContent(relevantSkills, false);
    return skillsPrompt || "\n*No active skills detected.*";
  }
}

export { SkillManager };