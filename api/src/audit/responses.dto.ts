import { ApiProperty } from '@nestjs/swagger';
import { AUDIT_ACTIONS, type AuditAction } from './actions';

export class AuditActorDto {
  id: string;
  name: string;
}

export class AuditEntryDto {
  id: string;

  /** null — the server itself (auto-close of sessions and the like). */
  @ApiProperty({ type: String, nullable: true })
  actorId: string | null;

  @ApiProperty({ type: AuditActorDto, nullable: true })
  actor: AuditActorDto | null;

  @ApiProperty({ enum: AUDIT_ACTIONS, enumName: 'AuditAction' })
  action: AuditAction;

  entity: string;

  @ApiProperty({ type: String, nullable: true })
  entityId: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  meta: Record<string, unknown> | null;

  createdAt: Date;
}
