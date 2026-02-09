import { DOM, State } from './globals';
import { showLog } from './ui';
import { createElement } from './utils';

const editors = {
  envs: null as any,
  tasks: null as any,
};

export function initConfigEvents() {
  // Environment Variables
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

  // Tasks List
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

// Configuration Modal
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
  
  ai_model.onchange = (event: any) => {
    api_url.value = config.models[event.target.value]?.api_url || '';
    api_key.value = config.models[event.target.value]?.api_key || '';
  };

  if (config.plugins?.cli_execute) {
    (document.getElementById('cli-prompt') as HTMLInputElement).value = config.tool_call.cli_prompt || '';
    (document.getElementById('ssh-host') as HTMLInputElement).value = config.tool_call.ssh_config?.host || '';
    (document.getElementById('ssh-port') as HTMLInputElement).value = config.tool_call.ssh_config?.port || '';
    (document.getElementById('ssh-username') as HTMLInputElement).value = config.tool_call.ssh_config?.username || '';
    (document.getElementById('ssh-password') as HTMLInputElement).value = config.tool_call.ssh_config?.password || '';
    (document.getElementById('ssh-enabled') as HTMLInputElement).checked = !!config.tool_call.ssh_config?.enabled;
    (document.getElementById('mcp_server-biotools-url') as HTMLInputElement).value = config.mcp_server.biotools.url || '';
    (document.getElementById('mcp_server-biotools-enabled') as HTMLInputElement).checked = !!config.mcp_server?.biotools.enabled;
  } else {
    const remoteDiv = document.getElementById('remote-div');
    if (remoteDiv) remoteDiv.style.display = "none";
  }
}

export function hideConfig() {
  document.querySelectorAll('.config-modal').forEach((m: any) => m.style.display = 'none');
}

export async function saveConfig() {
  const config = await window.electronAPI.getConfig();
  const postConfig = {
    tool_call: {
      cli_prompt: (document.getElementById('cli-prompt') as HTMLInputElement).value,
      ssh_config: {
        host: (document.getElementById('ssh-host') as HTMLInputElement).value,
        port: parseInt((document.getElementById('ssh-port') as HTMLInputElement).value),
        username: (document.getElementById('ssh-username') as HTMLInputElement).value,
        password: (document.getElementById('ssh-password') as HTMLInputElement).value,
        enabled: (document.getElementById('ssh-enabled') as HTMLInputElement).checked
      }
    },
    mcp_server: {
      biotools: {
        url: (document.getElementById('mcp_server-biotools-url') as HTMLInputElement).value,
        disabled: (document.getElementById('mcp_server-biotools-disabled') as HTMLInputElement).checked
      }
    },
  };
  
  let ai_config = {
    model: (document.getElementById('ai-model') as HTMLSelectElement).value,
    api_url: (document.getElementById('api-url') as HTMLInputElement).value,
    api_key: (document.getElementById('api-key') as HTMLInputElement).value,
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
  showLog('success', 'Configuration saved successfully!');
  hideConfig();
}
