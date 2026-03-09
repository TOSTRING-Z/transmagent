<template>
  <div class="terminal-wrapper">
    <n-card :bordered="false" content-style="padding: 0;" class="terminal-card">
      <template #header>
        <n-space align="center">
          <i class="fas fa-terminal"></i>
          <span>System Terminal</span>
        </n-space>
      </template>
      <div class="terminal-content">
        <n-log :lines="logs" :font-size="12" trim class="custom-log" />
      </div>
      <template #action>
        <n-input-group>
          <n-input placeholder="Execute command..." v-model:value="command" @keyup.enter="runCommand">
            <template #prefix><span>$</span></template>
          </n-input>
          <n-button type="primary" @click="runCommand">Run</n-button>
        </n-input-group>
      </template>
    </n-card>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { NCard, NLog, NInput, NInputGroup, NButton, NSpace } from 'naive-ui';

const logs = ref(['[System] Terminal initialized...', '[User] help']);
const command = ref('');

const runCommand = () => {
  if (!command.value) return;
  logs.value.push(`$ ${command.value}`);
  command.value = '';
};
</script>

<style scoped>
.terminal-wrapper { height: 100%; background: #000; }
.terminal-card { height: 100%; background: #1a1a1a; color: #fff; }
.terminal-content { padding: 12px; height: 300px; overflow-y: auto; }
.custom-log { color: #00ff00; }
</style>