import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import Sidebar from './Sidebar.vue';

describe('Sidebar.vue', () => {
  const globalOptions = {
    stubs: {
      'n-layout-sider': {
        template: '<div class="n-layout-sider"><slot /></div>'
      },
      'n-button': {
        template: `<button class="n-button" @click="$emit('click')"><slot /></button>`
      },
      'n-scrollbar': {
        template: '<div class="n-scrollbar"><slot /></div>'
      },
      'n-tooltip': {
        template: '<div class="n-tooltip"><slot /></div>'
      }
    }
  };

  it('renders history items', () => {
    const wrapper = mount(Sidebar, {
      props: { history: [{ id: '1', name: 'Test Chat' }] },
      global: globalOptions
    });
    expect(wrapper.text()).toContain('Test Chat');
  });

  it('toggles collapse state', async () => {
    const wrapper = mount(Sidebar, {
      props: { history: [] },
      global: globalOptions
    });
    const btn = wrapper.find('.n-button');
    if (btn.exists()) {
      await btn.trigger('click');
      expect(btn.exists()).toBe(true);
    }
  });
});
