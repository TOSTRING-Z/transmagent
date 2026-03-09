import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import App from './App.vue';

describe('App.vue', () => {
  it('renders App with Sidebar and MessageList', () => {
    const wrapper = mount(App);
    expect(wrapper.findComponent({ name: 'Sidebar' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'MessageList' }).exists()).toBe(true);
  });
});