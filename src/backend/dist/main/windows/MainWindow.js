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
exports.MainWindow = void 0;
const electron_1 = require("electron");
const logger_1 = require("../../utils/logger");
const jsdom_1 = require("jsdom");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssh2_1 = require("ssh2");
const worker_threads_1 = require("worker_threads");
const BaseWindow_1 = require("./BaseWindow");
const globals_1 = require("../../utils/globals");
const LLMService_1 = require("../../core/LLMService");
const ReActAgent_1 = require("../../core/ReActAgent");
const ToolCall_1 = require("../../core/ToolCall");
const ChainCall_1 = require("../../core/ChainCall");
const Plugins_1 = require("../../core/Plugins");
const CaptureMouse_1 = require("../../mouse/CaptureMouse");
const Install_1 = require("../../core/Install");
const MainServer_1 = require("../../server/MainServer");
class MainWindow extends BaseWindow_1.BaseWindow {
    funcItems;
    plugins;
    llm_service;
    tool_call;
    chain_call;
    main_server;
    worker;
    constructor(windowManager) {
        super(windowManager);
        this.funcItems = {
            clip: {
                statu: globals_1.utils.getConfig("func_status")?.clip || false,
                event: () => { },
                click: () => { this.funcItems.clip.statu = !this.funcItems.clip.statu; }
            },
            markdown: {
                statu: globals_1.utils.getConfig("func_status")?.markdown || false,
                event: () => { },
                click: () => {
                    this.funcItems.markdown.statu = !this.funcItems.markdown.statu;
                    this.funcItems.markdown.event();
                }
            },
            text: {
                statu: globals_1.utils.getConfig("func_status")?.text || false,
                event: () => { },
                click: () => { this.funcItems.text.statu = !this.funcItems.text.statu; }
            },
            del: {
                statu: globals_1.utils.getConfig("func_status")?.del || false,
                event: () => { },
                click: () => { this.funcItems.del.statu = !this.funcItems.del.statu; }
            },
            react: {
                statu: globals_1.utils.getConfig("func_status")?.react || true,
                event: () => { },
                transagent: {
                    statu: globals_1.globalState.config === globals_1.sysConfig.transagent,
                    config: globals_1.sysConfig.transagent,
                    click: () => {
                        this.funcItems.react.event();
                        globals_1.store.set("config", globals_1.sysConfig.transagent);
                        this.restart(this.window);
                    }
                },
                baseagent: {
                    statu: globals_1.globalState.config === globals_1.sysConfig.baseagent,
                    config: globals_1.sysConfig.baseagent,
                    click: () => {
                        this.funcItems.react.event();
                        globals_1.store.set("config", globals_1.sysConfig.baseagent);
                        this.restart(this.window);
                    }
                },
                multagent: {
                    statu: globals_1.globalState.config === globals_1.sysConfig.multagent,
                    config: globals_1.sysConfig.multagent,
                    click: () => {
                        this.funcItems.react.event();
                        globals_1.store.set("config", globals_1.sysConfig.multagent);
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
    destroy() {
        this.window?.close();
    }
    restart(window) {
        if (!window)
            return;
        electron_1.dialog.showMessageBox(window, {
            type: 'question',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
            title: 'Restart Application',
            message: 'Agent configuration has been changed. A restart is required for changes to take effect. Restart now?'
        }).then(({ response }) => {
            if (response === 0) {
                try {
                    electron_1.app.relaunch();
                    electron_1.app.exit(0);
                }
                catch (err) {
                    console.error('Failed to restart app:', err);
                }
            }
        }).catch(err => console.error('Restart prompt failed:', err));
    }
    setupHeartbeat() {
        const heartbeat = globals_1.utils.getConfig("heartbeat");
        if (heartbeat && heartbeat.enabled) {
            logger_1.logger.log(`[Heartbeat] Service started. Interval: ${heartbeat.interval}s`);
            setInterval(async () => {
                if (this.tool_call && (this.tool_call.state === ReActAgent_1.State.IDLE || this.tool_call.state === ReActAgent_1.State.FINAL)) {
                    try {
                        let time = this.tool_call.environment_details.time;
                        let query = { query: `[${time}] This is a heartbeat timestamp. Please keep the system active.` };
                        this.sendQuery(query);
                    }
                    catch (e) {
                        console.error("[Heartbeat] Execution failed:", e);
                    }
                }
            }, heartbeat.interval * 1000);
        }
    }
    create() {
        this.window = new electron_1.BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                preload: path.join(__dirname, '../preloads/main_window_preload.js'),
            },
        });
        this.plugins = new Plugins_1.Plugins();
        this.plugins.init();
        this.llm_service = new LLMService_1.LLMService([], this.window);
        let agentTools = {};
        let agent_mode = "transagent";
        let mcp_server = true;
        if (this.funcItems.react.transagent.statu && globals_1.utils.getConfig("tool_call")?.subagent) {
            agentTools = { "tool_manager": this.windowManager.subAgentWindow?.agentTools?.["tool_manager"] };
        }
        if (this.funcItems.react.multagent.statu) {
            agent_mode = "multagent";
            mcp_server = false;
            agentTools = { ...this.windowManager.subAgentWindow?.getMainSubAgent() };
        }
        if (this.funcItems.react.baseagent.statu) {
            agent_mode = "baseagent";
        }
        this.tool_call = new ToolCall_1.ToolCall(this.plugins, agentTools, this.llm_service, this.window, this.windowManager.alertWindow, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            subagent: false,
            agent_mode: agent_mode,
            tool_format: this.llm_service.chatManager.chat.tool_format
        });
        this.chain_call = new ChainCall_1.ChainCall(this.plugins, this.llm_service, this.window, this.windowManager.alertWindow);
        this.main_server = new MainServer_1.MainServer(this);
        // 启动 WebServer Worker
        this.worker = new worker_threads_1.Worker(path.join(__dirname, '../../server/MainWorker.js'));
        // 传入配置启动
        const webserverConfig = globals_1.utils.getConfig("webserver");
        this.worker.postMessage({
            type: 'start',
            config: {
                port: webserverConfig?.port || 3005,
                timeoutMs: webserverConfig?.timeout || 12 * 60 * 60 * 1000
            }
        });
        // 接收 Worker 的业务请求并分发
        this.worker.on('message', (request) => {
            const { requestId, cdata } = request;
            if (!cdata?.method)
                return;
            const handler = this.main_server[cdata.method];
            if (typeof handler === 'function') {
                handler.call(this.main_server, cdata.data)
                    .then((result) => this.worker.postMessage({ requestId, result }))
                    .catch((error) => this.worker.postMessage({ requestId, result: { error: error.message } }));
            }
            else {
                console.error(`[MainWindow] Unknown worker method: ${cdata.method}`);
                this.worker.postMessage({ requestId, result: { error: `Unknown method: ${cdata.method}` } });
            }
        });
        this.worker.on('error', (err) => {
            console.error('[MainWindow] Worker error:', err);
        });
        this.window.on('focus', () => {
            this.window?.setAlwaysOnTop(true);
            setTimeout(() => this.window?.setAlwaysOnTop(false), 0);
        });
        const menu = electron_1.Menu.buildFromTemplate(this.getTemplate());
        electron_1.Menu.setApplicationMenu(menu);
        this.window.loadFile('src/frontend/index.html');
        this.window.webContents.on('did-finish-load', () => {
            this.initFuncItems();
            this.initInfo();
            this.setupHeartbeat();
        });
        this.window.webContents.on('will-navigate', (event, url) => {
            function isValidUrl(urlStr) {
                try {
                    new URL(urlStr);
                    return true;
                }
                catch (e) {
                    return false;
                }
            }
            event.preventDefault();
            logger_1.logger.log(`Attempt to navigate to: ${url}, has been blocked`);
            if (isValidUrl(url)) {
                electron_1.shell.openExternal(url).catch(err => console.error('Failed to open link:', err.message));
            }
            else {
                console.error('Invalid URL:', url);
            }
        });
        this.window.on('close', () => {
            this.windowManager.closeAllWindows();
        });
        this.window.on('closed', () => {
            this.window = null;
        });
        globals_1.globalState.last_clipboard_content = electron_1.clipboard.readText();
    }
    async agentLoop(data) {
        if (process.platform !== 'win32')
            this.window?.show();
        else
            this.window?.focus();
        data = this.tool_call.getDataDefault({
            ...data
        });
        data.query = this.funcItems.text.event(data.query);
        this.llm_service.startMessage();
        if (data?.is_plugin) {
            await this.chain_call.pluginCall(data);
        }
        else if (this.funcItems.react.statu) {
            await this.tool_call.callReAct(data);
            this.tool_call.saveLongTermMemory(data.query, data.output);
        }
        else {
            await this.chain_call.callChain(data);
            this.tool_call.saveLongTermMemory(data.query, data.output);
        }
    }
    setup() {
        electron_1.ipcMain.on('open-code-editor', (event, filePath) => {
            if (this.windowManager.codeWindow)
                this.windowManager.codeWindow.openFile(filePath);
        });
        electron_1.ipcMain.on('open-code-editor-content', (event, content) => {
            if (this.windowManager.codeWindow)
                this.windowManager.codeWindow.openContent(content);
        });
        electron_1.ipcMain.handle('get-file-path', async () => {
            return new Promise((resolve, reject) => {
                const lastDirectory = globals_1.store.get('lastFileDirectory') || globals_1.utils.getDefault("config.json");
                electron_1.dialog.showOpenDialog(this.window, { properties: ['openFile'], defaultPath: lastDirectory })
                    .then(result => {
                    if (!result.canceled) {
                        const filePath = result.filePaths[0];
                        globals_1.store.set('lastFileDirectory', path.dirname(filePath));
                        if (this.funcItems.react.statu) {
                            const ssh_config = globals_1.utils.getSshConfig();
                            if (ssh_config?.enabled) {
                                const conn = new ssh2_1.Client();
                                conn.on('ready', () => {
                                    conn.sftp((err, sftp) => {
                                        if (err)
                                            throw err;
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
                            }
                            else
                                resolve(filePath);
                        }
                        else
                            resolve(filePath);
                    }
                }).catch(err => reject(err));
            });
        });
        electron_1.ipcMain.handle('agentLoop', async (_event, data) => this.agentLoop(data));
        // ============================================
        // 适配后的 ChatManager 调用 (替换 toggleMessageGroup 等)
        // ============================================
        electron_1.ipcMain.handle("compressionGroupMessage", async (_event, data) => {
            let compression_content = await this.tool_call.compressionGroupMessage({ ...data });
            this.tool_call.setHistory();
            return { compression_content };
        });
        electron_1.ipcMain.handle("toggleMessageGroup", async (_event, data) => {
            let message_len = await this.llm_service.chatManager.toggleMessageGroup({ ...data, del_mode: !!this.funcItems.del.statu });
            this.tool_call.setHistory();
            logger_1.logger.log(`delete id: ${data.id}, length: ${message_len}`);
            return { del_mode: !!this.funcItems.del.statu };
        });
        electron_1.ipcMain.handle("thumbMessageGroup", async (_event, data) => {
            let result = this.llm_service.chatManager.thumbMessageGroup(data);
            if (result?.type === "messages") {
                const messages = result.data;
                this.tool_call.setHistory();
                globals_1.utils.sendData(globals_1.CONSTANTS.COLLECTION_URL, {
                    "chat_id": this.llm_service.chatManager.chat.id,
                    "message_id": data.group_id,
                    "user_message": messages[0].content,
                    "agent_messages": messages,
                });
                return messages ? data.thumb : 0;
            }
            else if (result?.type === "thumb") {
                return result.data;
            }
        });
        electron_1.ipcMain.handle("toggleContextMessage", async (_event, context_id) => {
            let memory_len = await this.llm_service.chatManager.toggleContextMessage({ context_id: context_id, del_mode: !!this.funcItems.del.statu });
            this.tool_call.setHistory();
            logger_1.logger.log(`delete context_id: ${context_id}, length: ${memory_len}`);
            return { del_mode: !!this.funcItems.del.statu };
        });
        electron_1.ipcMain.on("toggle-auto-opt", () => {
            globals_1.globalState.status.auto_opt = !globals_1.globalState.status.auto_opt;
        });
        electron_1.ipcMain.on("stream-message-stop", () => {
            this.llm_service.stopMessage();
            this.windowManager.subAgentWindow?.destroy();
        });
        electron_1.ipcMain.on('changeMode', (_event, mode) => {
            this.tool_call.changeMode(mode);
            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
        });
        electron_1.ipcMain.on('open-external', (_event, href) => electron_1.shell.openExternal(href));
        electron_1.ipcMain.handle('new-chat', () => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.tool_call.newChat();
            this.updateVersionsSubmenu();
            return chat;
        });
        electron_1.ipcMain.handle('loadChat', (_event, id) => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.tool_call.loadChat(id);
            this.updateVersionsSubmenu();
            return chat;
        });
        electron_1.ipcMain.on('del-chat', (_event, id) => {
            this.tool_call.delHistory(id);
        });
        electron_1.ipcMain.on('rename-chat', (_event, chat) => this.tool_call.renameHistory(chat));
        electron_1.ipcMain.handle('get-config-main', () => globals_1.utils.getConfig());
        electron_1.ipcMain.handle('set-config-main', (_, config) => {
            let state = globals_1.utils.setConfig(config);
            this.updateVersionsSubmenu();
            const plugins = new Plugins_1.Plugins();
            plugins.init();
            return state;
        });
        electron_1.ipcMain.handle('envs', (_, data) => {
            if (data.type === "set") {
                this.llm_service.chatManager.chat.envs = data.envs;
                this.tool_call.setHistory();
                return true;
            }
            else {
                return this.tool_call?.llm_service.chatManager.chat.envs || {};
            }
        });
        electron_1.ipcMain.handle('tasks', (_, data) => {
            if (data.type === "set") {
                this.llm_service.chatManager.chat.vars.tasks = data.tasks;
                this.tool_call.setHistory();
                return true;
            }
            else {
                return this.tool_call?.llm_service.chatManager.chat.vars.tasks || [];
            }
        });
        electron_1.ipcMain.on('set-global', (_, chat) => {
            this.llm_service.chatManager.chat.tokens = chat.tokens;
            this.llm_service.chatManager.chat.seconds = chat.seconds;
            if (chat.compress_context !== undefined) {
                this.llm_service.chatManager.chat.compress_context = chat.compress_context;
            }
            if (chat.model !== undefined) {
                this.llm_service.chatManager.chat.model = chat.model;
            }
            if (this.tool_call)
                this.tool_call.setHistory(this.llm_service.chatManager.chat);
        });
        electron_1.ipcMain.on('show-log', (_, data) => this.windowManager.alertWindow?.create(data));
    }
    startAgentLoop(data) {
        this.window?.webContents.send('startAgentLoop', data);
    }
    sendQuery(data) {
        this.startAgentLoop(data);
        this.agentLoop(data);
    }
    getClipEvent(e) {
        return setInterval(async () => {
            let clipboardContent = electron_1.clipboard.readText();
            if (clipboardContent !== globals_1.globalState.last_clipboard_content) {
                if (globals_1.globalState.concat) {
                    globals_1.globalState.last_clipboard_content = `${globals_1.globalState.last_clipboard_content} ${clipboardContent}`;
                    electron_1.clipboard.writeText(globals_1.globalState.last_clipboard_content);
                }
                else {
                    globals_1.globalState.last_clipboard_content = clipboardContent;
                }
                if (this.funcItems.text.statu) {
                    try {
                        const dom = new jsdom_1.JSDOM(globals_1.globalState.last_clipboard_content);
                        const plainText = dom.window.document.body.textContent || "";
                        globals_1.globalState.last_clipboard_content = plainText;
                        electron_1.clipboard.writeText(plainText);
                    }
                    catch (error) {
                        console.error('Failed to clear clipboard formatting:', error);
                    }
                }
                if (e.statu) {
                    (0, CaptureMouse_1.captureMouse)().then((mousePosition) => {
                        this.windowManager.iconWindow?.create(mousePosition);
                    }).catch((error) => console.error(error));
                }
            }
        }, 100);
    }
    getMarkDownEvent(e) {
        const markdownFormat = () => this.window?.webContents.send('markdown-format', e.statu);
        markdownFormat();
        return markdownFormat;
    }
    getTextEvent(e) {
        return (text) => {
            if (text != null) {
                text = text.replaceAll('-\n', '');
                return e.statu ? text.replace(/[\s\n]+/g, ' ').trim() : text;
            }
        };
    }
    getReactEvent(e) {
        const extraReact = () => {
            this.window?.webContents.send('react-statu', e.statu);
            if (globals_1.globalState.is_plugin) {
                this.window?.webContents.send("extra_load", e.statu && this.plugins.get[this.llm_service.chatManager.chat.version]?.extra);
            }
            else {
                const ssh_config = globals_1.utils.getSshConfig();
                let extra = [{ "type": "act-plan" }];
                if (ssh_config?.enabled)
                    extra.push({ "type": "file-upload" });
                this.window?.webContents.send("extra_load", e.statu ? extra : globals_1.utils.getConfig("extra"));
            }
        };
        extraReact();
        return extraReact;
    }
    initFuncItems() {
        this.funcItems.clip.event = this.getClipEvent(this.funcItems.clip);
        this.funcItems.markdown.event = this.getMarkDownEvent(this.funcItems.markdown);
        this.funcItems.text.event = this.getTextEvent(this.funcItems.text);
        this.funcItems.react.event = this.getReactEvent(this.funcItems.react);
    }
    initInfo() {
        const filePath = globals_1.utils.getConfig("prompt");
        let prompt = "";
        if (fs.existsSync(filePath))
            prompt = fs.readFileSync(filePath, 'utf-8');
        const history_data = globals_1.utils.getHistoryData();
        this.window?.webContents.send('init-info', {
            prompt,
            ...globals_1.globalState,
            model: this.llm_service.chatManager.chat.model,
            version: this.llm_service.chatManager.chat.version,
            tool_format: this.llm_service.chatManager.chat.tool_format,
            is_plugin: this.llm_service.chatManager.chat.is_plugin,
            chat: this.llm_service.chatManager.chat,
            chats: history_data.data
        });
    }
    updateVersionsSubmenu() {
        const menu = electron_1.Menu.buildFromTemplate(this.getTemplate());
        electron_1.Menu.setApplicationMenu(menu);
    }
    getModelsSubmenu() {
        return Object.keys(globals_1.utils.getConfig("models")).map((_model) => ({
            type: 'radio',
            checked: this.llm_service.chatManager.chat.model === _model,
            click: () => {
                this.llm_service.chatManager.chat.model = _model;
                globals_1.globalState.is_plugin = _model === "plugins";
                this.llm_service.chatManager.chat.version = globals_1.utils.getConfig("models")[_model]["versions"][0].version;
                this.updateVersionsSubmenu();
                this.window?.webContents.send("handleSetChat", this.llm_service.chatManager.chat);
                if (this.tool_call.setHistory)
                    this.tool_call.setHistory();
            },
            label: _model
        }));
    }
    getVersionsSubmenu() {
        let versions;
        if (globals_1.globalState.is_plugin) {
            versions = globals_1.globalState.pluginVersions.filter((v) => v?.show);
        }
        else {
            versions = globals_1.utils.getConfig("models")[this.llm_service.chatManager.chat.model]["versions"];
        }
        this.funcItems.react.event();
        return versions.map((version) => {
            const _version = version?.version || version;
            return {
                type: 'radio',
                checked: this.llm_service.chatManager.chat.version === _version,
                click: () => {
                    this.llm_service.chatManager.chat.version = _version;
                    this.window?.webContents.send("handleSetChat", this.llm_service.chatManager.chat);
                    if (this.tool_call.setHistory)
                        this.tool_call.setHistory();
                    if (globals_1.globalState.is_plugin)
                        this.window?.webContents.send("extra_load", version?.extra);
                },
                label: _version
            };
        });
    }
    getTemplate() {
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
                            let config = globals_1.utils.getConfig();
                            config.default.tool_format = 'prompt';
                            globals_1.utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory)
                                this.tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.tool_format === 'openai',
                        label: 'OpenAI (Native API)',
                        click: () => {
                            this.llm_service.chatManager.chat.tool_format = 'openai';
                            let config = globals_1.utils.getConfig();
                            config.default.tool_format = 'openai';
                            globals_1.utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory)
                                this.tool_call.setHistory();
                        }
                    },
                    {
                        type: 'radio',
                        checked: this.llm_service.chatManager.chat.tool_format === 'anthropic',
                        label: 'Anthropic (Claude API)',
                        click: () => {
                            this.llm_service.chatManager.chat.tool_format = 'anthropic';
                            let config = globals_1.utils.getConfig();
                            config.default.tool_format = 'anthropic';
                            globals_1.utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                            if (this.tool_call.setHistory)
                                this.tool_call.setHistory();
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
                            const lastPath = path.join(globals_1.store.get('lastSaveConfigurationPath') || globals_1.utils.getDefault(), globals_1.globalState.config);
                            electron_1.dialog.showSaveDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastSaveConfigurationPath', path.dirname(result.filePath));
                                    fs.writeFileSync(result.filePath, JSON.stringify(globals_1.utils.getConfig(), null, 2));
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Configuration',
                        click: () => {
                            const lastPath = globals_1.store.get('lastLoadConfigurationPath') || globals_1.utils.getDefault();
                            electron_1.dialog.showOpenDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastLoadConfigurationPath', path.dirname(result.filePaths[0]));
                                    const configFilePath = path.join(globals_1.utils.getDefault(), globals_1.globalState.config);
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
                            (0, Install_1.install)(true);
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
                            const lastPath = path.join(globals_1.store.get('lastSavePath') || globals_1.utils.getDefault("history/"), `messages_${this.llm_service.chatManager.chat.name || globals_1.utils.formatDate()}.json`);
                            electron_1.dialog.showSaveDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastSavePath', path.dirname(result.filePath));
                                    this.llm_service.chatManager.saveMessages(result.filePath);
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Conversation',
                        click: () => {
                            const lastPath = globals_1.store.get('lastLoadPath') || globals_1.utils.getDefault("history/");
                            electron_1.dialog.showOpenDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastLoadPath', path.dirname(result.filePaths[0]));
                                    this.tool_call.initVar();
                                    this.tool_call.loadMessage(result.filePaths[0]);
                                    let id_exist = this.tool_call.setHistory();
                                    if (id_exist) {
                                        this.window?.webContents.send('select-chat', this.llm_service.chatManager.chat);
                                    }
                                    else {
                                        this.window?.webContents.send('handleSetChat', this.llm_service.chatManager.chat);
                                    }
                                    ;
                                }
                            });
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Open Memory',
                        click: () => {
                            const memoryPath = path.join(globals_1.utils.getDefault(), 'memory.md');
                            if (!fs.existsSync(memoryPath))
                                fs.writeFileSync(memoryPath, '# Memory\n\n');
                            electron_1.shell.openPath(memoryPath).catch(err => console.error('Failed to open memory.md:', err));
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Console',
                        click: () => {
                            this.windowManager.configWindow?.window?.webContents.openDevTools();
                            this.windowManager.subAgentWindow?.windows?.forEach(window => window.webContents.openDevTools());
                            this.windowManager.modelWindow?.window?.webContents.openDevTools();
                            this.windowManager.toolWindow?.window?.webContents.openDevTools();
                            this.window?.webContents.openDevTools();
                        }
                    },
                ]
            }
        ];
    }
    setPrompt(filePath = null) {
        if (filePath && fs.existsSync(filePath)) {
            const config = globals_1.utils.getConfig();
            if (this.funcItems.react.statu) {
                config.tool_call.extra_prompt = filePath;
            }
            else {
                const system_prompt = fs.readFileSync(filePath, 'utf-8');
                this.llm_service.chatManager.chat.system_prompt = system_prompt;
                this.window?.webContents.send('prompt', system_prompt);
            }
            globals_1.utils.setConfig(config);
        }
    }
    loadPrompt() {
        const lastDirectory = globals_1.store.get('lastPromptDirectory') || path.join(process.resourcesPath, 'resources/', 'system_prompts/');
        electron_1.dialog.showOpenDialog(this.window, { properties: ['openFile'], defaultPath: lastDirectory })
            .then(result => {
            if (!result.canceled) {
                const filePath = result.filePaths[0];
                globals_1.store.set('lastPromptDirectory', path.dirname(filePath));
                this.setPrompt(filePath);
            }
        }).catch(err => logger_1.logger.log(err));
    }
    setChain(chainStr) {
        let config = globals_1.utils.getConfig();
        config.chain_call = JSON.parse(chainStr).chain_call;
        config.extra = [];
        for (const key in config.chain_call) {
            const item = config.chain_call[key];
            let extra = item?.model === globals_1.CONSTANTS.PLUGIN_MODEL_NAME
                ? (this.plugins.getTool(item.version)?.extra || [])
                : [{ "type": "system-prompt" }];
            extra.forEach((e) => config.extra.push(e));
        }
        const deduplicateByType = (arr) => {
            const seen = new Set();
            return arr.filter(item => {
                const duplicate = seen.has(item.type);
                seen.add(item.type);
                return !duplicate;
            });
        };
        config.extra = deduplicateByType(config.extra);
        globals_1.utils.setConfig(config);
        this.funcItems.react.statu = false;
        this.funcItems.react.transagent.statu = false;
        this.funcItems.react.multagent.statu = false;
        this.funcItems.react.baseagent.statu = false;
        this.funcItems.react.llm.statu = true;
        this.funcItems.react.event();
        this.updateVersionsSubmenu();
    }
    loadChain() {
        const lastDirectory = globals_1.store.get('lastChainDirectory') || path.join(process.resourcesPath, 'resources/', 'chain_calls/');
        electron_1.dialog.showOpenDialog(this.window, { properties: ['openFile'], defaultPath: lastDirectory })
            .then(result => {
            if (!result.canceled) {
                const filePath = result.filePaths[0];
                globals_1.store.set('lastChainDirectory', path.dirname(filePath));
                this.setChain(fs.readFileSync(filePath, 'utf-8'));
            }
        }).catch(err => logger_1.logger.log(err));
    }
}
exports.MainWindow = MainWindow;
//# sourceMappingURL=MainWindow.js.map