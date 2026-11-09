import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { TaskStatus } from './task.entities';

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
