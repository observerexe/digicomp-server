import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('points_ledger')
@Unique(['userId', 'taskId'])
export class PointsEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'int' })
  amount: number;

  @Column()
  reason: string;

  @Column({ name: 'task_id', type: 'uuid', nullable: true })
  taskId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
