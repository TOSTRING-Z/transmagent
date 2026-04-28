"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureMouse = captureMouse;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = require("fs");
const util_1 = require("util");
// 将 execFile 转换为 Promise 风格
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
/**
 * 获取当前平台对应的可执行文件路径
 * @throws {Error} 如果平台不支持或文件不存在
 */
function getExecutablePath() {
    const platform = process.platform;
    const executableDir = path_1.default.join(__dirname, '../../bin');
    const executableMap = {
        linux: 'capture_mouse_x11',
        win32: 'capture_mouse_win.exe',
        // darwin: 'capture_mouse_mac', // 如果未来支持 macOS 可以在此添加
    };
    const executableName = executableMap[platform];
    if (!executableName) {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    const fullPath = path_1.default.join(executableDir, executableName);
    if (!(0, fs_1.existsSync)(fullPath)) {
        throw new Error(`Executable not found at: ${fullPath}`);
    }
    return fullPath;
}
/**
 * 执行二进制文件并捕获鼠标位置
 * @returns 包含 x, y 坐标的对象
 */
async function captureMouse() {
    const executablePath = getExecutablePath();
    try {
        const { stdout, stderr } = await execFileAsync(executablePath);
        if (stderr) {
            throw new Error(stderr);
        }
        return JSON.parse(stdout);
    }
    catch (error) {
        // 重新包装错误，提供更有用的上下文
        throw new Error(`Failed to capture mouse: ${error.message}`);
    }
}
