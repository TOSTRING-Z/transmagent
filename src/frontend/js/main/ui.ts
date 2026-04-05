import { startAgentLoop } from './chat';
import { DOM } from './globals';
import { State } from './state';
import { initChat } from './history';
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
  const input_h = DOM.input ? DOM.input.clientHeight : 40;
  // We need to store original height somewhere if we want strict adherence to old code,
  // but let's approximate minHeight as 40px or current clientHeight if not resized.
  // A safer bet is 40px base.
  const minHeight = 40;
  const maxHeight = minHeight * 3;

  const scrollHeight = textarea.scrollHeight;
  const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
  textarea.style.height = newHeight + "px";

  if (DOM.top_div && DOM.bottom_div) {
    DOM.top_div.style.height = (window.innerHeight - DOM.bottom_div.clientHeight) + "px";
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
const htmlContent = `
<div class="base-container">
    <div class="base-header">
      <div class="base-icon">B</div>
      <h1 class="base-title">I am TransMAgent, an AI agent specialized in transcriptional regulation analysis.</h1>
    </div>
    <div class="options-container">
      <div data-query="Coverage analysis of SNPs on the GATA2 gene" class="option-card">
        <div class="option-icon">📍</div>
        <h3 class="option-title">Regional annotation analysis</h3>
        <p class="option-desc">Enhancer annotation, transcription factor binding prediction, SNP site analysis"</p>
      </div>
      <div data-query="Analyze TP53 gene expression across tissues and generate a heatmap visualization" class="option-card">
        <div class="option-icon">📈</div>
        <h3 class="option-title">Gene expression analysis</h3>
        <p class="option-desc">Tissue/cell/disease-specific expression profiling, co-expression network analysis, and expression pattern visualization</p>
      </div>
      <div data-query="Analyze the enhancer coverage of ESR1, GATA3, FOXA1, and EP300 genes, and identify motifs in overlapping enhancers" class="option-card">
        <div class="option-icon">🧬</div>
        <h3 class="option-title">Sequence data analysis</h3>
        <p class="option-desc">Motif discovery, sequence alignment, deepTools analysis</p>
      </div>
    </div>
  </div>
`;

export function handleClear() {
  DOM.messages.innerHTML = "";
  DOM.pause.style.display = "none";
  DOM.pause.innerHTML = "";
  initChat();

  const optionDom = createElement(htmlContent);
  const optionCards = optionDom.querySelectorAll('.option-card');

  optionCards.forEach((card: any) => {
    card.addEventListener('click', () => {
      const query = card.dataset.query;
      if (query) {
        State.formData.query = query;
        State.formData.prompt = DOM.system_prompt.value;
        startAgentLoop(State.formData);
        window.electronAPI.agentLoop(State.formData);
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
        if (info?.remotePath)
          DOM.input.value = `Upload: ${info.remotePath}\n${DOM.input.value}`;
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
