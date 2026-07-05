// @ts-nocheck
// 演示引擎核心 - DemoPlayer + 控制台事件 + 消息渲染
import { BUILT_IN_SCRIPT, TF_NETWORK_SCRIPT, DemoScript, DemoMessage } from './data';
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
const user_message_template = `<div class="relative space-y-2 space-x-2 demo-msg" data-role="user" data-idx="">
  <div class="flex flex-row-reverse w-full">
    <div class="menu-container">
      <img class="menu user" src="../img/user.svg" alt="User Avatar">
    </div>
    <div class="message"></div>
  </div>
</div>`;

const system_message_template = `<div class="relative space-y-2 space-x-2 demo-msg" data-role="system" data-idx="">
  <div class="menu-container">
    <img class="menu system" src="" alt="System Avatar">
  </div>
  <div class="info hidden">
    <div class="info-header">Call information</div>
    <div class="info-content overflow-y-auto" data-content=""></div>
  </div>
  <div class="message" data-content=""></div>
  <div class="thinking">
    <div class="dot"></div>
    <div class="dot"></div>
    <div class="dot"></div>
  </div>
</div>`;

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
    const messageDiv = node.getElementsByClassName('message')[0] as HTMLElement;
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.innerText = msg.content;
    messageDiv.appendChild(textDiv);
    messageDiv.dataset.content = msg.content;
    messagesEl.appendChild(node);
    return;
  }

  // system / tool
  const wrapper = document.createElement('div');
  wrapper.innerHTML = system_message_template;
  const node = wrapper.firstElementChild as HTMLElement;
  node.dataset.idx = String(idx);
  node.dataset.role = msg.role;

  const menu = node.getElementsByClassName('menu')[0] as HTMLImageElement;
  menu.src = `../img/${msg.icon || (msg.role === 'tool' ? 'tool' : 'agent')}.svg`;

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

  document.querySelectorAll('.script-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = (btn as HTMLElement).dataset.script;
      const script = key === 'tf' ? TF_NETWORK_SCRIPT : BUILT_IN_SCRIPT;
      player.setScript(script);
      const titleEl = document.getElementById('script-title');
      if (titleEl) titleEl.textContent = script.title;
      const scenarioEl = document.getElementById('script-scenario');
      if (scenarioEl) scenarioEl.textContent = script.scenario;
      document.querySelectorAll('.script-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      player.onProgress(0, script.messages.length);
    });
  });
}

// ============ 键盘快捷键 ============
function setupKeyboard(player: DemoPlayer) {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
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

// ============ 启动 ============
function bootstrap() {
  const player = new DemoPlayer(BUILT_IN_SCRIPT);
  player.onRender = renderMessage;
  setupConsole(player);
  setupKeyboard(player);

  // 初始进度
  player.onProgress(0, player.total);

  // 暴露到 window 用于调试
  (window as any).demoPlayer = player;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}