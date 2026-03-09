import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import ModelManager from './ModelManager.vue'

describe('ModelManager.vue', () => {
  it('mounts properly', () => {
    const wrapper = mount(ModelManager)
    expect(wrapper.exists()).toBe(true)
  })
})
