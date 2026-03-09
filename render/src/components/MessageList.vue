<template>
  <n-scrollbar class="message-list-container" ref="scrollbarRef">
    <div class="message-list-content">
      <n-empty v-if="messages.length === 0" description="I am TransMAgent" size="large" class="empty-state">
        <template #icon>
          <n-icon size="48">
            <i class="fas fa-robot"></i>
          </n-icon>
        </template>
      </n-empty>
      <div v-else v-for="msg in messages" :key="msg.id">
        <MessageItem :message="msg" />
      </div>
    </div>
  </n-scrollbar>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref, watch, nextTick } from 'vue';
import { NScrollbar, NEmpty, NIcon } from 'naive-ui';
import MessageItem from './MessageItem.vue';

const props = defineProps<{
  messages: any[];
}>();

const scrollbarRef = ref(null);

watch(() => props.messages.length, () => {
  nextTick(() => {
    if (scrollbarRef.value) {
      scrollbarRef.value.scrollTo({ position: 'bottom', silent: true });
    }
  });
}, { deep: true });
</script>

<style scoped>
.message-list-container {
  height: 100%;
  flex: 1;
}
.message-list-content {
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
}
.empty-state {
  margin-top: 20vh;
}
</style>