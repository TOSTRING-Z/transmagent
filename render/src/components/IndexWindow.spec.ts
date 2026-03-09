import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import IndexWindow from './IndexWindow.vue'

describe('IndexWindow.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(IndexWindow)
    expect(wrapper.exists()).toBe(true)
  })
})
