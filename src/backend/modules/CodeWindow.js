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
                this.window.webContents.openDevTools();
            });

            ipcMain.on('minimize-window', () => {
                this.window.minimize()
            })

            ipcMain.on('close-window', () => {
                this.window.close()
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

        // 代码补全
        ipcMain.handle('code-completion', async (event, { prefix, suffix, isMidWord }) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent({}, llm_service);

                const prompt = utils.getConfig("code")?.completion?.prompt || "你是一个代码/文本补全引擎。如果光标<CURSOR>在单词中间，仅补全后缀。如果光标在行尾，补全逻辑。直接输出代码，无Markdown。如果不需要补全，返回空字符串。你是一个代码补全工具。\n规则：\n1. 你的输出将被直接拼接到光标<CURSOR>后面。\n2. 严禁重复光标前的内容。\n3. 只输出补全部分，不要解释，不要使用 markdown 格式。\n4. 如果光标在行尾，通常只需要补全换行后的逻辑。\n5. 如果不需要补全，返回空字符串。";
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

                const data = react_agent.getDataDefault(requestData);
                const result = await react_agent.llmCall(data);
                return result;
            } catch (e) {
                console.log("Code completion error:", e);
                return { error: e.message };
            }
        });

        // 代码重构分析
        ipcMain.handle('code-refactor', async (event, code) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent({}, llm_service);

                const prompt = utils.getConfig("code")?.refactor?.prompt || `你是一个严格的 Code Linter。找出逻辑错误。返回 JSON: {"errors": [{"text": "错误代码", "fix": "修正代码"}]}。 如果没有错误，返回 {"errors": []}。不要添加多余说明。`;

                const requestData = {
                    prompt,
                    query: code,
                    params: {
                        response_format: { type: "json_object" },
                        ...(utils.getConfig("code")?.refactor?.params || {})
                    }
                };

                const data = react_agent.getDataDefault(requestData);

                const result = await react_agent.llmCall(data);
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

                const prompt = utils.getConfig("code")?.modify?.prompt || "你是一个智能代码助手。请根据用户的指令修改下面提供的代码片段。只返回修改后的代码，不要包含任何 Markdown 标记（如 ```），不要包含任何解释性文字。如果无需修改，原样返回。";
                
                const query = `[代码片段开始]\n${selectedText}\n[代码片段结束]\n\n用户指令：${instruction}\n\n请修改上述代码：`;

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
    }

}

module.exports = {
    CodeWindow
};