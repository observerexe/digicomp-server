import {
  IsNumberString,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class ListAuditQuery {
  /** Exact action (`user.updated`) or a group with a dot (`user.`). */
  @IsOptional()
  @Matches(/^[a-z0-9_.]{1,60}$/)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @Matches(/^[a-z_]{1,40}$/)
  entity?: string;

  /** Id of the last entry already shown: the next page starts after it. */
  @IsOptional()
  @IsUUID()
  before?: string;

  @IsOptional()
  @IsNumberString({ no_symbols: true })
  @MaxLength(3)
  limit?: string;
}
