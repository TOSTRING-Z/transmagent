const { Window } = require("./Window");
const { utils } = require('./globals');
const { ReActAgent } = require('../server/agent');
const { LLMService } = require('../server/llm_service');

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
                width: 1600,
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

        // 获取API信息（api_key, api_url）
        ipcMain.handle('get-apis', () => {

        });

        // 代码补全
        ipcMain.handle('code-completion', async (event, { prefix, suffix, isMidWord }) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent({}, llm_service);

                const prompt = "你是一个代码/文本补全引擎。如果光标在单词中间，仅补全后缀。如果光标在行尾，补全逻辑。直接输出代码，无Markdown。如果不需要补全，返回空字符串。只输出部分补全然后截断（例如 1-2 行或不超过 80 个字符），以便后续请求继续生成。";
                const query = `[Context]:\n${prefix}<CURSOR>\n${suffix}`;

                const requestData = {
                    prompt,
                    query,
                    params: {
                        max_tokens: 30,
                        stop: isMidWord ? ["\n", " "] : ["\n\n"]
                    }
                };

                const data = react_agent.getDataDefault(requestData);
                // 确保 model 被正确设置

                const result = await react_agent.llmCall(data);
                return result;
            } catch (e) {
                console.error("Code completion error:", e);
                return { error: e.message };
            }
        });

        // 代码重构分析
        ipcMain.handle('code-refactor', async (event, code) => {
            try {
                const llm_service = new LLMService();
                const react_agent = new ReActAgent({}, llm_service);

                const prompt = `你是一个严格的 Code Linter。找出逻辑错误。返回 JSON: {"errors": [{"text": "错误代码", "fix": "修正代码"}]}。 如果没有错误，返回 {"errors": []}。不要添加多余说明。`;

                const requestData = {
                    prompt,
                    query: code,
                    params: {
                        response_format: { type: "json_object" }
                    }
                };

                const data = react_agent.getDataDefault(requestData);

                const result = await react_agent.llmCall(data);
                return result;
            } catch (e) {
                console.error("Code refactor error:", e);
                return { error: e.message };
            }
        });
    }

}

module.exports = {
    CodeWindow
};