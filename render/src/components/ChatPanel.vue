<template>
  <div class="chat-panel">
    <div class="messages">
      <div v-for="(msg, index) in messages" :key="index" class="message">{{ msg.text }}</div>
    </div>
    <input v-model="input" placeholder="Type a message..." class="chat-input" @keyup.enter="sendMessage" />
    <button @click="sendMessage">Send</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const messages = ref([{ text: 'Hello!' }])
const input = ref('')

const sendMessage = () => {
  if (input.value.trim()) {
    messages.value.push({ text: input.value })
    input.value = ''
  }
}
</script>
