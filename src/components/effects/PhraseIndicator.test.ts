import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import PhraseIndicator from './PhraseIndicator.vue';

function epochNow() {
  return performance.timeOrigin + performance.now();
}

describe('PhraseIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts beats from its own clock and marks the cells passed', async () => {
    const wrapper = mount(PhraseIndicator, {
      props: { phrase: { startedAt: epochNow() - 2500, beatMs: 1000, total: 16 } }
    });
    expect(wrapper.find('.beat-counter').text()).toBe('3\u2009/\u200916');
    expect(wrapper.findAll('.phrase-cell--done')).toHaveLength(2);
    expect(wrapper.findAll('.phrase-cell--current')).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.beat-counter').text()).toBe('4\u2009/\u200916');
    wrapper.unmount();
  });

  it('highlights the last bar so the coming switch is visible', () => {
    const wrapper = mount(PhraseIndicator, {
      props: { phrase: { startedAt: epochNow() - 13500, beatMs: 1000, total: 16 } }
    });
    const lastBar = wrapper.findAll('.phrase-cell--last-bar');
    expect(lastBar).toHaveLength(4);
    expect(lastBar[1].classes()).toContain('phrase-cell--current');
    wrapper.unmount();
  });
});
