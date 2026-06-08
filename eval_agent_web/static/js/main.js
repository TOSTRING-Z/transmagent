/* ================================================================
   评测 Agent Web — Main JavaScript
   ================================================================ */

// ── 全局状态 ─────────────────────────────────────────────
const state = {
  taskId: null,
  files: [],           // {name, model_name}
  models: [],
  tasksCount: 0,
  stats: null,
  currentTab: 'tabSummary',
  streamSource: null
};

// ── DOM 引用 ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  dropZone: $('#dropZone'),
  fileInput: $('#fileInput'),
  fileList: $('#fileList'),
  btnUpload: $('#btnUpload'),
  btnEvaluate: $('#btnEvaluate'),
  btnDownload: $('#btnDownload'),
  btnTestKey: $('#btnTestKey'),
  uploadStatus: $('#uploadStatus'),
  testKeyResult: $('#testKeyResult'),
  cardOverview: $('#cardOverview'),
  cardProgress: $('#cardProgress'),
  overviewInfo: $('#overviewInfo'),
  progressFill: $('#progressFill'),
  progressText: $('#progressText'),
  emptyState: $('#emptyState'),
  resultsContainer: $('#resultsContainer'),
  summaryContent: $('#summaryContent'),
  chartsContent: $('#chartsContent'),
  detailSelector: $('#detailSelector'),
  detailContent: $('#detailContent'),
  resultTabs: $('#resultTabs'),
  tabContents: $$('.tab-content'),
};

// ── 初始化 ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupDragDrop();
  setupTabs();
});

// ── 拖拽上传 ─────────────────────────────────────────────
function setupDragDrop() {
  const dz = dom.dropZone;

  dz.addEventListener('click', () => dom.fileInput.click());

  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag-over');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });

  dom.fileInput.addEventListener('change', () => handleFiles(dom.fileInput.files));
}

function handleFiles(fileList) {
  state.files = Array.from(fileList).filter(f => {
    const ext = f.name.split('.').pop().toLowerCase();
    return ['json', 'csv'].includes(ext);
  });

  if (state.files.length === 0) {
    setStatus('uploadStatus', 'No valid files selected (.json / .csv only)', 'err');
    dom.btnUpload.disabled = true;
    return;
  }

  dom.fileList.innerHTML = state.files.map((f, i) => `
    <div class="file-item">
      <span>📄 ${f.name}</span>
      <span class="remove-file" onclick="removeFile(${i})">×</span>
    </div>
  `).join('');

  setStatus('uploadStatus', `${state.files.length} file(s) selected`, 'ok');
  dom.btnUpload.disabled = false;
}

function removeFile(idx) {
  state.files.splice(idx, 1);
  if (state.files.length === 0) {
    dom.fileList.innerHTML = '';
    dom.btnUpload.disabled = true;
  } else {
    handleFiles(state.files); // 重建显示
  }
}

// ── API Key 测试 ─────────────────────────────────────────
async function testApiKey() {
  const apiKey = $('#apiKey').value.trim();
  const apiUrl = $('#apiUrl').value.trim();

  if (!apiKey) {
    setStatus('testKeyResult', 'Please enter API Key', 'err');
    return;
  }

  setStatus('testKeyResult', 'Testing...', '');
  dom.btnTestKey.disabled = true;

  try {
    const resp = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, api_url: apiUrl, task_id: '_test' })
    });
    const data = await resp.json();
    // 如果返回 "任务数据不存在" 说明 API Key 验证通过（只是没有评估数据）
    if (data.error === 'Task data not found, please upload files first') {
      setStatus('testKeyResult', '✅ Connected', 'ok');
    } else if (data.error) {
      setStatus('testKeyResult', '❌ ' + data.error, 'err');
    } else {
      setStatus('testKeyResult', '✅ Connected', 'ok');
    }
  } catch (e) {
    setStatus('testKeyResult', '❌ Network error: ' + e.message, 'err');
  } finally {
    dom.btnTestKey.disabled = false;
  }
}

