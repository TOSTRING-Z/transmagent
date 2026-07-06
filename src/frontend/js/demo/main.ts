// @ts-nocheck
// 演示引擎核心 - DemoPlayer + 控制台事件 + 消息渲染
// ⚠️ T-10 commit: 已彻底移除所有内置固定 demo 兜底 (BUILT_IN_SCRIPT / TF_NETWORK_SCRIPT)
// 演示数据现在 100% 来自后端 SessionManager.getChat().messages,
// 无数据时显示空状态 UI 而非降级播放任何固定案例。
import { EMPTY_SCRIPT, DemoScript, DemoMessage } from './data';
import { renderMarkdown } from './markdown';

// ============ 类型 ============
type LoopMode = 'none' | 'loop' | 'pingpong';
type Speed = 0.5 | 1 | 1.5 | 2;

// ============ DemoPlayer 引擎 ============
class DemoPlayer {
  private script: DemoScript;
  private index: number = 0;
  private maxIndex: number = -1;
  private isPlaying: boolean = false;
  private timer: any = null;
  private pingpongDir: 1 | -1 = 1;
  private pingpongDone: boolean = false;

  public interval: number = 2000;
  public speed: Speed = 1;
  public loopMode: LoopMode = 'none';

  public onStateChange: () => void = () => {};
  public onRender: (msg: DemoMessage, index: number) => Promise<void> = async () => {};
  public onProgress: (current: number, total: number) => void = () => {};

  constructor(script: DemoScript) {
    this.script = script;
  }

  get total(): number { return this.script.messages.length; }
  get currentIndex(): number { return this.index; }
  get playing(): boolean { return this.isPlaying; }
  get currentScript(): DemoScript { return this.script; }

  setScript(script: DemoScript) {
    this.pause();
    this.script = script;
    this.index = 0;
    this.maxIndex = -1;
    this.pingpongDir = 1;
    this.pingpongDone = false;
    this.onProgress(0, script.messages.length);
    this.onStateChange();
  }

  setInterval(ms: number) {
    this.interval = Math.max(200, Math.min(10000, Math.round(ms)));
    this.onStateChange();
  }

  setSpeed(s: Speed) {
    this.speed = s;
    this.onStateChange();
  }

  setLoopMode(mode: LoopMode) {
    this.loopMode = mode;
    this.pingpongDir = 1;
    this.onStateChange();
  }

  get effectiveDelay(): number {
    return Math.max(100, this.interval / this.speed);
  }

  async play() {
    if (this.isPlaying) return;
    if (this.total === 0) {
      console.warn('[demo] no messages to play');
      return;
    }
    if (this.index >= this.total) {
      this.index = 0;
    }
    this.isPlaying = true;
    this.pingpongDone = false;
    this.onStateChange();
    await this.renderCurrent();
    this.scheduleNext();
  }

