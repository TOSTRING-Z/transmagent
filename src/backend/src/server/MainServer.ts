import { utils } from '../utils/globals';
import type { MainWindow } from '../main/windows/MainWindow';

interface CompletionsRequest {
    messages: Array<{ role: string; content: string }>;
    max_step?: number;
}

interface CheckoutRequest {
    chat_id?: string;
    chat_name?: string;
}

interface ModeRequest {
    mode?: string;
}

interface ServerResult<T = any> {
    error?: string;
    [key: string]: T | string | undefined;
}

export class MainServer {
    private mainWindow: MainWindow;

    constructor(mainWindow: MainWindow) {
        this.mainWindow = mainWindow;
    }

    async completions(data: CompletionsRequest): Promise<ServerResult> {
        return new Promise((resolve, reject) => {
            const chatManager = this.mainWindow.llm_service.chatManager;

            const cdata: any = {
                query: data.messages[data.messages.length - 1].content,
                max_step: data?.max_step
            };

            this.mainWindow.send_query(
                cdata,
                chatManager.chat.model,
                chatManager.chat.version,
                false
            );

            const _data = this.mainWindow.tool_call.getDataDefault(cdata);
            _data.id = String(chatManager.chat.max_index);

            this.mainWindow.tool_call.callReAct(_data)
                .then((result: any) => {
                    this.mainWindow.tool_call.setHistory();

                    let message_list = chatManager.getMessages(true)
                        .filter((message: any) => message.id === result.id);

                    message_list = this.mainWindow.llm_service.adapter.formatMessages(
                        message_list,
                        result.params,
                        result.env_message
                    );

                    resolve({ messages: message_list });
                })
                .catch((error: Error) => {
                    console.error('[MainServer] Error in callReAct:', error);
                    reject({ error: error.message });
                });
        });
    }

    async mode(data: ModeRequest): Promise<ServerResult> {
        try {
            if (data.mode) {
                this.mainWindow.tool_call.change_mode(data.mode);
            }
            return { chat_mode: this.mainWindow.llm_service.chatManager.chat.mode };
        } catch (error: any) {
            return { error: error.message };
        }
    }

    async list(): Promise<ServerResult> {
        try {
            const history_data = utils.getHistoryData();
            return { history_data };
        } catch (error: any) {
            return { error: error.message };
        }
    }

    async checkout(data: CheckoutRequest): Promise<ServerResult> {
        try {
            const chatManager = this.mainWindow.llm_service.chatManager;

            if (data?.chat_id) {
                // 加载已有会话
                const chat = await this.mainWindow.tool_call.loadChat(data.chat_id);
                if (chat) {
                    chatManager.loadFromChat(chat);
                    this.mainWindow.window?.webContents.send(
                        'select-chat',
                        chatManager.chat
                    );
                }
            } else {
                // 创建新会话
                this.mainWindow.window?.webContents.send('clear');
                chatManager.init();

                if (data?.chat_name) {
                    chatManager.chat.name = data.chat_name;
                }

                this.mainWindow.window?.webContents.send(
                    'new-chat',
                    chatManager.chat
                );
                this.mainWindow.tool_call.setHistory();
            }

            return { chat: chatManager.chat };
        } catch (error: any) {
            return { error: error.message };
        }
    }
}