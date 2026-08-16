import type { AgentId } from '@meowbase/shared';
import type { AgentRegistry, AgentService } from './types.js';

export function createAgentRegistry(services: AgentService[]): AgentRegistry {
  const byId = new Map<AgentId, AgentService>(services.map((s) => [s.agentId, s]));
  return {
    get: (agentId) => byId.get(agentId),
    list: () => [...byId.keys()],
    register: (service) => {
      byId.set(service.agentId, service);
    },
  };
}
