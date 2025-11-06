const { global, utils } = require('./globals')

class MainServer {
    constructor(main_window) {
        this.main_window = main_window;
    }

    async completions(data) {
        return new Promise((resolve, reject) => {
            let cdata = {
                query: data.messages[data.messages.length - 1].content,
                max_step: data?.max_step
            };
            this.main_window.send_query(cdata, global.model, global.version, false);
            const _data = this.main_window.tool_call.getDataDefault(cdata);
            _data.id = this.main_window.llm_service.chat.max_index;

            this.main_window.tool_call.callReAct(_data)
                .then(result => {
                    this.main_window.tool_call.setHistory();
                    let message_list = this.main_window.llm_service.getMessages(true)
                        .filter(message => message.id === result.id);
                    message_list = this.main_window.llm_service.formatMessages(
                        message_list,
                        result.params,
                        result.env_message
                    );
                    resolve({ messages: message_list });
                })
                .catch(error => {
                    console.error('Error in callReAct:', error);
                    reject({ error: error.message });
                });
        });
    }

    // auto
    async mode({ mode }) {
        try {
            if (mode) {
                this.main_window.tool_call.change_mode(mode);
            }
            return { chat_mode: this.main_window.llm_service.chat.mode };
        } catch (error) {
            return { error: error.message };
        }
    }

    async list() {
        try {
            const history_data = utils.getHistoryData();
            return { history_data: history_data };
        } catch (error) {
            return { error: error.message };
        }
    }

    async checkout(data) {
        try {
            if (data?.chat_id) {
                const history = await this.main_window.tool_call.loadChat(data.chat_id);
                if (history) {
                    this.main_window.llm_service.chat = history;
                    this.main_window.window.webContents.send('select-chat', this.main_window.llm_service.chat);
                }
            } else {
                this.main_window.window.webContents.send('clear');
                this.main_window.llm_service.init();
                if (data?.chat_name) {
                    this.main_window.llm_service.chat.name = data.chat_name;
                }
                this.main_window.window.webContents.send('new-chat', this.main_window.llm_service.chat);
                this.main_window.tool_call.setHistory();
            }
            return { chat: this.main_window.llm_service.chat };
        } catch (error) {
            return { error: error.message };
        }
    }
}

module.exports = {
    MainServer
};