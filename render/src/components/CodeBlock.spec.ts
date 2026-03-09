import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import CodeBlock from './CodeBlock.vue'

describe('CodeBlock.vue', () => {
  it('renders code correctly', () => {
    const wrapper = mount(CodeBlock, {
      props: { code: 'console.log("hello")', language: 'javascript' }
    })
    const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
    expect(textarea.value).toBe('console.log("hello")')
  })

  it('toggles wrap mode', async () => {
    const wrapper = mount(CodeBlock, {
      props: { code: '', language: 'plaintext' }
    })
    const btn = wrapper.find('.toggle-wrap-btn')
    await btn.trigger('click')
    expect(btn.classes()).toContain('active')
  })
})
