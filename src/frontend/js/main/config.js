import { DOM } from './globals';
import { State } from './state';
import { showLog } from './ui';
import { createElement } from './utils';
const editors = {
    envs: null,
    tasks: null,
};
export function initConfigEvents() {
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
    // ─── 后台任务面板 ──────────────────────────────────────────────────────
    DOM.bgtasks.addEventListener('click', async () => {
        const modal = document.getElementById('m-bgtasks');
        if (modal)
            modal.style.display = 'flex';
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
        window._bgAutoRefresh = autoRefresh;
    });
    DOM.btn_clear_bgtasks.addEventListener('click', async () => {
        await window.electronAPI.BGTasks({ type: "clear" });
        await renderBGTasks();
    });
}
// ─── 后台任务列表渲染 ─────────────────────────────────────────────────────
let _lastTasksSnapshot = '';
async function renderBGTasks() {
    const container = document.getElementById('bg_tasks_list');
    if (!container)
        return;
    const expandedTasks = window._expandedTasks
        ? Array.from(window._expandedTasks)
        : [];
    const tasks = await window.electronAPI.BGTasks({ type: "get" });
    // 计算快照：仅比对会影响 DOM 结构的关键字段
    const newSnapshot = JSON.stringify(tasks.map(t => ({
        id: t.taskId, status: t.status, summary: t.resultSummary || ''
    })));
    if (newSnapshot === _lastTasksSnapshot && tasks.length > 0) {
        // 无结构性变化，仅内联更新 elapsed 时间，不重建 DOM（消除闪烁）
        updateElapsedTimes(tasks);
        return;
    }
    _lastTasksSnapshot = newSnapshot;
    const emptyEl = document.getElementById('bg_tasks_empty');
    if (!tasks || tasks.length === 0) {
        _lastTasksSnapshot = '';
        container.innerHTML = '';
        const div = document.createElement('div');
        div.id = 'bg_tasks_empty';
        div.style.cssText = 'text-align: center; color: #888; padding: 40px 0; font-size: 14px;';
        div.textContent = 'No background tasks running';
        container.appendChild(div);
        return;
    }
    const statusColors = {
        running: '#f59e0b',
        completed: '#10b981',
        failed: '#ef4444',
    };
    const statusIcons = {
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
        const stopBtn = t.status === 'running'
            ? `<button class="bg-stop-btn" data-taskid="${escapeHtml(t.taskId)}" title="Stop task" style="
          background: transparent;
          border: 1px solid #ef4444;
          color: #ef4444;
          cursor: pointer;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          transition: background 0.2s;
        " onmouseover="this.style.background='#ef444422'" onmouseout="this.style.background='transparent'">
          <i class="fas fa-stop"></i> Stop
        </button>`
            : '';
        const detailsBtn = (t.status === 'running' || t.status === 'completed' || t.status === 'failed')
            ? `<button class="bg-details-toggle-btn" data-taskid="${escapeHtml(t.taskId)}" onclick="toggleTaskDetails('${escapeHtml(t.taskId)}')">
          <i class="fas fa-terminal"></i> Details
        </button>`
            : '';
        const isExpanded = expandedTasks.includes(t.taskId);
        const detailsPanel = `<div class="bg-task-details-panel" id="bg-details-panel-${escapeHtml(t.taskId)}" style="display: ${isExpanded ? 'block' : 'none'};"></div>`;
        return `
      <div style="
        padding: 12px 16px;
        border-bottom: 1px solid rgba(139, 92, 246, 0.08);
        font-size: 13px;
      " data-taskid="${escapeHtml(t.taskId)}">
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
          <div style="display: flex; align-items: center; gap: 10px;">
            ${detailsBtn}
            ${stopBtn}
            <span style="color: #888; font-size: 12px;" data-elapsed="${escapeHtml(t.taskId)}">${elapsed}</span>
          </div>
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
        ${detailsPanel}
      </div>
    `;
    }).join('');
    // 保存已展开面板的 innerHTML，避免重建时闪烁
    const savedPanels = {};
    for (const tid of expandedTasks) {
        const panel = document.getElementById('bg-details-panel-' + tid);
        if (panel)
            savedPanels[tid] = panel.innerHTML;
    }
    container.innerHTML = rows;
    // 绑定 Stop 按钮事件（innerHTML 后需重新挂载）
    container.querySelectorAll('.bg-stop-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const taskId = btn.dataset.taskid;
            if (!taskId)
                return;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            await window.electronAPI.BGTasks({ type: "interrupt", taskId });
            await renderBGTasks();
        });
    });
    // 从缓存恢复已展开任务的详情面板（无 IPC 调用，不闪烁）
    for (const tid of expandedTasks) {
        const panel = document.getElementById('bg-details-panel-' + tid);
        if (panel && savedPanels[tid]) {
            panel.innerHTML = savedPanels[tid];
            panel.style.display = 'block';
        }
    }
    // 对运行中的展开任务启动 2s 刷新（仅更新文本内容，不重建 DOM）
    if (window._bgOutputRefreshInterval) {
        clearInterval(window._bgOutputRefreshInterval);
        window._bgOutputRefreshInterval = null;
    }
    const runningExpanded = expandedTasks.filter(tid => {
        const t = tasks.find(t2 => t2.taskId === tid);
        return t && t.status === 'running';
    });
    if (runningExpanded.length > 0) {
        window._bgOutputRefreshInterval = setInterval(async () => {
            for (const tid of runningExpanded) {
                await refreshTaskOutput(tid);
            }
        }, 2000);
    }
}
function updateElapsedTimes(tasks) {
    const container = document.getElementById('bg_tasks_list');
    if (!container)
        return;
    const cards = container.querySelectorAll('[data-taskid]');
    cards.forEach(card => {
        const tid = card.dataset.taskid;
        const t = tasks.find(t2 => t2.taskId === tid);
        if (!t)
            return;
        const elapsed = t.endTime
            ? `${((t.endTime - t.startTime) / 1000).toFixed(1)}s`
            : `${((Date.now() - t.startTime) / 1000).toFixed(0)}s running`;
        const span = card.querySelector(`[data-elapsed="${tid}"]`);
        if (span)
            span.textContent = elapsed;
    });
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
// ─── 后台任务详情面板 ───────────────────────────────────────────────────
window.toggleTaskDetails = async (taskId) => {
    const panel = document.getElementById('bg-details-panel-' + taskId);
    if (!panel)
        return;
    window._expandedTasks = window._expandedTasks || new Set();
    if (panel.style.display === 'none' || panel.style.display === '') {
        panel.style.display = 'block';
        window._expandedTasks.add(taskId);
        await loadTaskDetails(taskId);
    }
    else {
        panel.style.display = 'none';
        window._expandedTasks.delete(taskId);
        window._loadedDetails = window._loadedDetails || new Set();
        window._loadedDetails.delete(taskId);
    }
};
async function loadTaskDetails(taskId) {
    const panel = document.getElementById('bg-details-panel-' + taskId);
    if (!panel)
        return;
    window._loadedDetails = window._loadedDetails || new Set();
    // 先显示 loading 状态
    panel.innerHTML = `
    <div class="bg-task-details">
      <div class="bg-details-header">
        <span class="bg-details-title"><i class="fas fa-terminal"></i> Task Output</span>
        <div class="bg-details-actions">
          <button class="bg-details-btn" onclick="toggleTaskDetails('${escapeHtml(taskId)}')">
            <i class="fas fa-chevron-up"></i> Collapse
          </button>
        </div>
      </div>
      <div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">
        <i class="fas fa-spinner fa-spin" style="margin-right: 8px;"></i> Loading task output...
      </div>
    </div>
  `;
    try {
        const details = await window.electronAPI.BGTaskDetails({ type: 'getDetails', taskId });
        const output = await window.electronAPI.BGTaskDetails({ type: 'getOutput', taskId });
        const outputFilePath = details?.outputFilePath || 'N/A';
        panel.innerHTML = `
      <div class="bg-task-details">
        <div class="bg-details-header">
          <span class="bg-details-title"><i class="fas fa-terminal"></i> Task Output</span>
          <div class="bg-details-actions">
            <button class="bg-details-btn" onclick="copyOutputPath('${escapeHtml(taskId)}')">
              <i class="fas fa-copy"></i> Copy Path
            </button>
            <button class="bg-details-btn" onclick="openOutputFolder('${escapeHtml(taskId)}')">
              <i class="fas fa-folder-open"></i> Open Folder
            </button>
            <button class="bg-details-btn" onclick="toggleTaskDetails('${escapeHtml(taskId)}')">
              <i class="fas fa-chevron-up"></i> Collapse
            </button>
          </div>
        </div>
        <div class="bg-details-meta">
          <span><i class="fas fa-file"></i> Output: <code class="bg-details-path">${escapeHtml(outputFilePath)}</code></span>
        </div>
        <pre class="bg-details-output"><code>${escapeHtml(output)}</code></pre>
      </div>
    `;
        window._loadedDetails.add(taskId);
    }
    catch (err) {
        panel.innerHTML = `<div class="bg-task-details" style="color: #ef4444; font-size: 12px;">Failed to load details: ${escapeHtml(err.message || 'Unknown error')}</div>`;
    }
}
async function refreshTaskOutput(taskId) {
    const panel = document.getElementById('bg-details-panel-' + taskId);
    if (!panel)
        return;
    const codeEl = panel.querySelector('.bg-details-output code');
    if (!codeEl)
        return;
    try {
        const output = await window.electronAPI.BGTaskDetails({ type: 'getOutput', taskId });
        codeEl.textContent = output;
    }
    catch (_err) { /* ignore refresh errors */ }
}
window.copyOutputPath = async (taskId) => {
    try {
        const details = await window.electronAPI.BGTaskDetails({ type: 'getDetails', taskId });
        if (details?.outputFilePath) {
            await navigator.clipboard.writeText(details.outputFilePath);
            showLog('success', 'Path copied to clipboard');
        }
    }
    catch (_err) {
        showLog('error', 'Failed to copy path');
    }
};
window.openOutputFolder = async (taskId) => {
    try {
        await window.electronAPI.BGTaskDetails({ type: 'openFolder', taskId });
    }
    catch (_err) {
        showLog('error', 'Failed to open folder');
    }
};
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
    if (State.chat && State.chat.compress_context !== undefined) {
        DOM.compress_box.checked = State.chat.compress_context;
    }
    const memoryLength = document.getElementById('memory-length');
    if (memoryLength)
        memoryLength.value = String(State.chat.memory_length ?? '');
    const longMemoryLength = document.getElementById('long-memory-length');
    if (longMemoryLength)
        longMemoryLength.value = String(State.chat.long_memory_length ?? '');
    const maxTokens = document.getElementById('max-tokens');
    if (maxTokens)
        maxTokens.value = String(State.chat.max_tokens ?? '');
    ai_model.onchange = (event) => {
        api_url.value = config.models[event.target.value]?.api_url || '';
        api_key.value = config.models[event.target.value]?.api_key || '';
    };
    const cli_prompt = document.getElementById('cli-prompt');
    if (cli_prompt)
        cli_prompt.value = config.tool_call?.cli_prompt || '';
    const ssh_host = document.getElementById('ssh-host');
    if (ssh_host)
        ssh_host.value = config.tool_call?.ssh_config?.host || '';
    const ssh_port = document.getElementById('ssh-port');
    if (ssh_port)
        ssh_port.value = config.tool_call?.ssh_config?.port || '';
    const ssh_username = document.getElementById('ssh-username');
    if (ssh_username)
        ssh_username.value = config.tool_call?.ssh_config?.username || '';
    const ssh_password = document.getElementById('ssh-password');
    if (ssh_password)
        ssh_password.value = config.tool_call?.ssh_config?.password || '';
    const ssh_enabled = document.getElementById('ssh-enabled');
    if (ssh_enabled)
        ssh_enabled.checked = !!config.tool_call?.ssh_config?.enabled;
    const biotools_url = document.getElementById('mcp_server-biotools-url');
    if (biotools_url)
        biotools_url.value = config.mcp_server?.biotools?.url || '';
    const biotools_disabled = document.getElementById('mcp_server-biotools-disabled');
    if (biotools_disabled) {
        biotools_disabled.checked = config.mcp_server?.biotools?.disabled;
    }
}
export function hideConfig() {
    // 停止后台任务轮询
    if (window._bgAutoRefresh) {
        clearInterval(window._bgAutoRefresh);
        window._bgAutoRefresh = null;
    }
    document.querySelectorAll('.config-modal').forEach((m) => m.style.display = 'none');
}
export async function saveConfig() {
    const config = await window.electronAPI.getConfig();
    const ai_model = document.getElementById('ai-model').value;
    const api_url = document.getElementById('api-url').value;
    const api_key = document.getElementById('api-key').value;
    if (!config.models)
        config.models = {};
    if (!config.models[ai_model])
        config.models[ai_model] = { api_url: '', api_key: '' };
    config.models[ai_model].api_url = api_url;
    config.models[ai_model].api_key = api_key;
    State.chat.compress_context = DOM.compress_box.checked;
    const memoryLength = document.getElementById('memory-length');
    if (memoryLength)
        State.chat.memory_length = Number(memoryLength.value) || 0;
    const longMemoryLength = document.getElementById('long-memory-length');
    if (longMemoryLength)
        State.chat.long_memory_length = Number(longMemoryLength.value) || 0;
    const maxTokens = document.getElementById('max-tokens');
    if (maxTokens)
        State.chat.max_tokens = Number(maxTokens.value) || 0;
    window.electronAPI.setChat(State.chat);
    if (!config.tool_call)
        config.tool_call = {};
    config.tool_call.cli_prompt = document.getElementById('cli-prompt')?.value || '';
    if (!config.tool_call.ssh_config)
        config.tool_call.ssh_config = {};
    config.tool_call.ssh_config.host = document.getElementById('ssh-host')?.value || '';
    config.tool_call.ssh_config.port = Number(document.getElementById('ssh-port')?.value) || 22;
    config.tool_call.ssh_config.username = document.getElementById('ssh-username')?.value || '';
    config.tool_call.ssh_config.password = document.getElementById('ssh-password')?.value || '';
    config.tool_call.ssh_config.enabled = !!document.getElementById('ssh-enabled')?.checked;
    if (!config.mcp_server)
        config.mcp_server = {};
    if (!config.mcp_server.biotools)
        config.mcp_server.biotools = {};
    config.mcp_server.biotools.url = document.getElementById('mcp_server-biotools-url')?.value || '';
    const biotools_disabled = document.getElementById('mcp_server-biotools-disabled');
    config.mcp_server.biotools.disabled = biotools_disabled.checked;
    await window.electronAPI.setConfig(config);
    // @ts-ignore
    if (typeof showLog === 'function')
        showLog('success', 'Configuration saved successfully!');
    hideConfig();
}
