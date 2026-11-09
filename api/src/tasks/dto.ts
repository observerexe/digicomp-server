import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { NOT_BLANK } from '../points/dto';
import { TaskStatus } from './task.entities';

export class CreateTaskDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsInt()
  @Min(0)
  @Max(1000)
  points: number;

  /** How many members may take the task. Default 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAssignees?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  points?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAssignees?: number;

  /** ISO date or null to clear the deadline. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsDateString()
  dueDate?: string | null;
}

export class ListTasksQuery {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  /** Only tasks where the current user is an assignee. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: string;
}

export class CommentDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(2000)
  body: string;
}