  pause() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isPlaying = false;
    this.onStateChange();
  }

  stop() {
    this.pause();
    this.index = 0;
    this.maxIndex = -1;
    this.pingpongDir = 1;
    this.pingpongDone = false;
    this.onProgress(0, this.total);
    const messages = document.getElementById('messages');
    if (messages) messages.innerHTML = '';
    this.onStateChange();
  }

  async next() {
    this.pause();
    if (this.index < this.total) {
      this.index++;
      if (this.index > this.maxIndex) {
        await this.renderCurrent();
      } else {
        this.onProgress(this.index + 1, this.total);
      }
    }
    this.onStateChange();
  }

  async prev() {
    this.pause();
    if (this.index > 0) {
      this.index--;
      this.onProgress(this.index + 1, this.total);
    }
    this.onStateChange();
  }

  async jumpTo(target: number) {
    this.pause();
    if (this.total === 0) return;
    target = Math.max(0, Math.min(this.total - 1, target));
    const messages = document.getElementById('messages');
    if (!messages) return;

    if (target > this.maxIndex) {
      for (let i = this.maxIndex + 1; i <= target; i++) {
        const msg = this.script.messages[i];
        await this.appendMessage(msg, i);
      }
    } else if (target < this.index) {
      const toRemove = this.index - target;
      for (let i = 0; i < toRemove; i++) {
        if (messages.lastElementChild) messages.removeChild(messages.lastElementChild);
      }
      this.maxIndex = target;
    }
    this.index = target;
    this.onProgress(this.index + 1, this.total);
    this.onStateChange();
    scrollToBottom();
  }

  private scheduleNext() {
    if (!this.isPlaying) return;
    const delay = this.effectiveDelay;
    const msg = this.script.messages[this.index];
    const customDelay = msg?.delay;
    const finalDelay = customDelay ?? delay;

    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.isPlaying) return;
      this.index++;
      if (this.index >= this.total) {
        if (this.loopMode === 'loop') {
          const messages = document.getElementById('messages');
          if (messages) messages.innerHTML = '';
          this.index = 0;
          this.maxIndex = -1;
          await this.renderCurrent();
          this.scheduleNext();
          return;
        } else if (this.loopMode === 'pingpong') {
          if (this.pingpongDone) {
            this.isPlaying = false;
            this.onStateChange();
            return;
          }
          this.pingpongDir = -1;
          this.index = this.total - 2;
          const messages = document.getElementById('messages');
          if (messages) messages.innerHTML = '';
          this.maxIndex = -1;
          for (let i = 0; i <= this.index + 1; i++) {
            await this.appendMessage(this.script.messages[i], i);
          }
          this.scheduleNextReverse();
          return;
        } else {
          this.isPlaying = false;
          this.onStateChange();
          return;
        }
      }
      await this.renderCurrent();
      this.scheduleNext();
    }, finalDelay);
  }

  private scheduleNextReverse() {
    if (!this.isPlaying) return;
    const delay = this.effectiveDelay;
    this.timer = setTimeout(async () => {
      this.timer = null;
      if (!this.isPlaying) return;
      this.index--;
      if (this.index < 0) {
        this.pingpongDone = true;
        this.isPlaying = false;
        this.onStateChange();
        return;
      }
      const messages = document.getElementById('messages');
      if (messages && messages.lastElementChild) {
        messages.removeChild(messages.lastElementChild);
      }
      this.maxIndex = this.index;
      this.onProgress(this.index + 1, this.total);
      this.scheduleNextReverse();
    }, delay);
  }

  private async renderCurrent() {
    if (this.index < 0 || this.index >= this.total) return;
    const msg = this.script.messages[this.index];
    await this.appendMessage(msg, this.index);
  }

  private async appendMessage(msg: DemoMessage, idx: number) {
    await this.onRender(msg, idx);
    this.maxIndex = Math.max(this.maxIndex, idx);
    this.onProgress(this.index + 1, this.total);
    scrollToBottom();
  }
}

// ============ 模板 ============
const user_message_template = `<div class="demo-msg" data-role="user" data-idx="">
  <div class="bubble"></div>
</div>`;

const system_message_template = `<div class="demo-msg" data-role="system" data-idx="">
  <div class="info hidden">
    <div class="info-header">Call information</div>
    <div class="info-content" data-content=""></div>
  </div>
  <div class="message" data-content=""></div>
  <div class="thinking">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>`;

