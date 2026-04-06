import { BrowserWindow, Menu, shell, ipcMain, clipboard, dialog, app, MenuItemConstructorOptions } from 'electron';
import { logger } from '../../utils/logger';
import { JSDOM } from "jsdom";
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'ssh2';
import { Worker } from 'worker_threads';

import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { store, CONSTANTS, sysConfig, extraPrompt } from '../../utils/globals';
import { State } from "../../core/ReActAgent";
import { PluginItem } from '../../core/Plugins';
import { captureMouse } from '../../mouse/CaptureMouse';
import { install } from '../../core/Install';
import { MainServer } from '../../server/MainServer';
import { Session, SessionManager } from '../../core/SessionManager';

// 定义 FuncItems 结构以启用严格模式
interface FuncItemNode {
    statu: boolean;
    event?: any;
    click?: () => void;
    [key: string]: any;
}

export class MainWindow extends BaseWindow {
    public funcItems!: Record<string, FuncItemNode>;
    public sessionManager!: SessionManager;
    public main_server: any;
    public worker: any;
    public last_clipboard_content?: string | null;
    public concat?: boolean;
    public session!: (() => Session);

    constructor(windowManager: WindowManager) {
        super(windowManager);
        // 创建并配置主窗口
        this.create();
        this.setup();
    }

