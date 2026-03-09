import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import TerminalWindow from './TerminalWindow.vue'

describe('TerminalWindow.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(TerminalWindow)
    expect(wrapper.exists()).toBe(true)
  })
})
