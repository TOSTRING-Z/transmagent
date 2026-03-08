import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ChatPanel from '../components/ChatPanel.vue'

describe('ChatPanel.vue', () => {
  it('renders messages and handles input', async () => {
    const wrapper = mount(ChatPanel)
    expect(wrapper.text()).toContain('Hello!')
    
    const input = wrapper.find('.chat-input')
    await input.setValue('New message')
    await wrapper.find('button').trigger('click')
    
    expect(wrapper.text()).toContain('New message')
  })
})
