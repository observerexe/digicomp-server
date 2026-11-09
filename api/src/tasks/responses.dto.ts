import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { TaskCommentKind, TaskStatus } from './task.entities';

export class TaskAssigneeDto extends UserRefDto {
  /** Order of taking decides who gets the remainder of a points split. */
  takenAt: Date;
}

export class TaskDto {
  id: string;
  title: string;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: TaskStatus, enumName: 'TaskStatus' })
  status: TaskStatus;

  points: number;
  maxAssignees: number;

  @ApiProperty({ type: Date, nullable: true })
  dueDate: Date | null;

  createdById: string;
  createdAt: Date;
  updatedAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  completedAt: Date | null;

  /** In the order of taking. */
  @ApiProperty({ type: [TaskAssigneeDto] })
  assignees: TaskAssigneeDto[];
}

export class TaskCommentDto {
  id: string;

  /** `return` — written by a moderator when sending the task back. */
  @ApiProperty({ enum: TaskCommentKind, enumName: 'TaskCommentKind' })
  kind: TaskCommentKind;

  body: string;
  author: UserRefDto;
  createdAt: Date;
}

export class TaskFileDto {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedById: string;
  createdAt: Date;
}

export class TaskDetailDto extends TaskDto {
  /** Oldest first. */
  @ApiProperty({ type: [TaskCommentDto] })
  comments: TaskCommentDto[];

  /** GET /tasks/:id/files/:fileId/download */
  @ApiProperty({ type: [TaskFileDto] })
  files: TaskFileDto[];
}
