'use client';
import { useEffect, useState } from 'react';
import type { AgentConfigDto, AppConfigDto, ModelPresetDto } from '@/lib/api';
import { CatAvatar } from './CatAvatar';

export interface AgentSavePayload {
  name: string;
  aliases: string[];
  role: string;
  personality: string;
  expertise: string[];
  bin: string;
  model?: string;
  modelId?: string;
  autoApprove: boolean;
}

export interface SettingsSavePayload {
  a2aMaxDepth: number;
  defaultAgentId: string;
}

export interface VerifyModelPayload {
  bin: string;
  model?: string;
  modelId?: string;
  protocol?: ModelProtocol;
  baseUrl?: string;
  apiKey?: string;
  label?: string;
}

export interface VerifyModelResult {
  ok: boolean;
  stage: 'bin' | 'model';
  latencyMs: number;
  error?: string;
  preview?: string;
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,，、]+/)
    .map((s) => s.replace(/^@/, '').trim())
    .filter(Boolean);
}

const CLI_OPTIONS = ['claude', 'gemini', 'opencode'] as const;
const PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic / Claude' },
  { value: 'gemini', label: 'Gemini' },
] as const;
type ModelProtocol = (typeof PROTOCOL_OPTIONS)[number]['value'];
const CLIS_FOR_PROTOCOL: Record<ModelProtocol, readonly string[]> = {
  anthropic: ['claude', 'opencode'],
  openai: ['opencode'],
  gemini: ['gemini', 'opencode'],
};

function isKnownCli(bin: string): bin is (typeof CLI_OPTIONS)[number] {
  return (CLI_OPTIONS as readonly string[]).includes(bin);
}

function presetBins(preset: Pick<ModelPresetDto, 'bin' | 'bins'>): string[] {
  if (preset.bins && preset.bins.length > 0) return preset.bins;
  return preset.bin ? [preset.bin] : [];
}

function inferProtocol(preset: Pick<ModelPresetDto, 'bin' | 'bins' | 'protocol'>): ModelProtocol {
  if (preset.protocol === 'anthropic' || preset.protocol === 'openai' || preset.protocol === 'gemini') {
    return preset.protocol;
  }
  const bins = presetBins(preset);
  if (bins.includes('claude')) return 'anthropic';
  if (bins.includes('gemini')) return 'gemini';
  return 'openai';
}

function protocolLabel(protocol: ModelProtocol): string {
  return PROTOCOL_OPTIONS.find((item) => item.value === protocol)?.label ?? protocol;
}

function gatewayPlaceholder(protocol: ModelProtocol): string {
  return protocol === 'openai' ? 'https://api.example.com/v1' : 'https://api.example.com';
}

function slugId(label: string, model: string): string {
  const raw = (label || model)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return raw || `model-${Date.now().toString(36)}`;
}

