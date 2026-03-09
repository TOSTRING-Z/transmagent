import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ToolWindow from './ToolWindow.vue'

describe('ToolWindow.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(ToolWindow)
    expect(wrapper.exists()).toBe(true)
  })
})
