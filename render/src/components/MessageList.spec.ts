import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import MessageList from './MessageList.vue';

describe('MessageList.vue', () => {
  it('renders empty state when no messages', () => {
    const wrapper = mount(MessageList, {
      props: { messages: [] }
    });
    expect(wrapper.text()).toContain('I am TransMAgent');
  });

  it('renders messages', () => {
    const wrapper = mount(MessageList, {
      props: {
        messages: [{ id: '1', role: 'user', content: 'Hello TS' }]
      }
    });
    expect(wrapper.text()).toContain('Hello TS');
  });
});