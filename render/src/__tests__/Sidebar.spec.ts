import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Sidebar from '../components/Sidebar.vue'

describe('Sidebar.vue', () => {
  it('renders sidebar items', () => {
    const wrapper = mount(Sidebar)
    expect(wrapper.findAll('.sidebar-item').length).toBe(2)
    expect(wrapper.text()).toContain('Chat 1')
  })
})