    public setActiveAgent(activeAgent) {
        // 重置所有状态
        this.funcItems.react.transagent.statu = false;
        this.funcItems.react.baseagent.statu = false;
        this.funcItems.react.multagent.statu = false;

        // 激活选中的 agent
        switch (activeAgent) {
            case 'transagent':
                this.funcItems.react.transagent.statu = true;
                break;
            case 'multagent':
                this.funcItems.react.multagent.statu = true;
                break;
            case 'baseagent':
                this.funcItems.react.baseagent.statu = true;
                break;
        }
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
                } catch (err: any) {
                    console.error('Failed to restart app:', err);
                }
            }
        }).catch(err => console.error('Restart prompt failed:', err));
    }

    public setupHeartbeat() {
        const heartbeat = this.session().utils.getConfig("heartbeat");
        if (heartbeat && heartbeat.enabled) {
            logger.log(`[Heartbeat] Service started. Interval: ${heartbeat.interval}s`);
            setInterval(async () => {
                if (this.session().tool_call && (this.session().tool_call.state === State.IDLE || this.session().tool_call.state === State.FINAL)) {
                    try {
                        let time = this.session().tool_call.environment_details.time;
                        let query = { query: `[${time}] This is a heartbeat timestamp. Please keep the system active.` };
                        this.sendQuery(query);
                    } catch (e: any) {
                        console.error("[Heartbeat] Execution failed:", e);
                    }
                }
            }, heartbeat.interval * 1000);
        }
    }

    public serverInit() {

        this.main_server = new MainServer(this);

        // 启动 WebServer Worker
        this.worker = new Worker(path.join(__dirname, '../../server/MainWorker.js'));

        // 传入配置启动
        const webserverConfig = this.session().utils.getConfig("webserver");
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

        const menu = Menu.buildFromTemplate(this.getTemplate());
        Menu.setApplicationMenu(menu);

        this.window?.loadFile('src/frontend/index.html');

        this.window?.webContents.on('did-finish-load', () => {
            this.initFuncItems();
            this.initInfo();
            this.setupHeartbeat();
        });
    }

    public create() {

        this.window = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                preload: path.join(__dirname, '../preloads/main_window_preload.js'),
            },
        });

        this.sessionManager = new SessionManager(this.window);

        this.sessionManager.addSession();

        this.session = () => this.sessionManager.getActiveSession();

        this.funcItems = {
            clip: {
                statu: this.session().utils.getConfig("func_status")?.clip || false,
                event: () => { },
                click: () => { this.funcItems.clip.statu = !this.funcItems.clip.statu; }
            },
            markdown: {
                statu: this.session().utils.getConfig("func_status")?.markdown || false,
                event: () => { },
                click: () => {
                    this.funcItems.markdown.statu = !this.funcItems.markdown.statu;
                    this.funcItems.markdown.event();
                }
            },
            text: {
                statu: this.session().utils.getConfig("func_status")?.text || false,
                event: () => { },
                click: () => { this.funcItems.text.statu = !this.funcItems.text.statu; }
            },
            del: {
                statu: this.session().utils.getConfig("func_status")?.del || false,
                event: () => { },
                click: () => { this.funcItems.del.statu = !this.funcItems.del.statu; }
            },
            react: {
                statu: this.session().utils.getConfig("func_status")?.react || true,
                event: () => { },
                transagent: {
                    statu: sysConfig[this.sessionManager.getAgentMode()] === sysConfig.transagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.setActiveAgent('transagent');
                        this.sessionManager.setActiveagentMode('multagent');
                    }
                },
                baseagent: {
                    statu: sysConfig[this.sessionManager.getAgentMode()] === sysConfig.baseagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.setActiveAgent('baseagent');
                        this.sessionManager.setActiveagentMode('multagent');
                    }
                },
                multagent: {
                    statu: sysConfig[this.sessionManager.getAgentMode()] === sysConfig.multagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.setActiveAgent('multagent');
                        this.sessionManager.setActiveagentMode('multagent');
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

        this.serverInit();

        this.window.on('focus', () => {
            this.window?.setAlwaysOnTop(true);
            setTimeout(() => this.window?.setAlwaysOnTop(false), 0);
        });

        this.window.webContents.on('will-navigate', (event, url) => {
            function isValidUrl(urlStr: string) {
                try { new URL(urlStr); return true; } catch (e: any) { return false; }
            }
            event.preventDefault();
            logger.log(`Attempt to navigate to: ${url}, has been blocked`);
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

        this.last_clipboard_content = clipboard.readText();
    }

    public async agentLoop(data) {
        if (process.platform !== 'win32') this.window?.show();
        else this.window?.focus();
        data = this.session().tool_call.getDataDefault({
            ...data
        });
        data.query = this.funcItems.text.event(data.query);
        this.session().llmService.startLoop();

        if (data?.is_plugin) {
            await this.session().chain_call.pluginCall(data);
        } else if (this.funcItems.react.statu) {
            await this.session().tool_call.callReAct(data);
            this.session().tool_call.saveLongTermMemory(data.query, data.output);
        } else {
            await this.session().chain_call.callChain(data);
            this.session().tool_call.saveLongTermMemory(data.query, data.output);
        }
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
                const lastDirectory = store.get('lastFileDirectory') || this.session().utils.getDefault("config_transagent.json");
                dialog.showOpenDialog(this.window!, { properties: ['openFile'], defaultPath: lastDirectory })
                    .then(result => {
                        if (!result.canceled) {
                            const filePath = result.filePaths[0];
                            store.set('lastFileDirectory', path.dirname(filePath));
                            if (this.funcItems.react.statu) {
                                const ssh_config = this.session().utils.getSshConfig();
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

        ipcMain.handle('agentLoop', async (_event, data) => this.agentLoop(data));

        // ============================================
        // 适配后的 ChatManager 调用 (替换 toggleMessageGroup 等)
        // ============================================
        ipcMain.handle("compressionGroupMessage", async (_event, data) => {
            let compression_content = await this.session().tool_call.compressionGroupMessage({ ...data });
            this.session().tool_call.setHistory();
            return { compression_content };
        });

        ipcMain.handle("toggleMessageGroup", async (_event, data) => {
            let message_len = await this.session().llmService.chatManager.toggleMessageGroup({ ...data, del_mode: !!this.funcItems.del.statu });
            this.session().tool_call.setHistory();
            logger.log(`delete id: ${data.id}, length: ${message_len}`)
            return { del_mode: !!this.funcItems.del.statu };
        });

        ipcMain.handle("thumbMessageGroup", async (_event, data) => {
            let result = this.session().llmService.chatManager.thumbMessageGroup(data);
            if (result?.type === "messages") {
                const messages = result.data;
                this.session().tool_call.setHistory();
                this.session().utils.sendData(CONSTANTS.COLLECTION_URL, {
                    "chat_id": this.sessionManager.getChat()?.id,
                    "message_id": data.group_id,
                    "user_message": messages[0].content,
                    "agent_messages": messages,
                });
                return messages ? data.thumb : 0;
            } else if (result?.type === "thumb") {
                return result.data;
            }
        });

        ipcMain.handle("toggleContextMessage", async (_event, context_id) => {
            let memory_len = await this.sessionManager.toggleContextMessage({ context_id: context_id, del_mode: !!this.funcItems.del.statu });
            this.session().tool_call.setHistory();
            logger.log(`delete context_id: ${context_id}, length: ${memory_len}`)
            return { del_mode: !!this.funcItems.del.statu };
        });

        ipcMain.on("stopMessage", () => {
            this.sessionManager.stopLoop();
            this.windowManager.subAgentWindow?.destroy();
        });

        ipcMain.on('changeMode', (_event, mode) => {
            this.session().tool_call.changeMode(mode);
            this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
        });

        ipcMain.on('open-external', (_event, href) => shell.openExternal(href));

        ipcMain.handle('newChat', () => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.session().tool_call.newChat();
            this.updateVersionsSubmenu();
            return chat;
        });

        ipcMain.handle('loadChat', (_event, id) => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.session().tool_call.loadChat(id);
            this.updateVersionsSubmenu();
            return chat;
        });

        ipcMain.on('del-chat', (_event, id) => {
            this.session().tool_call.delHistory(id);
        });

        ipcMain.on('rename-chat', (_event, chat) => this.session().tool_call.renameHistory(chat));

        ipcMain.handle('get-config-main', () => this.session().utils.getConfig());

        ipcMain.handle('set-config-main', (_, config) => {
            let state = this.session().utils.setConfig(config);
            this.updateVersionsSubmenu();
            this.setActiveAgent(this.sessionManager.getAgentMode());
            return state;
        });

        ipcMain.handle('envs', (_, data) => {
            if (data.type === "set") {
                this.sessionManager.setChat({ envs: data.envs });
                this.session().tool_call.setHistory();
                return true;
            } else {
                return this.session().tool_call?.llmService.chatManager.chat.envs || {};
            }
        });

        ipcMain.handle('tasks', (_, data) => {
            if (data.type === "set") {
                let vars = this.sessionManager.getChat()?.vars || {};
                vars.tasks = data.tasks;
                this.sessionManager.setChat({ vars });
                this.session().tool_call.setHistory();
                return true;
            } else {
                return this.session().tool_call?.llmService.chatManager.chat.vars.tasks || [];
            }
        });

        ipcMain.on('setChat', (_, chat) => {
            this.sessionManager.setChat({ seconds: chat.seconds });
            if (chat.compress_context !== undefined) {
                this.sessionManager.setChat({ compress_context: chat.compress_context });
            }
            this.session().tool_call.setHistory();
        });

        ipcMain.on('show-log', (_, data) => this.windowManager.alertWindow?.create(data));
    }

    public startAgentLoop(data: any) {
        this.window?.webContents.send('startAgentLoop', data);
    }

    public sendQuery(data: any) {
        this.startAgentLoop(data);
        this.agentLoop(data);
    }

    private getClipEvent(e: FuncItemNode) {
        return setInterval(async () => {
            let clipboardContent = clipboard.readText();
            if (clipboardContent !== this.last_clipboard_content) {
                if (this.concat) {
                    this.last_clipboard_content = `${this.last_clipboard_content} ${clipboardContent}`;
                    clipboard.writeText(this.last_clipboard_content);
                } else {
                    this.last_clipboard_content = clipboardContent;
                }

                if (this.funcItems.text.statu) {
                    try {
                        const dom = new JSDOM(this.last_clipboard_content);
                        const plainText = dom.window.document.body.textContent || "";
                        this.last_clipboard_content = plainText;
                        clipboard.writeText(plainText);
                    } catch (error: any) {
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
            if (this.sessionManager.getChat()?.is_plugin) {
                this.window?.webContents.send("extra_load", e.statu && this.session().plugins.getTool[this.sessionManager.getChat()?.version as string]?.extra);
            } else {
                const ssh_config = this.session().utils.getSshConfig();
                let extra = [{ "type": "act-plan" }];
                if (ssh_config?.enabled) extra.push({ "type": "file-upload" });
                this.window?.webContents.send("extra_load", e.statu ? extra : this.session().utils.getConfig("extra"));
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
        const filePath = this.session().utils.getConfig("prompt");
        let prompt = "";
        if (fs.existsSync(filePath)) prompt = fs.readFileSync(filePath, 'utf-8');

        const history_data = this.session().utils.getHistoryData();
        console.log(history_data[0]);
        this.window?.webContents.send('init-info', {
            prompt,
            config: sysConfig[this.sessionManager.getAgentMode()],
            concat: this.concat,
            last_clipboard_content: this.last_clipboard_content,
            model: this.sessionManager.getChat()?.model,
            version: this.sessionManager.getChat()?.version,
            is_plugin: this.sessionManager.getChat()?.is_plugin,
            chat: this.sessionManager.getChat(),
            chats: history_data.data
        });
    }

    public updateVersionsSubmenu() {
        const menu = Menu.buildFromTemplate(this.getTemplate());
        Menu.setApplicationMenu(menu);
    }

    private getModelsSubmenu(): MenuItemConstructorOptions[] {
        return Object.keys(this.session().utils.getConfig("models")).map((_model) => ({
            type: 'radio',
            checked: this.sessionManager.getChat()?.model === _model,
            click: () => {
                const modelConfig = this.session().utils.getConfig("models")[_model];
                this.sessionManager.setChat({
                    model: _model,
                    is_plugin: _model === "plugins",
                    version: modelConfig?.versions[0].version,
                })

                this.updateVersionsSubmenu();
                this.window?.webContents.send("handleSetChat", this.sessionManager.getChat());
                if (this.session().tool_call.setHistory) this.session().tool_call.setHistory();
            },
            label: _model
        }));
    }

    private getVersionsSubmenu(): MenuItemConstructorOptions[] {
        let versions;
        if (this.sessionManager.getChat()?.is_plugin) {
            versions = Object.values(this.session().plugins.getTool() as Record<string, PluginItem>)
                .filter((tool: PluginItem) => tool?.version && tool?.show)
                .map((tool: PluginItem) => ({ version: tool.version, show: tool.show }));
        } else {
            versions = this.session().utils.getConfig("models")[this.sessionManager.getChat()?.model as string]["versions"];
        }

        this.funcItems.react.event();
        return versions.map((version: any) => {
            const _version = version?.version || version;
            return {
                type: 'radio',
                checked: this.sessionManager.getChat()?.version === _version,
                click: () => {
                    this.sessionManager.setChat({ version: _version });
                    this.window?.webContents.send("handleSetChat", this.sessionManager.getChat());
                    if (this.session().tool_call.setHistory) this.session().tool_call.setHistory();
                    if (this.sessionManager.getChat()?.is_plugin) this.window?.webContents.send("extra_load", version?.extra);
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
                        checked: this.sessionManager.getChat()?.tool_format === 'toolcalls',
                        label: 'ToolCalls (Native API)',
                        click: () => {
                            this.sessionManager.setChat({ tool_format: 'toolcalls' });
                            let config = this.session().utils.getConfig();
                            config.default.tool_format = 'toolcalls';
                            this.session().utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
                            if (this.session().tool_call.setHistory) this.session().tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.sessionManager.getChat()?.tool_format === 'prompt',
                        label: 'Prompt (Parse JSON)',
                        click: () => {
                            this.sessionManager.setChat({ tool_format: 'prompt' });
                            let config = this.session().utils.getConfig();
                            config.default.tool_format = 'prompt';
                            this.session().utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
                            if (this.session().tool_call.setHistory) this.session().tool_call.setHistory();
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
                            const lastPath = path.join(store.get('lastSaveConfigurationPath') || this.session().utils.getDefault(), sysConfig[this.sessionManager.getAgentMode()]);
                            dialog.showSaveDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastSaveConfigurationPath', path.dirname(result.filePath));
                                    fs.writeFileSync(result.filePath, JSON.stringify(this.session().utils.getConfig(), null, 2));
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Configuration',
                        click: () => {
                            const lastPath = store.get('lastLoadConfigurationPath') || this.session().utils.getDefault();
                            dialog.showOpenDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastLoadConfigurationPath', path.dirname(result.filePaths[0]));
                                    const configFilePath = path.join(this.session().utils.getDefault(), sysConfig[this.sessionManager.getAgentMode()]);
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
                            this.session().tool_call.initVar();
                            const chat_id = this.sessionManager.getChat()?.id;
                            this.session().llmService.chatManager.init();
                            this.sessionManager.setChat({ id: chat_id });
                            this.session().tool_call.setHistory();
                            this.session().tool_call.changeMode();
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
                        }
                    },
                    {
                        label: 'Save Conversation',
                        click: () => {
                            const lastPath = path.join(store.get('lastSavePath') || this.session().utils.getDefault("history/"), `messages_${this.sessionManager.getChat()?.name || this.session().utils.formatDate()}.json`);
                            dialog.showSaveDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastSavePath', path.dirname(result.filePath));
                                    this.session().llmService.chatManager.saveMessages(result.filePath);
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Conversation',
                        click: () => {
                            const lastPath = store.get('lastLoadPath') || this.session().utils.getDefault("history/");
                            dialog.showOpenDialog(this.window!, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastLoadPath', path.dirname(result.filePaths[0]));
                                    this.session().tool_call.initVar();
                                    this.session().tool_call.loadMessage(result.filePaths[0]);
                                    let id_exist = this.session().tool_call.setHistory();
                                    if (id_exist) {
                                        this.window?.webContents.send('select-chat', this.sessionManager.getChat());
                                    } else {
                                        this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
                                    };
                                }
                            });
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Open Memory',
                        click: () => {
                            const memoryPath = path.join(this.session().utils.getDefault(), 'memory.md');
                            if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, '');
                            shell.openPath(memoryPath).catch(err => WindowManager.instance.alertWindow.show('error', `Failed to open :${memoryPath}`));
                        }
                    },
                    {
                        label: 'Open Extra Prompt',
                        click: () => {
                            const promptPath = path.join(this.session().utils.getDefault(), extraPrompt[this.sessionManager.getAgentMode()]);
                            if (!fs.existsSync(promptPath)) fs.writeFileSync(promptPath, '');
                            shell.openPath(promptPath).catch(err => WindowManager.instance.alertWindow.show('error', `Failed to open :${promptPath}`));
                        }
                    },
                    {
                        label: 'Open CLI Prompt',
                        click: () => {
                            const promptPath = this.session().utils.getConfig("tool_call").cli_prompt || this.session().utils.getDefault("prompts/cli_prompt.md");
                            if (!fs.existsSync(promptPath)) fs.writeFileSync(promptPath, '');
                            shell.openPath(promptPath).catch(err => WindowManager.instance.alertWindow.show('error', `Failed to open :${promptPath}`));
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Console',
                        click: () => {
                            this.window?.webContents.openDevTools();
                            this.windowManager.configWindow?.window?.webContents.openDevTools();
                            this.windowManager.subAgentWindow?.windows?.forEach(window => window?.webContents?.openDevTools());
                            this.windowManager.modelWindow?.window?.webContents.openDevTools();
                            this.windowManager.toolWindow?.window?.webContents.openDevTools();
                        }
                    },
                ]
            }
        ];
    }

    public setPrompt(filePath: string | null = null) {
        if (filePath && fs.existsSync(filePath)) {
            const config = this.session().utils.getConfig();
            if (this.funcItems.react.statu) {
                config.tool_call.extra_prompt = filePath;
            } else {
                const system_prompt = fs.readFileSync(filePath, 'utf-8');
                this.sessionManager.setChat({ system_prompt });
                this.window?.webContents.send('prompt', system_prompt);
            }
            this.session().utils.setConfig(config);
        }
    }

    public loadPrompt() {
        const lastDirectory = store.get('lastPromptDirectory') || this.session().utils.getDefault("prompts/");
        dialog.showOpenDialog(this.window!, { properties: ['openFile'], defaultPath: lastDirectory })
            .then(result => {
                if (!result.canceled) {
                    const filePath = result.filePaths[0];
                    store.set('lastPromptDirectory', path.dirname(filePath));
                    this.setPrompt(filePath);
                }
            }).catch(err => logger.log(err));
    }

    public setChain(chainStr: string) {
        let config = this.session().utils.getConfig();
        config.chain_call = JSON.parse(chainStr).chain_call;
        config.extra = [];

        for (const key in config.chain_call) {
            const item = config.chain_call[key];
            let extra = item?.model === CONSTANTS.PLUGIN_MODEL_NAME
                ? (this.session().plugins.getTool(item.version)?.extra || [])
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
        this.session().utils.setConfig(config);

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
            }).catch(err => logger.log(err));
    }
}