// ============ 空状态渲染 ============
function renderEmptyState(reason: 'no-history' | 'timeout' | 'error') {
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) return;
  const titleEl = document.getElementById('script-title');
  const scenarioEl = document.getElementById('script-scenario');

  const cfg: Record<typeof reason, { title: string; scenario: string; hint: string }> = {
    'no-history': {
      title: '当前无会话历史',
      scenario: '请先在主窗口发起对话,演示窗口将自动加载您的真实聊天记录',
      hint: '💡 在主窗口输入消息后,再次点击演示按钮即可加载会话历史',
    },
    'timeout': {
      title: '未接收到会话数据',
      scenario: '5 秒内主窗口未推送有效 payload (可能主窗口聊天历史为空)',
      hint: '💡 请确认主窗口存在聊天记录,然后重新打开演示窗口',
    },
    'error': {
      title: '数据加载失败',
      scenario: '解析后端 payload 时出错,已停止播放',
      hint: '💡 请查看主进程日志或重新打开演示窗口',
    },
  };
  const c = cfg[reason];

  if (titleEl) titleEl.textContent = c.title;
  if (scenarioEl) scenarioEl.textContent = c.scenario;

  messagesEl.innerHTML = `
    <div class="demo-empty-state">
      <div class="demo-empty-icon">
        <i class="fas fa-comments"></i>
      </div>
      <div class="demo-empty-title">${c.title}</div>
      <div class="demo-empty-scenario">${c.scenario}</div>
      <div class="demo-empty-hint">${c.hint}</div>
    </div>
  `;
}

// ============ 滚动 ============
function scrollToBottom() {
  const topDiv = document.getElementById('top_div');
  if (topDiv) {
    requestAnimationFrame(() => {
      topDiv.scrollTo({ top: topDiv.scrollHeight, behavior: 'smooth' });
    });
  }
}

// ============ 消息渲染 ============
async function renderMessage(msg: DemoMessage, idx: number) {
  const messagesEl = document.getElementById('messages');
  if (!messagesEl) return;

  if (msg.role === 'user') {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = user_message_template;
    const node = wrapper.firstElementChild as HTMLElement;
    node.dataset.idx = String(idx);
    const bubble = node.getElementsByClassName('bubble')[0] as HTMLElement;
    bubble.textContent = msg.content;
    bubble.dataset.content = msg.content;
    messagesEl.appendChild(node);
    return;
  }

  // system / tool
  const wrapper = document.createElement('div');
  wrapper.innerHTML = system_message_template;
  const node = wrapper.firstElementChild as HTMLElement;
  node.dataset.idx = String(idx);
  node.dataset.role = msg.role;

  const messageDiv = node.getElementsByClassName('message')[0] as HTMLElement;
  const thinking = node.getElementsByClassName('thinking')[0] as HTMLElement;

  if (thinking) thinking.classList.remove('hidden');
  messagesEl.appendChild(node);

  // 模拟思考延时
  const thinkMs = Math.min(600, 200 + msg.content.length / 20);
  await new Promise(r => setTimeout(r, thinkMs));

  // 渲染 Markdown
  try {
    const html = await renderMarkdown(msg.content);
    messageDiv.innerHTML = html;
    messageDiv.dataset.content = msg.content;
  } catch (e) {
    messageDiv.innerText = msg.content;
  }

  if (msg.role === 'tool' && msg.info) {
    const infoDiv = node.getElementsByClassName('info')[0] as HTMLElement;
    const infoContent = node.getElementsByClassName('info-content')[0] as HTMLElement;
    if (infoDiv && infoContent) {
      infoDiv.classList.remove('hidden');
      try {
        const infoHtml = await renderMarkdown(msg.info);
        infoContent.innerHTML = infoHtml;
      } catch (e) {
        infoContent.innerText = msg.info;
      }
    }
  }

  if (thinking) thinking.classList.add('hidden');
}

