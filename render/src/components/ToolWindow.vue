<template>
  <n-card title="Tool Box" size="small" closable @close="$emit('close')">
    <template #header-extra>
      <n-badge :value="tools.length" color="#2080f0" />
    </template>
    <n-grid :cols="2" :x-gap="12" :y-gap="12">
      <n-gi v-for="tool in tools" :key="tool.name">
        <n-button block secondary strong @click="invokeTool(tool.name)">
          <template #icon><i :class="tool.icon"></i></template>
          {{ tool.label }}
        </n-button>
      </n-gi>
    </n-grid>
  </n-card>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { NCard, NGrid, NGi, NButton, NBadge } from 'naive-ui';

const tools = ref([
  { name: 'browser', label: 'Browser', icon: 'fas fa-globe' },
  { name: 'terminal', label: 'Terminal', icon: 'fas fa-terminal' },
  { name: 'python', label: 'Python', icon: 'fab fa-python' },
  { name: 'file', label: 'Explorer', icon: 'fas fa-folder-open' }
]);

const invokeTool = (name) => { console.log('Invoking:', name); };
</script>