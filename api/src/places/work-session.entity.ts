import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { Place } from './place.entity';

@Entity('work_sessions')
@Index('one_active_session_per_user', ['userId'], {
  unique: true,
  where: '"ended_at" IS NULL',
})
@Index('work_session_idempotency', ['userId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
@Index(['placeId', 'startedAt'])
export class WorkSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'place_id', type: 'uuid' })
  placeId: string;

  @ManyToOne(() => Place, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'place_id' })
  place: Place;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'ended_by_id', type: 'uuid', nullable: true })
  endedById: string | null;

  @Column({ name: 'safety_confirmed', type: 'boolean' })
  safetyConfirmed: boolean;

  @Column({ type: 'varchar', length: 1000, default: '' })
  note: string;

  @Column({
    name: 'equipment_state',
    type: 'varchar',
    length: 200,
    default: '',
  })
  equipmentState: string;

  @Column({ name: 'end_reason', type: 'varchar', length: 500, default: '' })
  endReason: string;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  idempotencyKey: string | null;
}
