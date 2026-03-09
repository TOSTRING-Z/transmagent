<template>
  <div class="message-wrapper" :class="message.role">
    <div class="message-avatar">
      <n-avatar 
        round 
        :size="40" 
        :color="message.role === 'user' ? '#18a058' : '#2080f0'"
      >
        <n-icon color="#fff">
           <i :class="message.role === 'user' ? 'fas fa-user' : 'fas fa-robot'"></i>
        </n-icon>
      </n-avatar>
    </div>
    <div class="message-content-wrapper">
      <n-card 
        v-if="message.infoContent" 
        size="small" 
        embedded 
        class="info-card"
      >
        <div v-html="renderedInfoHtml"></div>
      </n-card>
      
      <div :class="['message-bubble', message.role]">
        <div class="main-content" v-html="renderedHtml"></div>
        <div v-if="message.thinking" class="thinking-status">
          <n-spin size="small" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { computed } from 'vue';
import { NAvatar, NSpin, NCard, NIcon } from 'naive-ui';
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/github.css';

const props = defineProps<{
  message: {
    id: string;
    role: 'user' | 'system' | 'assistant' | string;
    content: string;
    infoContent?: string;
    thinking?: boolean;
  }
}>();

marked.setOptions({
  highlight: (code, lang) => {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  langPrefix: 'hljs language-',
});

const renderedHtml = computed(() => {
  if (!props.message.content) return '';
  return DOMPurify.sanitize(marked.parse(props.message.content) as string);
});

const renderedInfoHtml = computed(() => {
  if (!props.message.infoContent) return '';
  return DOMPurify.sanitize(marked.parse(props.message.infoContent) as string);
});
</script>

<style scoped>
.message-wrapper {
  display: flex;
  margin: 16px 0;
  gap: 12px;
}
.message-wrapper.user { flex-direction: row-reverse; }
.message-content-wrapper { max-width: 80%; display: flex; flex-direction: column; gap: 4px; }
.message-wrapper.user .message-content-wrapper { align-items: flex-end; }

.message-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.message-bubble.user {
  background-color: #18a058;
  color: white;
  border-top-right-radius: 2px;
}
.message-bubble.assistant {
  background-color: #f4f4f8;
  color: #333;
  border-top-left-radius: 2px;
}
.info-card {
  background-color: #fffbe6 !important;
  border: 1px solid #ffe58f !important;
  font-size: 12px;
}
.thinking-status { margin-top: 8px; }
</style>