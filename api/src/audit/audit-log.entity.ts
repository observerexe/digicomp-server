import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_log')
@Index('IDX_audit_log_created_id', ['createdAt', 'id'])
@Index('IDX_audit_log_actor_created', ['actorId', 'createdAt', 'id'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column()
  action: string;

  @Column()
  entity: string;

  @Column({ name: 'entity_id', type: 'varchar', nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
