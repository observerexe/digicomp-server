import { ApiProperty } from '@nestjs/swagger';
import { UserRefDto } from '../common/responses.dto';
import { DisciplineType } from './discipline.entity';

export class DisciplineRecordDto {
  id: string;

  @ApiProperty({ enum: DisciplineType, enumName: 'DisciplineType' })
  type: DisciplineType;

  reason: string;

  /** Fine size in points; null for warnings and reprimands. */
  @ApiProperty({ type: Number, nullable: true })
  amount: number | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  user: UserRefDto | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  issuedBy: UserRefDto | null;

  createdAt: Date;
  revoked: boolean;

  @ApiProperty({ type: Date, nullable: true })
  revokedAt: Date | null;

  @ApiProperty({ type: UserRefDto, nullable: true })
  revokedBy: UserRefDto | null;

  @ApiProperty({ type: String, nullable: true })
  revokeReason: string | null;
}

export class DisciplineListDto {
  @ApiProperty({ type: [DisciplineRecordDto] })
  items: DisciplineRecordDto[];

  total: number;
  page: number;
  limit: number;
}
