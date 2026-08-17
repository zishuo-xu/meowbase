import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RelayTimeline } from '../RelayTimeline';

describe('RelayTimeline', () => {
  it('画出墨墨到闪闪,失败一棒可见', () => {
    render(
      <RelayTimeline
        hops={[
          { name: '墨墨', agentId: 'claude', status: 'done' },
          { name: '闪闪', agentId: 'gemini', status: 'failed' },
        ]}
      />,
    );
    expect(screen.getByText('墨墨')).toBeTruthy();
    expect(screen.getByText('闪闪')).toBeTruthy();
    expect(screen.getByText('→')).toBeTruthy();
  });

  it('没有 hops 不渲染', () => {
    const { container } = render(<RelayTimeline hops={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
