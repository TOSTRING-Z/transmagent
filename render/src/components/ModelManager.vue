<template>
  <n-card title="Model Management" class="model-manager-card">
    <template #header-extra>
      <n-button type="primary" size="small" @click="refreshModels">
        <template #icon><i class="fas fa-sync"></i></template>
        Refresh
      </n-button>
    </template>
    <n-list bordered clickable>
      <n-list-item v-for="model in models" :key="model.id">
        <n-thing :title="model.name" :description="model.provider">
          <template #avatar>
            <n-avatar round><i class="fas fa-brain"></i></n-avatar>
          </template>
          <n-tag :type="model.status === 'active' ? 'success' : 'default'" size="small">
            {{ model.status }}
          </n-tag>
        </n-thing>
        <template #suffix>
          <n-switch v-model:value="model.enabled" />
        </template>
      </n-list-item>
    </n-list>
  </n-card>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { NCard, NButton, NList, NListItem, NThing, NAvatar, NTag, NSwitch } from 'naive-ui';

const models = ref([
  { id: '1', name: 'GPT-4o', provider: 'OpenAI', status: 'active', enabled: true },
  { id: '2', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', status: 'active', enabled: true },
  { id: '3', name: 'Gemini 1.5 Pro', provider: 'Google', status: 'idle', enabled: false }
]);

const refreshModels = () => { console.log('Refreshing...'); };
</script>