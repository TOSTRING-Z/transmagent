import { setActivePinia, createPinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore } from '../store/chat'

describe('Chat Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('adds a message and calls IPC mock', () => {
    const store = useChatStore()
    
    // Mock IPC
    const mockSendMessage = vi.fn()
    ;(window as any).electronAPI = { sendMessage: mockSendMessage }
    
    store.addMessage('Hello Pinia!')
    
    expect(store.messages.length).toBe(1)
    expect(store.messages[0]?.text).toBe('Hello Pinia!')
    expect(mockSendMessage).toHaveBeenCalledWith('Hello Pinia!')
  })

  it('toggles compress context', () => {
    const store = useChatStore()
    expect(store.compressContext).toBe(false)
    store.toggleCompress()
    expect(store.compressContext).toBe(true)
  })
})
