import { ApiProperty } from '@nestjs/swagger';

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

  action: string;
  entity: string;

  @ApiProperty({ type: String, nullable: true })
  entityId: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  meta: Record<string, unknown> | null;

  createdAt: Date;
}
