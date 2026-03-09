import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import IconOverlay from './IconOverlay.vue'

describe('IconOverlay.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(IconOverlay)
    expect(wrapper.exists()).toBe(true)
  })
})
