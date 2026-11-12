import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { Actor } from '../auth/policy';
import { AgentAction, AgentClient } from './agent.client';
import type {
  ContainerDto,
  LastBackupDto,
  MetricsDto,
  PanelJobDto,
  PanelLogsDto,
  PanelOverviewDto,
} from './responses.dto';

@Injectable()
export class AdminPanelService {
  constructor(
    private agent: AgentClient,
    private audit: AuditService,
  ) {}

  /** Metrics, containers and the last backup in one call. */
  async overview(): Promise<PanelOverviewDto> {
    const [metrics, containers, lastBackup] = await Promise.all([
      this.agent.get<MetricsDto>('/v1/metrics'),
      this.agent.get<{ items: ContainerDto[] }>('/v1/containers'),
      this.agent.get<LastBackupDto>('/v1/last-backup'),
    ]);
    return { metrics, containers: containers.items, lastBackup };
  }

  logs(lines: number): Promise<PanelLogsDto> {
    return this.agent.get<PanelLogsDto>(`/v1/logs?lines=${lines}`);
  }

  async run(action: AgentAction, actor: Actor): Promise<PanelJobDto> {
    const job = await this.agent.post<PanelJobDto>('/v1/jobs', { action });
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

  job(id: string): Promise<PanelJobDto> {
    return this.agent.get<PanelJobDto>(`/v1/jobs/${encodeURIComponent(id)}`);
  }
}
