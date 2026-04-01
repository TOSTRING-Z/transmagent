import { BrowserWindow, Menu, shell, ipcMain, clipboard, dialog, app, MenuItemConstructorOptions } from 'electron';
import { logger } from '../../utils/logger';
import { JSDOM } from "jsdom";
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'ssh2';
import { Worker } from 'worker_threads';

import { BaseWindow } from "./BaseWindow";
import { WindowManager } from "./WindowManager";
import { store, CONSTANTS, utils, sysConfig, extraPrompt, getCliPromptPath } from '../../utils/globals';
import { LLMService } from '../../core/LLMService';
import { State } from "../../core/ReActAgent";
import { AgentConfigs, ToolCall } from '../../core/ToolCall';
import { ChainCall } from '../../core/ChainCall';
import { PluginItem, Plugins } from '../../core/Plugins';
import { captureMouse } from '../../mouse/CaptureMouse';
import { install } from '../../core/Install';
import { MainServer } from '../../server/MainServer';
import { AgentMode } from '../../types';

// 定义 FuncItems 结构以启用严格模式
interface FuncItemNode {
    statu: boolean;
    event?: any;
    click?: () => void;
    [key: string]: any;
}

export class MainWindow extends BaseWindow {
    public funcItems: Record<string, FuncItemNode>;
    public plugins!: Plugins;
    public llm_service!: LLMService;
    public tool_call!: ToolCall;
    public chain_call!: ChainCall;
    public main_server: any;
    public worker: any;
    public last_clipboard_content?: string | null;
    public concat?: boolean;
    public agentMode: AgentMode;

