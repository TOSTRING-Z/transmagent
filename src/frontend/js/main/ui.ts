import { startAgentLoop } from './chat';
import { DOM } from './globals';
import { State } from './state';
import { updateChat } from './history';
import { createElement } from './utils';

// UI Helper Functions

export function showLog(type: string, content: string) {
  window.electronAPI.showLog({ type, content });
}

export function toggleMode(mode: string, send = false) {
  if (send) window.electronAPI.changeMode(mode);

  DOM.auto.classList.remove("active");
  DOM.act.classList.remove("active");
  DOM.plan.classList.remove("active");
  DOM.flash.classList.remove("active");

  switch (mode) {
    case "auto":
      DOM.auto.classList.add("active");
      break;
    case "act":
      DOM.act.classList.add("active");
      break;
    case "plan":
      DOM.plan.classList.add("active");
      break;
    case "flash":
      DOM.flash.classList.add("active");
      break;
  }
}

export function autoResizeTextarea(textarea: HTMLTextAreaElement) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  // 修复: 使用更稳定的最小高度计算方式
  const minHeight = 40;
  const maxHeight = minHeight * 3;

  const scrollHeight = textarea.scrollHeight;
  // 使用 scrollHeight 作为基准，避免 clientHeight 为 0 的问题
  const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  textarea.style.height = newHeight + "px";

  if (DOM.top_div && DOM.bottom_div) {
    const bottomHeight = DOM.bottom_div.clientHeight;
    DOM.top_div.style.height = (window.innerHeight - bottomHeight) + "px";
  }
}

export function init_size() {
  if (!DOM.input || !DOM.system_prompt || !DOM.top_div || !DOM.bottom_div) return;
  const bottomHeight = DOM.bottom_div.clientHeight;
  DOM.top_div.style.height = (window.innerHeight - bottomHeight) + "px";
}

export function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) {
    sidebar.classList.toggle('collapsed');
    const icon = document.querySelector('.nav-collapse-btn i');
    if (icon) {
      icon.classList.toggle('fa-chevron-left');
      icon.classList.toggle('fa-chevron-right');
    }
  }
}

// Initial Options / Welcome Screen
// 3 Agent mode cards. Clicking a card ONLY switches the active Agent mode
// (state + status bar + backend sync). No query is launched.
const htmlContent = `
<div class="base-container">
    <div class="base-header">
      <div class="base-icon">B</div>
      <h1 class="base-title">I am TransMAgent, an AI agent specialized in transcriptional regulation analysis.</h1>
    </div>
    <div class="options-container">
      <div data-mode="transagent" class="option-card mode-card">
        <div class="option-icon">🧠</div>
        <h3 class="option-title">TransAgent</h3>
        <p class="option-desc">Default mode with serial task and tool scheduling, following the "subtask – record – reflect" workflow</p>
      </div>
      <div data-mode="multagent" class="option-card mode-card">
        <div class="option-icon">🤖</div>
        <h3 class="option-title">MultAgent</h3>
        <p class="option-desc">Multi-agent collaboration mode driven by task documents, enabling specialized division of labor across sub-agents</p>
      </div>
      <div data-mode="baseagent" class="option-card mode-card">
        <div class="option-icon">⚙️</div>
        <h3 class="option-title">BaseAgent</h3>
        <p class="option-desc">Base mode for general instruction handling, providing straightforward command execution</p>
      </div>
    </div>
  </div>
`;

export function handleClear() {
  DOM.messages.innerHTML = "";
  DOM.pause.style.display = "none";
  DOM.pause.innerHTML = "";

  // S2: Do NOT call updateChat({}) here. That would wipe State.chat.agentMode
  // to undefined and reset the status bar, making it look like the user's
  // previous mode selection was lost. Only reset the transient DOM bits.
  if (DOM.tokens) DOM.tokens.innerText = "0";
  if (DOM.msg_count) (DOM.msg_count as any).innerText = "0";
  if (DOM.seconds) DOM.seconds.innerText = "0";

  // Resolve current Agent mode with a safe fallback.
  const currentMode: string =
    (State.chat && (State.chat.agentMode as string)) || 'transagent';

  // Make sure the status bar reflects the current mode on every clear.
  if (DOM.agentMode) DOM.agentMode.innerText = currentMode;

  const optionDom = createElement(htmlContent);

  // --- S3: Mode cards: click to switch mode (NO execution) ---
  const modeCards = optionDom.querySelectorAll('.mode-card');
  modeCards.forEach((card: any) => {
    const mode = card.dataset.mode as string | undefined;
    if (mode === currentMode) card.classList.add('active-mode');

    card.addEventListener('click', () => {
      const selectedMode = card.dataset.mode;
      if (!selectedMode) return;

      // 1) Frontend state: persist the new Agent mode immediately.
      if (!State.chat) {
        // Build a minimal stub so downstream consumers don't crash.
        State.chat = { agentMode: selectedMode } as any;
      } else {
        State.chat.agentMode = selectedMode as any;
      }

      // 2) Status bar: immediate visual feedback (do not wait for IPC echo).
      if (DOM.agentMode) DOM.agentMode.innerText = selectedMode;

      // 3) Toggle card highlight.
      modeCards.forEach((c: any) => c.classList.remove('active-mode'));
      card.classList.add('active-mode');

      // 4) Notify the main process; it will call tool_call.changeMode() and
      //    push back the updated chat via 'handleSetChat' -> updateChat(),
      //    which will refresh DOM.agentMode again (idempotent).
      try {
        window.electronAPI.changeMode(selectedMode);
      } catch (e) {
        // In a non-electron context (e.g. unit tests) electronAPI is absent;
        // the frontend state + UI are already updated, so we just log.
        console.warn('[ui] electronAPI.changeMode unavailable:', e);
      }
    });

    card.style.cursor = 'pointer';
    card.style.transition = 'transform 0.2s';
    card.addEventListener('mouseenter', () => { card.style.transform = 'scale(1.02)'; });
    card.addEventListener('mouseleave', () => { card.style.transform = 'scale(1)'; });
  });

  DOM.messages.append(optionDom);
}

// Rename Dialog
export function showRenameDialog() {
  DOM.renameDialog.style.display = 'flex';
  DOM.renameInput.focus();
}

export function hideRenameDialog() {
  DOM.renameDialog.style.display = 'none';
  DOM.renameInput.value = '';
}

// Progress Bar
export function updateProgress(info: any) {
  switch (info.state) {
    case "start":
      DOM.progress_bar.style.width = `0%`;
      DOM.progress_bar.textContent = `0%`;
      DOM.progress_container.style.display = "block";
      break;
    case "progress":
      DOM.progress_bar.style.width = `${info.progress}%`;
      DOM.progress_bar.textContent = `${info.progress}%`;
      DOM.progress_container.style.display = "block";
      break;
    case "end":
      DOM.progress_bar.style.width = `100%`;
      DOM.progress_bar.textContent = `100%`;
      setTimeout(() => {
        DOM.progress_container.style.display = "none";
        if (info?.filePath)
          DOM.input.value = `Upload: ${info.filePath}\n${DOM.input.value}`;
      }, 500);
      break;
    case "error":
      DOM.progress_bar.style.backgroundColor = "#ff4757";
      DOM.progress_bar.textContent = `上传失败: ${info.error}`;
      setTimeout(() => {
        DOM.progress_container.style.display = "none";
        DOM.progress_bar.style.backgroundColor = "";
      }, 3000);
      break;
  }
}
