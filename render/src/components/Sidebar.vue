<template>
  <n-layout-sider
    bordered
    collapse-mode="width"
    :collapsed-width="64"
    :width="250"
    :collapsed="isCollapsed"
    show-trigger="arrow-circle"
    @collapse="isCollapsed = true"
    @expand="isCollapsed = false"
    class="sidebar-container"
  >
    <div class="sidebar-header">
      <n-button v-if="!isCollapsed" dashed block @click="toggle" type="primary">
        <template #icon><i class="fas fa-plus"></i></template>
        New Chat
      </n-button>
      <n-button v-else circle dashed @click="toggle" type="primary">
        <i class="fas fa-plus"></i>
      </n-button>
    </div>
    
    <n-scrollbar style="height: calc(100vh - 80px);">
      <n-menu
        :collapsed="isCollapsed"
        :collapsed-width="64"
        :collapsed-icon-size="22"
        :options="menuOptions"
      />
    </n-scrollbar>
  </n-layout-sider>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref, computed, h } from 'vue';
import { NLayoutSider, NButton, NScrollbar, NMenu, NIcon } from 'naive-ui';

const props = defineProps<{
  history: any[];
}>();

const isCollapsed = ref(false);
const toggle = () => { isCollapsed.value = !isCollapsed.value; };

const menuOptions = computed(() => {
  if (!props.history) return [];
  return props.history.map(item => ({
    label: item.name || item.title,
    key: item.id,
    icon: () => h('i', { class: 'fas fa-history' })
  }));
});
</script>

<style scoped>
.sidebar-container { height: 100vh; background-color: #fafafc; }
.sidebar-header { padding: 16px; display: flex; justify-content: center; align-items: center; }
</style>