    constructor(windowManager: WindowManager) {
        super(windowManager);
        this.agentMode = store.get('agentMode', 'transagent');

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
                    statu: sysConfig[this.agentMode] === sysConfig.transagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.agentMode = 'transagent';
                        utils.agentMode = this.agentMode;
                        store.set('agentMode', 'transagent');
                        this.setActiveAgent('transagent');
                        this.serverInit();
                    }
                },
                baseagent: {
                    statu: sysConfig[this.agentMode] === sysConfig.baseagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.agentMode = 'baseagent';
                        utils.agentMode = this.agentMode;
                        store.set('agentMode', 'baseagent');
                        this.setActiveAgent('baseagent');
                        this.serverInit();
                    }
                },
                multagent: {
                    statu: sysConfig[this.agentMode] === sysConfig.multagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.agentMode = 'multagent';
                        utils.agentMode = this.agentMode;
                        store.set('agentMode', 'multagent');
                        this.setActiveAgent('multagent');
                        this.serverInit();
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
        const heartbeat = utils.getConfig("heartbeat");
        if (heartbeat && heartbeat.enabled) {
            logger.log(`[Heartbeat] Service started. Interval: ${heartbeat.interval}s`);
            setInterval(async () => {
                if (this.tool_call && (this.tool_call.state === State.IDLE || this.tool_call.state === State.FINAL)) {
                    try {
                        let time = this.tool_call.environment_details.time;
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
        this.plugins = new Plugins();
        this.plugins.loadInit();
        this.llm_service = new LLMService([], this.window);

        let agentTools = {};
        let agent_mode: AgentConfigs["agent_mode"] = "transagent";
        let mcp_server = true;
        let skill = true;

        if (this.funcItems.react.transagent.statu && utils.getConfig("tool_call")?.subagent) {
            agentTools = { "tool_manager": this.windowManager.subAgentWindow?.agentTools?.["tool_manager"] };
        }
        if (this.funcItems.react.multagent.statu) {
            agent_mode = "multagent";
            mcp_server = false;
            skill = false;
            agentTools = { ...this.windowManager.subAgentWindow?.getMainSubAgent() };
        }
        if (this.funcItems.react.baseagent.statu) {
            agent_mode = "baseagent";
        }
        agentTools["deep_researcher"] = this.windowManager.subAgentWindow?.agentTools?.["deep_researcher"];

        this.tool_call = new ToolCall(this.plugins, agentTools, this.llm_service, this.window, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            env: true,
            skill: skill,
            subagent: false,
            agent_mode: agent_mode,
            agent_name: "TransMAgent",
            tool_format: this.llm_service.chatManager.chat.tool_format
        });

        this.chain_call = new ChainCall(this.plugins, this.llm_service, this.window);
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
        data = this.tool_call.getDataDefault({
            ...data
        });
        data.query = this.funcItems.text.event(data.query);
        this.llm_service.startMessage();

        if (data?.is_plugin) {
            await this.chain_call.pluginCall(data);
        } else if (this.funcItems.react.statu) {
            await this.tool_call.callReAct(data);
            this.tool_call.saveLongTermMemory(data.query, data.output);
        } else {
            await this.chain_call.callChain(data);
            this.tool_call.saveLongTermMemory(data.query, data.output);
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
                const lastDirectory = store.get('lastFileDirectory') || utils.getDefault("config_transagent.json");
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

        ipcMain.handle('agentLoop', async (_event, data) => this.agentLoop(data));

        // ============================================
        // 适配后的 ChatManager 调用 (替换 toggleMessageGroup 等)
        // ============================================
        ipcMain.handle("compressionGroupMessage", async (_event, data) => {
            let compression_content = await this.tool_call.compressionGroupMessage({ ...data });
            this.tool_call.setHistory();
            return { compression_content };
        });

        ipcMain.handle("toggleMessageGroup", async (_event, data) => {
            let message_len = await this.llm_service.chatManager.toggleMessageGroup({ ...data, del_mode: !!this.funcItems.del.statu });
            this.tool_call.setHistory();
            logger.log(`delete id: ${data.id}, length: ${message_len}`)
            return { del_mode: !!this.funcItems.del.statu };
        });

        ipcMain.handle("thumbMessageGroup", async (_event, data) => {
            let result = this.llm_service.chatManager.thumbMessageGroup(data);
            if (result?.type === "messages") {
                const messages = result.data;
                this.tool_call.setHistory();
                utils.sendData(CONSTANTS.COLLECTION_URL, {
                    "chat_id": this.llm_service.chatManager.chat.id,
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
            let memory_len = await this.llm_service.chatManager.toggleContextMessage({ context_id: context_id, del_mode: !!this.funcItems.del.statu });
            this.tool_call.setHistory();
            logger.log(`delete context_id: ${context_id}, length: ${memory_len}`)
            return { del_mode: !!this.funcItems.del.statu };
        });

        ipcMain.on("stopMessage", () => {
            this.llm_service.stopMessage();
            this.windowManager.subAgentWindow?.destroy();
        });

        ipcMain.on('changeMode', (_event, mode) => {
            this.tool_call.changeMode(mode);
            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
        });

        ipcMain.on('open-external', (_event, href) => shell.openExternal(href));

        ipcMain.handle('new-chat', () => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.tool_call.newChat();
            this.updateVersionsSubmenu();
            return chat;
        });

        ipcMain.handle('loadChat', (_event, id) => {
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
            plugins.loadInit();
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

        ipcMain.on('setChat', (_, chat) => {
            this.llm_service.chatManager.chat.seconds = chat.seconds;
            if (chat.compress_context !== undefined) {
                this.llm_service.chatManager.chat.compress_context = chat.compress_context;
            }
            this.tool_call.setHistory();
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
            if (this.llm_service.chatManager.chat.is_plugin) {
                this.window?.webContents.send("extra_load", e.statu && this.plugins.getTool[this.llm_service.chatManager.chat.version]?.extra);
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
            config: sysConfig[this.agentMode],
            concat: this.concat,
            last_clipboard_content: this.last_clipboard_content,
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
                this.llm_service.chatManager.chat.is_plugin = _model === "plugins";
                this.llm_service.chatManager.chat.version = utils.getConfig("models")[_model]["versions"][0].version;
                
                // 根据模型配置设置 api_type 和 tool_format
                const modelConfig = utils.getConfig("models")[_model];
                this.llm_service.chatManager.chat.api_type = modelConfig?.api_type || 'openai';
                // tool_format 由用户手动选择，或使用默认值
                
                this.updateVersionsSubmenu();
                this.window?.webContents.send("handleSetChat", this.llm_service.chatManager.chat);
                if (this.tool_call.setHistory) this.tool_call.setHistory();
            },
            label: _model
        }));
    }

    private getVersionsSubmenu(): MenuItemConstructorOptions[] {
        let versions;
        if (this.llm_service.chatManager.chat.is_plugin) {
            versions = Object.values(this.plugins.getTool() as Record<string, PluginItem>)
                .filter((tool: PluginItem) => tool?.version && tool?.show)
                .map((tool: PluginItem) => ({ version: tool.version, show: tool.show }));
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
                    this.window?.webContents.send("handleSetChat", this.llm_service.chatManager.chat);
                    if (this.tool_call.setHistory) this.tool_call.setHistory();
                    if (this.llm_service.chatManager.chat.is_plugin) this.window?.webContents.send("extra_load", version?.extra);
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
                label: "API Type",
                submenu: [
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.api_type === 'openai',
                        label: 'OpenAI',
                        click: () => {
                            this.llm_service.chatManager.chat.api_type = 'openai';
                            let config = utils.getConfig();
                            config.default.api_type = 'openai';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory) this.tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.api_type === 'anthropic',
                        label: 'Anthropic',
                        click: () => {
                            this.llm_service.chatManager.chat.api_type = 'anthropic';
                            let config = utils.getConfig();
                            config.default.api_type = 'anthropic';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory) this.tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.api_type === 'ollama',
                        label: 'Ollama (Local)',
                        click: () => {
                            this.llm_service.chatManager.chat.api_type = 'ollama';
                            let config = utils.getConfig();
                            config.default.api_type = 'ollama';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory) this.tool_call.setHistory();
                        }
                    }
                ]
            },
            {
                label: "Tool Format",
                submenu: [
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.tool_format === 'toolcalls',
                        label: 'ToolCalls (Native API)',
                        click: () => {
                            this.llm_service.chatManager.chat.tool_format = 'toolcalls';
                            let config = utils.getConfig();
                            config.default.tool_format = 'toolcalls';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory) this.tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.tool_format === 'prompt',
                        label: 'Prompt (Parse JSON)',
                        click: () => {
                            this.llm_service.chatManager.chat.tool_format = 'prompt';
                            let config = utils.getConfig();
                            config.default.tool_format = 'prompt';
                            utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
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
                            const lastPath = path.join(store.get('lastSaveConfigurationPath') || utils.getDefault(), sysConfig[this.agentMode]);
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
                                    const configFilePath = path.join(utils.getDefault(), sysConfig[this.agentMode]);
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
                            this.tool_call.initVar();
                            const chat_id = this.llm_service.chatManager.chat.id;
                            this.llm_service.chatManager.init();
                            this.llm_service.chatManager.chat.id = chat_id;
                            this.tool_call.setHistory();
                            this.tool_call.changeMode();
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
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
                                    this.tool_call.initVar();
                                    this.tool_call.loadMessage(result.filePaths[0]);
                                    let id_exist = this.tool_call.setHistory();
                                    if (id_exist) {
                                        this.window?.webContents.send('select-chat', this.llm_service.chatManager.chat);
                                    } else {
                                        this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
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
                            if (!fs.existsSync(memoryPath)) fs.writeFileSync(memoryPath, '');
                            shell.openPath(memoryPath).catch(err => WindowManager.instance.alertWindow.show('error', `Failed to open :${memoryPath}`));
                        }
                    },
                    {
                        label: 'Open Extra Prompt',
                        click: () => {
                            const promptPath = path.join(utils.getDefault(), extraPrompt[this.agentMode]);
                            if (!fs.existsSync(promptPath)) fs.writeFileSync(promptPath, '');
                            shell.openPath(promptPath).catch(err => WindowManager.instance.alertWindow.show('error', `Failed to open :${promptPath}`));
                        }
                    },
                    {
                        label: 'Open CLI Prompt',
                        click: () => {
                            const promptPath = getCliPromptPath();
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
        const lastDirectory = store.get('lastPromptDirectory') || utils.getDefault("prompts/");
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
        let config = utils.getConfig();
        config.chain_call = JSON.parse(chainStr).chain_call;
        config.extra = [];

        for (const key in config.chain_call) {
            const item = config.chain_call[key];
            let extra = item?.model === CONSTANTS.PLUGIN_MODEL_NAME
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
            }).catch(err => logger.log(err));
    }
}