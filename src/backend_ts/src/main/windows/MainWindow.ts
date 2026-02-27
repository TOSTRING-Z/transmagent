import { BrowserWindow, Menu, shell, ipcMain, clipboard, dialog, app, MenuItemConstructorOptions } from 'electron';
import { JSDOM } from "jsdom";
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'ssh2';
import { Worker } from 'worker_threads';

import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { store, globalState, inner, utils, sysConfig } from '../../utils/globals';
import { LLMService } from '../../core/LLMService';
import { State } from "../../core/ReActAgent";
import { ToolCall } from '../../core/ToolCall';
import { ChainCall } from '../../core/ChainCall';
import { Plugins } from '../../core/Plugins';
import { captureMouse } from '../../mouse/CaptureMouse';
import { install } from '../../core/Install';
import { MainServer } from '../../server/MainServer';

// 定义 FuncItems 结构以启用严格模式
interface FuncItemNode {
    statu: boolean;
    event?: any;
    click?: () => void;
    [key: string]: any;
}

export class MainWindow extends BaseWindow {
    public funcItems: Record<string, FuncItemNode>;
    public plugins: any;
    public llm_service!: LLMService;
    public tool_call!: ToolCall;
    public chain_call!: ChainCall;
    public main_server: any;
    public worker: any;

    constructor(windowManager: WindowManager) {
        super(windowManager);
        this.funcItems = {
            clip: {
                statu: utils.getConfig("func_status")?.clip || false,
                event: () => { },
                click: () => { this.funcItems.clip.statu = !this.funcItems.clip.statu; }
            },
            markdown: {
                statu: utils.getConfig("func_status")?.markdown || false,
                event: () => { },
                click: () => {
                    this.funcItems.markdown.statu = !this.funcItems.markdown.statu;
                    this.funcItems.markdown.event();
                }
            },
            text: {
                statu: utils.getConfig("func_status")?.text || false,
                event: () => { },
                click: () => { this.funcItems.text.statu = !this.funcItems.text.statu; }
            },
            del: {
                statu: utils.getConfig("func_status")?.del || false,
                event: () => { },
                click: () => { this.funcItems.del.statu = !this.funcItems.del.statu; }
            },
            react: {
                statu: utils.getConfig("func_status")?.react || true,
                event: () => { },
                transagent: {
                    statu: globalState.config === sysConfig.transagent,
                    config: sysConfig.transagent,
                    click: () => {
                        this.funcItems.react.event();
                        store.set("config", sysConfig.transagent);
                        this.restart(this.window);
                    }
                },
                baseagent: {
                    statu: globalState.config === sysConfig.baseagent,
                    config: sysConfig.baseagent,
                    click: () => {
                        this.funcItems.react.event();
                        store.set("config", sysConfig.baseagent);
                        this.restart(this.window);
                    }
                },
                multagent: {
                    statu: globalState.config === sysConfig.multagent,
                    config: sysConfig.multagent,
                    click: () => {
                        this.funcItems.react.event();
                        store.set("config", sysConfig.multagent);
                        this.restart(this.window);
                    }
                },
                llm: {
                    statu: false,
                    click: () => {
                        this.funcItems.react.statu = !this.funcItems.react.statu;
                        this.funcItems.react.llm.statu = !this.funcItems.react.llm.statu;
                        this.funcItems.react.event();
                        this.updateVersionsSubmenu();
                    }
                },
            },
        };
    }

    destroy(): void {
        this.window?.close();
    }

    public restart(window: BrowserWindow | null) {
        if (!window) return;
        dialog.showMessageBox(window, {
            type: 'question',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: 'Restart Application',
            message: 'Agent configuration has been changed. A restart is required for changes to take effect. Restart now?'
        }).then(({ response }) => {
            if (response === 0) {
                try {
                    app.relaunch();
                    app.exit(0);
                } catch (err) {
                    console.error('Failed to restart app:', err);
                }
            }
        }).catch(err => console.error('Restart prompt failed:', err));
    }