// ============ 控制台 UI 绑定 ============
function setupConsole(player: DemoPlayer) {
  const progressBar = document.getElementById('progress-bar-inner') as HTMLDivElement;
  const progressTrack = document.getElementById('progress-track') as HTMLDivElement;

  // 首次播放前清空占位节点
  const empty = document.querySelector('.demo-empty');
  if (empty && empty.parentElement === document.getElementById('messages')) {
    empty.remove();
  }

  player.onProgress = (current, total) => {
    const pct = total > 0 ? (current / total) * 100 : 0;
    if (progressBar) progressBar.style.width = pct + '%';
    const counter = document.getElementById('progress-counter');
    if (counter) counter.textContent = `${current} / ${total}`;
    const statCurrent = document.getElementById('stat-current');
    if (statCurrent) statCurrent.textContent = String(current);
    const statTotal = document.getElementById('stat-total');
    if (statTotal) statTotal.textContent = String(total);
  };

  let isDragging = false;
  function seekFromEvent(e: MouseEvent) {
    if (!progressTrack) return;
    const rect = progressTrack.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const ratio = x / rect.width;
    const target = Math.floor(ratio * player.total);
    player.jumpTo(target);
  }
  progressTrack?.addEventListener('mousedown', (e) => {
    isDragging = true;
    seekFromEvent(e);
  });
  document.addEventListener('mousemove', (e) => {
    if (isDragging) seekFromEvent(e);
  });
  document.addEventListener('mouseup', () => { isDragging = false; });

  const btnPlay = document.getElementById('btn-play');
  const iconPlay = document.getElementById('icon-play');
  btnPlay?.addEventListener('click', () => {
    if (player.total === 0) {
      console.warn('[demo] no messages, cannot play');
      return;
    }
    if (player.playing) player.pause();
    else player.play();
  });

  document.getElementById('btn-stop')?.addEventListener('click', () => player.stop());
  document.getElementById('btn-prev')?.addEventListener('click', () => player.prev());
  document.getElementById('btn-next')?.addEventListener('click', () => player.next());

  const intervalSlider = document.getElementById('interval-slider') as HTMLInputElement;
  const intervalValue = document.getElementById('interval-value');
  intervalSlider?.addEventListener('input', () => {
    const v = parseInt(intervalSlider.value, 10);
    player.setInterval(v);
    if (intervalValue) intervalValue.textContent = (v / 1000).toFixed(1) + 's';
  });

  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = parseFloat((btn as HTMLElement).dataset.speed || '1') as Speed;
      player.setSpeed(s);
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.loop-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = (btn as HTMLElement).dataset.loop as LoopMode;
      player.setLoopMode(mode);
      document.querySelectorAll('.loop-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const lbl = document.getElementById('loop-label');
      if (lbl) {
        lbl.textContent = mode === 'loop' ? '列表循环' : mode === 'pingpong' ? '乒乓循环' : '不循环';
      }
    });
  });

  player.onStateChange = () => {
    if (iconPlay) iconPlay.className = player.playing ? 'fas fa-pause' : 'fas fa-play';
    const title = document.getElementById('btn-play');
    if (title) title.setAttribute('title', player.playing ? '暂停 (Space)' : '播放 (Space)');
  };

  // ⚠️ T-10 commit: 已彻底移除 .script-btn 切换逻辑
  // (不再切换 BUILT_IN_SCRIPT / TF_NETWORK_SCRIPT,实时会话模式下脚本不可切换)
  document.querySelectorAll('.script-btn').forEach((btn) => {
    (btn as HTMLElement).style.opacity = '0.4';
    (btn as HTMLElement).style.cursor = 'not-allowed';
    (btn as HTMLElement).title = '实时会话模式:脚本不可切换';
    btn.classList.remove('active');
  });
}

// ============ 键盘快捷键 ============
function setupKeyboard(player: DemoPlayer) {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (player.total === 0) return;
      if (player.playing) player.pause();
      else player.play();
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      player.prev();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      player.next();
    } else if (e.code === 'Home') {
      e.preventDefault();
      player.jumpTo(0);
    } else if (e.code === 'End') {
      e.preventDefault();
      player.jumpTo(player.total - 1);
    }
  });
}

