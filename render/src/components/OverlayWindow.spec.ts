import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import OverlayWindow from './OverlayWindow.vue'

describe('OverlayWindow.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(OverlayWindow)
    expect(wrapper.exists()).toBe(true)
  })
})
