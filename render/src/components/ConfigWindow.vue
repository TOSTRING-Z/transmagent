<template>
  <n-layout class="config-layout">
    <n-layout-header bordered class="title-bar">
      <div class="title">
        <n-icon><i class="fas fa-gear"></i></n-icon>
        <span style="margin-left: 8px">Settings</span>
      </div>
      <n-space class="window-controls" :size="8">
        <n-button quaternary circle size="small" @click="minimize">
           <template #icon><div class="dot minimize"></div></template>
        </n-button>
        <n-button quaternary circle size="small" @click="close">
           <template #icon><div class="dot close"></div></template>
        </n-button>
      </n-space>
    </n-layout-header>

    <n-layout-content content-style="padding: 24px;">
      <n-card title="System Configuration" size="medium" class="editor-card">
        <div id="json-editor" class="config-editor"></div>
        <template #footer>
          <n-space justify="end">
            <n-button type="primary" @click="saveConfig">Save Changes</n-button>
          </n-space>
        </template>
      </n-card>
    </n-layout-content>
  </n-layout>
</template>

<script setup lang="ts">
// @ts-nocheck
import { onMounted } from 'vue';
import { NLayout, NLayoutHeader, NLayoutContent, NCard, NButton, NSpace, NIcon } from 'naive-ui';

let editor: any = null;
let ipcRenderer: any = null;

try {
  const electron = window.require ? window.require('electron') : null;
  if (electron) ipcRenderer = electron.ipcRenderer;
} catch (e) {}

function showLog(log: string) {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '9999';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.1)';

  const box = document.createElement('div');
  box.style.padding = '12px 24px';
  box.style.background = 'rgba(255, 255, 255, 0.95)';
  box.style.border = '2px solid #666';
  box.style.borderRadius = '6px';
  box.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
  box.style.fontSize = '1.2rem';
  box.style.color = '#333';
  box.style.textAlign = 'center';
  box.style.maxWidth = '80%';
  box.style.wordWrap = 'break-word';
  box.innerText = log;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  setTimeout(() => {
      overlay.remove();
  }, 2000);
}

onMounted(async () => {
  const container = document.getElementById('json-editor');
  if (container) {
    // @ts-ignore
    editor = new JSONEditor(container, {
      mode: 'tree',
      modes: ['tree', 'code']
    });
  }

  if (ipcRenderer) {
    const config = await ipcRenderer.invoke('get-config');
    if (editor) editor.set(config);
  }
});

const minimize = () => ipcRenderer?.send('minimize-window');
const close = () => ipcRenderer?.send('close-window');

const saveConfig = async () => {
  if (!editor || !ipcRenderer) return;
  const config = editor.get();
  const success = await ipcRenderer.invoke('set-config', config);
  if (success) {
    showLog('Configuration saved successfully!');
  }
};
</script>

<style scoped>
.config-layout { height: 100vh; }
.title-bar {
  -webkit-app-region: drag;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 16px;
  height: 48px;
  background-color: #f9f9f9;
}
.window-controls { -webkit-app-region: no-drag; }
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.dot.close { background: #ff5e57; }
.dot.minimize { background: #ffbb2e; }
.config-editor { height: 400px; border: 1px solid #efeff5; border-radius: 4px; }
.editor-card { max-width: 800px; margin: 0 auto; }
</style>