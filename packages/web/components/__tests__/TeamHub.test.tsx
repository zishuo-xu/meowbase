import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeamHub } from '../TeamHub';
import type { AppConfigDto, UsageDto } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    fetchUsage: vi.fn().mockResolvedValue({ byAgent: {}, total: {} }),
    fetchToolUsage: vi.fn().mockResolvedValue({
      skills: [],
      tools: [],
      total: { skillInjections: 0, toolCalls: 0 },
    }),
    fetchMemoryRecall: vi.fn().mockResolvedValue({
      items: [],
      total: { injections: 0, citations: 0 },
    }),
    listApprovals: vi.fn().mockResolvedValue([]),
    fetchMcpProvision: vi.fn().mockResolvedValue({
      command: 'node mcp.js',
      apiUrl: 'http://127.0.0.1:3200',
      claude: { mcpServers: { meowbase: { command: 'node mcp.js', args: [] } } },
      gemini: { allowedMcpServerNames: ['meowbase'] },
      env: { MEOW_MCP_COMMAND: 'node mcp.js', MEOW_API_URL: 'http://127.0.0.1:3200' },
    }),
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
    vi.mocked(api.fetchToolUsage).mockReset();
    vi.mocked(api.fetchToolUsage).mockResolvedValue({
      skills: [],
      tools: [],
      total: { skillInjections: 0, toolCalls: 0 },
    });
    vi.mocked(api.fetchMemoryRecall).mockReset();
    vi.mocked(api.fetchMemoryRecall).mockResolvedValue({
      items: [],
      total: { injections: 0, citations: 0 },
    });
    vi.mocked(api.fetchMcpProvision).mockReset();
    vi.mocked(api.fetchMcpProvision).mockResolvedValue({
      command: 'node mcp.js',
      apiUrl: 'http://127.0.0.1:3200',
      claude: { mcpServers: { meowbase: { command: 'node mcp.js', args: [] } } },
      gemini: { allowedMcpServerNames: ['meowbase'] },
      env: { MEOW_MCP_COMMAND: 'node mcp.js', MEOW_API_URL: 'http://127.0.0.1:3200' },
    });
    vi.mocked(api.listApprovals).mockReset();
    vi.mocked(api.listApprovals).mockResolvedValue([]);
  });

  it('待批页列出还没落地的卡,点批准和去看', async () => {
    vi.mocked(api.listApprovals).mockResolvedValue([
      {
        id: 'ap_aaaaaaa1',
        threadId: 't-a',
        writerAgentId: 'claude',
        reviewerAgentId: 'gemini',
        status: 'reviewing',
        diffStat: 'hello.txt | 1 +',
        createdAt: '2026-09-06T00:00:00.000Z',
      },
      {
        id: 'ap_bbbbbbb2',
        threadId: 't-b',
        writerAgentId: 'opencode',
        reviewerAgentId: 'gemini',
        status: 'applied',
        diffStat: 'done.txt | 1 +',
        createdAt: '2026-09-06T00:00:00.000Z',
      },
    ]);
    const onApproveCard = vi.fn();
    const onOpenThread = vi.fn();
    render(
      <TeamHub
        open
        config={config}
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onApproveCard={onApproveCard}
        onOpenThread={onOpenThread}
        threadTitleOf={(id) => (id === 't-a' ? '加法线程' : id)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /待批/ }));
    const board = await screen.findByRole('region', { name: '待批' });
    expect(within(board).getByText('加法线程')).toBeTruthy();
    expect(within(board).queryByText('done.txt | 1 +')).toBeNull();
    fireEvent.click(within(board).getByRole('button', { name: '批准' }));
    expect(onApproveCard).toHaveBeenCalledWith('ap_aaaaaaa1');
    fireEvent.click(within(board).getByRole('button', { name: '去看' }));
    expect(onOpenThread).toHaveBeenCalledWith('t-a');
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

  it('能力页只读列出谁写谁审谁跑', async () => {
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
    expect(screen.getByText('协作工具')).toBeTruthy();
    expect(screen.getByText(/search_messages/)).toBeTruthy();
    expect(screen.getByText(/list_threads/)).toBeTruthy();
    expect(screen.getByText(/cross-post/)).toBeTruthy();
    expect(await screen.findByText('可携带')).toBeTruthy();
    expect(screen.getByText(/mcpServers/)).toBeTruthy();
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

  it('加入目录空模型名显示字段提示且不加入', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '加入目录' }));
    expect(screen.getByText(/请填写模型/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '保存模型目录' }));
    expect(onSaveModels).toHaveBeenCalledWith([expect.objectContaining({ id: 'flash' })]);
    expect(onSaveModels.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it('加入目录没勾 CLI 显示字段提示', () => {
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
    fireEvent.change(screen.getByLabelText('模型 ID'), { target: { value: 'kimi-k2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'opencode' }));
    fireEvent.click(screen.getByRole('button', { name: '加入目录' }));
    expect(screen.getByText(/请至少勾选/)).toBeTruthy();
    expect(screen.queryByText('kimi-k2')).toBeNull();
  });

  it('验证新模型空模型名显示字段提示且不探测', () => {
    const onVerifyModel = vi.fn();
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
    fireEvent.click(screen.getByRole('button', { name: '验证新模型' }));
    expect(onVerifyModel).not.toHaveBeenCalled();
    expect(screen.getByText(/请填写模型/)).toBeTruthy();
  });

  it('探测成功把 token 和花费写进结果', async () => {
    const onVerifyModel = vi.fn().mockResolvedValue({
      ok: true,
      stage: 'model',
      latencyMs: 12,
      preview: 'pong',
      usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
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
    await waitFor(() => {
      expect(screen.getByText(/已连通/)).toBeTruthy();
    });
    expect(screen.getByText(/输入 10/)).toBeTruthy();
    expect(screen.getByText(/输出 4/)).toBeTruthy();
    expect(screen.getByText(/\$0.01/)).toBeTruthy();
  });

  it('探测失败也显示用量,没成本写无成本数据不是 $0', async () => {
    const onVerifyModel = vi.fn().mockResolvedValue({
      ok: false,
      stage: 'model',
      latencyMs: 9,
      error: '解析失败',
      usage: { inputTokens: 8, outputTokens: 2 },
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
    await waitFor(() => {
      expect(screen.getByText(/失败: 解析失败/)).toBeTruthy();
    });
    expect(screen.getByText(/输入 8/)).toBeTruthy();
    expect(screen.getByText(/无成本数据/)).toBeTruthy();
    expect(screen.queryByText('$0')).toBeNull();
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
    expect(within(ledger).getByText(/只算猫/)).toBeTruthy();
    expect(within(ledger).getByText(/不计入/)).toBeTruthy();
    expect(within(ledger).getByText(/1,234/)).toBeTruthy();
    expect(within(ledger).getByText('墨墨')).toBeTruthy();
    expect(within(ledger).getByText('闪闪')).toBeTruthy();
    expect(within(ledger).getByText('团团')).toBeTruthy();
  });

  it('配了预算时账本显示已花和上限', async () => {
    vi.mocked(api.fetchUsage).mockResolvedValue(threadUsage);
    render(
      <TeamHub
        open
        config={{ ...config, budgetUsd: 1 }}
        activeThreadId="t1"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '账本' }));
    const ledger = await screen.findByRole('region', { name: '账本' });
    expect(within(ledger).getByText(/上限/)).toBeTruthy();
    expect(within(ledger).getByText(/\$1/)).toBeTruthy();
  });

  it('账本可改全平台上限和每只猫上限', async () => {
    const onSaveBudget = vi.fn();
    vi.mocked(api.fetchUsage).mockResolvedValue(threadUsage);
    render(
      <TeamHub
        open
        config={{ ...config, budgetUsd: 1, agentBudgets: { claude: 0.5 } }}
        activeThreadId="t1"
        onClose={() => {}}
        onSaveAgent={vi.fn()}
        onSaveSettings={vi.fn()}
        onSaveBudget={onSaveBudget}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '账本' }));
    const ledger = await screen.findByRole('region', { name: '账本' });
    expect(within(ledger).getByLabelText('全平台上限')).toBeTruthy();
    expect(within(ledger).getByLabelText('墨墨上限')).toBeTruthy();
    fireEvent.change(within(ledger).getByLabelText('全平台上限'), { target: { value: '2' } });
    fireEvent.click(within(ledger).getByRole('button', { name: '保存上限' }));
    expect(onSaveBudget).toHaveBeenCalledWith({ budgetUsd: 2 });
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

  it('技能页列出注入次数和工具调用', async () => {
    vi.mocked(api.fetchToolUsage).mockResolvedValue({
      skills: [
        { id: 'review', count: 2 },
        { id: 'tdd', count: 1 },
      ],
      tools: [{ name: 'Write', category: 'builtin', count: 3 }],
      total: { skillInjections: 3, toolCalls: 3 },
    });
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
    fireEvent.click(screen.getByRole('button', { name: '技能' }));
    const board = await screen.findByRole('region', { name: '技能' });
    expect(within(board).getByText('review')).toBeTruthy();
    expect(within(board).getByText('tdd')).toBeTruthy();
    expect(within(board).getByText('Write')).toBeTruthy();
    expect(within(board).getByText('builtin')).toBeTruthy();
    expect(within(board).getByText(/技能注入/)).toBeTruthy();
  });

  it('记忆页列出注入和引用', async () => {
    vi.mocked(api.fetchMemoryRecall).mockResolvedValue({
      items: [{ id: 'ev_aaaaaaaa', injections: 2, citations: 1 }],
      total: { injections: 2, citations: 1 },
    });
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
    fireEvent.click(screen.getByRole('button', { name: '记忆' }));
    const board = await screen.findByRole('region', { name: '记忆' });
    expect(within(board).getByText('ev_aaaaaaaa')).toBeTruthy();
    expect(within(board).getByText(/注入 2/)).toBeTruthy();
    expect(within(board).getByText(/引用 1/)).toBeTruthy();
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

  it('没有 totalTokens 的猫显示派生总计,没出场仍是 —', async () => {
    vi.mocked(api.fetchUsage).mockResolvedValue({
      byAgent: {
        claude: { inputTokens: 21171, outputTokens: 1936, cacheReadTokens: 107008, costUsd: 0.207759 },
      },
      total: { inputTokens: 21171, outputTokens: 1936, cacheReadTokens: 107008, costUsd: 0.207759 },
    });
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
    const claudeRow = within(ledger).getByText('墨墨').closest('li');
    expect(claudeRow?.textContent).toMatch(/总计 130,115/);
    const geminiRow = within(ledger).getByText('闪闪').closest('li');
    expect(geminiRow?.textContent).toMatch(/总计 —/);
    expect(geminiRow?.textContent).not.toMatch(/总计 0/);
  });
});
