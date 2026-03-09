<template>
  <n-tooltip trigger="hover" placement="left">
    <template #trigger>
      <div class="icon-overlay">
        <n-button circle type="primary" size="large" class="floating-btn">
          <template #icon><i class="fas fa-bolt-lightning"></i></template>
        </n-button>
      </div>
    </template>
    Quick Actions
  </n-tooltip>
</template>

<script setup lang="ts">
// @ts-nocheck
import { NButton, NTooltip } from 'naive-ui';
</script>

<style scoped>
.icon-overlay {
  position: fixed;
  bottom: 30px;
  right: 30px;
  z-index: 1000;
}
.floating-btn {
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transition: transform 0.2s;
}
.floating-btn:hover {
  transform: scale(1.1);
}
</style>