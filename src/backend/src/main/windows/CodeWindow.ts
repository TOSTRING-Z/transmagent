import { BrowserWindow, ipcMain, dialog } from 'electron';
import * as path from 'path';
import { BaseWindow } from './BaseWindow';
import { WindowManager } from './WindowManager';
import { store, utils } from '../../utils/globals';
import { LLMService } from '../../core/LLMService';
import { ReActAgent } from '../../core/ReActAgent';

export class CodeWindow extends BaseWindow {
    private llm_service_completion: LLMService | null = null;
    private react_agent_completion: ReActAgent | null = null;
    private llm_service_refactor: LLMService | null = null;
    private react_agent_refactor: ReActAgent | null = null;
    private auto_complete_enabled: boolean = false;  // 自动AI补全开关，默认关闭
    private auto_error_correct_enabled: boolean = false;  // 自动错误纠正开关，默认关闭

    constructor(windowManager: WindowManager) {
        super(windowManager);
    }

    public create() {
        if (this.window) {
            this.window.restore();
            this.window.show();
            this.window.focus();
            return;
        }

        this.window = new BrowserWindow({
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

        ipcMain.on('minimize-window', () => {
            BrowserWindow.getFocusedWindow()?.minimize()
        })

        ipcMain.on('close-window', () => {
            BrowserWindow.getFocusedWindow()?.close()
        })
    }

    public openFile(filePath: string) {
        this.create();
        const send = () => this.window?.webContents.send('open-file', filePath);
        if (this.window?.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', send);
        } else {
            send();
        }
    }

    public openContent(content: string) {
        this.create();
        const send = () => this.window?.webContents.send('open-content', content);
        if (this.window?.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', send);
        } else {
            send();
        }
    }

    public destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    public setup() {
        ipcMain.handle('get-file', (_, file_path) => utils.getFile(file_path));

        ipcMain.handle('set-file', (_, content, file_path) => {
            utils.setFile(content, file_path);
            this.windowManager.alertWindow?.show("success", "File saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
        });

        ipcMain.handle('get-code-config', () => utils.getConfig("code") || {});

        ipcMain.handle('open-file-dialog', async () => {
            if (!this.window) return null;
            const lastPath = store.get('last_opened_dir');
            const result = await dialog.showOpenDialog(this.window, {
                properties: ['openFile'],
                defaultPath: lastPath || undefined
            });
            if (result.canceled || result.filePaths.length === 0) return null;
            const filePath = result.filePaths[0];
            store.set('last_opened_dir', path.dirname(filePath));
            this.openFile(filePath);
            return filePath;
        });

        ipcMain.handle('save-as-dialog', async (_, options) => {
            if (!this.window) return null;
            const lastPath = store.get('last_saved_dir');
            const result = await dialog.showSaveDialog(this.window, { ...options, defaultPath: lastPath || undefined });
            if (result.canceled) return null;
            store.set('last_saved_dir', path.dirname(result.filePath));
            return result.filePath;
        });

        ipcMain.handle('show-log', (_, { type, content }: { type: string; content: string }) => {
            this.windowManager.alertWindow?.show(type, content);
        });

        ipcMain.handle('open-dropped-file', async (_, filePath: string) => {
            try {
                if (filePath && typeof filePath === 'string') {
                    this.openFile(filePath);
                    return { success: true, message: 'File loaded' };
                }
                return { success: false, message: 'Invalid file path' };
            } catch (error: any) {
                return { success: false, message: `Load failed: ${error.message}` };
            }
        });

        ipcMain.on('clear-completion', () => this.llm_service_completion?.stopMessage());
        ipcMain.on('clear-refactor', () => this.llm_service_refactor?.stopMessage());

        ipcMain.handle('code-completion', async (_, { prefix, suffix, isMidWord }: { prefix: string; suffix: string; isMidWord: boolean }) => {
            try {
                this.llm_service_completion?.stopMessage();
                this.llm_service_completion = new LLMService();
                this.react_agent_completion = new ReActAgent(this.llm_service_completion);

                const prompt = utils.getConfig("code")?.completion?.prompt || "You are a code/text completion engine. Output code directly, no Markdown. If no completion is needed, return an empty string.";
                const query = `${prefix}<CURSOR>${suffix}`;
                const data = this.react_agent_completion.getDataDefault({
                    prompt, query,
                    params: { max_tokens: 200, stop: isMidWord ? ["\n", " "] : ["\n\n"], ...(utils.getConfig("code")?.completion?.params || {}) }
                });
                return await this.react_agent_completion.llmCall(data);
            } catch (e: any) {
                console.error("Code completion error:", e);
                return { error: e.message };
            }
        });

        ipcMain.handle('code-refactor', async (_, code: string) => {
            try {
                this.llm_service_refactor?.stopMessage();
                this.llm_service_refactor = new LLMService();
                this.react_agent_refactor = new ReActAgent(this.llm_service_refactor);

                const prompt = utils.getConfig("code")?.refactor?.prompt || `You are a strict code linter. Return JSON: {"errors": [{"text": "erroneous_code", "fix": "fixed_code"}]}.`;
                const data = this.react_agent_refactor.getDataDefault({
                    prompt, query: code,
                    params: { response_format: { type: "json_object" }, ...(utils.getConfig("code")?.refactor?.params || {}) }
                });
                return await this.react_agent_refactor.llmCall(data);
            } catch (e: any) {
                console.error("Code refactor error:", e);
                return { error: e.message };
            }
        });

        ipcMain.handle('code-modify', async (_, { selectedText, instruction }: { selectedText: string; instruction: string }) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent(llm_service);
                const prompt = utils.getConfig("code")?.modify?.prompt || "You are an intelligent code assistant. Return only the modified code, no Markdown markers.";
                const query = `[CODE START]\n${selectedText}\n[CODE END]\n\nUser instruction: ${instruction}\n\nPlease modify the code above:`;
                const data = react_agent.getDataDefault({
                    prompt, query,
                    params: { ...(utils.getConfig("code")?.modify?.params || {}) }
                });
                return await react_agent.llmCall(data);
            } catch (e: any) {
                console.error("Code modify error:", e);
                return { error: e.message };
            }
        });

        // 获取自动AI补全和错误纠正开关状态
        ipcMain.handle('get-auto-features', () => {
            return {
                auto_complete: this.auto_complete_enabled,
                auto_error_correct: this.auto_error_correct_enabled
            };
        });

        // 设置自动AI补全开关
        ipcMain.handle('set-auto-complete', (_, enabled: boolean) => {
            this.auto_complete_enabled = enabled;
            return { success: true, enabled: this.auto_complete_enabled };
        });

        // 设置自动错误纠正开关
        ipcMain.handle('set-auto-error-correct', (_, enabled: boolean) => {
            this.auto_error_correct_enabled = enabled;
            return { success: true, enabled: this.auto_error_correct_enabled };
        });

        ipcMain.handle('detect-language', async (_, code: string) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent(llm_service);
                const prompt = "You are a programming language detector. Output ONLY the lowercase language name.";
                const snippet = code?.length > 1000 ? code.slice(0, 1000) : code;
                const data = react_agent.getDataDefault({
                    prompt, query: snippet,
                    params: { temperature: 0.1, max_tokens: 20, ...(utils.getConfig("code")?.detect?.params || {}) }
                });
                const messageOutput = await react_agent.llmCall(data);
                if (messageOutput) {
                    let lang = (messageOutput.content as string).trim().toLowerCase().replace(/[^a-z0-9+#]/g, '');
                    return { language: lang };
                }
                return { language: 'plaintext' };
            } catch (e: any) {
                console.error("Language detection error:", e);
                return { error: e.message };
            }
        });
    }
}