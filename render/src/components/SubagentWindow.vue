<template>
  <n-drawer :show="visible" :width="400" placement="right" @update:show="$emit('close')">
    <n-drawer-content title="Sub-Agent Monitor" closable>
      <n-collapse default-expanded-names="1" accordion>
        <n-collapse-item v-for="(agent, index) in agents" :key="index" :title="agent.name" :name="index + 1">
          <template #header-extra>
            <n-tag :type="agent.status === 'running' ? 'success' : 'warning'" size="small">
              {{ agent.status }}
            </n-tag>
          </template>
          <div class="agent-detail">
             <n-p><strong>Task:</strong> {{ agent.currentTask }}</n-p>
             <n-progress type="line" :percentage="agent.progress" :indicator-placement="'inside'" />
          </div>
        </n-collapse-item>
      </n-collapse>
    </n-drawer-content>
  </n-drawer>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { NDrawer, NDrawerContent, NCollapse, NCollapseItem, NTag, NP, NProgress } from 'naive-ui';

defineProps<{ visible: boolean }>();

const agents = ref([
  { name: 'Data Analyzer', status: 'running', currentTask: 'Cleaning CSV...', progress: 65 },
  { name: 'Web Crawler', status: 'idle', currentTask: 'Waiting...', progress: 0 }
]);
</script>