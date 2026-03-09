<template>
  <div class="code-block-wrapper">
    <div class="code-header">
      <n-text depth="3" class="lang-label">{{ language }}</n-text>
      <n-button quaternary size="tiny" @click="copyCode">
        <template #icon><i class="fas fa-copy"></i></template>
        Copy
      </n-button>
    </div>
    <pre><code :class="'hljs language-' + language" v-html="highlightedCode"></code></pre>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { computed } from 'vue';
import { NButton, NText } from 'naive-ui';
import hljs from 'highlight.js';

const props = defineProps<{ code: string; language: string }>();

const highlightedCode = computed(() => {
  const validLang = hljs.getLanguage(props.language) ? props.language : 'plaintext';
  return hljs.highlight(props.code, { language: validLang }).value;
});

const copyCode = () => { navigator.clipboard.writeText(props.code); };
</script>

<style scoped>
.code-block-wrapper { background: #fdfdfd; border: 1px solid #efeff5; border-radius: 6px; margin: 8px 0; overflow: hidden; }
.code-header { background: #f7f7fa; padding: 4px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #efeff5; }
.lang-label { font-size: 12px; font-family: monospace; }
pre { padding: 12px; margin: 0; overflow-x: auto; font-size: 13px; line-height: 1.5; }
</style>