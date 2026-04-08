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

interface AgentModeRequest {
    agent_mode?: string;
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
            const chatManager = this.mainWindow.session().llmService.chatManager;

            const cdata: any = {
                query: data.messages[data.messages.length - 1].content,
                max_step: data?.max_step
            };

            this.mainWindow.startAgentLoop(cdata);
            this.mainWindow.session().llmService.startLoop();

            const _data = this.mainWindow.session().tool_call.getDataDefault(cdata);

            this.mainWindow.session().tool_call.callReAct(_data)
                .then((result: any) => {
                    this.mainWindow.session().tool_call.setHistory();

                    let message_list = chatManager.getMessages(true)
                        .filter((message: any) => message.group_id === chatManager.chat.group_id);

                    message_list = this.mainWindow.session().llmService.adapter.formatMessages(
                        message_list,
                        result
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
                this.mainWindow.session().tool_call.changeMode(data.mode);
                this.mainWindow.window?.webContents.send('handleSetChat', this.mainWindow.session().llmService.chatManager.chat);
            }
            return { chat_mode: this.mainWindow.session().llmService.chatManager.chat.mode };
        } catch (error: any) {
            return { error: error.message };
        }
    }

    async list(): Promise<ServerResult> {
        try {
            const history_data = this.mainWindow.session().utils.getHistoryData();
            return { history_data };
        } catch (error: any) {
            return { error: error.message };
        }
    }

    async checkout(data: CheckoutRequest): Promise<ServerResult> {
        try {
            let chat;
            if (data?.chat_id) {
                // 加载已有会话
                this.mainWindow.sessionManager.checkoutSession(data?.chat_id);
                let chat = this.mainWindow.session().llmService.chatManager.chat;
                this.mainWindow.updateVersionsSubmenu();
                if (chat) {
                    this.mainWindow.session().llmService.chatManager.loadFromChat(chat);
                    this.mainWindow.window?.webContents.send(
                        'handleloadChat',
                        chat
                    );
                }
            } else {
                // 创建新会话
                this.mainWindow.sessionManager.updateSession();
                this.mainWindow.updateVersionsSubmenu();
                chat = this.mainWindow.session().llmService.chatManager.chat;
                this.mainWindow.window?.webContents.send("clear");
                this.mainWindow.window?.webContents.send(
                    'handleNewChat',
                    chat
                );
            }

            return { chat };
        } catch (error: any) {
            return { error: error.message };
        }
    }

    async agent_mode(data: AgentModeRequest): Promise<ServerResult> {
        try {
            if (data.agent_mode) {
                this.mainWindow.setActiveAgent(data.agent_mode as any);
            }
            return { agent_mode: this.mainWindow.sessionManager.getAgentMode() };
        } catch (error: any) {
            return { error: error.message };
        }
    }
}