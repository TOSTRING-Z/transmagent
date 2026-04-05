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
const WindowManager_1 = require("./WindowManager");
const globals_1 = require("../../utils/globals");
const ReActAgent_1 = require("../../core/ReActAgent");
const CaptureMouse_1 = require("../../mouse/CaptureMouse");
const Install_1 = require("../../core/Install");
const MainServer_1 = require("../../server/MainServer");
const SessionManager_1 = require("../../core/SessionManager");
class MainWindow extends BaseWindow_1.BaseWindow {
    funcItems;
    sessionManager;
    main_server;
    worker;
    last_clipboard_content;
    concat;
    session;
    constructor(windowManager) {
        super(windowManager);
        // 创建并配置主窗口
        this.create();
        this.setup();
    }
    setActiveAgent(activeAgent) {
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
        const heartbeat = this.session().utils.getConfig("heartbeat");
        if (heartbeat && heartbeat.enabled) {
            logger_1.logger.log(`[Heartbeat] Service started. Interval: ${heartbeat.interval}s`);
            setInterval(async () => {
                if (this.session().tool_call && (this.session().tool_call.state === ReActAgent_1.State.IDLE || this.session().tool_call.state === ReActAgent_1.State.FINAL)) {
                    try {
                        let time = this.session().tool_call.environment_details.time;
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
    serverInit() {
        this.main_server = new MainServer_1.MainServer(this);
        // 启动 WebServer Worker
        this.worker = new worker_threads_1.Worker(path.join(__dirname, '../../server/MainWorker.js'));
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
        const menu = electron_1.Menu.buildFromTemplate(this.getTemplate());
        electron_1.Menu.setApplicationMenu(menu);
        this.window?.loadFile('src/frontend/index.html');
        this.window?.webContents.on('did-finish-load', () => {
            this.initFuncItems();
            this.initInfo();
            this.setupHeartbeat();
        });
    }
    create() {
        this.window = new electron_1.BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                preload: path.join(__dirname, '../preloads/main_window_preload.js'),
            },
        });
        this.sessionManager = new SessionManager_1.SessionManager(this.window);
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
                    statu: globals_1.sysConfig[this.sessionManager.getAgentMode()] === globals_1.sysConfig.transagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.setActiveAgent('transagent');
                        this.sessionManager.setActiveagentMode('multagent');
                    }
                },
                baseagent: {
                    statu: globals_1.sysConfig[this.sessionManager.getAgentMode()] === globals_1.sysConfig.baseagent,
                    click: () => {
                        this.funcItems.react.event();
                        this.setActiveAgent('baseagent');
                        this.sessionManager.setActiveagentMode('multagent');
                    }
                },
                multagent: {
                    statu: globals_1.sysConfig[this.sessionManager.getAgentMode()] === globals_1.sysConfig.multagent,
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
        this.last_clipboard_content = electron_1.clipboard.readText();
    }
    async agentLoop(data) {
        if (process.platform !== 'win32')
            this.window?.show();
        else
            this.window?.focus();
        data = this.session().tool_call.getDataDefault({
            ...data
        });
        data.query = this.funcItems.text.event(data.query);
        this.session().llm_service.startLoop();
        if (data?.is_plugin) {
            await this.session().chain_call.pluginCall(data);
        }
        else if (this.funcItems.react.statu) {
            await this.session().tool_call.callReAct(data);
            this.session().tool_call.saveLongTermMemory(data.query, data.output);
        }
        else {
            await this.session().chain_call.callChain(data);
            this.session().tool_call.saveLongTermMemory(data.query, data.output);
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
                const lastDirectory = globals_1.store.get('lastFileDirectory') || this.session().utils.getDefault("config_transagent.json");
                electron_1.dialog.showOpenDialog(this.window, { properties: ['openFile'], defaultPath: lastDirectory })
                    .then(result => {
                    if (!result.canceled) {
                        const filePath = result.filePaths[0];
                        globals_1.store.set('lastFileDirectory', path.dirname(filePath));
                        if (this.funcItems.react.statu) {
                            const ssh_config = this.session().utils.getSshConfig();
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
            let compression_content = await this.session().tool_call.compressionGroupMessage({ ...data });
            this.session().tool_call.setHistory();
            return { compression_content };
        });
        electron_1.ipcMain.handle("toggleMessageGroup", async (_event, data) => {
            let message_len = await this.session().llm_service.chatManager.toggleMessageGroup({ ...data, del_mode: !!this.funcItems.del.statu });
            this.session().tool_call.setHistory();
            logger_1.logger.log(`delete id: ${data.id}, length: ${message_len}`);
            return { del_mode: !!this.funcItems.del.statu };
        });
        electron_1.ipcMain.handle("thumbMessageGroup", async (_event, data) => {
            let result = this.session().llm_service.chatManager.thumbMessageGroup(data);
            if (result?.type === "messages") {
                const messages = result.data;
                this.session().tool_call.setHistory();
                this.session().utils.sendData(globals_1.CONSTANTS.COLLECTION_URL, {
                    "chat_id": this.sessionManager.getChat()?.id,
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
            let memory_len = await this.sessionManager.toggleContextMessage({ context_id: context_id, del_mode: !!this.funcItems.del.statu });
            this.session().tool_call.setHistory();
            logger_1.logger.log(`delete context_id: ${context_id}, length: ${memory_len}`);
            return { del_mode: !!this.funcItems.del.statu };
        });
        electron_1.ipcMain.on("stopMessage", () => {
            this.sessionManager.stopLoop();
            this.windowManager.subAgentWindow?.destroy();
        });
        electron_1.ipcMain.on('changeMode', (_event, mode) => {
            this.session().tool_call.changeMode(mode);
            this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
        });
        electron_1.ipcMain.on('open-external', (_event, href) => electron_1.shell.openExternal(href));
        electron_1.ipcMain.handle('newChat', () => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.session().tool_call.newChat();
            this.updateVersionsSubmenu();
            return chat;
        });
        electron_1.ipcMain.handle('loadChat', (_event, id) => {
            this.windowManager.subAgentWindow?.destroy();
            const chat = this.session().tool_call.loadChat(id);
            this.updateVersionsSubmenu();
            return chat;
        });
        electron_1.ipcMain.on('del-chat', (_event, id) => {
            this.session().tool_call.delHistory(id);
        });
        electron_1.ipcMain.on('rename-chat', (_event, chat) => this.session().tool_call.renameHistory(chat));
        electron_1.ipcMain.handle('get-config-main', () => this.session().utils.getConfig());
        electron_1.ipcMain.handle('set-config-main', (_, config) => {
            let state = this.session().utils.setConfig(config);
            this.updateVersionsSubmenu();
            this.setActiveAgent(this.sessionManager.getAgentMode());
            return state;
        });
        electron_1.ipcMain.handle('envs', (_, data) => {
            if (data.type === "set") {
                this.sessionManager.setChat({ envs: data.envs });
                this.session().tool_call.setHistory();
                return true;
            }
            else {
                return this.session().tool_call?.llm_service.chatManager.chat.envs || {};
            }
        });
        electron_1.ipcMain.handle('tasks', (_, data) => {
            if (data.type === "set") {
                let vars = this.sessionManager.getChat()?.vars || {};
                vars.tasks = data.tasks;
                this.sessionManager.setChat({ vars });
                this.session().tool_call.setHistory();
                return true;
            }
            else {
                return this.session().tool_call?.llm_service.chatManager.chat.vars.tasks || [];
            }
        });
        electron_1.ipcMain.on('setChat', (_, chat) => {
            this.sessionManager.setChat({ seconds: chat.seconds });
            if (chat.compress_context !== undefined) {
                this.sessionManager.setChat({ compress_context: chat.compress_context });
            }
            this.session().tool_call.setHistory();
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
            if (clipboardContent !== this.last_clipboard_content) {
                if (this.concat) {
                    this.last_clipboard_content = `${this.last_clipboard_content} ${clipboardContent}`;
                    electron_1.clipboard.writeText(this.last_clipboard_content);
                }
                else {
                    this.last_clipboard_content = clipboardContent;
                }
                if (this.funcItems.text.statu) {
                    try {
                        const dom = new jsdom_1.JSDOM(this.last_clipboard_content);
                        const plainText = dom.window.document.body.textContent || "";
                        this.last_clipboard_content = plainText;
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
            if (this.sessionManager.getChat()?.is_plugin) {
                this.window?.webContents.send("extra_load", e.statu && this.session().plugins.getTool[this.sessionManager.getChat()?.version]?.extra);
            }
            else {
                const ssh_config = this.session().utils.getSshConfig();
                let extra = [{ "type": "act-plan" }];
                if (ssh_config?.enabled)
                    extra.push({ "type": "file-upload" });
                this.window?.webContents.send("extra_load", e.statu ? extra : this.session().utils.getConfig("extra"));
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
        const filePath = this.session().utils.getConfig("prompt");
        let prompt = "";
        if (fs.existsSync(filePath))
            prompt = fs.readFileSync(filePath, 'utf-8');
        const history_data = this.session().utils.getHistoryData();
        console.log(history_data[0]);
        this.window?.webContents.send('init-info', {
            prompt,
            config: globals_1.sysConfig[this.sessionManager.getAgentMode()],
            concat: this.concat,
            last_clipboard_content: this.last_clipboard_content,
            model: this.sessionManager.getChat()?.model,
            version: this.sessionManager.getChat()?.version,
            is_plugin: this.sessionManager.getChat()?.is_plugin,
            chat: this.sessionManager.getChat(),
            chats: history_data.data
        });
    }
    updateVersionsSubmenu() {
        const menu = electron_1.Menu.buildFromTemplate(this.getTemplate());
        electron_1.Menu.setApplicationMenu(menu);
    }
    getModelsSubmenu() {
        return Object.keys(this.session().utils.getConfig("models")).map((_model) => ({
            type: 'radio',
            checked: this.sessionManager.getChat()?.model === _model,
            click: () => {
                const modelConfig = this.session().utils.getConfig("models")[_model];
                this.sessionManager.setChat({
                    model: _model,
                    is_plugin: _model === "plugins",
                    version: modelConfig?.versions[0].version,
                });
                this.updateVersionsSubmenu();
                this.window?.webContents.send("handleSetChat", this.sessionManager.getChat());
                if (this.session().tool_call.setHistory)
                    this.session().tool_call.setHistory();
            },
            label: _model
        }));
    }
    getVersionsSubmenu() {
        let versions;
        if (this.sessionManager.getChat()?.is_plugin) {
            versions = Object.values(this.session().plugins.getTool())
                .filter((tool) => tool?.version && tool?.show)
                .map((tool) => ({ version: tool.version, show: tool.show }));
        }
        else {
            versions = this.session().utils.getConfig("models")[this.sessionManager.getChat()?.model]["versions"];
        }
        this.funcItems.react.event();
        return versions.map((version) => {
            const _version = version?.version || version;
            return {
                type: 'radio',
                checked: this.sessionManager.getChat()?.version === _version,
                click: () => {
                    this.sessionManager.setChat({ version: _version });
                    this.window?.webContents.send("handleSetChat", this.sessionManager.getChat());
                    if (this.session().tool_call.setHistory)
                        this.session().tool_call.setHistory();
                    if (this.sessionManager.getChat()?.is_plugin)
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
                        checked: this.sessionManager.getChat()?.tool_format === 'toolcalls',
                        label: 'ToolCalls (Native API)',
                        click: () => {
                            this.sessionManager.setChat({ tool_format: 'toolcalls' });
                            let config = this.session().utils.getConfig();
                            config.default.tool_format = 'toolcalls';
                            this.session().utils.setConfig(config);
                            this.updateVersionsSubmenu();
                            this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
                            if (this.session().tool_call.setHistory)
                                this.session().tool_call.setHistory();
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
                            if (this.session().tool_call.setHistory)
                                this.session().tool_call.setHistory();
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
                            const lastPath = path.join(globals_1.store.get('lastSaveConfigurationPath') || this.session().utils.getDefault(), globals_1.sysConfig[this.sessionManager.getAgentMode()]);
                            electron_1.dialog.showSaveDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastSaveConfigurationPath', path.dirname(result.filePath));
                                    fs.writeFileSync(result.filePath, JSON.stringify(this.session().utils.getConfig(), null, 2));
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Configuration',
                        click: () => {
                            const lastPath = globals_1.store.get('lastLoadConfigurationPath') || this.session().utils.getDefault();
                            electron_1.dialog.showOpenDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastLoadConfigurationPath', path.dirname(result.filePaths[0]));
                                    const configFilePath = path.join(this.session().utils.getDefault(), globals_1.sysConfig[this.sessionManager.getAgentMode()]);
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
                            this.session().tool_call.initVar();
                            const chat_id = this.sessionManager.getChat()?.id;
                            this.session().llm_service.chatManager.init();
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
                            const lastPath = path.join(globals_1.store.get('lastSavePath') || this.session().utils.getDefault("history/"), `messages_${this.sessionManager.getChat()?.name || this.session().utils.formatDate()}.json`);
                            electron_1.dialog.showSaveDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastSavePath', path.dirname(result.filePath));
                                    this.session().llm_service.chatManager.saveMessages(result.filePath);
                                }
                            });
                        }
                    },
                    {
                        label: 'Load Conversation',
                        click: () => {
                            const lastPath = globals_1.store.get('lastLoadPath') || this.session().utils.getDefault("history/");
                            electron_1.dialog.showOpenDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [{ name: 'JSON File', extensions: ['json'] }, { name: 'All Files', extensions: ['*'] }]
                            }).then(result => {
                                if (!result.canceled) {
                                    globals_1.store.set('lastLoadPath', path.dirname(result.filePaths[0]));
                                    this.session().tool_call.initVar();
                                    this.session().tool_call.loadMessage(result.filePaths[0]);
                                    let id_exist = this.session().tool_call.setHistory();
                                    if (id_exist) {
                                        this.window?.webContents.send('select-chat', this.sessionManager.getChat());
                                    }
                                    else {
                                        this.window?.webContents.send('handleSetChat', this.sessionManager.getChat());
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
                            const memoryPath = path.join(this.session().utils.getDefault(), 'memory.md');
                            if (!fs.existsSync(memoryPath))
                                fs.writeFileSync(memoryPath, '');
                            electron_1.shell.openPath(memoryPath).catch(err => WindowManager_1.WindowManager.instance.alertWindow.show('error', `Failed to open :${memoryPath}`));
                        }
                    },
                    {
                        label: 'Open Extra Prompt',
                        click: () => {
                            const promptPath = path.join(this.session().utils.getDefault(), globals_1.extraPrompt[this.sessionManager.getAgentMode()]);
                            if (!fs.existsSync(promptPath))
                                fs.writeFileSync(promptPath, '');
                            electron_1.shell.openPath(promptPath).catch(err => WindowManager_1.WindowManager.instance.alertWindow.show('error', `Failed to open :${promptPath}`));
                        }
                    },
                    {
                        label: 'Open CLI Prompt',
                        click: () => {
                            const promptPath = this.session().utils.getConfig("tool_call").cli_prompt || this.session().utils.getDefault("prompts/cli_prompt.md");
                            if (!fs.existsSync(promptPath))
                                fs.writeFileSync(promptPath, '');
                            electron_1.shell.openPath(promptPath).catch(err => WindowManager_1.WindowManager.instance.alertWindow.show('error', `Failed to open :${promptPath}`));
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
    setPrompt(filePath = null) {
        if (filePath && fs.existsSync(filePath)) {
            const config = this.session().utils.getConfig();
            if (this.funcItems.react.statu) {
                config.tool_call.extra_prompt = filePath;
            }
            else {
                const system_prompt = fs.readFileSync(filePath, 'utf-8');
                this.sessionManager.setChat({ system_prompt });
                this.window?.webContents.send('prompt', system_prompt);
            }
            this.session().utils.setConfig(config);
        }
    }
    loadPrompt() {
        const lastDirectory = globals_1.store.get('lastPromptDirectory') || this.session().utils.getDefault("prompts/");
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
        let config = this.session().utils.getConfig();
        config.chain_call = JSON.parse(chainStr).chain_call;
        config.extra = [];
        for (const key in config.chain_call) {
            const item = config.chain_call[key];
            let extra = item?.model === globals_1.CONSTANTS.PLUGIN_MODEL_NAME
                ? (this.session().plugins.getTool(item.version)?.extra || [])
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
        this.session().utils.setConfig(config);
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