function uniqueModelId(label: string, model: string, existing: ModelPresetDto[]): string {
  const base = slugId(label, model);
  if (!existing.some((item) => item.id === base)) return base;
  let n = 2;
  while (existing.some((item) => item.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

function draftFrom(agent: AgentConfigDto) {
  return {
    name: agent.name,
    aliases: agent.aliases.join('、'),
    role: agent.role,
    personality: agent.personality ?? '',
    expertise: (agent.expertise ?? []).join('、'),
    bin: agent.bin,
    model: agent.model ?? '',
    modelId: agent.modelId ?? '',
    autoApprove: Boolean(agent.autoApprove),
  };
}

export function TeamHub({
  open,
  config,
  focusAgentId,
  saving,
  onClose,
  onSaveAgent,
  onSaveSettings,
  onSaveModels,
  onVerifyModel,
}: {
  open: boolean;
  config: AppConfigDto;
  focusAgentId?: string;
  saving?: boolean;
  onClose: () => void;
  onSaveAgent: (agentId: string, patch: AgentSavePayload) => void;
  onSaveSettings: (patch: SettingsSavePayload) => void;
  onSaveModels?: (models: ModelPresetDto[]) => void;
  onVerifyModel?: (preset: VerifyModelPayload) => Promise<VerifyModelResult>;
}) {
  const catalog = config.models ?? [];
  const [pane, setPane] = useState<'models' | string>(focusAgentId ?? 'models');
  const selected = config.agents.find((a) => a.id === pane);
  const [draft, setDraft] = useState(() =>
    selected ? draftFrom(selected) : config.agents[0] ? draftFrom(config.agents[0]) : null,
  );
  const [depth, setDepth] = useState(String(config.a2aMaxDepth));
  const [defaultAgentId, setDefaultAgentId] = useState(config.defaultAgentId);
  const [models, setModels] = useState<ModelPresetDto[]>(catalog);
  const [newLabel, setNewLabel] = useState('');
  const [newBins, setNewBins] = useState<string[]>(['opencode']);
  const [newProtocol, setNewProtocol] = useState<ModelProtocol>('openai');
  const [newModel, setNewModel] = useState('');
  const [newBaseUrl, setNewBaseUrl] = useState('');
  const [newApiKey, setNewApiKey] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState('');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [verifyNotes, setVerifyNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const nextPane = focusAgentId ?? 'models';
    setPane(nextPane);
    const agent = config.agents.find((a) => a.id === nextPane) ?? config.agents[0];
    setDraft(agent ? draftFrom(agent) : null);
    setDepth(String(config.a2aMaxDepth));
    setDefaultAgentId(config.defaultAgentId);
    setModels(config.models ?? []);
    setVerifyNotes({});
    setEditingId(null);
    setEditApiKey('');
  }, [open, focusAgentId, config]);

  if (!open) return null;

  const selectedPreset = models.find((m) => m.id === draft?.modelId);

  const patchPreset = (id: string, patch: Partial<ModelPresetDto>) => {
    setModels((list) =>
      list.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        const bins = presetBins(next);
        return { ...next, bin: bins[0] ?? next.bin, bins };
      }),
    );
  };

  const runVerify = async (key: string, payload: VerifyModelPayload) => {
    if (!onVerifyModel) return;
    setVerifyingId(key);
    setVerifyNotes((notes) => ({ ...notes, [key]: '探测中…' }));
    try {
      const result = await onVerifyModel(payload);
      setVerifyNotes((notes) => ({
        ...notes,
        [key]: result.ok
          ? `已连通 (${result.latencyMs}ms)${result.preview ? ` · ${result.preview}` : ''}`
          : `失败: ${result.error ?? result.stage}`,
      }));
    } catch (err) {
      setVerifyNotes((notes) => ({
        ...notes,
        [key]: `失败: ${err instanceof Error ? err.message : '探测出错'}`,
      }));
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div
      data-team-hub
      className="fixed inset-0 z-40 flex items-center justify-center bg-[#2c2a27]/30 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="team-hub-title"
        className="flex max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <aside className="flex w-44 shrink-0 flex-col border-r border-[var(--border)] bg-white/50 p-3">
          <button
            type="button"
            onClick={() => setPane('models')}
            className={`mb-3 rounded-2xl px-2 py-2 text-left text-sm font-bold transition ${
              pane === 'models'
                ? 'bg-white shadow-sm ring-1 ring-[var(--accent)]/25'
                : 'hover:bg-white/70'
            }`}
          >
            模型目录
          </button>
          <div className="mb-2 px-1 text-[11px] font-bold tracking-wide text-[var(--ink-soft)] uppercase">
            成员
          </div>
          {config.agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                setPane(agent.id);
                setDraft(draftFrom(agent));
              }}
              className={`mb-1 flex items-center gap-2 rounded-2xl px-2 py-2 text-left transition ${
                pane === agent.id
                  ? 'bg-white shadow-sm ring-1 ring-[var(--accent)]/25'
                  : 'hover:bg-white/70'
              }`}
            >
              <CatAvatar agentId={agent.id} name={agent.name} size={28} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold">{agent.name}</span>
                <span className="block truncate text-[11px] text-[var(--ink-soft)]">{agent.role}</span>
              </span>
            </button>
          ))}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 id="team-hub-title" className="text-lg font-bold">
                团队 Hub
              </h2>
              <p className="mt-0.5 text-xs text-[var(--ink-soft)]">
                先在模型目录配好,再给每只猫选用。第三方模型在目录里填网关和 API Key。
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-2 py-1 text-sm text-[var(--ink-soft)] hover:bg-black/5"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {pane === 'models' ? (
            <section className="space-y-3">
              <p className="text-xs leading-relaxed text-[var(--ink-soft)]">
                对齐 clowder:先选协议再勾 CLI。第三方模型填网关 URL 和 API Key；官方登录或 opencode zen 可留空。密钥只存在本机，不进 git。
              </p>
              <div className="text-xs font-bold text-[var(--ink-soft)]">已登记</div>
              {models.length === 0 && (
                <p className="text-[11px] text-[var(--ink-soft)]">还没有模型,用下面的表单添加。</p>
              )}
              {models.map((preset) => {
                const protocol = inferProtocol(preset);
                const editing = editingId === preset.id;
                return (
                <div
                  key={preset.id}
                  className="rounded-2xl border border-[var(--border)] bg-white/70 px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold">{preset.label}</div>
                      <div className="truncate font-mono text-[11px] text-[var(--ink-soft)]">
                        {protocolLabel(protocol)} · {presetBins(preset).join(', ')} · {preset.model}
                      </div>
                      {preset.baseUrl && (
                        <div className="truncate font-mono text-[11px] text-[var(--ink-soft)]">{preset.baseUrl}</div>
                      )}
                      {(preset.hasApiKey || preset.apiKey) && (
                        <div className="text-[11px] text-[var(--ink-soft)]">已配置 API Key</div>
                      )}
                      {verifyNotes[preset.id] && (
                        <div
                          className={`mt-1 text-[11px] ${
                            verifyNotes[preset.id]?.startsWith('已连通')
                              ? 'text-[var(--accent-strong)]'
                              : verifyNotes[preset.id] === '探测中…'
                                ? 'text-[var(--ink-soft)]'
                                : 'text-red-700'
                          }`}
                        >
                          {verifyNotes[preset.id]}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(editing ? null : preset.id);
                          setEditApiKey('');
                        }}
                        className="text-xs font-bold text-[var(--ink)] hover:underline"
                      >
                        {editing ? '收起' : `编辑 ${preset.label}`}
                      </button>
                      <button
                        type="button"
                        disabled={verifyingId === preset.id}
                        onClick={() =>
                          void runVerify(preset.id, {
                            ...preset,
                            modelId: preset.id,
                            ...(editApiKey.trim() ? { apiKey: editApiKey.trim() } : {}),
                          })
                        }
                        className="text-xs font-bold text-[var(--accent-strong)] hover:underline disabled:opacity-60"
                      >
                        验证 {preset.label}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setModels((list) => list.filter((m) => m.id !== preset.id));
                          if (editingId === preset.id) setEditingId(null);
                        }}
                        className="text-xs text-[var(--ink-soft)] hover:text-red-700"
                      >
                        删除 {preset.label}
                      </button>
                    </div>
                  </div>
                  {editing && (
                    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-[var(--ink-soft)]">
                          显示名
                          <input
                            aria-label={`编辑 ${preset.id} 显示名`}
                            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
                            value={preset.label}
                            onChange={(e) => patchPreset(preset.id, { label: e.target.value })}
                          />
                        </label>
                        <label className="block text-xs text-[var(--ink-soft)]">
                          协议
                          <select
                            aria-label={`编辑 ${preset.id} 协议`}
                            className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
                            value={protocol}
                            onChange={(e) => {
                              const nextProtocol = e.target.value as ModelProtocol;
                              const allowed = CLIS_FOR_PROTOCOL[nextProtocol];
                              const bins = presetBins(preset).filter((bin) =>
                                (allowed as readonly string[]).includes(bin),
                              );
                              patchPreset(preset.id, {
                                protocol: nextProtocol,
                                bins: bins.length > 0 ? bins : [allowed[0]!],
                              });
                            }}
                          >
                            {PROTOCOL_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <label className="block text-xs text-[var(--ink-soft)]">
                        模型 ID
                        <input
                          aria-label={`编辑 ${preset.id} 模型 ID`}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-sm text-[var(--ink)]"
                          value={preset.model}
                          onChange={(e) => patchPreset(preset.id, { model: e.target.value })}
                        />
                      </label>
                      <label className="block text-xs text-[var(--ink-soft)]">
                        网关 URL
                        <input
                          aria-label={`编辑 ${preset.id} 网关 URL`}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-sm text-[var(--ink)]"
                          value={preset.baseUrl ?? ''}
                          onChange={(e) =>
                            patchPreset(preset.id, { baseUrl: e.target.value.trim() || undefined })
                          }
                          placeholder={gatewayPlaceholder(protocol)}
                        />
                      </label>
                      <label className="block text-xs text-[var(--ink-soft)]">
                        API Key
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={`编辑 ${preset.id} API Key`}
                          className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-sm text-[var(--ink)]"
                          value={editApiKey}
                          onChange={(e) => setEditApiKey(e.target.value)}
                          placeholder={preset.hasApiKey || preset.apiKey ? '已配置,留空不改' : 'sk-...'}
                        />
                      </label>
                      <fieldset className="text-xs text-[var(--ink-soft)]">
                        <legend className="mb-1">可用 CLI</legend>
                        <div className="flex flex-wrap gap-3">
                          {CLI_OPTIONS.map((bin) => {
                            const compatible = (CLIS_FOR_PROTOCOL[protocol] as readonly string[]).includes(bin);
                            return (
                              <label
                                key={bin}
                                className={`flex items-center gap-1.5 text-sm ${compatible ? 'text-[var(--ink)]' : 'text-[var(--ink-soft)]'}`}
                              >
                                <input
                                  type="checkbox"
                                  aria-label={`${preset.label} CLI ${bin}`}
                                  checked={presetBins(preset).includes(bin)}
                                  disabled={!compatible}
                                  onChange={() => {
                                    if (!compatible) return;
                                    const current = presetBins(preset);
                                    const bins = current.includes(bin)
                                      ? current.filter((item) => item !== bin)
                                      : [...current, bin];
                                    if (bins.length === 0) return;
                                    patchPreset(preset.id, { bins });
                                  }}
                                />
                                {bin}
                              </label>
                            );
                          })}
                        </div>
                      </fieldset>
                      <button
                        type="button"
                        onClick={() => {
                          if (editApiKey.trim()) patchPreset(preset.id, { apiKey: editApiKey.trim() });
                          setEditingId(null);
                          setEditApiKey('');
                        }}
                        className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold ring-1 ring-[var(--border)]"
                      >
                        完成编辑
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-white/40 p-3 space-y-3">
                <div className="text-xs font-bold text-[var(--ink)]">添加新模型</div>
                <p className="text-[11px] text-[var(--ink-soft)]">
                  这是新增,不会改上面已登记的条目。
                </p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-[var(--ink-soft)]">
                  显示名
                  <input
                    className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="例如 Kimi K2"
                  />
                </label>
                <label className="block text-xs text-[var(--ink-soft)]">
                  协议
                  <select
                    className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
                    value={newProtocol}
                    onChange={(e) => {
                      const protocol = e.target.value as ModelProtocol;
                      const allowed = CLIS_FOR_PROTOCOL[protocol];
                      setNewProtocol(protocol);
                      setNewBins((list) => {
                        const next = list.filter((bin) => (allowed as readonly string[]).includes(bin));
                        return next.length > 0 ? next : [allowed[0]!];
                      });
                    }}
                  >
                    {PROTOCOL_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-[var(--ink-soft)]">
                模型 ID
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-sm text-[var(--ink)]"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="例如 provider/model-id"
                />
              </label>
              <label className="block text-xs text-[var(--ink-soft)]">
                网关 URL
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-sm text-[var(--ink)]"
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  placeholder={gatewayPlaceholder(newProtocol)}
                />
              </label>
              <label className="block text-xs text-[var(--ink-soft)]">
                API Key
                <input
                  type="password"
                  autoComplete="off"
                  className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 font-mono text-sm text-[var(--ink)]"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </label>
              <p className="text-[11px] leading-relaxed text-[var(--ink-soft)]">
                第三方必填 URL 和 Key。Anthropic 不要带 /v1，OpenAI 兼容要带 /v1。官方 CLI 登录可留空。
              </p>
              <fieldset className="text-xs text-[var(--ink-soft)]">
                <legend className="mb-1">可用 CLI</legend>
                <div className="flex flex-wrap gap-3">
                  {CLI_OPTIONS.map((bin) => {
                    const compatible = (CLIS_FOR_PROTOCOL[newProtocol] as readonly string[]).includes(bin);
                    return (
                      <label
                        key={bin}
                        className={`flex items-center gap-1.5 text-sm ${compatible ? 'text-[var(--ink)]' : 'text-[var(--ink-soft)]'}`}
                      >
                        <input
                          type="checkbox"
                          checked={newBins.includes(bin)}
                          disabled={!compatible}
                          onChange={() => {
                            if (!compatible) return;
                            setNewBins((list) =>
                              list.includes(bin) ? list.filter((item) => item !== bin) : [...list, bin],
                            );
                          }}
                        />
                        {bin}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              {verifyNotes.draft && (
                <div
                  className={`text-[11px] ${
                    verifyNotes.draft.startsWith('已连通')
                      ? 'text-[var(--accent-strong)]'
                      : verifyNotes.draft === '探测中…'
                        ? 'text-[var(--ink-soft)]'
                        : 'text-red-700'
                  }`}
                >
                  {verifyNotes.draft}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={verifyingId === 'draft'}
                  onClick={() =>
                    void runVerify('draft', {
                      bin: newBins[0] ?? '',
                      model: newModel.trim(),
                      protocol: newProtocol,
                      ...(newBaseUrl.trim() ? { baseUrl: newBaseUrl.trim() } : {}),
                      ...(newApiKey.trim() ? { apiKey: newApiKey.trim() } : {}),
                      label: newLabel.trim() || newModel.trim(),
                    })
                  }
                  className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold ring-1 ring-[var(--border)] disabled:opacity-60"
                >
                  验证新模型
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const model = newModel.trim();
                    if (!model || newBins.length === 0) return;
                    const label = newLabel.trim() || model;
                    const baseUrl = newBaseUrl.trim();
                    const apiKey = newApiKey.trim();
                    setModels((list) => [
                      ...list,
                      {
                        id: uniqueModelId(label, model, list),
                        label,
                        bin: newBins[0]!,
                        bins: [...newBins],
                        protocol: newProtocol,
                        model,
                        ...(baseUrl ? { baseUrl } : {}),
                        ...(apiKey ? { apiKey } : {}),
                      },
                    ]);
                    setNewLabel('');
                    setNewModel('');
                    setNewBaseUrl('');
                    setNewApiKey('');
                  }}
                  className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold ring-1 ring-[var(--border)]"
                >
                  加入目录
                </button>
              </div>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  const outgoing =
                    editingId && editApiKey.trim()
                      ? models.map((item) =>
                          item.id === editingId ? { ...item, apiKey: editApiKey.trim() } : item,
                        )
                      : models;
                  onSaveModels?.(outgoing);
                }}
                className="rounded-xl bg-[var(--accent)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
              >
                保存模型目录
              </button>
            </section>
          ) : (
            draft &&
            selected && (
              <>
                <section className="mb-5 rounded-2xl border border-[var(--border)] bg-white/70 p-3">
                  <div className="mb-2 text-xs font-bold text-[var(--ink-soft)]">协作设置</div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-[var(--ink-soft)]">
                      默认接话猫
                      <select
                        className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
                        value={defaultAgentId}
                        onChange={(e) => setDefaultAgentId(e.target.value)}
                      >
                        {config.agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs text-[var(--ink-soft)]">
                      A2A 链深
                      <input
                        type="number"
                        min={1}
                        max={10}
                        className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-2 py-1.5 text-sm text-[var(--ink)]"
                        value={depth}
                        onChange={(e) => setDepth(e.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      onSaveSettings({
                        a2aMaxDepth: Number(depth),
                        defaultAgentId,
                      })
                    }
                    className="mt-3 rounded-xl bg-white px-3 py-1.5 text-xs font-bold ring-1 ring-[var(--border)] transition hover:bg-[var(--surface)] disabled:opacity-60"
                  >
                    保存协作设置
                  </button>
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-3">
                    <CatAvatar agentId={selected.id} name={draft.name} size={44} />
                    <div>
                      <div className="text-sm font-bold">{draft.name}</div>
                      <div className="text-xs text-[var(--ink-soft)]">@{selected.id}</div>
                    </div>
                  </div>
                  <label className="block text-xs text-[var(--ink-soft)]">
                    名字
                    <input
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-[var(--ink-soft)]">
                    别名
                    <input
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                      value={draft.aliases}
                      onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
                      placeholder="墨墨、claude"
                    />
                  </label>
                  <label className="block text-xs text-[var(--ink-soft)]">
                    角色
                    <input
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                      value={draft.role}
                      onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-[var(--ink-soft)]">
                    性格
                    <textarea
                      rows={2}
                      className="mt-1 w-full resize-none rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                      value={draft.personality}
                      onChange={(e) => setDraft({ ...draft, personality: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-[var(--ink-soft)]">
                    擅长
                    <input
                      className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                      value={draft.expertise}
                      onChange={(e) => setDraft({ ...draft, expertise: e.target.value })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block text-xs text-[var(--ink-soft)]">
                      CLI
                      <select
                        className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                        value={draft.bin}
                        onChange={(e) => {
                          const bin = e.target.value;
                          const stillValid = models.find(
                            (m) => m.id === draft.modelId && presetBins(m).includes(bin),
                          );
                          setDraft({
                            ...draft,
                            bin,
                            modelId: stillValid ? draft.modelId : '',
                            model: stillValid ? draft.model : '',
                          });
                        }}
                      >
                        {!isKnownCli(draft.bin) && (
                          <option value={draft.bin}>{draft.bin}</option>
                        )}
                        {CLI_OPTIONS.map((bin) => (
                          <option key={bin} value={bin}>
                            {bin}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-xs text-[var(--ink-soft)]">
                      选用模型
                      <select
                        className="mt-1 w-full rounded-xl border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                        value={draft.modelId}
                        onChange={(e) => {
                          const modelId = e.target.value;
                          const preset = models.find((m) => m.id === modelId);
                          const bins = preset ? presetBins(preset) : [];
                          setDraft({
                            ...draft,
                            modelId,
                            bin:
                              preset && bins.includes(draft.bin)
                                ? draft.bin
                                : (bins[0] ?? draft.bin),
                            model: preset?.model ?? '',
                          });
                        }}
                      >
                        <option value="">使用 CLI 默认</option>
                        {models
                          .filter((preset) => presetBins(preset).includes(draft.bin))
                          .map((preset) => (
                            <option key={preset.id} value={preset.id}>
                              {preset.label}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  {models.filter((preset) => presetBins(preset).includes(draft.bin)).length === 0 && (
                    <p className="text-[11px] text-[var(--ink-soft)]">
                      这条 CLI 还没有模型,去左侧「模型目录」勾上对应 CLI 后再选。
                    </p>
                  )}
                  {selectedPreset && (
                    <p className="text-xs text-[var(--ink-soft)]">
                      {protocolLabel(inferProtocol(selectedPreset))} · {presetBins(selectedPreset).join(', ')} ·{' '}
                      {selectedPreset.model}
                      {selectedPreset.baseUrl ? ` · ${selectedPreset.baseUrl}` : ''}
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.autoApprove}
                      onChange={(e) => setDraft({ ...draft, autoApprove: e.target.checked })}
                    />
                    自动批准这只猫的 diff
                  </label>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      onSaveAgent(selected.id, {
                        name: draft.name,
                        aliases: splitList(draft.aliases),
                        role: draft.role,
                        personality: draft.personality,
                        expertise: splitList(draft.expertise),
                        bin: draft.bin,
                        model: draft.model.trim(),
                        modelId: draft.modelId,
                        autoApprove: draft.autoApprove,
                      })
                    }
                    className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-60"
                  >
                    保存这只猫
                  </button>
                </section>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
