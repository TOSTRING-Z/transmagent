import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Settings from '../components/Settings.vue'

describe('Settings.vue', () => {
  it('toggles compress context checkbox', async () => {
    const wrapper = mount(Settings)
    const checkbox = wrapper.find('.compress-checkbox')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    
    await checkbox.setValue(true)
    expect((checkbox.element as HTMLInputElement).checked).toBe(true)
  })
})
