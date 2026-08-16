import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TeamHub } from '../TeamHub';
import type { AppConfigDto } from '@/lib/api';

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
      role: '主力写手',
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

describe('TeamHub', () => {
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
      expect.objectContaining({ name: '墨墨酱' }),
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
});
