<template>
  <n-layout has-sider class="index-layout">
    <Sidebar :history="historyList" />
    
    <n-layout>
      <n-layout-header bordered class="main-header">
        <n-space align="center" justify="space-between" style="height: 100%; padding: 0 20px;">
          <n-text strong style="font-size: 18px;">TransMAgent v3</n-text>
          <n-space>
            <n-button quaternary circle @click="isConfigVisible = true">
              <template #icon><i class="fas fa-gear"></i></template>
            </n-button>
          </n-space>
        </n-space>
      </n-layout-header>

      <n-layout-content class="main-content">
         <MessageList :messages="activeMessages" />
      </n-layout-content>

      <n-layout-footer class="main-footer">
        <div class="input-container">
          <n-input
            v-model:value="userInput"
            type="textarea"
            placeholder="Ask me anything..."
            :autosize="{ minRows: 1, maxRows: 5 }"
            @keyup.enter.prevent="sendMessage"
          />
          <n-button type="primary" circle @click="sendMessage">
             <template #icon><i class="fas fa-paper-plane"></i></template>
          </n-button>
        </div>
      </n-layout-footer>
    </n-layout>
  </n-layout>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref } from 'vue';
import { 
  NLayout, NLayoutHeader, NLayoutContent, NLayoutFooter, 
  NButton, NInput, NSpace, NText 
} from 'naive-ui';
import Sidebar from './Sidebar.vue';
import MessageList from './MessageList.vue';

const historyList = ref([]);
const activeMessages = ref([]);
const isConfigVisible = ref(false);
const userInput = ref('');

const sendMessage = () => {
  if (!userInput.value.trim()) return;
  activeMessages.value.push({
    id: Date.now().toString(),
    role: 'user',
    content: userInput.value
  });
  userInput.value = '';
};
</script>

<style scoped>
.index-layout { height: 100vh; }
.main-header { height: 60px; }
.main-content { background-color: #ffffff; display: flex; flex-direction: column; }
.main-footer { padding: 16px 24px; background: transparent; }
.input-container { 
  max-width: 900px; 
  margin: 0 auto; 
  display: flex; 
  gap: 12px; 
  align-items: flex-end;
  background: #f4f4f8;
  padding: 12px;
  border-radius: 12px;
}
</style>