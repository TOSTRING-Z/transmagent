<template>
  <n-config-provider>
    <n-message-provider>
      <n-dialog-provider>
        <div class="app-container">
          <Sidebar :history="store.state.history" />
          <main class="main-content">
            <MessageList :messages="store.state.messages" />
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { NConfigProvider, NMessageProvider, NDialogProvider } from 'naive-ui';
import Sidebar from './components/Sidebar.vue';
import MessageList from './components/MessageList.vue';
import { useChatStore } from './store/chatStore';

const store = useChatStore();
</script>

<style>
.app-container { display: flex; height: 100vh; }
.main-content { flex: 1; display: flex; flex-direction: column; }
</style>
