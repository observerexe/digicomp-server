import { ApiProperty } from '@nestjs/swagger';
import { ProjectStage } from './project.entities';

export class ProjectMemberDto {
  id: string;
  name: string;
  position: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;
}

export class ProjectDto {
  id: string;
  title: string;
  description: string;

  @ApiProperty({ enum: ProjectStage, enumName: 'ProjectStage' })
  stage: ProjectStage;

  /** YYYY-MM-DD */
  @ApiProperty({ type: String, format: 'date', nullable: true })
  startDate: string | null;

  /** YYYY-MM-DD */
  @ApiProperty({ type: String, format: 'date', nullable: true })
  deadline: string | null;

  /** 0–100 */
  progress: number;

  accomplishments: string;

  @ApiProperty({ type: [String] })
  sources: string[];

  @ApiProperty({ type: String, nullable: true })
  createdById: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export class ProjectListItemDto extends ProjectDto {
  @ApiProperty({ type: [ProjectMemberDto] })
  members: ProjectMemberDto[];
}

export class ProjectListDto {
  @ApiProperty({ type: [ProjectListItemDto] })
  items: ProjectListItemDto[];

  total: number;
  page: number;
  limit: number;
}

export class ProjectFileDto {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: Date;
}

export class ProjectDetailDto extends ProjectListItemDto {
  /** Newest first; GET /projects/:id/files/:fileId/download */
  @ApiProperty({ type: [ProjectFileDto] })
  files: ProjectFileDto[];

  /** The caller may change this project (staff or a member of it). */
  canEdit: boolean;
}

export class HistoryActorDto {
  id: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;
}

/** One audit record of the project (project.created, project.updated…). */
export class ProjectHistoryDto {
  id: string;
  action: string;

  @ApiProperty({ type: HistoryActorDto, nullable: true })
  actor: HistoryActorDto | null;

  /** Changed fields and values, as written to the audit log. */
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  meta: Record<string, unknown> | null;

  createdAt: Date;
}
