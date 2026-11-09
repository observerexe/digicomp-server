import { IsIn, IsNumberString, IsOptional, MaxLength } from 'class-validator';

export class LogsQuery {
  /** Number of last lines, 1–500 (default 200). */
  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  lines?: string;
}

export class RestartDto {
  /** Only the API and Home Assistant; the database is never restarted here. */
  @IsIn(['api', 'ha'])
  target: 'api' | 'ha';
}
