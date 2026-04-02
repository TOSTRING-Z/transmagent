"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainServer = void 0;
const globals_1 = require("../utils/globals");
class MainServer {
    mainWindow;
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
    }
    async completions(data) {
        return new Promise((resolve, reject) => {
            const chatManager = this.mainWindow.llm_service.chatManager;
            const cdata = {
                query: data.messages[data.messages.length - 1].content,
                max_step: data?.max_step
            };
            this.mainWindow.startAgentLoop(cdata);
            this.mainWindow.llm_service.startMessage();
            const _data = this.mainWindow.tool_call.getDataDefault(cdata);
            this.mainWindow.tool_call.callReAct(_data)
                .then((result) => {
                this.mainWindow.tool_call.setHistory();
                let message_list = chatManager.getMessages(true)
                    .filter((message) => message.group_id === chatManager.chat.group_id);
                message_list = this.mainWindow.llm_service.adapter.formatMessages(message_list, result);
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
                this.mainWindow.tool_call.changeMode(data.mode);
                this.mainWindow.window?.webContents.send('handleSetChat', this.mainWindow.llm_service.chatManager.chat);
            }
            return { chat_mode: this.mainWindow.llm_service.chatManager.chat.mode };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async list() {
        try {
            const history_data = globals_1.utils.getHistoryData();
            return { history_data };
        }
        catch (error) {
            return { error: error.message };
        }
    }
    async checkout(data) {
        try {
            const chatManager = this.mainWindow.llm_service.chatManager;
            if (data?.chat_id) {
                // 加载已有会话
                const chat = await this.mainWindow.tool_call.loadChat(data.chat_id);
                if (chat) {
                    chatManager.loadFromChat(chat);
                    this.mainWindow.window?.webContents.send('select-chat', chatManager.chat);
                }
            }
            else {
                // 创建新会话
                this.mainWindow.window?.webContents.send('clear');
                chatManager.init();
                if (data?.chat_name) {
                    chatManager.chat.name = data.chat_name;
                }
                this.mainWindow.window?.webContents.send('newChat', chatManager.chat);
                this.mainWindow.tool_call.setHistory();
            }
            return { chat: chatManager.chat };
        }
        catch (error) {
            return { error: error.message };
        }
    }
}
exports.MainServer = MainServer;
//# sourceMappingURL=MainServer.js.map