// ── 文件上传 ─────────────────────────────────────────────
async function uploadFiles() {
  if (state.files.length === 0) return;

  const fmt = document.querySelector('input[name="format"]:checked').value;

  dom.btnUpload.disabled = true;
  setStatus('uploadStatus', 'Uploading & parsing...', '');

  const formData = new FormData();
  formData.append('format', fmt);
  state.files.forEach(f => formData.append('files', f));

  try {
    const resp = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await resp.json();

    if (data.error) {
      setStatus('uploadStatus', '❌ ' + data.error, 'err');
      dom.btnUpload.disabled = false;
      return;
    }

    state.taskId = data.task_id;
    state.models = data.models;
    state.tasksCount = data.tasks_count;

    setStatus('uploadStatus',
      `✅ Parsed: ${data.models.length} models, ${data.tasks_count} tasks`, 'ok');

    showOverview(data);

  } catch (e) {
    setStatus('uploadStatus', '❌ Upload failed: ' + e.message, 'err');
    dom.btnUpload.disabled = false;
  }
}

function showOverview(data) {
  dom.cardOverview.style.display = 'block';
  dom.overviewInfo.innerHTML = `
    <table class="summary-table">
      <tr><td style="text-align:left;font-weight:600;">Format</td><td>${data.format === 'model_json' ? 'Model Result JSON' : 'Generic Format'}</td></tr>
      <tr><td style="text-align:left;font-weight:600;">Models</td><td><strong>${data.models.length}</strong></td></tr>
      <tr><td style="text-align:left;font-weight:600;">Tasks</td><td><strong>${data.tasks_count}</strong></td></tr>
      <tr><td style="text-align:left;font-weight:600;">Model List</td><td>${data.models.join(', ')}</td></tr>
    </table>
  `;
}

// ── 启动评估 ─────────────────────────────────────────────
async function startEvaluation() {
  const apiKey = $('#apiKey').value.trim();
  const apiUrl = $('#apiUrl').value.trim();

  if (!apiKey) {
    alert('Please enter API Key first');
    return;
  }
  if (!state.taskId) {
    alert('Please upload data files first');
    return;
  }

  dom.btnEvaluate.disabled = true;
  dom.cardProgress.style.display = 'block';
  dom.progressFill.style.width = '0%';
  dom.progressText.textContent = 'Starting evaluation engine...';

  // 隐藏空状态
  dom.emptyState.style.display = 'none';
  dom.resultsContainer.style.display = 'block';

  try {
    const resp = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task_id: state.taskId,
        api_key: apiKey,
        api_url: apiUrl
      })
    });
    const data = await resp.json();

    if (data.error) {
      dom.progressText.textContent = '❌ ' + data.error;
      dom.btnEvaluate.disabled = false;
      return;
    }

    // 连接 SSE 流
    connectSSE(data.stream_url);

  } catch (e) {
    dom.progressText.textContent = '❌ Launch failed: ' + e.message;
    dom.btnEvaluate.disabled = false;
  }
}

function connectSSE(streamUrl) {
  if (state.streamSource) {
    state.streamSource.close();
  }

  const source = new EventSource(streamUrl);
  state.streamSource = source;

  source.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    dom.progressFill.style.width = data.percent + '%';
    dom.progressText.textContent =
      `Evaluating: ${data.current}/${data.total} (${data.percent}%) — ${data.task}`;
  });

  source.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data);
    dom.progressFill.style.width = '100%';
    dom.progressText.textContent = '✅ Evaluation complete! Loading results...';
    state.stats = data.stats;

    // 加载结果
    renderSummary(data.stats);
    renderCharts(data.charts);
    renderDetailSelector(data.stats.total_questions);
    dom.cardProgress.style.display = 'none';
    dom.btnEvaluate.disabled = false;

    source.close();
  });

  source.addEventListener('error', (e) => {
    let msg = 'Unknown error';
    try { const d = JSON.parse(e.data); msg = d.message; } catch (_) {}
    dom.progressText.textContent = '❌ ' + msg;
    dom.btnEvaluate.disabled = false;
    source.close();
  });

  source.addEventListener('ping', () => { /* keep-alive */ });

  source.onerror = () => {
    dom.progressText.textContent = '⚠️ Connection lost, reconnecting...';
  };
}

