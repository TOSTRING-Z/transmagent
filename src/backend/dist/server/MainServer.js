"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainServer = void 0;
class MainServer {
    mainWindow;
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
    }
    async completions(data) {
        return new Promise((resolve, reject) => {
            const chatManager = this.mainWindow.session().llmService.chatManager;
            const cdata = {
                query: data.messages[data.messages.length - 1].content,
                max_step: data?.max_step
            };
            this.mainWindow.startAgentLoop(cdata);
            this.mainWindow.session().llmService.startLoop();
            const _data = this.mainWindow.session().tool_call.getDataDefault(cdata);
            this.mainWindow.session().tool_call.callReAct(_data)
                .then((result) => {
                this.mainWindow.session().tool_call.setHistory();
                let message_list = chatManager.getMessages(true)
                    .filter((message) => message.group_id === chatManager.chat.group_id);
                message_list = this.mainWindow.session().llmService.adapter.formatMessages(message_list, result);
                resolve({ messages: message_list });
            })
                .catch((error) => {
                console.error('[MainServer] Error in callReAct:', error);
                reject({ error: error.message });
            });
        });
    }
    async mode(data) {
        try {
            if (data.mode) {
                this.mainWindow.session().tool_call.changeMode(data.mode);
                this.mainWindow.window?.webContents.send('handleSetChat', this.mainWindow.session().llmService.chatManager.chat);
            }
            return { chat_mode: this.mainWindow.session().llmService.chatManager.chat.mode };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async model(data) {
        try {
            if (data.model) {
                const modelConfig = this.mainWindow.session().utils.getConfig("models")[data.model];
                if (!modelConfig) {
                    return { error: `Model '${data.model}' not found` };
                }
                this.mainWindow.sessionManager.setSessionChat({
                    model: data.model,
                    is_plugin: data.model === "plugins",
                    version: modelConfig?.versions[0].version,
                });
                this.mainWindow.updateVersionsSubmenu();
                this.mainWindow.window?.webContents.send('handleSetChat', this.mainWindow.sessionManager.getChat());
                if (this.mainWindow.session().tool_call.setHistory) {
                    this.mainWindow.session().tool_call.setHistory();
                }
            }
            return { model: this.mainWindow.sessionManager.getChat()?.model };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async list() {
        try {
            const history_data = this.mainWindow.session().utils.getHistoryData();
            return { history_data };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async checkout(data) {
        try {
            let chat;
            if (data?.chat_id) {
                // 加载已有会话
                this.mainWindow.sessionManager.checkoutSession(data?.chat_id);
                let chat = this.mainWindow.session().llmService.chatManager.chat;
                this.mainWindow.updateVersionsSubmenu();
                if (chat) {
                    this.mainWindow.session().llmService.chatManager.loadFromChat(chat);
                    this.mainWindow.window?.webContents.send('handleloadChat', chat);
                }
            }
            else {
                // 创建新会话
                this.mainWindow.sessionManager.updateSession();
                this.mainWindow.updateVersionsSubmenu();
                chat = this.mainWindow.session().llmService.chatManager.chat;
                this.mainWindow.window?.webContents.send("clear");
                this.mainWindow.window?.webContents.send('handleNewChat', chat);
            }
            return { chat };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async agent_mode(data) {
        try {
            if (data.agent_mode) {
                this.mainWindow.setActiveAgent(data.agent_mode);
            }
            return { agent_mode: this.mainWindow.sessionManager.getAgentMode() };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async tool_format(data) {
        try {
            if (data.tool_format && (data.tool_format === 'toolcalls' || data.tool_format === 'prompt')) {
                this.mainWindow.sessionManager.setSessionChat({
                    tool_format: data.tool_format,
                });
                this.mainWindow.updateVersionsSubmenu();
                this.mainWindow.window?.webContents.send('handleSetChat', this.mainWindow.sessionManager.getChat());
                if (this.mainWindow.session().tool_call.setHistory) {
                    this.mainWindow.session().tool_call.setHistory();
                }
            }
            return { tool_format: this.mainWindow.sessionManager.getChat()?.tool_format };
        }
        catch (error) {
            return { error: error.message };
        }
    }
}
exports.MainServer = MainServer;
//# sourceMappingURL=MainServer.js.map