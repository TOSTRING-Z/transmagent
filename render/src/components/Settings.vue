<template>
  <div class="settings">
    <h2>Settings</h2>
    <label>
      <input type="checkbox" v-model="compressContext" class="compress-checkbox" />
      Compress Context
    </label>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const compressContext = ref(false)
</script>
