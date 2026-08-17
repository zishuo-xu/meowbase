import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { EvidenceRail } from '../EvidenceRail';

describe('EvidenceRail', () => {
  it('点击条目插入引用,草稿可确认', () => {
    const onCite = vi.fn();
    const onConfirm = vi.fn();
    render(
      <EvidenceRail
        onCite={onCite}
        onConfirm={onConfirm}
        items={[
          {
            id: 'ev_abcd1234',
            threadId: 't',
            kind: 'fact',
            title: '加法约定',
            content: '2+3=5',
            status: 'confirmed',
            createdAt: '',
          },
          {
            id: 'ev_deadbeef',
            threadId: 't',
            kind: 'lesson',
            title: '待确认',
            content: 'x',
            status: 'draft',
            createdAt: '',
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('加法约定'));
    expect(onCite).toHaveBeenCalledWith('ev_abcd1234');
    fireEvent.click(screen.getByText('确认'));
    expect(onConfirm).toHaveBeenCalledWith('ev_deadbeef');
  });
});
