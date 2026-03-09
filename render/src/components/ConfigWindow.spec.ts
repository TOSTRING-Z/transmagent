import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ConfigWindow from './ConfigWindow.vue'

describe('ConfigWindow.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(ConfigWindow)
    expect(wrapper.exists()).toBe(true)
  })
})
