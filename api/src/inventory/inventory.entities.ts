import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

const numeric = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

@Entity('inventory_items')
@Check('"quantity" >= 0')
@Check('"min_quantity" >= 0')
export class InventoryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'varchar', length: 100 })
  category: string;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numeric,
  })
  quantity: number;

  @Column({ type: 'varchar', length: 20, default: 'шт' })
  unit: string;

  @Column({
    name: 'min_quantity',
    type: 'numeric',
    precision: 12,
    scale: 3,
    default: 0,
    transformer: numeric,
  })
  minQuantity: number;

  @Column({ type: 'varchar', length: 200, default: '' })
  location: string;

  @Column({ type: 'text', default: '' })
  notes: string;

  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

@Entity('inventory_movements')
@Check('"delta" <> 0')
@Index(['itemId', 'createdAt'])
@Index('inventory_movement_idempotency', ['actorId', 'idempotencyKey'], {
  unique: true,
  where: '"idempotency_key" IS NOT NULL',
})
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ManyToOne(() => InventoryItem, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'item_id' })
  item: InventoryItem;

  @Column({
    type: 'numeric',
    precision: 12,
    scale: 3,
    transformer: numeric,
  })
  delta: number;

  @Column({
    name: 'quantity_after',
    type: 'numeric',
    precision: 12,
    scale: 3,
    transformer: numeric,
  })
  quantityAfter: number;

  @Column({ type: 'varchar', length: 500 })
  note: string;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_id' })
  actor: User;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  idempotencyKey: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
