import { DOM, State } from './globals';
import { showLog } from './ui';
import { createElement } from './utils';
const editors = {
    envs: null,
    tasks: null,
};
export function initConfigEvents() {
    // Environment Variables
    DOM.btn_save_envs.addEventListener('click', async () => {
        const envs = editors.envs.get();
        const statu = await window.electronAPI.Envs({ type: "set", envs: envs });
        if (statu)
            showLog('success', 'Configuration saved successfully!');
    });
    DOM.envs.addEventListener('click', async () => {
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
    DOM.btn_save_tasks.addEventListener('click', async () => {
        const taskList = editors.tasks.get();
        const statu = await window.electronAPI.Tasks({ type: "set", tasks: taskList });
        if (statu)
            showLog('success', 'Tasks saved!');
    });
    DOM.tasks.addEventListener('click', async () => {
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
// Configuration Modal
export async function showConfig() {
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
            const option = createElement(`<option value="${model}">${model}</option>`);
            ai_model.appendChild(option);
        }
    }
    if (State.chat && State.chat.model) {
        ai_model.value = State.chat.model;
        api_url.value = config.models[State.chat.model]?.api_url || '';
        api_key.value = config.models[State.chat.model]?.api_key || '';
    }
    const compress_box_1 = document.getElementById('compress-context');
    if (compress_box_1 && State.chat) {
        compress_box_1.checked = !!State.chat.compress_context;
    }
    ai_model.onchange = (event) => {
        api_url.value = config.models[event.target.value]?.api_url || '';
        api_key.value = config.models[event.target.value]?.api_key || '';
    };
    // ======== 小圆的魔法：根据当前聊天记录同步配置面板上的模型和压缩选项 ========
    if (State.chat && State.chat.model) {
        ai_model.value = State.chat.model;
        api_url.value = config.models[State.chat.model]?.api_url || '';
        api_key.value = config.models[State.chat.model]?.api_key || '';
    }
    const compress_box_2 = document.getElementById('compress-context');
    if (compress_box_2 && State.chat) {
        compress_box_2.checked = !!State.chat.compress_context;
    }
    // ==========================================================================
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
export function hideConfig() {
    document.querySelectorAll('.config-modal').forEach((m) => m.style.display = 'none');
}
export async function saveConfig() {
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
    // ======== 小圆的魔法：将当前的设置同步更新到当前的聊天中，并保存 ========
    const compress_box_3 = document.getElementById('compress-context');
    if (State.chat) {
        State.chat.model = ai_config.model;
        State.chat.compress_context = compress_box_3 ? compress_box_3.checked : false;
        window.electronAPI.saveChat(State.chat);
    }
    // ========================================================================
    await window.electronAPI.setConfig(config);
    showLog('success', 'Configuration saved successfully!');
    hideConfig();
}
