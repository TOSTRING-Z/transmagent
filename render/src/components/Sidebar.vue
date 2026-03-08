<template>
  <div class="sidebar">
    <h2>Sidebar</h2>
    <ul>
      <li v-for="item in items" :key="item.id" class="sidebar-item">{{ item.name }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const items = ref([
  { id: 1, name: 'Chat 1' },
  { id: 2, name: 'Chat 2' }
])
</script>
