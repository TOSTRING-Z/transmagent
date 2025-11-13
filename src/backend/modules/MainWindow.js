const { Window } = require("./Window")
const { Plugins } = require('./Plugins');
const { store, global, inner, utils, config } = require('./globals')
const { LLMService } = require('../server/llm_service');
const { captureMouse } = require('../mouse/capture_mouse');
const { ToolCall } = require('../server/tool_call');
const { ChainCall } = require('../server/chain_call');
const { install } = require('./Install');


const { BrowserWindow, Menu, shell, ipcMain, clipboard, dialog, app } = require('electron');
const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');
const { Worker } = require('worker_threads');
const { MainServer } = require('./MainServer');

class MainWindow extends Window {
    constructor(windowManager) {
        super(windowManager);
        this.funcItems = {
            clip: {
                statu: utils.getConfig("func_status")?.clip,
                event: () => { },
                click: () => {
                    this.funcItems.clip.statu = !this.funcItems.clip.statu;
                }
            },
            markdown: {
                statu: utils.getConfig("func_status")?.markdown,
                event: () => { },
                click: () => {
                    this.funcItems.markdown.statu = !this.funcItems.markdown.statu;
                    this.funcItems.markdown.event();
                }
            },
            text: {
                statu: utils.getConfig("func_status")?.text,
                event: () => { },
                click: () => {
                    this.funcItems.text.statu = !this.funcItems.text.statu;
                }
            },
            del: {
                statu: utils.getConfig("func_status")?.del,
                event: () => { },
                click: () => {
                    this.funcItems.del.statu = !this.funcItems.del.statu;
                }
            },
            react: {
                statu: utils.getConfig("func_status")?.react,
                event: () => { },
                transagent: {
                    statu: global.config === config.transagent,
                    config: config.transagent,
                    click: () => {
                        this.funcItems.react.event();
                        store.set("config", config.transagent);
                        this.restart(this.window);
                    }
                },
                baseagent: {
                    statu: global.config === config.baseagent,
                    config: config.baseagent,
                    click: () => {
                        this.funcItems.react.event();
                        store.set("config", config.baseagent);
                        this.restart(this.window);
                    }
                },
                multagent: {
                    statu: global.config === config.multagent,
                    config: config.multagent,
                    click: () => {
                        this.funcItems.react.event();
                        store.set("config", config.multagent);
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

    restart(window) {
        // 提示用户重启以使改动生效
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

    create() {
        this.window = new BrowserWindow({
            width: 1200,
            height: 800,
            webPreferences: {
                // eslint-disable-next-line no-undef
                preload: path.join(__dirname, '../preload.js')
            }
        })

        this.window.on('focus', () => {
            this.window?.setAlwaysOnTop(true)
            setTimeout(() => this.window?.setAlwaysOnTop(false), 0);
        })

        const menu = Menu.buildFromTemplate(this.getTemplate())
        Menu.setApplicationMenu(menu)

        this.window.loadFile('src/frontend/index.html')

        // Send message to renderer process after window loaded
        this.window.webContents.on('did-finish-load', () => {
            this.initFuncItems();
            this.initInfo();
        });

        // Intercept page navigation
        this.window.webContents.on('will-navigate', (event, url) => {
            function isValidUrl(url) {
                try {
                    new URL(url); // If URL is invalid, will throw error
                    return true;
                } catch {
                    return false;
                }
            }
            // Prevent navigation
            event.preventDefault();
            console.log(`Attempt to navigate to: ${url}, has been blocked`);
            if (isValidUrl(url)) {
                shell.openExternal(url).catch((error) => {
                    console.error('Failed to open link:', error.message);
                });
            } else {
                console.error('Invalid URL:', url);
            }
        });

        // Bind window close event
        this.window.on('close', () => {
            this.windowManager.closeAllWindows();
        })

        this.window.on('closed', () => {
            this.window = null;
        })

        global.last_clipboard_content = clipboard.readText();

        this.plugins = new Plugins();
        this.plugins.init();
        this.llm_service = new LLMService();
        let tools = this.plugins.getTool();
        let agent_mode = "transagent";
        let mcp_server = true;
        if (this.funcItems.react.transagent.statu && utils.getConfig("tool_call")?.subagent) {
            tools = { ...tools, "tool_manager": this.windowManager.subAgentWindow.agentTools["tool_manager"] };
        }
        if (this.funcItems.react.multagent.statu) {
            agent_mode = "multagent";
            mcp_server = false;
            tools = { ...tools, ...this.windowManager.subAgentWindow.getMainSubAgent() };
        }
        if (this.funcItems.react.baseagent.statu) {
            agent_mode = "baseagent";
        }
        this.tool_call = new ToolCall(this.plugins, tools, this.llm_service, this.window, this.windowManager.alertWindow, {
            agent_prompt: null,
            mcp_server: mcp_server,
            todolist: true,
            subagent: false,
            agent_mode: agent_mode
        });
        this.chain_call = new ChainCall(this.plugins, this.llm_service, this.window, this.windowManager.alertWindow);
        this.main_server = new MainServer(this);
        // 创建 Worker
        // eslint-disable-next-line no-undef
        this.worker = new Worker(path.join(__dirname, 'MainWorker.js'));
        // 发送任务
        this.worker.postMessage({ type: 'start' });
        // 接收结果
        this.worker.on('message', (request) => {
            console.log('Received from worker:', request);
            const { requestId, cdata } = request;
            switch (cdata.method) {
                case "completions":
                    this.main_server.completions(cdata.data).then(result => {
                        this.worker.postMessage({ requestId, result });
                    });
                    break;
                case "mode":
                    this.main_server.mode(cdata.data).then(result => {
                        this.worker.postMessage({ requestId, result });
                    });
                    break;
                case "list":
                    this.main_server.list().then(result => {
                        this.worker.postMessage({ requestId, result });
                    });
                    break;
                case "checkout":
                    this.main_server.checkout(cdata.data).then(result => {
                        this.worker.postMessage({ requestId, result });
                    });
                    break;
                default:
                    console.error('Unknown method:', cdata.method);
            }
        });
    }

    setup() {

        ipcMain.handle('get-file-path', async () => {
            return new Promise((resolve, rejects) => {
                const lastDirectory = store.get('lastFileDirectory') || utils.getDefault("config.json");
                dialog
                    .showOpenDialog(this.window, {
                        properties: ['openFile'],
                        defaultPath: lastDirectory
                    })
                    .then(result => {
                        if (!result.canceled) {
                            const filePath = result.filePaths[0];
                            store.set('lastFileDirectory', path.dirname(filePath));
                            console.log(filePath);
                            if (this.funcItems.react.statu) {
                                const ssh_config = utils.getSshConfig();
                                if (ssh_config?.enabled) {
                                    const conn = new Client();
                                    conn
                                        .on('ready', () => {
                                            console.log('SSH Connection Ready');
                                            conn.sftp(async (err, sftp) => {
                                                if (err) throw err;

                                                const base_name = path.basename(filePath);
                                                const remotePath = `/tmp/${base_name}`;

                                                this.window.webContents.send('upload-progress', { state: "start" });

                                                // 方法1: 使用 put 方法（推荐）
                                                const readStream = fs.createReadStream(filePath);
                                                const writeStream = sftp.createWriteStream(remotePath);

                                                // 获取文件大小用于计算进度
                                                const stats = fs.statSync(filePath);
                                                const fileSize = stats.size;
                                                let uploadedSize = 0;

                                                readStream.on('data', (chunk) => {
                                                    uploadedSize += chunk.length;
                                                    const progress = Math.round((uploadedSize / fileSize) * 100);
                                                    this.window.webContents.send('upload-progress', {
                                                        state: "progress",
                                                        progress: progress
                                                    });
                                                });

                                                writeStream.on('close', () => {
                                                    console.log(`文件上传成功: ${filePath} -> remote:${remotePath}`);
                                                    conn.end();
                                                    this.window.webContents.send('upload-progress', {
                                                        state: "end",
                                                        remotePath
                                                    });
                                                });

                                                writeStream.on('error', (err) => {
                                                    console.error('上传失败:', err);
                                                    conn.end();
                                                    this.window.webContents.send('upload-progress', {
                                                        state: "error",
                                                        error: err.message
                                                    });
                                                });

                                                readStream.pipe(writeStream);
                                            });
                                        })
                                        .on('error', (err) => {
                                            console.error('Connection Error:', err);
                                            this.window.webContents.send('upload-progress', {
                                                state: "error",
                                                error: err.message
                                            });
                                        })
                                        .on('close', () => {
                                            console.log('Connection Closed');
                                        })
                                        .connect(ssh_config);

                                } else {
                                    resolve(filePath)
                                }
                            } else {
                                resolve(filePath)
                            }
                        }
                    })
                    .catch(err => {
                        rejects(err);
                    });
            });
        })

        ipcMain.handle('query-text', async (_event, data) => {
            // eslint-disable-next-line no-undef
            if (process.platform !== 'win32') {
                this.window.show();
            } else {
                this.window.focus();
            }
            if (global.status.auto_opt) {
                await this.tool_call.contextAutoOpt(data);
            }
            // Default values
            data = this.tool_call.getDataDefault({ ...data });
            data.query = this.funcItems.text.event(data.query);
            this.llm_service.startMessage();
            if (data?.is_plugin) {
                let content = await this.chain_call.pluginCall(data);
                this.window.webContents.send('stream-data', { id: data.id, content: content, end: true, is_plugin: data.is_plugin });
            }
            else if (this.funcItems.react.statu) {
                // ReAct
                await this.tool_call.callReAct(data)
            }
            else {
                // Chain call
                await this.chain_call.callChain(data);
            }
        })

        ipcMain.handle("toggle-message", async (_event, data) => {
            let message_len = await this.llm_service.toggleMessage({ ...data, del_mode: !!this.funcItems.del.statu });
            this.tool_call.setHistory();
            console.log(`delete id: ${data.id}, length: ${message_len}`)
            return { del_mode: !!this.funcItems.del.statu };
        })

        ipcMain.handle("thumb-message", async (_event, data) => {
            let result = await this.llm_service.thumbMessage(data);
            if (result?.type === "messages") {
                const messages = result.data;
                this.tool_call.setHistory();
                console.log(`message id: ${data.id}, thumb: ${data.thumb}`);
                utils.sendData(inner.url_base.data.collection, {
                    "chat_id": this.llm_service.chat.id,
                    "message_id": data.id,
                    "user_message": messages[0].content,
                    "agent_messages": messages,
                });
                return messages ? data.thumb : 0;
            } else if (result?.type === "thumb") {
                return result.data;
            }
        })

        ipcMain.handle("toggle-memory", async (_event, memory_id) => {
            let memory_len = await this.llm_service.toggleMemory({ memory_id: memory_id, del_mode: !!this.funcItems.del.statu });
            this.tool_call.setHistory();
            console.log(`delete memory_id: ${memory_id}, length: ${memory_len}`)
            return { del_mode: !!this.funcItems.del.statu };
        })

        ipcMain.on("toggle-auto-opt", () => {
            global.status.auto_opt = !global.status.auto_opt;
            console.log(`global.status.auto_opt: ${global.status.auto_opt}`)
        })

        ipcMain.on("stream-message-stop", () => {
            this.llm_service.stopMessage();
            this.windowManager.subAgentWindow.destroy();
        })

        ipcMain.on('submit', (_event, formData) => {
            this.send_query(formData, global.model, global.version);
        })

        ipcMain.on('change-mode', (_event, mode) => {
            this.tool_call.change_mode(mode);
        })

        ipcMain.on('open-external', (_event, href) => {
            console.log(href)
            shell.openExternal(href);
        })

        ipcMain.handle('new-chat', () => {
            this.windowManager.subAgentWindow.destroy();
            const chat = this.tool_call.newChat();
            return chat;
        })

        ipcMain.handle('load-chat', (_event, id) => {
            this.windowManager.subAgentWindow.destroy();
            const chat = this.tool_call.loadChat(id);
            return chat;
        })

        ipcMain.on('del-chat', (_event, id) => {
            if (id == this.llm_service.chat.id) {
                this.llm_service.init();
                this.windowManager.subAgentWindow.destroy();
                this.window.webContents.send('clear');
            }
            this.tool_call.delHistory(id);
        })

        ipcMain.on('rename-chat', (_event, chat) => {
            this.tool_call.renameHistory(chat);
        })

        // 读取配置
        ipcMain.handle('get-config-main', () => {
            return utils.getConfig();
        });

        // 保存配置
        ipcMain.handle('set-config-main', (_, config) => {
            let state = utils.setConfig(config);
            this.updateVersionsSubmenu()
            const plugins = new Plugins();
            plugins.init();
            return state;
        });

        // 环境变量
        ipcMain.handle('envs', (_, data) => {
            if (data.type === "set") {
                const envs = data.envs;
                this.llm_service.chat.envs = envs;
                this.tool_call.setHistory()
                return true;
            } else {
                const envs = this.tool_call?.llm_service.chat.envs;
                return envs || {};
            }
        });

        // 任务列表
        ipcMain.handle('tasks', (_, data) => {
            if (data.type === "set") {
                const tasks = data.tasks;
                this.llm_service.chat.vars.tasks = tasks;
                this.tool_call.setHistory();
                return true;
            } else {
                const tasks = this.tool_call?.llm_service.chat.vars.tasks;
                return tasks || [];
            }
        });

        ipcMain.on('set-global', (_, chat) => {
            this.llm_service.chat.tokens = chat.tokens;
            this.llm_service.chat.seconds = chat.seconds;
        });

        ipcMain.on('show-log', (_, data) => {
            this.windowManager.alertWindow.create(data);
        });
    }

    send_query(data, model, version, api_callback = true) {
        data = { ...data, model, version, is_plugin: model === "plugins", id: ++this.llm_service.chat.max_index }
        this.window.webContents.send('query', { data, api_callback });
    }

    getClipEvent(e) {
        return setInterval(async () => {
            let clipboardContent = clipboard.readText();

            if (clipboardContent !== global.last_clipboard_content) {
                if (global.concat) {
                    global.last_clipboard_content = `${global.last_clipboard_content} ${clipboardContent}`;
                    clipboard.writeText(global.last_clipboard_content);
                } else {
                    global.last_clipboard_content = clipboardContent;
                }
                if (this.funcItems.text.statu) {
                    try {
                        const dom = new JSDOM(global.last_clipboard_content);
                        const plainText = dom.window.document.body.textContent;
                        global.last_clipboard_content = plainText
                        clipboard.writeText(plainText);
                        console.log('Clipboard content has been converted to plain text.');
                    } catch (error) {
                        console.error('Failed to clear clipboard formatting:', error);
                    }
                }
                if (e.statu) {
                    captureMouse()
                        .then((mousePosition) => {
                            console.log(mousePosition);
                            this.windowManager.iconWindow.create(mousePosition);
                        })
                        .catch((error) => {
                            console.error(error);
                        });
                }
            }
        }, 100);
    }

    getMarkDownEvent(e) {
        const markdownFormat = () => {
            this.window.webContents.send('markdown-format', e.statu);
        }
        markdownFormat();
        return markdownFormat;
    }

    getTextEvent(e) {
        const textFormat = (text) => {
            if (text != null) {
                text = text.replaceAll('-\n', '');
                if (e.statu) {
                    return text.replace(/[\s\n]+/g, ' ').trim();
                } else {
                    return text;
                }
            }
        }
        return textFormat;
    }

    getReactEvent(e) {
        const extraReact = () => {
            this.window.webContents.send('react-statu', e.statu);
            if (global.is_plugin) {
                console.log(inner.model_obj)
                console.log(global)
                this.window.webContents.send("extra_load", e.statu && this.plugins.get[global.version]?.extra)
            }
            else {
                const ssh_config = utils.getSshConfig();
                let extra = [{ "type": "act-plan" }];
                if (ssh_config?.enabled) {
                    extra.push({ "type": "file-upload" });
                }
                this.window.webContents.send("extra_load", e.statu ? extra : utils.getConfig("extra"));
            }
        }
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
        const filePath = utils.getConfig("prompt");
        let prompt = "";
        if (fs.existsSync(filePath)) {
            prompt = fs.readFileSync(filePath, 'utf-8');
        }
        const history_data = utils.getHistoryData();
        this.window.webContents.send('init-info', { prompt, ...global, chat: this.llm_service.chat, chats: history_data.data });
    }

    updateVersionsSubmenu() {
        const menu = Menu.buildFromTemplate(this.getTemplate());
        Menu.setApplicationMenu(menu);
    }

    getModelsSubmenu() {
        return Object.keys(utils.getConfig("models")).map((_model) => {
            return {
                type: 'radio',
                checked: global.model == _model,
                click: () => {
                    global.model = _model;
                    global.is_plugin = _model === "plugins";
                    global.version = utils.getConfig("models")[_model]["versions"][0].version;
                    this.updateVersionsSubmenu();
                },
                label: _model
            }
        })
    }

    getVersionsSubmenu() {
        let versions;
        if (global.is_plugin) {
            versions = inner.model[inner.model_name.plugins]["versions"];
            console.log(versions)
            versions = versions.filter(version => version?.show);
            console.log(versions)
        }
        else {
            versions = utils.getConfig("models")[global.model]["versions"];
        }
        this.funcItems.react.event();
        console.log(versions);
        return versions.map((version) => {
            const _version = version?.version || version;
            return {
                type: 'radio',
                checked: global.version == _version,
                click: () => {
                    global.version = _version
                    if (global.is_plugin) {
                        this.window.webContents.send("extra_load", version?.extra)
                    }
                },
                label: _version
            }
        })
    }

    getTemplate() {
        return [
            {
                label: "Model Selection",
                submenu: this.getModelsSubmenu()
            },
            {
                label: "Version Selection",
                submenu: this.getVersionsSubmenu()
            },
            {
                label: "Configuration",
                submenu: [
                    {
                        label: 'Model',
                        click: async () => {
                            this.windowManager.modelWindow.create();;
                        }
                    },
                    {
                        label: 'Setting',
                        click: async () => {
                            this.windowManager.configWindow.create();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Save Configuration',
                        click: () => {
                            console.log(store.get('lastSaveConfigurationPath') || utils.getDefault(), global.config)
                            const lastPath = path.join(store.get('lastSaveConfigurationPath') || utils.getDefault(), global.config);
                            dialog.showSaveDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [
                                    { name: 'JSON File', extensions: ['json'] },
                                    { name: 'All Files', extensions: ['*'] }
                                ]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastSaveConfigurationPath', path.dirname(result.filePath));
                                    const config = utils.getConfig();
                                    fs.writeFileSync(result.filePath, JSON.stringify(config, null, 2));
                                    console.log('Configuration saved successfully.');
                                }
                            }).catch(err => {
                                console.error(err);
                            });
                        }
                    },
                    {
                        label: 'Load Configuration',
                        click: () => {
                            const lastPath = store.get('lastLoadConfigurationPath') || utils.getDefault();
                            dialog.showOpenDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [
                                    { name: 'JSON File', extensions: ['json'] },
                                    { name: 'All Files', extensions: ['*'] }
                                ]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastLoadConfigurationPath', path.dirname(result.filePaths[0]));
                                    // 复制配置文件到默认目录
                                    const configFilePath = path.join(utils.getDefault(), global.config);
                                    fs.copyFile(result.filePaths[0], configFilePath, (err) => {
                                        if (err) {
                                            console.error('Error copying configuration file:', err);
                                        } else {
                                            console.log('Configuration file copied successfully.');
                                            this.windowManager.configWindow.window?.webContents.send('load-config', configFilePath);
                                            this.restart(this.window);
                                        }
                                    });
                                }
                            }).catch(err => {
                                console.error(err);
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
                    {
                        click: this.funcItems.markdown.click,
                        label: 'Auto MarkDown',
                        type: 'checkbox',
                        checked: this.funcItems.markdown.statu,
                    },
                    {
                        click: this.funcItems.text.click,
                        label: 'Text Formatting',
                        type: 'checkbox',
                        checked: this.funcItems.text.statu,
                    },
                    {
                        click: this.funcItems.clip.click,
                        label: 'Copy Tool',
                        type: 'checkbox',
                        checked: this.funcItems.clip.statu,
                    },
                    {
                        click: this.funcItems.del.click,
                        label: 'Delete Mode',
                        type: 'checkbox',
                        checked: this.funcItems.del.statu,
                    },
                ]
            },
            {
                label: "Agent",
                submenu: [
                    {
                        label: 'Chain Call',
                        click: async () => {
                            this.loadChain();
                        }
                    },
                    {
                        label: 'LLM Conversation',
                        click: this.funcItems.react.llm.click,
                        type: 'checkbox',
                        checked: this.funcItems.react.llm.statu,
                    },
                    { type: 'separator' },
                    {
                        label: 'Agent Mode',
                        submenu: [
                            {
                                label: 'TransAgent',
                                click: this.funcItems.react.transagent.click,
                                type: 'checkbox',
                                checked: this.funcItems.react.transagent.statu,
                            },
                            {
                                label: 'MultAgent',
                                click: this.funcItems.react.multagent.click,
                                type: 'checkbox',
                                checked: this.funcItems.react.multagent.statu,
                            },
                            {
                                label: 'BaseAgent',
                                click: this.funcItems.react.baseagent.click,
                                type: 'checkbox',
                                checked: this.funcItems.react.baseagent.statu,
                            },
                        ]
                    },
                ]
            },
            {
                label: 'Others',
                submenu: [
                    { type: 'separator' },
                    {
                        label: 'Load System Prompt',
                        click: async () => {
                            this.loadPrompt();
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Reset Conversation',
                        click: () => {
                            this.window.webContents.send('clear');
                            this.windowManager.subAgentWindow.destroy();
                            this.tool_call.init_var();
                            const chat_id = utils.copy(this.llm_service.chat.id);
                            this.llm_service.init();
                            this.llm_service.chat.id = chat_id;
                            this.tool_call.setHistory();
                            this.tool_call.change_mode();
                        }
                    },
                    {
                        label: 'Save Conversation',
                        click: () => {
                            const lastPath = path.join(store.get('lastSavePath') || utils.getDefault("history/"), `messages_${this.llm_service.chat?.name || utils.formatDate()}.json`);
                            console.log(lastPath)
                            dialog.showSaveDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [
                                    { name: 'JSON File', extensions: ['json'] },
                                    { name: 'All Files', extensions: ['*'] }
                                ]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastSavePath', path.dirname(result.filePath));
                                    this.llm_service.saveMessages(result.filePath);
                                }
                            }).catch(err => {
                                console.error(err);
                            });
                        }
                    },
                    {
                        label: 'Load Conversation',
                        click: () => {
                            const lastPath = store.get('lastLoadPath') || utils.getDefault("history/");
                            dialog.showOpenDialog(this.window, {
                                defaultPath: lastPath,
                                filters: [
                                    { name: 'JSON File', extensions: ['json'] },
                                    { name: 'All Files', extensions: ['*'] }
                                ]
                            }).then(result => {
                                if (!result.canceled) {
                                    store.set('lastLoadPath', path.dirname(result.filePaths[0]));
                                    this.tool_call.init_var();
                                    this.tool_call.load_message(result.filePaths[0]);
                                    this.tool_call.setHistory();
                                    this.window.webContents.send('set-chat', this.llm_service.chat);
                                }
                            }).catch(err => {
                                console.error(err);
                            });
                        }
                    },
                    { type: 'separator' },
                    {
                        label: 'Console',
                        click: () => {
                            if (this.windowManager?.configWindow) this.windowManager.configWindow.window?.webContents.openDevTools();
                            if (this.windowManager?.modelWindow) this.windowManager.modelWindow.window?.webContents.openDevTools();
                            if (this.window) this.window.webContents.openDevTools();
                        }
                    },
                ]
            }

        ]
    }

    setPrompt(filePath = null) {
        if (!!filePath && fs.existsSync(filePath)) {
            const config = utils.getConfig();
            if (this.funcItems.react.statu) {
                config.tool_call.extra_prompt = filePath;
            } else {
                const system_prompt = fs.readFileSync(filePath, 'utf-8');
                this.llm_service.chat.system_prompt = system_prompt;
                this.window.webContents.send('prompt', system_prompt);
            }
            utils.setConfig(config);
        }
    }

    loadPrompt() {
        // eslint-disable-next-line no-undef
        const lastDirectory = store.get('lastPromptDirectory') || path.join(process.resourcesPath, 'resources/', 'system_prompts/');
        dialog
            .showOpenDialog(this.window, {
                properties: ['openFile'],
                defaultPath: lastDirectory
            })
            .then(result => {
                if (!result.canceled) {
                    const filePath = result.filePaths[0];
                    store.set('lastPromptDirectory', path.dirname(filePath));
                    console.log(filePath);
                    this.setPrompt(filePath);
                }
            })
            .catch(err => {
                console.log(err);
            });
    }

    setChain(chain) {
        let config = utils.getConfig();
        config.chain_call = JSON.parse(chain).chain_call;
        config.extra = [];
        for (const key in config.chain_call) {
            if (Object.hasOwnProperty.call(config.chain_call, key)) {
                const item = config.chain_call[key];
                let extra;
                if (item?.model == inner.model_name.plugins) {
                    extra = this.plugins.getTool(item.version)?.extra || []
                } else {
                    extra = [{ "type": "system-prompt" }]
                }
                extra.forEach(extra_ => {
                    config.extra.push(extra_)
                });
            }
        }
        const deduplicateByType = (arr) => {
            const seen = new Set();
            return arr.filter(item => {
                const duplicate = seen.has(item.type);
                seen.add(item.type);
                return !duplicate;
            });
        }
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

    loadChain() {
        // eslint-disable-next-line no-undef
        const lastDirectory = store.get('lastChainDirectory') || path.join(process.resourcesPath, 'resources/', 'chain_calls/');
        dialog
            .showOpenDialog(this.window, {
                properties: ['openFile'],
                defaultPath: lastDirectory
            })
            .then(result => {
                if (!result.canceled) {
                    const filePath = result.filePaths[0];
                    store.set('lastChainDirectory', path.dirname(filePath));
                    console.log(filePath);
                    const chain = fs.readFileSync(filePath, 'utf-8');
                    this.setChain(chain);
                }
            })
            .catch(err => {
                console.log(err);
            });
    }
}

module.exports = {
    MainWindow
};