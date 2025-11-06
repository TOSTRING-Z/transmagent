const { utils } = require('../modules/globals')
const { ReActAgent, State } = require("./agent")

class ChainCall extends ReActAgent {
    constructor(plugins, llm_service, window, alertWindow) {
        super(plugins, llm_service, window, alertWindow);
        this.is_plugin = false;
    }

    async pluginCall(data) {
        data.prompt_format = "";
        let func = this.plugins.getTool(data.version)?.func
        data.output = await this.retry(func, data);
        if (!data.output) {
            return null;
        }
        data.outputs.push(utils.copy(data.output));
        if (data.output_template) {
            data.output_format = data.output_template.format(data);
        } else {
            data.output_format = data.output;
        }
        data.output_formats.push(utils.copy(data.output_format));
        return data.output_format;
    }

    async step(data) {
        this.is_plugin = data.model === "plugins";
        let state = null;
        if (data.model === "plugins") {
            state = await this.pluginCall(data);
        }
        else {
            state = await this.llmCall(data);
        }
        if (!state) {
            this.state = State.ERROR;
        }
        if (data.end) {
            this.state = State.FINAL;
        }
    }

    async callChain(data) {
        this.llm_service.chat.system_prompt = data.prompt;
        this.state = State.IDLE;
        let chain_calls = utils.getConfig("chain_call");
        for (const step in chain_calls) {
            if (this.llm_service.stop) {
                this.window?.webContents.send('stream-data', { id: data.id, content: "The user interrupted the task.", end: true });
                break;
            }
            data = { ...data, ...chain_calls[step], step: step };
            const tool_params = {}
            const input_data = chain_calls[step]?.input_data || [];
            for (const key in input_data) {
                if (Object.hasOwnProperty.call(input_data, key)) {
                    const item = input_data[key];
                    tool_params[key] = item.format(data);
                }
            }
            data = { ...data, ...tool_params };
            await this.step(data);
            if (!this.llm_service.chat.name) {
                this.setChatName(data).then(() => {
                    if (this.llm_service.chat.name) {
                        this.window.webContents.send('auto-rename-chat', this.llm_service.chat);
                    }
                });
            }
            this.setHistory();
            if (this.state == State.FINAL) {
                if (this.is_plugin)
                    this.window?.webContents.send('stream-data', { id: data.id, content: data.output_format, end: true });
                break;
            }
            if (this.state == State.ERROR) {
                this.window?.webContents.send('stream-data', { id: data.id, content: "Error occurred!", end: true });
                break;
            }

            let info = this.get_info(data);
            this.window?.webContents.send('info-data', { id: data.id, content: info });
        }
        this.sendData(data);
        return data;
    }
}

module.exports = {
    ChainCall
};