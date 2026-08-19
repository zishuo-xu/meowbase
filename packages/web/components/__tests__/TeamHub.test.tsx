import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeamHub } from '../TeamHub';
import type { AppConfigDto, UsageDto } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    fetchUsage: vi.fn().mockResolvedValue({ byAgent: {}, total: {} }),
  },
}));

import { api } from '@/lib/api';

const config: AppConfigDto = {
  a2aMaxDepth: 3,
  defaultAgentId: 'claude',
  models: [
    {
      id: 'flash',
      label: 'Flash',
      bin: 'opencode',
      model: 'opencode-go/deepseek-v4-flash',
    },
  ],
  agents: [
    {
      id: 'claude',
      name: '墨墨',
      role: '主架构师',
      aliases: ['墨墨', 'claude'],
      bin: 'claude',
      personality: '沉稳',
      expertise: ['TypeScript'],
      autoApprove: false,
    },
    {
      id: 'gemini',
      name: '闪闪',
      role: '审查官',
      aliases: ['闪闪', 'gemini'],
      bin: 'gemini',
      personality: '活泼',
      expertise: ['审查'],
    },
    {
      id: 'opencode',
      name: '团团',
      role: '执行者',
      aliases: ['团团', 'opencode'],
      bin: 'opencode',
      model: 'opencode-go/deepseek-v4-flash',
      personality: '可靠',
      expertise: ['脚本'],
    },
  ],
};

const threadUsage: UsageDto = {
  byAgent: {
    claude: {
      inputTokens: 1234,
      outputTokens: 56,
      cacheReadTokens: 10,
      totalTokens: 1300,
      costUsd: 0.0123,
    },
    gemini: {
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    },
    opencode: {
      inputTokens: 40,
      outputTokens: 8,
      totalTokens: 48,
      costUsd: 0.02,
      costEstimated: true,
    },
  },
  total: {
    inputTokens: 1354,
    outputTokens: 84,
    cacheReadTokens: 10,
    totalTokens: 1448,
    costUsd: 0.0323,
    costEstimated: true,
  },
};

