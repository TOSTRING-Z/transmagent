<template>
  <n-alert
    v-if="visible"
    :title="title"
    :type="alertType"
    closable
    @close="close"
    class="custom-alert"
  >
    <template #icon>
      <n-icon>
        <i :class="iconClass"></i>
      </n-icon>
    </template>
    {{ currentContent }}
  </n-alert>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { NAlert, NIcon } from 'naive-ui';

const visible = ref(true);
const currentType = ref('log');
const currentContent = ref('默认内容');

const title = computed(() => currentType.value.toUpperCase());

const alertType = computed(() => {
  const map: Record<string, 'info' | 'error' | 'warning' | 'success'> = {
    log: 'info',
    error: 'error',
    warning: 'warning',
    success: 'success'
  };
  return map[currentType.value] || 'info';
});

const iconClass = computed(() => {
  switch (currentType.value) {
    case 'log': return 'fas fa-info-circle';
    case 'error': return 'fas fa-exclamation-triangle';
    case 'warning': return 'fas fa-exclamation-circle';
    case 'success': return 'fas fa-check-circle';
    default: return 'fas fa-info-circle';
  }
});

let ipcRenderer: any = null;
try {
  const electron = window.require ? window.require('electron') : null;
  if (electron) ipcRenderer = electron.ipcRenderer;
} catch (e) {}

const handleShowLog = (event: any, { type, content }: any) => {
  currentType.value = type;
  currentContent.value = content;
  visible.value = true;
};

onMounted(() => {
  if (ipcRenderer) ipcRenderer.on('show-log', handleShowLog);
});

onUnmounted(() => {
  if (ipcRenderer) ipcRenderer.removeListener('show-log', handleShowLog);
});

const close = () => {
  if (ipcRenderer) ipcRenderer.send('close-clicked');
  else visible.value = false;
};
</script>

<style scoped>
.custom-alert {
  margin: 10px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
</style>