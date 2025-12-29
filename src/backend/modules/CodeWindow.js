const { Window } = require("./Window");
const { utils } = require('./globals');
const { ReActAgent } = require('../server/agent');
const { LLMService } = require('../server/llm_service');
const { dialog } = require('electron');
const { store } = require('./globals');
const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');


class CodeWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
    }

    create() {
        if (this.window) {
            this.window.restore(); // 恢复窗口
            this.window.show();
            this.window.focus();
        } else {
            this.window = new BrowserWindow({
                width: 1000,
                height: 700,
                frame: false, // 取消默认标题栏和边框
                transparent: true, // 可选：实现透明效果
                resizable: true, // 允许改变窗口大小
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false
                }
            })

            this.window.loadFile('src/frontend/code.html')
            this.window.on('closed', () => {
                this.window = null;
            })

            this.window.on('ready-to-show', () => {
                // this.window.webContents.openDevTools();
            });

            ipcMain.on('minimize-window', () => {
                BrowserWindow.getFocusedWindow().minimize()
            })

            ipcMain.on('close-window', () => {
                BrowserWindow.getFocusedWindow().close()
            })
        }
    }

    openFile(filePath) {
        this.create();
        if (this.window.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', () => {
                this.window.webContents.send('open-file', filePath);
            });
        } else {
            this.window.webContents.send('open-file', filePath);
        }
    }

    openContent(content) {
        this.create();
        if (this.window.webContents.isLoading()) {
            this.window.webContents.once('did-finish-load', () => {
                this.window.webContents.send('open-content', content);
            });
        } else {
            this.window.webContents.send('open-content', content);
        }
    }

    destroy() {
        if (this.window) {
            this.window.close();
            this.window = null;
        }
    }

    setup() {
        // 获取文件
        ipcMain.handle('get-file', (file_path) => {
            return utils.getFile(file_path);
        });

        // 保存文件
        ipcMain.handle('set-file', (content, file_path) => {
            utils.setFile(content, file_path);
            this.windowManager.alertWindow.show("success", "file saved, restart to apply");
            this.windowManager.mainWindow.restart(this.windowManager.mainWindow.window);
        });

        ipcMain.handle('get-code-config', () => {
            return utils.getConfig("code") || {};
        });

        ipcMain.handle('open-file-dialog', async () => {
            const lastPath = store.get('last_opened_dir');
            const result = await dialog.showOpenDialog(this.window, {
                properties: ['openFile'],
                defaultPath: lastPath || undefined
            });
            if (result.canceled || result.filePaths.length === 0) {
                return null;
            } else {
                const filePath = result.filePaths[0];
                store.set('last_opened_dir', path.dirname(filePath));
                this.openFile(filePath);
                return filePath;
            }
        });

        ipcMain.handle('save-as-dialog', async (event, options) => {
            const lastPath = store.get('last_saved_dir');
            const result = await dialog.showSaveDialog(this.window, {
                ...options,
                defaultPath: lastPath || undefined
            });
            if (result.canceled) {
                return null;
            } else {
                store.set('last_saved_dir', path.dirname(result.filePath));
                return result.filePath;
            }
        });

        ipcMain.handle('show-log', (event, { type, content }) => {
            this.windowManager.alertWindow.show(type, content);
        });

        // 文件拖放支持
        ipcMain.handle('open-dropped-file', async (event, filePath) => {
            try {
                if (filePath && typeof filePath === 'string') {
                    this.openFile(filePath);
                    return { success: true, message: '文件已加载' };
                } else {
                    return { success: false, message: '无效的文件路径' };
                }
            } catch (error) {
                console.log('文件拖放加载失败:', error);
                return { success: false, message: '文件加载失败: ' + error.message };
            }
        });

        // 清除补全
        ipcMain.on('clear-completion', () => {
            this.llm_service_completion?.stopMessage();
        });

        // 清除重构
        ipcMain.on('clear-refactor', () => {
            this.llm_service_refactor?.stopMessage();
        });

        // 代码补全
        ipcMain.handle('code-completion', async (event, { prefix, suffix, isMidWord }) => {
            try {
                this.llm_service_completion?.stopMessage();
                this.llm_service_completion = new LLMService();
                this.react_agent_completion = new ReActAgent({}, this.llm_service_completion);

                const prompt = utils.getConfig("code")?.completion?.prompt || "You are a code/text completion engine. If the cursor <CURSOR> is in the middle of a word, only complete the suffix. If the cursor is at the end of a line, complete the logical continuation. Output code directly, no Markdown. If no completion is needed, return an empty string. You are a code completion tool.\nRules:\n1. Your output will be concatenated directly after the cursor <CURSOR>.\n2. Do not repeat any content that appears before the cursor.\n3. Output only the completion; do not explain and do not include any Markdown markers (e.g. ```).\n4. If the cursor is at the end of a line, usually only complete the logic following the newline.\n5. If no completion is needed, return an empty string.";
                const query = `${prefix}<CURSOR>${suffix}`;

                const requestData = {
                    prompt,
                    query,
                    params: {
                        max_tokens: 200,
                        stop: isMidWord ? ["\n", " "] : ["\n\n"],
                        ...(utils.getConfig("code")?.completion?.params || {})
                    }
                };

                const data = this.react_agent_completion.getDataDefault(requestData);
                const result = await this.react_agent_completion.llmCall(data);
                return result;
            } catch (e) {
                console.log("Code completion error:", e);
                return { error: e.message };
            }
        });

        // 代码重构分析
        ipcMain.handle('code-refactor', async (event, code) => {
            try {
                this.llm_service_refactor?.stopMessage();
                this.llm_service_refactor = new LLMService();
                this.react_agent_refactor = new ReActAgent({}, this.llm_service_refactor);

                const prompt = utils.getConfig("code")?.refactor?.prompt || `You are a strict code linter. Identify logical errors. Return JSON in the format: {"errors": [{"text": "erroneous_code", "fix": "fixed_code"}]}. If there are no errors, return {"errors": []}. Do not add any extra explanations.`;

                const requestData = {
                    prompt,
                    query: code,
                    params: {
                        response_format: { type: "json_object" },
                        ...(utils.getConfig("code")?.refactor?.params || {})
                    }
                };

                const data = this.react_agent_refactor.getDataDefault(requestData);

                const result = await this.react_agent_refactor.llmCall(data);
                return result;
            } catch (e) {
                console.log("Code refactor error:", e);
                return { error: e.message };
            }
        });

        // 代码智能修改
        ipcMain.handle('code-modify', async (event, { selectedText, instruction }) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent({}, llm_service);

                const prompt = utils.getConfig("code")?.modify?.prompt || "You are an intelligent code assistant. Modify the provided code snippet according to the user's instructions. Return only the modified code, do not include any Markdown markers (e.g. ```), and do not include any explanatory text. If no changes are needed, return the original code unchanged.";
                
                const query = `[CODE START]\n${selectedText}\n[CODE END]\n\nUser instruction: ${instruction}\n\nPlease modify the code above:`;

                const requestData = {
                    prompt,
                    query,
                    params: {
                        ...(utils.getConfig("code")?.modify?.params || {})
                    }
                };

                const data = react_agent.getDataDefault(requestData);
                const result = await react_agent.llmCall(data);
                return result;
            } catch (e) {
                console.log("Code modify error:", e);
                return { error: e.message };
            }
        });

        // 语言自动检测
        ipcMain.handle('detect-language', async (event, code) => {
            try {
                // 使用短暂的 agent 实例
                const llm_service = new LLMService();
                const react_agent = new ReActAgent({}, llm_service);

                const prompt = "You are a programming language detector. Analyze the following code snippet and return only the lowercase language name (e.g., javascript, python, java, c++, html, css, sql, json, markdown, shell). If the code is too short or ambiguous, make your best guess. If it's pure text, return 'plaintext'. Output ONLY the language name, no punctuation or explanation.";

                // 截取前 1000 个字符进行分析即可，无需发送全部代码
                const snippet = code && code.length > 1000 ? code.slice(0, 1000) : code;

                const requestData = {
                    prompt,
                    query: snippet,
                    params: {
                        temperature: 0.1, // 低温度以获得确定性结果
                        max_tokens: 20,
                        ...(utils.getConfig("code")?.detect?.params || {})
                    }
                };

                const data = react_agent.getDataDefault(requestData);
                const result = await react_agent.llmCall(data);
                
                // 清理结果，移除可能的空白或点号
                if (result) {
                    let lang = result.trim().toLowerCase();
                    // 移除末尾可能的标点
                    lang = lang.replace(/[^a-z0-9+#]/g, '');
                    return { language: lang };
                }
                return { language: 'plaintext' };
            } catch (e) {
                console.log("Language detection error:", e);
                return { error: e.message };
            }
        });
    }

}

module.exports = {
    CodeWindow
};