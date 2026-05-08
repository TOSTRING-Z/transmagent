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
const LLMBase_1 = require("../../core/LLMBase");
class CodeWindow extends BaseWindow_1.BaseWindow {
    llmServiceCompletion = null;
    reactAgentCompletion = null;
    llmServiceRefactor = null;
    reactAgentRefactor = null;
    llmService;
    autoCompleteEnabled = false;
    autoErrorCorrectEnabled = false;
    constructor(windowManager) {
        super(windowManager);
        this.llmService = () => {
            const llmService = new LLMService_1.LLMService(undefined, null, this.utils());
            const mainChat = this.windowManager.mainWindow.session().llmService.chatManager.chat;
            llmService.chatManager.chat.model = mainChat.model;
            llmService.chatManager.chat.version = mainChat.version;
            return llmService;
        };
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
        this.window.on('closed', () => {
            this.cleanupResources();
            this.window = null;
        });
    }
    openFile(filePath) {
        this.create();
        this.executeOnLoad(() => this.window?.webContents.send('open-file', filePath));
    }
    openContent(content) {
        this.create();
        this.executeOnLoad(() => this.window?.webContents.send('open-content', content));
    }
    destroy() {
        if (this.window) {
            this.cleanupResources();
            this.window.close();
            this.window = null;
        }
    }
    setup() {
        this.initWindowHandlers();
        this.initFileHandlers();
        this.initAIHandlers();
        this.initConfigHandlers();
    }
    // --- Private Helpers ---
    executeOnLoad(callback) {
        if (this.window?.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', callback);
        }
        else {
            callback();
        }
    }
    getCodeConfig() {
        return this.utils().getConfig("code") || {};
    }
    cleanupResources() {
        this.llmServiceCompletion?.stopLoop();
        this.llmServiceRefactor?.stopLoop();
        this.llmServiceCompletion = null;
        this.reactAgentCompletion = null;
        this.llmServiceRefactor = null;
        this.reactAgentRefactor = null;
    }
    // --- Handler Initializations ---
    initWindowHandlers() {
        electron_1.ipcMain.on('minimize-window', () => electron_1.BrowserWindow.getFocusedWindow()?.minimize());
        electron_1.ipcMain.on('close-window', () => electron_1.BrowserWindow.getFocusedWindow()?.close());
        electron_1.ipcMain.handle('show-log', (_, { type, content }) => this.windowManager.alertWindow?.show(type, content));
    }
    initFileHandlers() {
        electron_1.ipcMain.handle('get-file', (_, filePath) => this.utils().getFile(filePath));
        electron_1.ipcMain.handle('set-file', (_, content, filePath) => {
            this.utils().setFile(content, filePath);
            this.windowManager.alertWindow?.show("success", "File saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
        });
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
            if (result.canceled || !result.filePath)
                return null;
            globals_1.store.set('last_saved_dir', path.dirname(result.filePath));
            return result.filePath;
        });
        electron_1.ipcMain.handle('open-dropped-file', async (_, filePath) => {
            try {
                if (typeof filePath === 'string' && filePath) {
                    this.openFile(filePath);
                    return { success: true, message: 'File loaded' };
                }
                return { success: false, message: 'Invalid file path' };
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                return { success: false, message: `Load failed: ${msg}` };
            }
        });
    }
    initConfigHandlers() {
        electron_1.ipcMain.handle('get-code-config', () => this.getCodeConfig());
        electron_1.ipcMain.handle('get-auto-features', () => ({
            auto_complete: this.autoCompleteEnabled,
            auto_error_correct: this.autoErrorCorrectEnabled
        }));
        electron_1.ipcMain.handle('set-auto-complete', (_, enabled) => {
            this.autoCompleteEnabled = enabled;
            return { success: true, enabled: this.autoCompleteEnabled };
        });
        electron_1.ipcMain.handle('set-auto-error-correct', (_, enabled) => {
            this.autoErrorCorrectEnabled = enabled;
            return { success: true, enabled: this.autoErrorCorrectEnabled };
        });
    }
    initAIHandlers() {
        electron_1.ipcMain.on('clear-completion', () => this.llmServiceCompletion?.stopLoop());
        electron_1.ipcMain.on('clear-refactor', () => this.llmServiceRefactor?.stopLoop());
        // 在 initAIHandlers() 中修改补全逻辑
        electron_1.ipcMain.handle('code-completion', async (_, { prefix, suffix, isMidWord }) => {
            try {
                this.llmServiceCompletion?.stopLoop();
                this.llmServiceCompletion = this.llmService();
                this.reactAgentCompletion = new LLMBase_1.LLMBase(this.llmServiceCompletion, null, this.utils());
                const config = this.getCodeConfig().completion;
                // 【核心修改】新增 Rule 5，让模型在生成前就在语义上建立长度意识
                const defaultPrompt = `You are a universal context-aware completion engine.
Analyze the provided prefix and suffix context to seamlessly complete the missing content at the <CURSOR> position.

Rules:
1. Context Adaptive: If the context is programming code, output valid code matching the language, syntax, and indentation. If the context is natural language (e.g., Markdown, plaintext), output fluent, logically coherent text matching the tone and language.
2. Zero Chat: Output ONLY the exact characters to be inserted. Do NOT include greetings, explanations, or conversational filler.
3. No Markdown Wrapping: Do NOT wrap your output in \`\`\`code blocks\`\`\` unless the context explicitly indicates you are inside a markdown file and a code block is genuinely required.
4. Smooth Integration: Ensure the transition between the prefix, your output, and the suffix is grammatically and syntactically flawless.
5. Length Limit: Keep your completion strictly concise, NEVER exceeding 250 words/characters. Stop naturally before reaching this limit.`;
                const prompt = config?.prompt || defaultPrompt;
                const query = `${prefix}<CURSOR>${suffix}`;
                // 通用的 Stop Tokens 策略：
                // 如果是词中间，遇到换行或空格停止（通常用于补全半个单词/变量名）
                // 如果是行尾/句尾，遇到双换行停止（允许补全多行代码或完整的一段话）
                const stopWords = isMidWord ? ["\n", " "] : ["\n\n"];
                const data = this.reactAgentCompletion.getDataDefault({
                    prompt, query,
                    params: {
                        max_tokens: 250, // API 层面的硬截断
                        stop: stopWords,
                        ...(config?.params || {})
                    }
                });
                return (await this.reactAgentCompletion.llmCall(data)).content;
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Completion failed';
                return { error: msg };
            }
        });
        electron_1.ipcMain.handle('code-refactor', async (_, code) => {
            try {
                this.llmServiceRefactor?.stopLoop();
                this.llmServiceRefactor = this.llmService();
                this.reactAgentRefactor = new LLMBase_1.LLMBase(this.llmServiceRefactor, null, this.utils());
                const config = this.getCodeConfig().refactor;
                const prompt = config?.prompt || `You are a strict code linter. Return JSON: {"errors": [{"text": "...", "fix": "..."}]}.`;
                const data = this.reactAgentRefactor.getDataDefault({
                    prompt, query: code,
                    params: { response_format: { type: "json_object" }, ...(config?.params || {}) }
                });
                return (await this.reactAgentRefactor.llmCall(data)).content;
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Refactor failed';
                return { error: msg };
            }
        });
        electron_1.ipcMain.handle('code-modify', async (_, { selectedText, instruction }) => {
            try {
                const llmService = this.llmService();
                const reactAgent = new LLMBase_1.LLMBase(llmService, null, this.utils());
                const config = this.getCodeConfig().modify;
                // 【修改】新增 Rule 4，明确禁止输出边界标签
                const defaultPrompt = `You are a universal context-aware modification engine.
Apply the user's instruction to the provided content.

Rules:
1. Adaptive Handling: If the content is programming code, strictly maintain syntax, logic, and indentation. If the content is natural language, ensure fluency, grammatical correctness, and appropriate formatting.
2. Zero Chat: Output ONLY the final modified content. Do NOT include greetings, explanations, or any conversational filler.
3. No Markdown Wrapping: Do NOT wrap your output in \`\`\`code blocks\`\`\` unless the original content was already wrapped in them.
4. No Boundary Tags: Do NOT include the [CONTENT START] and [CONTENT END] tags in your output. Return ONLY the bare modified text.`;
                const prompt = config?.prompt || defaultPrompt;
                // 【修改】在引导语结尾再次强化，防止模型带出标签
                const query = `[CONTENT START]${selectedText}[CONTENT END]

Instruction: ${instruction}

Please output the exactly modified content below (without the boundary tags):`;
                const data = reactAgent.getDataDefault({
                    prompt, query,
                    params: { ...(config?.params || {}) }
                });
                return (await reactAgent.llmCall(data)).content;
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Modify failed';
                return { error: msg };
            }
        });
        electron_1.ipcMain.handle('detect-language', async (_, code) => {
            try {
                const llmService = this.llmService();
                const reactAgent = new LLMBase_1.LLMBase(llmService, null, this.utils());
                const config = this.getCodeConfig().detect;
                // 【核心修改】明确规定枚举值，防止 LLM 自由发挥输出 "js", "py", "bash" 等
                const defaultPrompt = `You are a strict language detector. Analyze the content and output EXACTLY ONE of the following keywords:
[javascript, typescript, python, html, markdown, shell, plaintext]
Do NOT output any other words, punctuation, or explanations.`;
                const prompt = defaultPrompt;
                const snippet = code?.length > 1000 ? code.slice(0, 1000) : code;
                const data = reactAgent.getDataDefault({
                    prompt, query: snippet,
                    params: { temperature: 0.1, max_tokens: 10, ...(config?.params || {}) }
                });
                const messageOutput = await reactAgent.llmCall(data);
                if (messageOutput && messageOutput.content) {
                    // 清理可能带入的空格或换行，直接作为语言标识返回
                    const lang = messageOutput.content.trim().toLowerCase().replace(/[^a-z]/g, '');
                    return { language: lang };
                }
                return { language: 'plaintext' };
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : 'Detection failed';
                return { error: msg };
            }
        });
    }
}
exports.CodeWindow = CodeWindow;
//# sourceMappingURL=CodeWindow.js.map