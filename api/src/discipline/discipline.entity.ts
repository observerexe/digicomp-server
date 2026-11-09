import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DisciplineType {
  Warning = 'warning',
  Fine = 'fine',
  Reprimand = 'reprimand',
}

@Entity('discipline_records')
@Check(
  `("type" = 'fine' AND "amount" IS NOT NULL AND "amount" > 0) OR ("type" <> 'fine' AND "amount" IS NULL)`,
)
export class DisciplineRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: DisciplineType })
  type: DisciplineType;

  @Column({ type: 'text' })
  reason: string;

  /** Fine size in points (positive); null for warnings and reprimands. */
  @Column({ type: 'int', nullable: true })
  amount: number | null;

  @Column({ name: 'issued_by_id', type: 'uuid' })
  issuedById: string;

  @Column({ name: 'ledger_entry_id', type: 'uuid', nullable: true })
  ledgerEntryId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'revoked_by_id', type: 'uuid', nullable: true })
  revokedById: string | null;

  @Column({ name: 'revoke_reason', type: 'text', nullable: true })
  revokeReason: string | null;
}