    public setupHeartbeat() {
        const heartbeat = utils.getConfig("heartbeat");
        if (heartbeat && heartbeat.enabled) {
            console.log(`[Heartbeat] Service started. Interval: ${heartbeat.interval}s`);
            setInterval(async () => {
                if (this.tool_call && (this.tool_call.state === State.IDLE || this.tool_call.state === State.FINAL)) {
                    try {
                        let time = this.tool_call.environment_details.time;
                        let data = { query: `[${time}] This is a heartbeat timestamp. Please keep the system active.` };
                        this.send_query(data, this.llm_service.chatManager.chat.model, this.llm_service.chatManager.chat.version);
                    } catch (e) {
                        console.error("[Heartbeat] Execution failed:", e);
                    }
                }
            }, heartbeat.interval * 1000);
        }
    }

    public create() {

        this.window = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                preload: path.join(__dirname, '../preload.js'),
            },
        });

        this.plugins = new Plugins();
        this.plugins.init();
        this.llm_service = new LLMService([], this.window);

        let tools = this.plugins.getTool();
        let agent_mode = "transagent";
        let mcp_server = true;

        if (this.funcItems.react.transagent.statu && utils.getConfig("tool_call")?.subagent) {
            tools = { ...tools, "tool_manager": this.windowManager.subAgentWindow?.agentTools?.["tool_manager"] };
        }
        if (this.funcItems.react.multagent.statu) {
            agent_mode = "multagent";
            mcp_server = false;
            tools = { ...tools, ...this.windowManager.subAgentWindow?.getMainSubAgent() };
        }
        if (this.funcItems.react.baseagent.statu) {
            agent_mode = "baseagent";
        }

        this.tool_call = new ToolCall(this.plugins, tools, this.llm_service, this.window, this.windowManager.alertWindow, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            subagent: false,
            agent_mode: agent_mode,
            tool_format: this.llm_service.chatManager.chat.tool_format
        });

        this.chain_call = new ChainCall(this.plugins, this.llm_service, this.window, this.windowManager.alertWindow);
        this.main_server = new MainServer(this);

        // 启动 WebServer Worker
        this.worker = new Worker(path.join(__dirname, '../../server/MainWorker.js'));

        // 传入配置启动
        const webserverConfig = utils.getConfig("webserver");
        this.worker.postMessage({
            type: 'start',
            config: {
                port: webserverConfig?.port || 3005,
                timeoutMs: webserverConfig?.timeout || 12 * 60 * 60 * 1000
            }
        });

        // 接收 Worker 的业务请求并分发
        this.worker.on('message', (request: any) => {
            const { requestId, cdata } = request;
            if (!cdata?.method) return;

            const handler = (this.main_server as any)[cdata.method];
            if (typeof handler === 'function') {
                handler.call(this.main_server, cdata.data)
                    .then((result: any) => this.worker.postMessage({ requestId, result }))
                    .catch((error: Error) => this.worker.postMessage({ requestId, result: { error: error.message } }));
            } else {
                console.error(`[MainWindow] Unknown worker method: ${cdata.method}`);
                this.worker.postMessage({ requestId, result: { error: `Unknown method: ${cdata.method}` } });
            }
        });

        this.worker.on('error', (err: Error) => {
            console.error('[MainWindow] Worker error:', err);
        });

        this.window.on('focus', () => {
            this.window?.setAlwaysOnTop(true);
            setTimeout(() => this.window?.setAlwaysOnTop(false), 0);
        });

        const menu = Menu.buildFromTemplate(this.getTemplate());
        Menu.setApplicationMenu(menu);

        this.window.loadFile('src/frontend/index.html');

        this.window.webContents.on('did-finish-load', () => {
            this.initFuncItems();
            this.initInfo();
            this.setupHeartbeat();
        });

        this.window.webContents.on('will-navigate', (event, url) => {
            function isValidUrl(urlStr: string) {
                try { new URL(urlStr); return true; } catch { return false; }
            }
            event.preventDefault();
            console.log(`Attempt to navigate to: ${url}, has been blocked`);
            if (isValidUrl(url)) {
                shell.openExternal(url).catch(err => console.error('Failed to open link:', err.message));
            } else {
                console.error('Invalid URL:', url);
            }
        });

        this.window.on('close', () => {
            this.windowManager.closeAllWindows();
        });

        this.window.on('closed', () => {
            this.window = null;
        });

        globalState.last_clipboard_content = clipboard.readText();
    }

    public setup() {
        ipcMain.on('open-code-editor', (event, filePath) => {
            if (this.windowManager.codeWindow) this.windowManager.codeWindow.openFile(filePath);
        });

        ipcMain.on('open-code-editor-content', (event, content) => {
            if (this.windowManager.codeWindow) this.windowManager.codeWindow.openContent(content);
        });

        ipcMain.handle('get-file-path', async () => {
            return new Promise((resolve, reject) => {
                const lastDirectory = store.get('lastFileDirectory') || utils.getDefault("config.json");
                dialog.showOpenDialog(this.window!, { properties: ['openFile'], defaultPath: lastDirectory })
                    .then(result => {
                        if (!result.canceled) {
                            const filePath = result.filePaths[0];
                            store.set('lastFileDirectory', path.dirname(filePath));
                            if (this.funcItems.react.statu) {
                                const ssh_config = utils.getSshConfig();
                                if (ssh_config?.enabled) {
                                    const conn = new Client();
                                    conn.on('ready', () => {
                                        conn.sftp((err, sftp) => {
                                            if (err) throw err;
                                            const remotePath = `/tmp/${path.basename(filePath)}`;
                                            this.window?.webContents.send('upload-progress', { state: "start" });

                                            const readStream = fs.createReadStream(filePath);
                                            const writeStream = sftp.createWriteStream(remotePath);
                                            const fileSize = fs.statSync(filePath).size;
                                            let uploadedSize = 0;

                                            readStream.on('data', (chunk) => {
                                                uploadedSize += chunk.length;
                                                this.window?.webContents.send('upload-progress', { state: "progress", progress: Math.round((uploadedSize / fileSize) * 100) });
                                            });

                                            writeStream.on('close', () => {
                                                conn.end();
                                                this.window?.webContents.send('upload-progress', { state: "end", remotePath });
                                            });
                                            writeStream.on('error', (err) => {
                                                conn.end();
                                                this.window?.webContents.send('upload-progress', { state: "error", error: err.message });
                                            });
                                            readStream.pipe(writeStream);
                                        });
                                    }).on('error', (err) => {
                                        this.window?.webContents.send('upload-progress', { state: "error", error: err.message });
                                    }).connect(ssh_config);
                                } else resolve(filePath);
                            } else resolve(filePath);
                        }
                    }).catch(err => reject(err));
            });
        });

        ipcMain.handle('query-text', async (_event, data) => {
            if (process.platform !== 'win32') this.window?.show();
            else this.window?.focus();

            if (globalState.status.auto_opt) await this.tool_call.contextAutoOpt(data);

            data = this.tool_call.getDataDefault({ ...data });
            data.query = this.funcItems.text.event(data.query);
            this.llm_service.startMessage();

            if (data?.is_plugin) {
                let content = await this.chain_call.pluginCall(data);
                this.window?.webContents.send('stream-data', { id: data.id, content: content, end: true, is_plugin: data.is_plugin });
            } else if (this.funcItems.react.statu) {
                await this.tool_call.callReAct(data);
                this.tool_call.save_long_term_memory(data.query, data.output_formats.find((_: string) => _.includes("final_answer")));
            } else {
                await this.chain_call.callChain(data);
                this.tool_call.save_long_term_memory(data.query, data.output_formats[0]);
            }
        });

        // ============================================
        // 适配后的 ChatManager 调用 (替换 toggleMessage 等)
        // ============================================
        ipcMain.handle("compression-message", async (_event, data) => {
            let compression_content = await this.tool_call.compression_message({ ...data });
            this.tool_call.setHistory();
            return { compression_content };
        });

        ipcMain.handle("toggle-message", async (_event, data) => {
            this.tool_call.setHistory();
            return { del_mode: !!this.funcItems.del.statu };
        });

        ipcMain.handle("thumb-message", async (_event, data) => {
            let result = this.llm_service.chatManager.thumbMessage(data);
            if (result?.type === "messages") {
                const messages = result.data;
                this.tool_call.setHistory();
                utils.sendData(inner.url_base.data.collection, {
                    "chat_id": this.llm_service.chatManager.chat.id,
                    "message_id": data.id,
                    "user_message": messages[0].content,
                    "agent_messages": messages,
                });
                return messages ? data.thumb : 0;
            } else if (result?.type === "thumb") {
                return result.data;
            }
        });

        ipcMain.handle("toggle-memory", async (_event, context_id) => {
            this.tool_call.setHistory();
            return { del_mode: !!this.funcItems.del.statu };
        });

        ipcMain.on("toggle-auto-opt", () => {
            globalState.status.auto_opt = !globalState.status.auto_opt;
        });

        ipcMain.on("stream-message-stop", () => {
            this.llm_service.stopMessage();
            this.windowManager.subAgentWindow?.destroy();
        });

        ipcMain.on('submit', (_event, formData) => {
            this.send_query(formData, this.llm_service.chatManager.chat.model, this.llm_service.chatManager.chat.version);
        });

        ipcMain.on('change-mode', (_event, mode) => {
            this.tool_call.change_mode(mode);
        });

        ipcMain.on('open-external', (_event, href) => shell.openExternal(href));

        ipcMain.handle('new-chat', () => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.tool_call.newChat();
            this.updateVersionsSubmenu();
            return chat;
        });

        ipcMain.handle('load-chat', (_event, id) => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.tool_call.loadChat(id);
            this.updateVersionsSubmenu();
            return chat;
        });

        ipcMain.on('del-chat', (_event, id) => {
            this.tool_call.delHistory(id);
        });

        ipcMain.on('rename-chat', (_event, chat) => this.tool_call.renameHistory(chat));

        ipcMain.handle('get-config-main', () => utils.getConfig());

        ipcMain.handle('set-config-main', (_, config) => {
            let state = utils.setConfig(config);
            this.updateVersionsSubmenu();
            const plugins = new Plugins();
            plugins.init();
            return state;
        });

        ipcMain.handle('envs', (_, data) => {
            if (data.type === "set") {
                this.llm_service.chatManager.chat.envs = data.envs;
                this.tool_call.setHistory();
                return true;
            } else {
                return this.tool_call?.llm_service.chatManager.chat.envs || {};
            }
        });

        ipcMain.handle('tasks', (_, data) => {
            if (data.type === "set") {
                this.llm_service.chatManager.chat.vars.tasks = data.tasks;
                this.tool_call.setHistory();
                return true;
            } else {
                return this.tool_call?.llm_service.chatManager.chat.vars.tasks || [];
            }
        });

        ipcMain.on('set-global', (_, chat) => {
            this.llm_service.chatManager.chat.tokens = chat.tokens;
            this.llm_service.chatManager.chat.seconds = chat.seconds;
        });

        ipcMain.on('show-log', (_, data) => this.windowManager.alertWindow?.create(data));
    }

    public send_query(data: any, model: string, version: string, api_callback = true) {
        data = { ...data, model, version, is_plugin: model === "plugins", id: String(++this.llm_service.chatManager.chat.max_index) };
        this.window?.webContents.send('query', { data, api_callback });
    }

    private getClipEvent(e: FuncItemNode) {
        return setInterval(async () => {
            let clipboardContent = clipboard.readText();
            if (clipboardContent !== globalState.last_clipboard_content) {
                if (globalState.concat) {
                    globalState.last_clipboard_content = `${globalState.last_clipboard_content} ${clipboardContent}`;
                    clipboard.writeText(globalState.last_clipboard_content);
                } else {
                    globalState.last_clipboard_content = clipboardContent;
                }

                if (this.funcItems.text.statu) {
                    try {
                        const dom = new JSDOM(globalState.last_clipboard_content);
                        const plainText = dom.window.document.body.textContent || "";
                        globalState.last_clipboard_content = plainText;
                        clipboard.writeText(plainText);
                    } catch (error) {
                        console.error('Failed to clear clipboard formatting:', error);
                    }
                }

                if (e.statu) {
                    captureMouse().then((mousePosition: any) => {
                        this.windowManager.iconWindow?.create(mousePosition);
                    }).catch((error: any) => console.error(error));
                }
            }
        }, 100);
    }

    private getMarkDownEvent(e: FuncItemNode) {
        const markdownFormat = () => this.window?.webContents.send('markdown-format', e.statu);
        markdownFormat();
        return markdownFormat;
    }

    private getTextEvent(e: FuncItemNode) {
        return (text: string) => {
            if (text != null) {
                text = text.replaceAll('-\n', '');
                return e.statu ? text.replace(/[\s\n]+/g, ' ').trim() : text;
            }
        };
    }

    private getReactEvent(e: FuncItemNode) {
        const extraReact = () => {
            this.window?.webContents.send('react-statu', e.statu);
            if ((globalState as any).is_plugin) {
                this.window?.webContents.send("extra_load", e.statu && this.plugins.get[this.llm_service.chatManager.chat.version]?.extra);
            } else {
                const ssh_config = utils.getSshConfig();
                let extra = [{ "type": "act-plan" }];
                if (ssh_config?.enabled) extra.push({ "type": "file-upload" });
                this.window?.webContents.send("extra_load", e.statu ? extra : utils.getConfig("extra"));
            }
        };
        extraReact();
        return extraReact;
    }

    private initFuncItems() {
        this.funcItems.clip.event = this.getClipEvent(this.funcItems.clip);
        this.funcItems.markdown.event = this.getMarkDownEvent(this.funcItems.markdown);
        this.funcItems.text.event = this.getTextEvent(this.funcItems.text);
        this.funcItems.react.event = this.getReactEvent(this.funcItems.react);
    }

    private initInfo() {
        const filePath = utils.getConfig("prompt");
        let prompt = "";
        if (fs.existsSync(filePath)) prompt = fs.readFileSync(filePath, 'utf-8');

        const history_data = utils.getHistoryData();
        this.window?.webContents.send('init-info', {
            prompt,
            ...globalState,
            model: this.llm_service.chatManager.chat.model,
            version: this.llm_service.chatManager.chat.version,
            tool_format: this.llm_service.chatManager.chat.tool_format,
            is_plugin: this.llm_service.chatManager.chat.is_plugin,
            chat: this.llm_service.chatManager.chat,
            chats: history_data.data
        });
    }

    public updateVersionsSubmenu() {
        const menu = Menu.buildFromTemplate(this.getTemplate());
        Menu.setApplicationMenu(menu);
    }

    private getModelsSubmenu(): MenuItemConstructorOptions[] {
        return Object.keys(utils.getConfig("models")).map((_model) => ({
            type: 'radio',
            checked: this.llm_service.chatManager.chat.model === _model,
            click: () => {
                this.llm_service.chatManager.chat.model = _model;
                (globalState as any).is_plugin = _model === "plugins";
                this.llm_service.chatManager.chat.version = utils.getConfig("models")[_model]["versions"][0].version;
                this.updateVersionsSubmenu();
                this.window?.webContents.send("set-chat", this.llm_service.chatManager.chat);
                if (this.tool_call.setHistory) this.tool_call.setHistory();
            },
            label: _model
        }));
    }

    private getVersionsSubmenu(): MenuItemConstructorOptions[] {
        let versions;
        if ((globalState as any).is_plugin) {
            versions = inner.model[(inner.model_name as any).plugins]["versions"].filter((v: any) => v?.show);
        } else {
            versions = utils.getConfig("models")[this.llm_service.chatManager.chat.model]["versions"];
        }

        this.funcItems.react.event();
        return versions.map((version: any) => {
            const _version = version?.version || version;
            return {
                type: 'radio',
                checked: this.llm_service.chatManager.chat.version === _version,
                click: () => {
                    this.llm_service.chatManager.chat.version = _version;
                    this.window?.webContents.send("set-chat", this.llm_service.chatManager.chat);
                    if (this.tool_call.setHistory) this.tool_call.setHistory();
                    if ((globalState as any).is_plugin) this.window?.webContents.send("extra_load", version?.extra);
                },
                label: _version
            };
        });
    }

    public getTemplate(): MenuItemConstructorOptions[] {
        return [
            { label: "Model Selection", submenu: this.getModelsSubmenu() },
            { label: "Version Selection", submenu: this.getVersionsSubmenu() },
            {
                label: "Tool Format",
                submenu: [
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.tool_format === 'prompt',
                        label: 'Prompt (Default)',
                        click: () => {
                            this.llm_service.chatManager.chat.tool_format = 'prompt';
                            let config = utils.getConfig();
                            config.default.tool_format = 'prompt';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('set-chat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory) this.tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.tool_format === 'openai',
                        label: 'OpenAI (Native API)',
                        click: () => {
                            this.llm_service.chatManager.chat.tool_format = 'openai';
                            let config = utils.getConfig();
                            config.default.tool_format = 'openai';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('set-chat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory) this.tool_call.setHistory();
                        }
                    }
                ]
            },
            {
                label: "Configuration",
                submenu: [
                    { label: 'Model', click: async () => this.windowManager.modelWindow?.create() },
                    { label: 'Tool', click: async () => this.windowManager.toolWindow?.create() },
                    { label: 'Setting', click: async () => this.windowManager.configWindow?.create() },
                    { type: 'separator' },
                    {
                        label: 'Save Configuration',
                        click: () => {
                            const lastPath = path.join(store.get('lastSaveConfigurationPath') || utils.getDefault(), (globalState as any).config);
                            dialog.showSaveDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastSaveConfigurationPath', path.dirname(result.filePath));
                                    fs.writeFileSync(result.filePath, JSON.stringify(utils.getConfig(), null, 2));
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Configuration',
                        click: () => {
                            const lastPath = store.get('lastLoadConfigurationPath') || utils.getDefault();
                            dialog.showOpenDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastLoadConfigurationPath', path.dirname(result.filePaths[0]));
                                    const configFilePath = path.join(utils.getDefault(), (globalState as any).config);
                                    fs.copyFile(result.filePaths[0], configFilePath, (err) => {
                                        if (!err) {
                                            this.windowManager.configWindow?.window?.webContents.send('load-config', configFilePath);
                                            this.restart(this.window);
                                        }
                                    });
                                }
                            });
                        }
                    },
                    {
                        label: 'Default Configuration',
                        click: () => {
                            install(true);
                            this.restart(this.window);
                        }
                    },
                ]
            },
            {
                label: "Function Selection",
                submenu: [
                    { click: this.funcItems.markdown.click, label: 'Auto MarkDown', type: 'checkbox', checked: this.funcItems.markdown.statu },
                    { click: this.funcItems.text.click, label: 'Text Formatting', type: 'checkbox', checked: this.funcItems.text.statu },
                    { click: this.funcItems.clip.click, label: 'Copy Tool', type: 'checkbox', checked: this.funcItems.clip.statu },
                    { click: this.funcItems.del.click, label: 'Delete Mode', type: 'checkbox', checked: this.funcItems.del.statu },
                ]
            },
            {
                label: "Agent",
                submenu: [
                    { label: 'Chain Call', click: async () => this.loadChain() },
                    { label: 'LLM Conversation', click: this.funcItems.react.llm.click, type: 'checkbox', checked: this.funcItems.react.llm.statu },
                    { type: 'separator' },
                    {
                        label: 'Agent Mode',
                        submenu: [
                            { label: 'TransAgent', click: this.funcItems.react.transagent.click, type: 'checkbox', checked: this.funcItems.react.transagent.statu },
                            { label: 'MultAgent', click: this.funcItems.react.multagent.click, type: 'checkbox', checked: this.funcItems.react.multagent.statu },
                            { label: 'BaseAgent', click: this.funcItems.react.baseagent.click, type: 'checkbox', checked: this.funcItems.react.baseagent.statu },
                        ]
                    },
                ]
            },
            {
                label: 'Others',
                submenu: [
                    { type: 'separator' },
                    { label: 'Load System Prompt', click: async () => this.loadPrompt() },
                    { type: 'separator' },
                    {
                        label: 'Reset Conversation',
                        click: () => {
                            this.window?.webContents.send('clear');
                            this.windowManager.subAgentWindow?.destroy();
                            this.tool_call.init_var();
                            const chat_id = this.llm_service.chatManager.chat.id;
                            this.llm_service.chatManager.init();
                            this.llm_service.chatManager.chat.id = chat_id;
                            this.tool_call.setHistory();
                            this.tool_call.change_mode();
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('set-chat', this.llm_service.chatManager.chat);
                        }
                    },
                    {
                        label: 'Save Conversation',
                        click: () => {
                            const lastPath = path.join(store.get('lastSavePath') || utils.getDefault("history/"), `messages_${this.llm_service.chatManager.chat.name || utils.formatDate()}.json`);
                            dialog.showSaveDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastSavePath', path.dirname(result.filePath));
                                    this.llm_service.chatManager.saveMessages(result.filePath);
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Conversation',
                        click: () => {
                            const lastPath = store.get('lastLoadPath') || utils.getDefault("history/");
                            dialog.showOpenDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastLoadPath', path.dirname(result.filePaths[0]));
                                    this.tool_call.init_var();
                                    this.tool_call.load_message(result.filePaths[0]);
                                    let id_exist = this.tool_call.setHistory();
                                    if (id_exist) {
                                        this.window?.webContents.send('select-chat', this.llm_service.chatManager.chat);
                                    } else {
                                        this.window?.webContents.send('set-chat', this.llm_service.chatManager.chat);
                                    };
                                }
                            });
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Open Memory',
                        click: () => {
                            const memoryPath = path.join(utils.getDefault(), 'memory.md');
                            if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, '# Memory\n\n');
                            shell.openPath(memoryPath).catch(err => console.error('Failed to open memory.md:', err));
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Console',
                        click: () => {
                            this.windowManager.configWindow?.window?.webContents.openDevTools();
                            this.windowManager.modelWindow?.window?.webContents.openDevTools();
                            this.window?.webContents.openDevTools();
                        }
                    },
                ]
            }
        ];
    }

    public setPrompt(filePath: string | null = null) {
        if (filePath && fs.existsSync(filePath)) {
            const config = utils.getConfig();
            if (this.funcItems.react.statu) {
                config.tool_call.extra_prompt = filePath;
            } else {
                const system_prompt = fs.readFileSync(filePath, 'utf-8');
                this.llm_service.chatManager.chat.system_prompt = system_prompt;
                this.window?.webContents.send('prompt', system_prompt);
            }
            utils.setConfig(config);
        }
    }

    public loadPrompt() {
        const lastDirectory = store.get('lastPromptDirectory') || path.join(process.resourcesPath, 'resources/', 'system_prompts/');
        dialog.showOpenDialog(this.window!, { properties: ['openFile'], defaultPath: lastDirectory })
            .then(result => {
                if (!result.canceled) {
                    const filePath = result.filePaths[0];
                    store.set('lastPromptDirectory', path.dirname(filePath));
                    this.setPrompt(filePath);
                }
            }).catch(err => console.log(err));
    }

    public setChain(chainStr: string) {
        let config = utils.getConfig();
        config.chain_call = JSON.parse(chainStr).chain_call;
        config.extra = [];

        for (const key in config.chain_call) {
            const item = config.chain_call[key];
            let extra = item?.model === (inner.model_name as any).plugins
                ? (this.plugins.getTool(item.version)?.extra || [])
                : [{ "type": "system-prompt" }];
            extra.forEach((e: any) => config.extra.push(e));
        }

        const deduplicateByType = (arr: any[]) => {
            const seen = new Set();
            return arr.filter(item => {
                const duplicate = seen.has(item.type);
                seen.add(item.type);
                return !duplicate;
            });
        };

        config.extra = deduplicateByType(config.extra);
        utils.setConfig(config);

        this.funcItems.react.statu = false;
        this.funcItems.react.transagent.statu = false;
        this.funcItems.react.multagent.statu = false;
        this.funcItems.react.baseagent.statu = false;
        this.funcItems.react.llm.statu = true;

        this.funcItems.react.event();
        this.updateVersionsSubmenu();
    }

    public loadChain() {
        const lastDirectory = store.get('lastChainDirectory') || path.join(process.resourcesPath, 'resources/', 'chain_calls/');
        dialog.showOpenDialog(this.window!, { properties: ['openFile'], defaultPath: lastDirectory })
            .then(result => {
                if (!result.canceled) {
                    const filePath = result.filePaths[0];
                    store.set('lastChainDirectory', path.dirname(filePath));
                    this.setChain(fs.readFileSync(filePath, 'utf-8'));
                }
            }).catch(err => console.log(err));
    }
}