describe('TeamHub', () => {
  beforeEach(() => {
    vi.mocked(api.fetchUsage).mockReset();
    vi.mocked(api.fetchUsage).mockResolvedValue({ byAgent: {}, total: {} });
  });

  it('列出三只猫并保存当前猫的改名', () => {
    const onSaveAgent = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={onSaveAgent}
        onSaveSettings={vi.fn()}
      />,
    );
    expect(screen.getByText('团队 Hub')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /墨墨/ }));
    fireEvent.change(screen.getByLabelText('名字'), { target: { value: '墨墨酱' } });
    fireEvent.click(screen.getByRole('button', { name: '保存这只猫' }));
    expect(onSaveAgent).toHaveBeenCalledWith(
      'claude',
      expect.objectContaining({ name: '墨墨酱', aliases: ['墨墨', 'claude'] }),
    );
  });

  it('能力页只读列出谁写谁审谁跑', () => {
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '能力' }));
    expect(screen.getByText('谁写、谁审、谁跑。只读名册，不改路由。')).toBeTruthy();
    expect(screen.getByText(/CLI claude/)).toBeTruthy();
    expect(screen.getByText(/CLI gemini/)).toBeTruthy();
    expect(screen.getByText(/CLI opencode/)).toBeTruthy();
  });

  it('顿号拼接的别名保存成两个 token', () => {
    const onSaveAgent = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={onSaveAgent}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /墨墨/ }));
    fireEvent.change(screen.getByLabelText('别名'), {
      target: { value: '墨墨、claude、墨' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存这只猫' }));
    expect(onSaveAgent).toHaveBeenCalledWith(
      'claude',
      expect.objectContaining({ aliases: ['墨墨', 'claude', '墨'] }),
    );
  });

  it('保存协作设置', () => {
    const onSaveSettings = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        focusAgentId="gemini"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={onSaveSettings}
      />,
    );
    fireEvent.change(screen.getByLabelText('A2A 链深'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('默认接话猫'), { target: { value: 'gemini' } });
    fireEvent.click(screen.getByRole('button', { name: '保存协作设置' }));
    expect(onSaveSettings).toHaveBeenCalledWith({ a2aMaxDepth: 5, defaultAgentId: 'gemini' });
  });

  it('保存模型目录', () => {
    const onSaveModels = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onSaveModels={onSaveModels}
      />,
    );
    expect(screen.getByText('添加新模型')).toBeTruthy();
    expect((screen.getByLabelText('显示名') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('模型 ID') as HTMLInputElement).value).toBe('');
    expect(screen.getByLabelText('网关 URL')).toBeTruthy();
    expect(screen.getByLabelText('API Key')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: 'Sonnet' } });
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'opencode' }));
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'sonnet' } });
    fireEvent.change(screen.getByLabelText('网关 URL'), {
      target: { value: 'https://api.moonshot.cn/anthropic' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
    fireEvent.click(screen.getByRole('button', { name: '加入目录' }));
    fireEvent.click(screen.getByRole('button', { name: '保存模型目录' }));
    expect(onSaveModels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Sonnet',
          bins: ['claude'],
          bin: 'claude',
          protocol: 'anthropic',
          model: 'sonnet',
          baseUrl: 'https://api.moonshot.cn/anthropic',
          apiKey: 'sk-test',
        }),
      ]),
    );
  });

  it('可编辑已登记模型', () => {
    const onSaveModels = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onSaveModels={onSaveModels}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '编辑 Flash' }));
    fireEvent.change(screen.getByLabelText('编辑 flash 显示名'), { target: { value: 'Flash 改' } });
    fireEvent.change(screen.getByLabelText('编辑 flash 网关 URL'), {
      target: { value: 'https://api.example.com/v1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '完成编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '保存模型目录' }));
    expect(onSaveModels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'flash',
          label: 'Flash 改',
          baseUrl: 'https://api.example.com/v1',
        }),
      ]),
    );
  });

  it('目录模型可勾多个 CLI', () => {
    const onSaveModels = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onSaveModels={onSaveModels}
      />,
    );
    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: 'Flash 多路' } });
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude' }));
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'opencode-go/deepseek-v4-flash' } });
    fireEvent.click(screen.getByRole('button', { name: '加入目录' }));
    fireEvent.click(screen.getByRole('button', { name: '保存模型目录' }));
    expect(onSaveModels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          bins: ['opencode', 'claude'],
          protocol: 'anthropic',
          model: 'opencode-go/deepseek-v4-flash',
        }),
      ]),
    );
  });

  it('OpenAI 协议不能勾 claude CLI', () => {
    const onSaveModels = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onSaveModels={onSaveModels}
      />,
    );
    expect((screen.getByRole('checkbox', { name: 'claude' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('显示名'), { target: { value: 'GPT' } });
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'gpt-4.1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude' }));
    fireEvent.click(screen.getByRole('button', { name: '加入目录' }));
    fireEvent.click(screen.getByRole('button', { name: '保存模型目录' }));
    expect(onSaveModels).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          protocol: 'openai',
          bins: ['opencode'],
          model: 'gpt-4.1',
        }),
      ]),
    );
  });

  it('验证连接调用探测', async () => {
    const onVerifyModel = vi.fn().mockResolvedValue({
      ok: true,
      stage: 'model',
      latencyMs: 12,
      preview: 'pong',
    });
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onVerifyModel={onVerifyModel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '验证 Flash' }));
    expect(onVerifyModel).toHaveBeenCalledWith(
      expect.objectContaining({ bin: 'opencode', model: 'opencode-go/deepseek-v4-flash' }),
    );
    await waitFor(() => {
      expect(screen.getByText(/已连通/)).toBeTruthy();
    });
  });

  it('验证新模型带上网关 URL', async () => {
    const onVerifyModel = vi.fn().mockResolvedValue({
      ok: true,
      stage: 'model',
      latencyMs: 8,
      preview: 'pong',
    });
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onVerifyModel={onVerifyModel}
      />,
    );
    fireEvent.change(screen.getByLabelText('协议'), { target: { value: 'anthropic' } });
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'kimi-k2' } });
    fireEvent.change(screen.getByLabelText('网关 URL'), {
      target: { value: 'https://api.moonshot.cn/anthropic' },
    });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-kimi' } });
    fireEvent.click(screen.getByRole('button', { name: '验证新模型' }));
    expect(onVerifyModel).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'anthropic',
        model: 'kimi-k2',
        baseUrl: 'https://api.moonshot.cn/anthropic',
        apiKey: 'sk-kimi',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText(/已连通/)).toBeTruthy();
    });
  });

  it('成员从目录选用模型', () => {
    const onSaveAgent = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        focusAgentId="claude"
        onClose={() => {}}
        onSaveAgent={onSaveAgent}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('CLI'), { target: { value: 'opencode' } });
    fireEvent.change(screen.getByLabelText('选用模型'), { target: { value: 'flash' } });
    fireEvent.click(screen.getByRole('button', { name: '保存这只猫' }));
    expect(onSaveAgent).toHaveBeenCalledWith(
      'claude',
      expect.objectContaining({
        modelId: 'flash',
        bin: 'opencode',
        model: 'opencode-go/deepseek-v4-flash',
      }),
    );
  });

  it('支持当前 CLI 的模型不用先改 CLI', () => {
    const onSaveAgent = vi.fn();
    render(
      <TeamHub
        open
        config={{
          ...config,
          models: [
            {
              id: 'flash',
              label: 'Flash',
              bin: 'opencode',
              bins: ['opencode', 'claude'],
              model: 'opencode-go/deepseek-v4-flash',
            },
          ],
        }}
        focusAgentId="claude"
        onClose={() => {}}
        onSaveAgent={onSaveAgent}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('选用模型'), { target: { value: 'flash' } });
    fireEvent.click(screen.getByRole('button', { name: '保存这只猫' }));
    expect(onSaveAgent).toHaveBeenCalledWith(
      'claude',
      expect.objectContaining({
        modelId: 'flash',
        bin: 'claude',
        model: 'opencode-go/deepseek-v4-flash',
      }),
    );
  });

  it('CLI 与选用模型都是下拉框', () => {
    render(
      <TeamHub
        open
        config={config}
        focusAgentId="claude"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('CLI').tagName).toBe('SELECT');
    expect(screen.getByLabelText('选用模型').tagName).toBe('SELECT');
    expect(screen.queryByLabelText('默认模型')).toBeNull();
    fireEvent.change(screen.getByLabelText('CLI'), { target: { value: 'opencode' } });
    const picker = screen.getByLabelText('选用模型') as HTMLSelectElement;
    expect([...picker.options].map((o) => o.value)).toContain('flash');
  });

  it('关闭时不渲染面板', () => {
    const { container } = render(
      <TeamHub
        open={false}
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-team-hub]')).toBeNull();
  });

  it('账本按猫渲染行,数字千分位', async () => {
    vi.mocked(api.fetchUsage).mockResolvedValue(threadUsage);
    render(
      <TeamHub
        open
        config={config}
        activeThreadId="t1"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '账本' }));
    const ledger = await screen.findByRole('region', { name: '账本' });
    expect(within(ledger).getByText(/1,234/)).toBeTruthy();
    expect(within(ledger).getByText('墨墨')).toBeTruthy();
    expect(within(ledger).getByText('闪闪')).toBeTruthy();
    expect(within(ledger).getByText('团团')).toBeTruthy();
  });

  it('没有 costUsd 时显示无成本数据而不是 $0', async () => {
    vi.mocked(api.fetchUsage).mockResolvedValue(threadUsage);
    render(
      <TeamHub
        open
        config={config}
        activeThreadId="t1"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '账本' }));
    const ledger = await screen.findByRole('region', { name: '账本' });
    const geminiRow = within(ledger).getByText('闪闪').closest('li');
    expect(geminiRow?.textContent).toContain('无成本数据');
    expect(geminiRow?.textContent).not.toMatch(/\$0/);
    expect(within(ledger).getByText('估算')).toBeTruthy();
  });

  it('切换当前线程 / 全部会换数据源', async () => {
    vi.mocked(api.fetchUsage).mockResolvedValue(threadUsage);
    render(
      <TeamHub
        open
        config={config}
        activeThreadId="t-current"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '账本' }));
    await waitFor(() => expect(api.fetchUsage).toHaveBeenCalledWith('t-current'));
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    await waitFor(() => expect(api.fetchUsage).toHaveBeenCalledWith(undefined));
    fireEvent.click(screen.getByRole('button', { name: '当前线程' }));
    await waitFor(() => {
      expect(vi.mocked(api.fetchUsage).mock.calls.at(-1)?.[0]).toBe('t-current');
    });
  });

  it('没出场的猫显示占位,完全没数据时给空态', async () => {
    vi.mocked(api.fetchUsage).mockResolvedValue({
      byAgent: {
        claude: { inputTokens: 3, outputTokens: 1, totalTokens: 4, costUsd: 0.01 },
      },
      total: { inputTokens: 3, outputTokens: 1, totalTokens: 4, costUsd: 0.01 },
    });
    const { rerender } = render(
      <TeamHub
        open
        config={config}
        activeThreadId="t1"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '账本' }));
    const ledger = await screen.findByRole('region', { name: '账本' });
    expect(within(ledger).getByText(/输入 3/)).toBeTruthy();
    const geminiRow = within(ledger).getByText('闪闪').closest('li');
    expect(geminiRow?.textContent).toMatch(/—/);
    expect(geminiRow?.textContent).not.toMatch(/\b0\b/);

    vi.mocked(api.fetchUsage).mockResolvedValue({ byAgent: {}, total: {} });
    rerender(
      <TeamHub
        open
        config={config}
        activeThreadId="t1"
        usageRefreshKey={1}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    expect(await screen.findByText(/还没有用量记录/)).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText('NaN')).toBeNull();
  });
});
