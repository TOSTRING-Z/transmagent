import { DOM } from './globals';
import { State } from './state';
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

  // ─── 后台任务面板 ──────────────────────────────────────────────────────

  DOM.bgtasks.addEventListener('click', async () => {
    const modal = document.getElementById('m-bgtasks');
    if (modal) modal.style.display = 'flex';
    await renderBGTasks();

    // 自动轮询刷新（每 2s）
    const autoRefresh = setInterval(async () => {
      if (!modal || modal.style.display !== 'flex') {
        clearInterval(autoRefresh);
        return;
      }
      await renderBGTasks();
    }, 2000);
    // 模态关闭时停止轮询
    (window as any)._bgAutoRefresh = autoRefresh;
  });

  DOM.btn_clear_bgtasks.addEventListener('click', async () => {
    await window.electronAPI.BGTasks({ type: "clear" });
    await renderBGTasks();
  });
}

// ─── 后台任务列表渲染 ─────────────────────────────────────────────────────

async function renderBGTasks() {
  const container = document.getElementById('bg_tasks_list');
  if (!container) return;

  const tasks: Array<{
    taskId: string;
    sessionId: string;
    toolName: string;
    commandSummary: string;
    status: string;
    startTime: number;
    endTime?: number;
    resultSummary?: string;
  }> = await window.electronAPI.BGTasks({ type: "get" });

  const emptyEl = document.getElementById('bg_tasks_empty');

  if (!tasks || tasks.length === 0) {
    container.innerHTML = '';
    const div = document.createElement('div');
    div.id = 'bg_tasks_empty';
    div.style.cssText = 'text-align: center; color: #888; padding: 40px 0; font-size: 14px;';
    div.textContent = 'No background tasks running';
    container.appendChild(div);
    return;
  }

  const statusColors: Record<string, string> = {
    running: '#f59e0b',
    completed: '#10b981',
    failed: '#ef4444',
  };

  const statusIcons: Record<string, string> = {
    running: 'fa-spinner fa-spin',
    completed: 'fa-check-circle',
    failed: 'fa-times-circle',
  };

  const rows = tasks.map((t) => {
    const startStr = new Date(t.startTime).toLocaleString();
    const elapsed = t.endTime
      ? `${((t.endTime - t.startTime) / 1000).toFixed(1)}s`
      : `${((Date.now() - t.startTime) / 1000).toFixed(0)}s running`;
    const color = statusColors[t.status] || '#888';
    const icon = statusIcons[t.status] || 'fa-question-circle';
    const result = t.resultSummary
      ? `<div style="font-size: 11px; color: #999; margin-top: 4px; word-break: break-all;">${escapeHtml(t.resultSummary)}</div>`
      : '';

    return `
      <div style="
        padding: 12px 16px;
        border-bottom: 1px solid rgba(139, 92, 246, 0.08);
        font-size: 13px;
      ">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 10px;">
            <i class="fas ${icon}" style="color: ${color}; font-size: 16px;"></i>
            <span style="font-weight: 600; color: #e2e8f0;">${escapeHtml(t.toolName)}</span>
            <span style="
              display: inline-block;
              padding: 2px 8px;
              border-radius: 10px;
              font-size: 11px;
              background: ${color}22;
              color: ${color};
              border: 1px solid ${color}44;
            ">${t.status}</span>
          </div>
          <span style="color: #888; font-size: 12px;">${elapsed}</span>
        </div>
        <div style="margin-top: 6px; color: #aab; font-size: 12px; font-family: monospace;">
          <span style="color: #666;">${escapeHtml(t.taskId)}</span>
          <span style="color: #888; margin: 0 8px;">|</span>
          <span style="color: #aaa;">${escapeHtml(t.commandSummary)}</span>
        </div>
        <div style="margin-top: 2px; color: #777; font-size: 11px;">
          Started: ${startStr}
        </div>
        ${result}
      </div>
    `;
  }).join('');

  container.innerHTML = rows;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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
  // 停止后台任务轮询
  if ((window as any)._bgAutoRefresh) {
    clearInterval((window as any)._bgAutoRefresh);
    (window as any)._bgAutoRefresh = null;
  }
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

  State.chat.compress_context = DOM.compress_box.checked;
  window.electronAPI.setChat(State.chat);

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
