"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveConfig = exports.hideConfig = exports.showConfig = exports.initConfigEvents = void 0;
const globals_1 = require("./globals");
const ui_1 = require("./ui");
const utils_1 = require("./utils");
const editors = {
    envs: null,
    tasks: null,
};
function initConfigEvents() {
    // Environment Variables
    globals_1.DOM.btn_save_envs.addEventListener('click', async () => {
        const envs = editors.envs.get();
        const statu = await window.electronAPI.Envs({ type: "set", envs: envs });
        if (statu)
            (0, ui_1.showLog)('success', 'Configuration saved successfully!');
    });
    globals_1.DOM.envs.addEventListener('click', async () => {
        const mEnvs = document.getElementById('m-envs');
        if (mEnvs)
            mEnvs.style.display = 'flex';
        const config_envs = await window.electronAPI.Envs({ type: "get" });
        const editor_env = document.getElementById("editor_env");
        // @ts-ignore
        editors.envs = editors.envs || new JSONEditor(editor_env, {
            mode: 'tree',
            modes: ['tree', 'code'],
        });
        editors.envs.set(config_envs);
    });
    // Tasks List
    globals_1.DOM.btn_save_tasks.addEventListener('click', async () => {
        const taskList = editors.tasks.get();
        const statu = await window.electronAPI.Tasks({ type: "set", tasks: taskList });
        if (statu)
            (0, ui_1.showLog)('success', 'Tasks saved!');
    });
    globals_1.DOM.tasks.addEventListener('click', async () => {
        const taskList = await window.electronAPI.Tasks({ type: "get" });
        const mTasks = document.getElementById('m-tasks');
        if (mTasks)
            mTasks.style.display = 'flex';
        const editor_tasks = document.getElementById("editor_tasks");
        // @ts-ignore
        editors.tasks = editors.tasks || new JSONEditor(editor_tasks, {
            mode: 'tree',
            modes: ['tree', 'code'],
        });
        editors.tasks.set(taskList);
    });
}
exports.initConfigEvents = initConfigEvents;
// Configuration Modal
async function showConfig() {
    const mConfig = document.querySelector('#m-config');
    if (mConfig)
        mConfig.style.display = 'flex';
    const config = await window.electronAPI.getConfig();
    const ai_model = document.getElementById("ai-model");
    const api_url = document.getElementById("api-url");
    const api_key = document.getElementById("api-key");
    ai_model.innerHTML = '';
    for (const model in config.models) {
        if (Object.prototype.hasOwnProperty.call(config.models[model], "api_key")) {
            if (!api_url.value && !api_key.value) {
                api_url.value = config.models[model]?.api_url || '';
                api_key.value = config.models[model]?.api_key || '';
            }
            const option = (0, utils_1.createElement)(`<option value="${model}">${model}</option>`);
            ai_model.appendChild(option);
        }
    }
    ai_model.onchange = (event) => {
        api_url.value = config.models[event.target.value]?.api_url || '';
        api_key.value = config.models[event.target.value]?.api_key || '';
    };
    if (config.plugins?.cli_execute) {
        document.getElementById('cli-prompt').value = config.tool_call.cli_prompt || '';
        document.getElementById('ssh-host').value = config.tool_call.ssh_config?.host || '';
        document.getElementById('ssh-port').value = config.tool_call.ssh_config?.port || '';
        document.getElementById('ssh-username').value = config.tool_call.ssh_config?.username || '';
        document.getElementById('ssh-password').value = config.tool_call.ssh_config?.password || '';
        document.getElementById('ssh-enabled').checked = !!config.tool_call.ssh_config?.enabled;
        document.getElementById('mcp_server-biotools-url').value = config.mcp_server.biotools.url || '';
        document.getElementById('mcp_server-biotools-enabled').checked = !!config.mcp_server?.biotools.enabled;
    }
    else {
        const remoteDiv = document.getElementById('remote-div');
        if (remoteDiv)
            remoteDiv.style.display = "none";
    }
}
exports.showConfig = showConfig;
function hideConfig() {
    document.querySelectorAll('.config-modal').forEach((m) => m.style.display = 'none');
}
exports.hideConfig = hideConfig;
async function saveConfig() {
    const config = await window.electronAPI.getConfig();
    const postConfig = {
        tool_call: {
            cli_prompt: document.getElementById('cli-prompt').value,
            ssh_config: {
                host: document.getElementById('ssh-host').value,
                port: parseInt(document.getElementById('ssh-port').value),
                username: document.getElementById('ssh-username').value,
                password: document.getElementById('ssh-password').value,
                enabled: document.getElementById('ssh-enabled').checked
            }
        },
        mcp_server: {
            biotools: {
                url: document.getElementById('mcp_server-biotools-url').value,
                disabled: document.getElementById('mcp_server-biotools-disabled').checked
            }
        },
    };
    let ai_config = {
        model: document.getElementById('ai-model').value,
        api_url: document.getElementById('api-url').value,
        api_key: document.getElementById('api-key').value,
    };
    if (config.plugins?.cli_execute) {
        config.tool_call.ssh_config = postConfig.tool_call.ssh_config;
        config.tool_call.cli_prompt = postConfig.tool_call.cli_prompt;
        config.mcp_server.biotools.url = postConfig.mcp_server.biotools.url;
        config.mcp_server.biotools.disabled = postConfig.mcp_server.biotools.disabled;
    }
    config.models[ai_config.model].api_url = ai_config.api_url;
    config.models[ai_config.model].api_key = ai_config.api_key;
    await window.electronAPI.setConfig(config);
    (0, ui_1.showLog)('success', 'Configuration saved successfully!');
    hideConfig();
}
exports.saveConfig = saveConfig;
//# sourceMappingURL=config.js.map