// ── 结果渲染：汇总表格 ──────────────────────────────────
function renderSummary(stats) {
  const models = stats.models;
  const sortedModels = [...models].sort((a, b) => stats.totals[b] - stats.totals[a]);
  const metrics = [
    "Data Authenticity", "Response Relevance", "Tool Use Accuracy", "Hallucination Control",
    "Code Execution", "Domain Knowledge", "Result Interpretation", "Autonomous Planning",
    "Error Recovery", "Output Standardization"
  ];

  let html = '<h3 style="margin-bottom:12px;">📊 Scoring Matrix</h3>';
  html += '<table class="summary-table"><thead><tr><th>Metric</th>';
  sortedModels.forEach(m => { html += `<th>${m}</th>`; });
  html += '</tr></thead><tbody>';

  metrics.forEach(metric => {
    html += `<tr><td style="text-align:left;font-weight:500;">${metric}</td>`;
    sortedModels.forEach(m => {
      const val = stats.metrics[m][metric] || 0;
      html += `<td>${val}</td>`;
    });
    html += '</tr>';
  });

  // 总分行
  html += '<tr style="border-top:2px solid var(--border);">';
  html += '<td style="text-align:left;font-weight:700;">Total (0-100)</td>';
  sortedModels.forEach(m => {
    html += `<td class="highlight">${stats.totals[m]}</td>`;
  });
  html += '</tr></tbody></table>';

  // 胜出统计
  html += '<h4 style="margin:18px 0 8px;">🏆 Win Statistics</h4><ul>';
  sortedModels.forEach(m => {
    html += `<li><strong>${m}</strong>: ${stats.wins[m]} tasks</li>`;
  });
  html += `<li>Ties: ${stats.ties} tasks</li></ul>`;

  dom.summaryContent.innerHTML = html;
}

// ── 结果渲染：图表 ──────────────────────────────────────
function renderCharts(charts) {
  if (!charts || Object.keys(charts).length === 0) {
    dom.chartsContent.innerHTML = '<p>暂无图表</p>';
    return;
  }

  const titles = {
    bar_chart: 'Model Performance Bar Chart',
    heatmap: 'Dimension Heatmap',
    radar: 'Model Radar Chart'
  };

  let html = '';
  for (const [key, url] of Object.entries(charts)) {
    html += `
      <div class="chart-card">
        <h4>${titles[key] || key}</h4>
        <iframe src="${url}" width="100%" height="520px"
                style="border:none;border-radius:4px;"
                title="${titles[key] || key}"></iframe>
      </div>`;
  }
  dom.chartsContent.innerHTML = html;
}

// ── 逐题详情 ────────────────────────────────────────────
function renderDetailSelector(total) {
  let html = '';
  for (let i = 0; i < total; i++) {
    html += `<button onclick="loadDetail(${i})" data-idx="${i}">#${i + 1}</button>`;
  }
  dom.detailSelector.innerHTML = html;
  dom.detailContent.innerHTML = '<p style="color:var(--text-secondary);">👆 Click a task number above to view per-task evaluation details</p>';
}

async function loadDetail(idx) {
  // 高亮当前按钮
  $$('#detailSelector button').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`#detailSelector button[data-idx="${idx}"]`);
  if (btn) btn.classList.add('active');

  dom.detailContent.textContent = 'Loading...';

  try {
    const resp = await fetch(`/api/eval_detail/${state.taskId}/${idx}`);
    const data = await resp.json();
    if (data.content) {
      dom.detailContent.textContent = data.content;
    } else {
      dom.detailContent.textContent = 'Load failed';
    }
  } catch (e) {
    dom.detailContent.textContent = 'Network error: ' + e.message;
  }
}

// ── 示例数据下载 ────────────────────────────────────────
async function downloadExamples() {
  setStatus('exampleStatus', 'Downloading...', '');
  
  try {
    window.open('/api/examples/download_all', '_blank');
    setStatus('exampleStatus', '✅ Downloaded! Unzip and drag the files to upload', 'ok');
  } catch (e) {
    setStatus('exampleStatus', '❌ Download failed', 'err');
  }
}

// ── 结果下载 ────────────────────────────────────────────
function downloadResults() {
  if (!state.taskId) return;
  window.open(`/api/download/${state.taskId}`, '_blank');
}

// ── 标签页切换 ──────────────────────────────────────────
function setupTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.tab;
      $$('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      dom.tabContents.forEach(tc => tc.classList.remove('active'));
      $(`#${targetId}`).classList.add('active');
      state.currentTab = targetId;
    });
  });
}

// ── 工具函数 ────────────────────────────────────────────
function setStatus(elementId, message, className) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.className = 'status-text ' + (className || '');
}
