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
