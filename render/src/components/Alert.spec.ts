import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Alert from './Alert.vue'

describe('Alert.vue', () => {
  it('renders default content when initialized', () => {
    const wrapper = mount(Alert)
    expect(wrapper.text()).toContain('默认内容')
    expect(wrapper.find('.log').exists()).toBe(true)
  })

  it('hides content when close button is clicked (without Electron)', async () => {
    const wrapper = mount(Alert)
    expect(wrapper.find('.alert-content').exists()).toBe(true)
    await wrapper.find('.close-btn').trigger('click')
    expect(wrapper.find('.alert-content').exists()).toBe(false)
  })
})
