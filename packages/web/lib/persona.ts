export type PersonaId = 'claude' | 'gemini' | 'opencode' | 'user';

export interface Persona {
  name: string;
  badge: string; // 徽章底色
  surface: string; // 气泡 surface
}

export const PERSONAS: Record<PersonaId, Persona> = {
  claude: {
    name: '墨墨',
    badge: 'var(--cat-claude-badge)',
    surface: 'var(--cat-claude-surface)',
  },
  gemini: {
    name: '闪闪',
    badge: 'var(--cat-gemini-badge)',
    surface: 'var(--cat-gemini-surface)',
  },
  opencode: {
    name: '团团',
    badge: 'var(--cat-opencode-badge)',
    surface: 'var(--cat-opencode-surface)',
  },
  user: {
    name: '你',
    badge: 'var(--cat-user-badge)',
    surface: 'var(--cat-user-surface)',
  },
};

export const AGENT_ORDER = ['claude', 'gemini', 'opencode'] as const;

export function getPersona(agentId: string | undefined): Persona {
  if (agentId && agentId in PERSONAS) return PERSONAS[agentId as PersonaId];
  return PERSONAS.user;
}