// ============ 将后端 payload 转换为 DemoScript ============
function buildLiveScript(payload: any): DemoScript {
  const msgs = Array.isArray(payload?.messages) ? payload.messages : [];
  return {
    title: typeof payload?.title === 'string' ? payload.title : '当前会话回放',
    scenario: typeof payload?.scenario === 'string' ? payload.scenario : `${msgs.length} 条消息 · 默认间隔 2s`,
    totalDurationHint: '',
    messages: msgs.map((m: any) => ({
      role: (m.role === 'user' || m.role === 'tool') ? m.role : 'system',
      content: typeof m.content === 'string' ? m.content : '',
      info: typeof m.info === 'string' ? m.info : undefined,
    })),
  };
}

// ============ 应用 live payload ============
function applyLivePayload(player: DemoPlayer, payload: any, titleEl: HTMLElement | null, scenarioEl: HTMLElement | null): boolean {
  try {
    if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) {
      console.warn('[demo] live payload empty/invalid');
      return false;
    }
    const live = buildLiveScript(payload);
    player.setScript(live);
    if (titleEl) titleEl.textContent = live.title;
    if (scenarioEl) scenarioEl.textContent = live.scenario;
    console.log('[demo] live history applied:', live.messages.length, 'messages');
    return true;
  } catch (err) {
    console.error('[demo] failed to apply live payload:', err);
    return false;
  }
}

// ============ 启动 ============
function bootstrap() {
  // ⚠️ T-10 commit: 不再降级到任何内置固定脚本
  // 无 payload 时显示空状态 UI,等待主进程 IPC 推送或 window.__DEMO_PAYLOAD__ 注入
  const initialScript = EMPTY_SCRIPT;

  const player = new DemoPlayer(initialScript);
  player.onRender = renderMessage;
  setupConsole(player);
  setupKeyboard(player);

  // 同步顶部标题 / 场景描述
  const titleEl = document.getElementById('script-title');
  if (titleEl) titleEl.textContent = initialScript.title;
  const scenarioEl = document.getElementById('script-scenario');
  if (scenarioEl) scenarioEl.textContent = initialScript.scenario;

  // 初始进度 (空)
  player.onProgress(0, player.total);

  // 暴露到 window 用于调试
  (window as any).demoPlayer = player;

  let applied = false;

  // 路径 A: 启动时直接读取已注入的 window.__DEMO_PAYLOAD__
  const bootPayload = (window as any).__DEMO_PAYLOAD__;
  if (bootPayload && Array.isArray(bootPayload.messages) && bootPayload.messages.length > 0) {
    applied = applyLivePayload(player, bootPayload, titleEl, scenarioEl);
  } else {
    // 显示空状态
    renderEmptyState('no-history');
  }

  // 路径 B: 监听主窗口 IPC 推送 (DemoWindow preload 的 demoAPI.onDemoData)
  if ((window as any).demoAPI && typeof (window as any).demoAPI.onDemoData === 'function') {
    (window as any).demoAPI.onDemoData((payload: any) => {
      const ok = applyLivePayload(player, payload, titleEl, scenarioEl);
      if (ok) applied = true;
    });
    // 通知主进程 demo 端已就绪,可推送数据
    if (typeof (window as any).demoAPI.notifyReady === 'function') {
      (window as any).demoAPI.notifyReady();
    }
  }

  // 路径 C: 【双保险】轮询 window.__DEMO_PAYLOAD__,防止 IPC race condition
  // 超时后显示空状态(不再降级到任何固定 demo)
  if (!applied) {
    let polls = 0;
    const poll = window.setInterval(() => {
      polls++;
      const p = (window as any).__DEMO_PAYLOAD__;
      if (p && Array.isArray(p.messages) && p.messages.length > 0) {
        window.clearInterval(poll);
        console.log('[demo] __DEMO_PAYLOAD__ arrived after', polls * 200, 'ms');
        applyLivePayload(player, p, titleEl, scenarioEl);
      } else if (polls >= 25) {
        window.clearInterval(poll);
        console.warn('[demo] __DEMO_PAYLOAD__ timeout after 5s, showing empty state');
        if (!applied) renderEmptyState('timeout');
      }
    }, 200);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
