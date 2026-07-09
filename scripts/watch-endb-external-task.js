const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const watchRoot = '/home/tostring/桌面/document/endb';
const tasksDir = path.join(os.homedir(), '.transmagent', 'tasks');
const pollMs = 2000;
const quietWindowMs = 1500;
const minTaskGapMs = 10000;
const argSessionId = process.argv[2] && process.argv[2].trim();
const envSessionId = process.env.TRANSMAGENT_SESSION_ID && process.env.TRANSMAGENT_SESSION_ID.trim();
const sessionId = argSessionId || envSessionId || '';

let previousSnapshot = new Map();
let pendingChanges = [];
let debounceTimer = null;
let lastTaskAt = 0;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function walk(dirPath, snapshot) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const stat = fs.statSync(fullPath);
    snapshot.set(fullPath, {
      isDirectory: stat.isDirectory(),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    });
    if (stat.isDirectory()) {
      walk(fullPath, snapshot);
    }
  }
}

function buildSnapshot(rootPath) {
  const snapshot = new Map();
  const stat = fs.statSync(rootPath);
  snapshot.set(rootPath, {
    isDirectory: stat.isDirectory(),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  });
  walk(rootPath, snapshot);
  return snapshot;
}

function diffSnapshots(prev, next) {
  const changes = [];

  for (const [filePath, nextMeta] of next.entries()) {
    const prevMeta = prev.get(filePath);
    if (!prevMeta) {
      changes.push({ type: 'created', filePath, meta: nextMeta });
      continue;
    }
    if (
      prevMeta.mtimeMs !== nextMeta.mtimeMs ||
      prevMeta.size !== nextMeta.size ||
      prevMeta.isDirectory !== nextMeta.isDirectory
    ) {
      changes.push({ type: 'modified', filePath, meta: nextMeta });
    }
  }

  for (const [filePath, prevMeta] of prev.entries()) {
    if (!next.has(filePath)) {
      changes.push({ type: 'deleted', filePath, meta: prevMeta });
    }
  }

  return changes.sort((a, b) => a.filePath.localeCompare(b.filePath, 'zh-CN'));
}

function mergeChanges(changes) {
  const merged = new Map();
  for (const change of changes) {
    merged.set(change.filePath, change);
  }
  return Array.from(merged.values()).sort((a, b) => a.filePath.localeCompare(b.filePath, 'zh-CN'));
}

function buildTaskMarkdown(changes) {
  const now = new Date();
  const title = `endb 目录发生变动，请整理内容（${now.toLocaleString('zh-CN', { hour12: false })}）`;
  const lines = changes.slice(0, 50).map((change, index) => {
    const kind = change.meta && change.meta.isDirectory ? '目录' : '文件';
    return `${index + 1}. [${change.type}] ${kind}: ${change.filePath}`;
  });

  return [
    `# ${title}`,
    '',
    '请检查 endb 目录的以下变化，并自动完成整理：',
    '- 归类新增或修改的内容',
    '- 如有临时/重复文件，给出清理建议或直接整理到合适位置',
    '- 总结本次变更影响',
    '',
    `监视目录: ${watchRoot}`,
    `变化数量: ${changes.length}`,
    '',
    '## 变动明细',
    ...lines,
  ].join('\n');
}

function emitTask(changes) {
  if (changes.length === 0) {
    return;
  }

  if (!sessionId) {
    console.warn('[watcher] 缺少 session_id，跳过任务投递');
    return;
  }

  const now = Date.now();
  if (now - lastTaskAt < minTaskGapMs) {
    console.log(`[watcher] 跳过过于频繁的任务投递，累计变化 ${changes.length} 项`);
    return;
  }

  ensureDir(tasksDir);
  const taskId = `endb-watch-${now}-${crypto.randomBytes(4).toString('hex')}`;
  const targetFile = path.join(tasksDir, `${sessionId}__${taskId}.md`);
  const content = buildTaskMarkdown(changes);
  fs.writeFileSync(targetFile, content, 'utf-8');
  lastTaskAt = now;
  console.log(`[watcher] 已投递任务 ${targetFile}`);
}

function scheduleEmit(changes) {
  pendingChanges.push(...changes);
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    const merged = mergeChanges(pendingChanges);
    pendingChanges = [];
    emitTask(merged);
  }, quietWindowMs);
}

function pollOnce() {
  try {
    const nextSnapshot = buildSnapshot(watchRoot);
    if (previousSnapshot.size === 0) {
      previousSnapshot = nextSnapshot;
      console.log(`[watcher] 初始快照完成，监视目录: ${watchRoot}`);
      return;
    }

    const changes = diffSnapshots(previousSnapshot, nextSnapshot);
    previousSnapshot = nextSnapshot;
    if (changes.length > 0) {
      console.log(`[watcher] 检测到 ${changes.length} 项变动`);
      scheduleEmit(changes);
    }
  } catch (error) {
    console.error('[watcher] 轮询失败:', error);
  }
}

function main() {
  if (!fs.existsSync(watchRoot) || !fs.statSync(watchRoot).isDirectory()) {
    throw new Error(`监视目录不存在或不是目录: ${watchRoot}`);
  }

  ensureDir(tasksDir);
  pollOnce();
  setInterval(pollOnce, pollMs);
  if (sessionId) {
    console.log(`[watcher] 当前会话: ${sessionId}`);
  } else {
    console.warn('[watcher] 未提供 session_id，检测到变动时不会投递任务');
  }
  console.log('[watcher] 运行中，按 Ctrl+C 退出');
}

main();
