import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../auth/policy';
import { AgentAction, AgentClient } from './agent.client';

export type AgentJob = {
  id: string;
  action: AgentAction;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  output: string[];
};

@Injectable()
export class AdminPanelService {
  constructor(
    private agent: AgentClient,
    private audit: AuditService,
  ) {}

  /** Metrics, containers and the last backup in one call. */
  async overview() {
    const [metrics, containers, lastBackup] = await Promise.all([
      this.agent.get<Record<string, unknown>>('/v1/metrics'),
      this.agent.get<{ items: unknown[] }>('/v1/containers'),
      this.agent.get<Record<string, unknown>>('/v1/last-backup'),
    ]);
    return { metrics, containers: containers.items, lastBackup };
  }

  logs(lines: number) {
    return this.agent.get<{ lines: string[] }>(`/v1/logs?lines=${lines}`);
  }

  async run(action: AgentAction, actor: Actor) {
    const job = await this.agent.post<AgentJob>('/v1/jobs', { action });
    // Logged before a restart can take the API down.
    await this.audit.log({
      actorId: actor.id,
      action: 'panel.action',
      entity: 'server',
      entityId: job.id,
      meta: { action },
    });
    return job;
  }

  job(id: string) {
    return this.agent.get<AgentJob>(`/v1/jobs/${encodeURIComponent(id)}`);
  }
}
