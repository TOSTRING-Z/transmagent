"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProgress = exports.hideRenameDialog = exports.showRenameDialog = exports.loadOptions = exports.toggleSidebar = exports.init_size = exports.autoResizeTextarea = exports.toggleMode = exports.showLog = void 0;
const globals_1 = require("./globals");
const utils_1 = require("./utils");
// UI Helper Functions
function showLog(type, content) {
    window.electronAPI.showLog({ type, content });
}
exports.showLog = showLog;
function toggleMode(mode, send = true) {
    if (send)
        window.electronAPI.changeMode(mode);
    globals_1.DOM.auto.classList.remove("active");
    globals_1.DOM.act.classList.remove("active");
    globals_1.DOM.plan.classList.remove("active");
    globals_1.DOM.flash.classList.remove("active");
    switch (mode) {
        case "auto":
            globals_1.DOM.auto.classList.add("active");
            break;
        case "act":
            globals_1.DOM.act.classList.add("active");
            break;
        case "plan":
            globals_1.DOM.plan.classList.add("active");
            break;
        case "flash":
            globals_1.DOM.flash.classList.add("active");
            break;
    }
}
exports.toggleMode = toggleMode;
function autoResizeTextarea(textarea) {
    if (!textarea)
        return;
    textarea.style.height = 'auto';
    const input_h = globals_1.DOM.input ? globals_1.DOM.input.clientHeight : 40;
    // We need to store original height somewhere if we want strict adherence to old code,
    // but let's approximate minHeight as 40px or current clientHeight if not resized.
    // A safer bet is 40px base.
    const minHeight = 40;
    const maxHeight = minHeight * 3;
    const scrollHeight = textarea.scrollHeight;
    const newHeight = Math.max(minHeight, Math.min(scrollHeight, maxHeight));
    textarea.style.height = newHeight + "px";
    if (globals_1.DOM.top_div && globals_1.DOM.bottom_div) {
        globals_1.DOM.top_div.style.height = (window.innerHeight - globals_1.DOM.bottom_div.clientHeight) + "px";
    }
}
exports.autoResizeTextarea = autoResizeTextarea;
function init_size() {
    if (!globals_1.DOM.input || !globals_1.DOM.system_prompt || !globals_1.DOM.top_div || !globals_1.DOM.bottom_div)
        return;
    const bottomHeight = globals_1.DOM.bottom_div.clientHeight;
    globals_1.DOM.top_div.style.height = (window.innerHeight - bottomHeight) + "px";
}
exports.init_size = init_size;
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
        const icon = document.querySelector('.collapse-btn i');
        if (icon) {
            icon.classList.toggle('fa-chevron-left');
            icon.classList.toggle('fa-chevron-right');
        }
    }
}
exports.toggleSidebar = toggleSidebar;
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
function loadOptions() {
    globals_1.DOM.messages.innerHTML = "";
    globals_1.DOM.pause.style.display = "none";
    globals_1.DOM.pause.innerHTML = "";
    globals_1.State.chat.seconds = 0;
    if (globals_1.State.seconds_timer)
        clearInterval(globals_1.State.seconds_timer);
    globals_1.State.chat.tokens = 0;
    globals_1.State.chat.msg_count = 0;
    globals_1.DOM.tokens.innerText = "0";
    globals_1.DOM.seconds.innerText = "0";
    globals_1.DOM.msg_count.innerText = "0";
    const optionDom = (0, utils_1.createElement)(htmlContent);
    const optionCards = optionDom.querySelectorAll('.option-card');
    optionCards.forEach((card) => {
        card.addEventListener('click', () => {
            const query = card.dataset.query;
            if (query) {
                globals_1.State.formData.query = query;
                globals_1.State.formData.prompt = globals_1.DOM.system_prompt.value;
                window.electronAPI.clickSubmit(globals_1.State.formData);
            }
        });
        card.style.cursor = 'pointer';
        card.style.transition = 'transform 0.2s';
        card.addEventListener('mouseenter', () => { card.style.transform = 'scale(1.02)'; });
        card.addEventListener('mouseleave', () => { card.style.transform = 'scale(1)'; });
    });
    globals_1.DOM.messages.append(optionDom);
}
exports.loadOptions = loadOptions;
// Rename Dialog
function showRenameDialog() {
    globals_1.DOM.renameDialog.style.display = 'flex';
    globals_1.DOM.renameInput.focus();
}
exports.showRenameDialog = showRenameDialog;
function hideRenameDialog() {
    globals_1.DOM.renameDialog.style.display = 'none';
    globals_1.DOM.renameInput.value = '';
}
exports.hideRenameDialog = hideRenameDialog;
// Progress Bar
function updateProgress(info) {
    switch (info.state) {
        case "start":
            globals_1.DOM.progress_bar.style.width = `0%`;
            globals_1.DOM.progress_bar.textContent = `0%`;
            globals_1.DOM.progress_container.style.display = "block";
            break;
        case "progress":
            globals_1.DOM.progress_bar.style.width = `${info.progress}%`;
            globals_1.DOM.progress_bar.textContent = `${info.progress}%`;
            globals_1.DOM.progress_container.style.display = "block";
            break;
        case "end":
            globals_1.DOM.progress_bar.style.width = `100%`;
            globals_1.DOM.progress_bar.textContent = `100%`;
            setTimeout(() => {
                globals_1.DOM.progress_container.style.display = "none";
                if (info?.remotePath)
                    globals_1.DOM.input.value = `Upload: ${info.remotePath}\n${globals_1.DOM.input.value}`;
            }, 500);
            break;
        case "error":
            globals_1.DOM.progress_bar.style.backgroundColor = "#ff4757";
            globals_1.DOM.progress_bar.textContent = `上传失败: ${info.error}`;
            setTimeout(() => {
                globals_1.DOM.progress_container.style.display = "none";
                globals_1.DOM.progress_bar.style.backgroundColor = "";
            }, 3000);
            break;
    }
}
exports.updateProgress = updateProgress;
//# sourceMappingURL=ui.js.map