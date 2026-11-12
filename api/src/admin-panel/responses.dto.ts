// Response shapes of the extended panel (the agent produces them, see
// ops/agent/digicomp_agent.py); the service is typed with these classes.
import { ApiProperty } from '@nestjs/swagger';
import { AGENT_ACTIONS, type AgentAction } from './agent.client';

export class MemoryDto {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
}

export class DiskDto {
  path: string;
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
}

export class MetricsDto {
  /** Busy share over a short sample, 0–100. */
  cpuPercent: number;

  @ApiProperty({ type: Number, nullable: true })
  cpuCount: number | null;

  /** 1, 5 and 15 minute load average. */
  @ApiProperty({ type: [Number] })
  load: number[];

  memory: MemoryDto;

  @ApiProperty({ type: [DiskDto] })
  disks: DiskDto[];

  uptimeSeconds: number;
  collectedAt: string;
}

export class ContainerDto {
  /** api, db (compose service names) or homeassistant. */
  name: string;

  /** running, exited, restarting, … or missing. */
  state: string;

  /** healthy, unhealthy, starting or null (no healthcheck). */
  @ApiProperty({ type: String, nullable: true })
  health: string | null;

  status: string;
}

export class LastBackupDto {
  found: boolean;
  count: number;
  file?: string;
  sizeBytes?: number;
  at?: string;
}

export class PanelOverviewDto {
  metrics: MetricsDto;

  @ApiProperty({ type: [ContainerDto] })
  containers: ContainerDto[];

  lastBackup: LastBackupDto;
}

export class PanelLogsDto {
  @ApiProperty({ type: [String] })
  lines: string[];

  /** false when docker compose logs failed (lines then hold its error). */
  ok: boolean;
}

export class PanelJobDto {
  id: string;

  @ApiProperty({ enum: AGENT_ACTIONS, enumName: 'PanelAction' })
  action: AgentAction;

  @ApiProperty({
    enum: ['running', 'succeeded', 'failed'],
    enumName: 'PanelJobStatus',
  })
  status: 'running' | 'succeeded' | 'failed';

  startedAt: string;

  @ApiProperty({ type: String, nullable: true })
  finishedAt: string | null;

  @ApiProperty({ type: Number, nullable: true })
  exitCode: number | null;

  @ApiProperty({ type: [String] })
  output: string[];
}
