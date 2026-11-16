import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumberString,
  IsObject,
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

  /** Extra fields: key → value (GET /records/task/field-defs). */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
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

  /** Only the keys given change; null clears a field. */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  extra?: Record<string, unknown>;
}

export class ListTasksQuery {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  /** Only tasks where the current user is an assignee. */
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: string;

  /** At most this many tasks (1–500). Done tasks come newest-completed first. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}

export class ListArchiveQuery {
  /** Part of the title. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  /** Year of acceptance. */
  @IsOptional()
  @Matches(/^\d{4}$/)
  year?: string;

  /**
   * `key:item` of a choice field (enum or list<enum>), e.g. `type:dyzain`;
   * may repeat — all must match (the first 10).
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Matches(/^[a-z0-9_]{1,60}:[a-z0-9_]{1,60}$/, { each: true })
  field?: string | string[];

  /** From 1. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(5)
  page?: string;

  /** 1–100, default 30. */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}

export class CommentDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(2000)
  body: string;
}

export class TakeTaskDto {
  /** Take the last free slot and start at once («взяти й почати»). */
  @IsOptional()
  @IsBoolean()
  start?: boolean;
}

export class CancelTaskDto {
  /** Why: kept in the audit. */
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(1000)
  reason: string;
}
