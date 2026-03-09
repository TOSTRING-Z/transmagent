import { DOM, State } from './globals';
import { showLog } from './ui';
import { createElement } from './utils';

const editors = {
  envs: null as any,
  tasks: null as any,
};

export function initConfigEvents() {
  DOM.btn_save_envs.addEventListener('click', async () => {
    const envs = editors.envs.get();
    const statu = await window.electronAPI.Envs({ type: "set", envs: envs });
    if (statu) showLog('success', 'Configuration saved successfully!');
  });

  DOM.envs.addEventListener('click', async () => {
    const mEnvs = document.getElementById('m-envs');
    if (mEnvs) mEnvs.style.display = 'flex';
    const config_envs = await window.electronAPI.Envs({ type: "get" });
    const editor_env = document.getElementById("editor_env") as HTMLElement;
    // @ts-ignore
    editors.envs = editors.envs || new JSONEditor(editor_env, {
      mode: 'tree',
      modes: ['tree', 'code'],
    });
    editors.envs.set(config_envs);
  });

  DOM.btn_save_tasks.addEventListener('click', async () => {
    const taskList = editors.tasks.get();
    const statu = await window.electronAPI.Tasks({ type: "set", tasks: taskList });
    if (statu) showLog('success', 'Tasks saved!');
  });

  DOM.tasks.addEventListener('click', async () => {
    const taskList = await window.electronAPI.Tasks({ type: "get" });
    const mTasks = document.getElementById('m-tasks');
    if (mTasks) mTasks.style.display = 'flex';
    const editor_tasks = document.getElementById("editor_tasks") as HTMLElement;
    // @ts-ignore
    editors.tasks = editors.tasks || new JSONEditor(editor_tasks, {
      mode: 'tree',
      modes: ['tree', 'code'],
    });
    editors.tasks.set(taskList);
  });
}

export async function showConfig() {
  const mConfig = document.querySelector('#m-config') as HTMLElement;
  if (mConfig) mConfig.style.display = 'flex';

  const config = await window.electronAPI.getConfig();
  const ai_model = document.getElementById("ai-model") as HTMLSelectElement;
  const api_url = document.getElementById("api-url") as HTMLInputElement;
  const api_key = document.getElementById("api-key") as HTMLInputElement;

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

  if (State.chat && State.chat.compress_context !== undefined) {
    DOM.compress_box.checked = State.chat.compress_context;
  }

  ai_model.onchange = (event: any) => {
    api_url.value = config.models[event.target.value]?.api_url || '';
    api_key.value = config.models[event.target.value]?.api_key || '';
  };

  const cli_prompt = document.getElementById('cli-prompt') as HTMLInputElement;
  if (cli_prompt) cli_prompt.value = config.tool_call?.cli_prompt || '';

  const ssh_host = document.getElementById('ssh-host') as HTMLInputElement;
  if (ssh_host) ssh_host.value = config.tool_call?.ssh_config?.host || '';

  const ssh_port = document.getElementById('ssh-port') as HTMLInputElement;
  if (ssh_port) ssh_port.value = config.tool_call?.ssh_config?.port || '';

  const ssh_username = document.getElementById('ssh-username') as HTMLInputElement;
  if (ssh_username) ssh_username.value = config.tool_call?.ssh_config?.username || '';

  const ssh_password = document.getElementById('ssh-password') as HTMLInputElement;
  if (ssh_password) ssh_password.value = config.tool_call?.ssh_config?.password || '';

  const ssh_enabled = document.getElementById('ssh-enabled') as HTMLInputElement;
  if (ssh_enabled) ssh_enabled.checked = !!config.tool_call?.ssh_config?.enabled;

  const biotools_url = document.getElementById('mcp_server-biotools-url') as HTMLInputElement;
  if (biotools_url) biotools_url.value = config.mcp_server?.biotools?.url || '';

  const biotools_disabled = document.getElementById('mcp_server-biotools-disabled') as HTMLInputElement;
  if (biotools_disabled) {
    biotools_disabled.checked = config.mcp_server?.biotools?.disabled;
  }
}

export function hideConfig() {
  document.querySelectorAll('.config-modal').forEach((m: any) => m.style.display = 'none');
}

export async function saveConfig() {
  const config = await window.electronAPI.getConfig();

  const ai_model = (document.getElementById('ai-model') as HTMLSelectElement).value;
  const api_url = (document.getElementById('api-url') as HTMLInputElement).value;
  const api_key = (document.getElementById('api-key') as HTMLInputElement).value;

  if (!config.models) config.models = {};
  if (!config.models[ai_model]) config.models[ai_model] = { api_url: '', api_key: '' };

  config.models[ai_model].api_url = api_url;
  config.models[ai_model].api_key = api_key;
  config.compress_context = DOM.compress_box.checked;

  State.chat.model = ai_model;
  State.chat.compress_context = DOM.compress_box.checked;
  window.electronAPI.setGlobal(State.chat);

  if (!config.tool_call) config.tool_call = {};
  config.tool_call.cli_prompt = (document.getElementById('cli-prompt') as HTMLInputElement)?.value || '';

  if (!config.tool_call.ssh_config) config.tool_call.ssh_config = {};
  config.tool_call.ssh_config.host = (document.getElementById('ssh-host') as HTMLInputElement)?.value || '';
  config.tool_call.ssh_config.port = Number((document.getElementById('ssh-port') as HTMLInputElement)?.value) || 22;
  config.tool_call.ssh_config.username = (document.getElementById('ssh-username') as HTMLInputElement)?.value || '';
  config.tool_call.ssh_config.password = (document.getElementById('ssh-password') as HTMLInputElement)?.value || '';
  config.tool_call.ssh_config.enabled = !!(document.getElementById('ssh-enabled') as HTMLInputElement)?.checked;

  if (!config.mcp_server) config.mcp_server = {};
  if (!config.mcp_server.biotools) config.mcp_server.biotools = {};
  config.mcp_server.biotools.url = (document.getElementById('mcp_server-biotools-url') as HTMLInputElement)?.value || '';

  const biotools_disabled = document.getElementById('mcp_server-biotools-disabled') as HTMLInputElement;
  config.mcp_server.biotools.disabled = biotools_disabled.checked;

  await window.electronAPI.setConfig(config);

  // @ts-ignore
  if (typeof showLog === 'function') showLog('success', 'Configuration saved successfully!');
  hideConfig();
}
