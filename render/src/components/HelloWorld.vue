<template>
  <n-result status="success" title="TransMAgent Ready" description="Everything is under control.">
    <template #extra>
      <n-space justify="center">
        <n-button type="primary" ghost @click="count++">Count: {{ count }}</n-button>
        <n-button secondary @click="$emit('start')">Get Started</n-button>
      </n-space>
    </template>
    <n-p style="text-align: center; margin-top: 24px;">
      Edit <code>components/HelloWorld.vue</code> to test HMR
    </n-p>
  </n-result>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { NResult, NButton, NSpace, NP } from 'naive-ui';
const count = ref(0);
</script>