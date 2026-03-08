import { defineStore } from 'pinia'

export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: [] as { text: string }[],
    compressContext: false
  }),
  actions: {
    addMessage(msg: string) {
      this.messages.push({ text: msg })
      // mock IPC call
      if ((window as any).electronAPI) {
        (window as any).electronAPI.sendMessage(msg)
      }
    },
    toggleCompress() {
      this.compressContext = !this.compressContext
    }
  }
})
