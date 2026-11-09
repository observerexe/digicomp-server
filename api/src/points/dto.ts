import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Rejects blank strings (only spaces). */
export const NOT_BLANK = /\S/;

/** Manual award for household chores and similar. */
export class AwardPointsDto {
  @IsUUID()
  userId: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  amount: number;

  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(500)
  reason: string;
}

/** Revoking a record always needs a reason. */
export class RevokeDto {
  @IsString()
  @Matches(NOT_BLANK)
  @MaxLength(500)
  reason: string;
}

export class LeaderboardQuery {
  /** `month` — current calendar month (Europe/Kyiv), `all` — all time. */
  @IsOptional()
  @IsIn(['month', 'all'])
  period?: 'month' | 'all';
}
