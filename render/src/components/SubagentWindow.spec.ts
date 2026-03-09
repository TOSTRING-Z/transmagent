import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import SubagentWindow from './SubagentWindow.vue'

describe('SubagentWindow.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(SubagentWindow)
    expect(wrapper.exists()).toBe(true)
  })
})
