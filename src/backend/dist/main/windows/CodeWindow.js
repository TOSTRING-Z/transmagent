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
exports.CodeWindow = void 0;
const electron_1 = require("electron");
const path = __importStar(require("path"));
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
const LLMService_1 = require("../../core/LLMService");
const ReActAgent_1 = require("../../core/ReActAgent");
class CodeWindow extends BaseWindow_1.BaseWindow {
    llm_service_completion = null;
    react_agent_completion = null;
    llm_service_refactor = null;
    react_agent_refactor = null;
    auto_complete_enabled = false; // 自动AI补全开关，默认关闭
    auto_error_correct_enabled = false; // 自动错误纠正开关，默认关闭
    constructor(windowManager) {
        super(windowManager);
    }
    create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }
        this.window = new electron_1.BrowserWindow({
            width: 1000,
            height: 700,
            frame: false,
            transparent: true,
            resizable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });
        this.window.loadFile('src/frontend/code.html');
        this.window.on('closed', () => { this.window = null; });
        electron_1.ipcMain.on('minimize-window', () => {
            electron_1.BrowserWindow.getFocusedWindow()?.minimize();
        });
        electron_1.ipcMain.on('close-window', () => {
            electron_1.BrowserWindow.getFocusedWindow()?.close();
        });
    }
    openFile(filePath) {
        this.create();
        const send = () => this.window?.webContents.send('open-file', filePath);
        if (this.window?.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', send);
        }
        else {
            send();
        }
    }
    openContent(content) {
        this.create();
        const send = () => this.window?.webContents.send('open-content', content);
        if (this.window?.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', send);
        }
        else {
            send();
        }
    }
    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }
    setup() {
        electron_1.ipcMain.handle('get-file', (_, file_path) => globals_1.utils.getFile(file_path));
        electron_1.ipcMain.handle('set-file', (_, content, file_path) => {
            globals_1.utils.setFile(content, file_path);
            this.windowManager.alertWindow?.show("success", "File saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
        });
        electron_1.ipcMain.handle('get-code-config', () => globals_1.utils.getConfig("code") || {});
        electron_1.ipcMain.handle('open-file-dialog', async () => {
            if (!this.window)
                return null;
            const lastPath = globals_1.store.get('last_opened_dir');
            const result = await electron_1.dialog.showOpenDialog(this.window, {
                properties: ['openFile'],
                defaultPath: lastPath || undefined
            });
            if (result.canceled || result.filePaths.length === 0)
                return null;
            const filePath = result.filePaths[0];
            globals_1.store.set('last_opened_dir', path.dirname(filePath));
            this.openFile(filePath);
            return filePath;
        });
        electron_1.ipcMain.handle('save-as-dialog', async (_, options) => {
            if (!this.window)
                return null;
            const lastPath = globals_1.store.get('last_saved_dir');
            const result = await electron_1.dialog.showSaveDialog(this.window, { ...options, defaultPath: lastPath || undefined });
            if (result.canceled)
                return null;
            globals_1.store.set('last_saved_dir', path.dirname(result.filePath));
            return result.filePath;
        });
        electron_1.ipcMain.handle('show-log', (_, { type, content }) => {
            this.windowManager.alertWindow?.show(type, content);
        });
        electron_1.ipcMain.handle('open-dropped-file', async (_, filePath) => {
            try {
                if (filePath && typeof filePath === 'string') {
                    this.openFile(filePath);
                    return { success: true, message: 'File loaded' };
                }
                return { success: false, message: 'Invalid file path' };
            }
            catch (error) {
                return { success: false, message: `Load failed: ${error.message}` };
            }
        });
        electron_1.ipcMain.on('clear-completion', () => this.llm_service_completion?.stopMessage());
        electron_1.ipcMain.on('clear-refactor', () => this.llm_service_refactor?.stopMessage());
        electron_1.ipcMain.handle('code-completion', async (_, { prefix, suffix, isMidWord }) => {
            try {
                this.llm_service_completion?.stopMessage();
                this.llm_service_completion = new LLMService_1.LLMService();
                this.react_agent_completion = new ReActAgent_1.ReActAgent(this.llm_service_completion);
                const prompt = globals_1.utils.getConfig("code")?.completion?.prompt || "You are a code/text completion engine. Output code directly, no Markdown. If no completion is needed, return an empty string.";
                const query = `${prefix}<CURSOR>${suffix}`;
                const data = this.react_agent_completion.getDataDefault({
                    prompt, query,
                    params: { max_tokens: 200, stop: isMidWord ? ["\n", " "] : ["\n\n"], ...(globals_1.utils.getConfig("code")?.completion?.params || {}) }
                });
                return await this.react_agent_completion.llmCall(data);
            }
            catch (e) {
                console.error("Code completion error:", e);
                return { error: e.message };
            }
        });
        electron_1.ipcMain.handle('code-refactor', async (_, code) => {
            try {
                this.llm_service_refactor?.stopMessage();
                this.llm_service_refactor = new LLMService_1.LLMService();
                this.react_agent_refactor = new ReActAgent_1.ReActAgent(this.llm_service_refactor);
                const prompt = globals_1.utils.getConfig("code")?.refactor?.prompt || `You are a strict code linter. Return JSON: {"errors": [{"text": "erroneous_code", "fix": "fixed_code"}]}.`;
                const data = this.react_agent_refactor.getDataDefault({
                    prompt, query: code,
                    params: { response_format: { type: "json_object" }, ...(globals_1.utils.getConfig("code")?.refactor?.params || {}) }
                });
                return await this.react_agent_refactor.llmCall(data);
            }
            catch (e) {
                console.error("Code refactor error:", e);
                return { error: e.message };
            }
        });
        electron_1.ipcMain.handle('code-modify', async (_, { selectedText, instruction }) => {
            try {
                const llm_service = new LLMService_1.LLMService();
                const react_agent = new ReActAgent_1.ReActAgent(llm_service);
                const prompt = globals_1.utils.getConfig("code")?.modify?.prompt || "You are an intelligent code assistant. Return only the modified code, no Markdown markers.";
                const query = `[CODE START]\n${selectedText}\n[CODE END]\n\nUser instruction: ${instruction}\n\nPlease modify the code above:`;
                const data = react_agent.getDataDefault({
                    prompt, query,
                    params: { ...(globals_1.utils.getConfig("code")?.modify?.params || {}) }
                });
                return await react_agent.llmCall(data);
            }
            catch (e) {
                console.error("Code modify error:", e);
                return { error: e.message };
            }
        });
        // 获取自动AI补全和错误纠正开关状态
        electron_1.ipcMain.handle('get-auto-features', () => {
            return {
                auto_complete: this.auto_complete_enabled,
                auto_error_correct: this.auto_error_correct_enabled
            };
        });
        // 设置自动AI补全开关
        electron_1.ipcMain.handle('set-auto-complete', (_, enabled) => {
            this.auto_complete_enabled = enabled;
            return { success: true, enabled: this.auto_complete_enabled };
        });
        // 设置自动错误纠正开关
        electron_1.ipcMain.handle('set-auto-error-correct', (_, enabled) => {
            this.auto_error_correct_enabled = enabled;
            return { success: true, enabled: this.auto_error_correct_enabled };
        });
        electron_1.ipcMain.handle('detect-language', async (_, code) => {
            try {
                const llm_service = new LLMService_1.LLMService();
                const react_agent = new ReActAgent_1.ReActAgent(llm_service);
                const prompt = "You are a programming language detector. Output ONLY the lowercase language name.";
                const snippet = code?.length > 1000 ? code.slice(0, 1000) : code;
                const data = react_agent.getDataDefault({
                    prompt, query: snippet,
                    params: { temperature: 0.1, max_tokens: 20, ...(globals_1.utils.getConfig("code")?.detect?.params || {}) }
                });
                const messageOutput = await react_agent.llmCall(data);
                if (messageOutput) {
                    let lang = messageOutput.content.trim().toLowerCase().replace(/[^a-z0-9+#]/g, '');
                    return { language: lang };
                }
                return { language: 'plaintext' };
            }
            catch (e) {
                console.error("Language detection error:", e);
                return { error: e.message };
            }
        });
    }
}
exports.CodeWindow = CodeWindow;
//# sourceMappingURL=CodeWindow.js.map