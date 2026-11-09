import { ApiProperty } from '@nestjs/swagger';
import { PointsKind } from './points-entry.entity';

export class PointsCreatorDto {
  id: string;

  @ApiProperty({ type: String, nullable: true })
  name: string | null;
}

export class PointsHistoryEntryDto {
  id: string;

  @ApiProperty({ enum: PointsKind, enumName: 'PointsKind' })
  kind: PointsKind;

  /** Negative for fines and reversals. */
  amount: number;

  reason: string;

  @ApiProperty({ type: String, nullable: true })
  taskId: string | null;

  @ApiProperty({ type: String, nullable: true })
  taskTitle: string | null;

  /** The entry this one cancels (kind = reversal). */
  @ApiProperty({ type: String, nullable: true })
  reversesId: string | null;

  /** null for task points (awarded by the system on acceptance). */
  @ApiProperty({ type: PointsCreatorDto, nullable: true })
  createdBy: PointsCreatorDto | null;

  /** A reversal entry exists for this one. */
  revoked: boolean;

  createdAt: Date;
}

export class PointsHistoryDto {
  balance: number;

  /** Last 100 entries, newest first. */
  @ApiProperty({ type: [PointsHistoryEntryDto] })
  history: PointsHistoryEntryDto[];
}

export class LeaderboardRowDto {
  id: string;
  name: string;

  @ApiProperty({ type: String, nullable: true })
  avatarUrl: string | null;

  position: string;
  total: number;

  /** Equal totals share a rank. */
  rank: number;
}

/** A new ledger entry (award or its reversal). */
export class PointsEntryDto {
  id: string;
  userId: string;
  amount: number;

  @ApiProperty({ enum: PointsKind, enumName: 'PointsKind' })
  kind: PointsKind;

  reason: string;

  @ApiProperty({ type: String, nullable: true })
  taskId: string | null;

  @ApiProperty({ type: String, nullable: true })
  createdById: string | null;

  @ApiProperty({ type: String, nullable: true })
  reversesId: string | null;

  createdAt: Date;
}
