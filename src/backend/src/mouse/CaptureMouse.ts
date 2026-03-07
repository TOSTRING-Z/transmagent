import { execFile } from 'child_process';
import path from 'path';
import { existsSync } from 'fs';
import { promisify } from 'util';

/** 鼠标位置接口 */
interface MousePosition {
  x: number;
  y: number;
  [key: string]: any; // 兼容可能存在的其他返回字段
}

// 将 execFile 转换为 Promise 风格
const execFileAsync = promisify(execFile);

/**
 * 获取当前平台对应的可执行文件路径
 * @throws {Error} 如果平台不支持或文件不存在
 */
function getExecutablePath(): string {
  const platform = process.platform;
  const executableDir = path.join(__dirname, '../../bin');

  const executableMap: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'capture_mouse_x11',
    win32: 'capture_mouse_win.exe',
    // darwin: 'capture_mouse_mac', // 如果未来支持 macOS 可以在此添加
  };

  const executableName = executableMap[platform];

  if (!executableName) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const fullPath = path.join(executableDir, executableName);

  if (!existsSync(fullPath)) {
    throw new Error(`Executable not found at: ${fullPath}`);
  }

  return fullPath;
}

/**
 * 执行二进制文件并捕获鼠标位置
 * @returns 包含 x, y 坐标的对象
 */
export async function captureMouse(): Promise<MousePosition> {
  const executablePath = getExecutablePath();

  try {
    const { stdout, stderr } = await execFileAsync(executablePath);

    if (stderr) {
      throw new Error(stderr);
    }

    return JSON.parse(stdout) as MousePosition;
  } catch (error: any) {
    // 重新包装错误，提供更有用的上下文
    throw new Error(`Failed to capture mouse: ${error.message}`);
  }
}