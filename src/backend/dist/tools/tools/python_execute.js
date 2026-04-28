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
exports.main = main;
const child_process_1 = require("child_process");
const os_1 = require("os");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const logger_1 = require("../utils/logger");
const BackgroundTaskRegistry_1 = require("../core/BackgroundTaskRegistry");
// --- 后台执行核心逻辑 ---
/**
 * 在后台执行 Python 代码，完成后通过 BackgroundTaskRegistry 投递结果。
 * 不创建终端窗口、不注册 IPC 监听器。
 */
async function runInBackground(code, params, toolCall, taskId, sessionId) {
    const timestamp = Date.now();
    const randomStr = Math.floor(Math.random() * 1000);
    const tempFile = path.join((0, os_1.tmpdir)(), `bg_temp_${timestamp}_${randomStr}.py`);
    (0, fs_1.writeFileSync)(tempFile, code);
    const outputFile = path.join((0, os_1.tmpdir)(), `bg_output_${timestamp}_${randomStr}.txt`);
    const outStream = (0, fs_1.createWriteStream)(outputFile, { encoding: 'utf8', flags: 'a' });
    let tailBuffer = '';
    let errorBuffer = '';
    const MAX_TAIL_CHARS = 50000;
    let isInterrupted = false;
    const appendToTail = (data, isError = false) => {
        tailBuffer += data;
        if (tailBuffer.length > MAX_TAIL_CHARS * 2) {
            tailBuffer = tailBuffer.slice(-MAX_TAIL_CHARS);
        }
        if (isError) {
            errorBuffer += data;
        }
    };
    return new Promise((_resolve) => {
        let isFinished = false;
        const sendToRegistry = (exitCode) => {
            if (isFinished)
                return;
            isFinished = true;
            outStream.end();
            if ((0, fs_1.existsSync)(tempFile)) {
                try {
                    (0, fs_1.unlinkSync)(tempFile);
                }
                catch (e) { /* ignore */ }
            }
            const MAX_LINES = 100;
            const lines = tailBuffer.split(/\r?\n/);
            let finalOutput = lines.length > MAX_LINES
                ? lines.slice(-MAX_LINES).join('\n')
                : tailBuffer;
            if (isInterrupted) {
                finalOutput += '\n\n[Process Interrupted]';
            }
            finalOutput += `\n\n[Complete output saved to: ${outputFile}]`;
            const message = (exitCode === 0 && !isInterrupted)
                ? `✅ Background Python task completed successfully.\n\n**Output:**\n\`\`\`\n${finalOutput}\n\`\`\`` +
                    (errorBuffer ? `\n\n**Stderr:**\n\`\`\`\n${errorBuffer}\n\`\`\`` : '')
                : `❌ Background Python task failed (exit code: ${exitCode}).\n\n**Error:** ${errorBuffer || 'Unknown error'}\n\n**Output:**\n\`\`\`\n${finalOutput}\n\`\`\``;
            BackgroundTaskRegistry_1.BackgroundTaskRegistry.addMessage(sessionId, taskId, message);
            logger_1.logger.log(`[BackgroundPython] Task "${taskId}" completed, message sent to session "${sessionId}"`);
        };
        const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
        const child = (0, child_process_1.spawn)(params.python_bin || 'python', [tempFile], { env });
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (data) => {
            outStream.write(data);
            appendToTail(data);
        });
        child.stderr.on('data', (data) => {
            outStream.write(data);
            appendToTail(data, true);
        });
        child.on('close', (exitCode) => {
            sendToRegistry(exitCode);
        });
        child.on('error', (err) => {
            errorBuffer += `Process error: ${err.message}`;
            sendToRegistry(-1);
        });
        logger_1.logger.log(`[BackgroundPython] Task "${taskId}" started: ${tempFile}`);
    });
}
function main(params) {
}
