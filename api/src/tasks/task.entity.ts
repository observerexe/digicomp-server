import {
  Column,
  CreateDateColumn,
  Entity,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

export enum TaskStatus {
  Todo = 'todo',
  InProgress = 'in_progress',
  Review = 'review',
  Done = 'done',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'enum', enum: TaskStatus, default: TaskStatus.Todo })
  status: TaskStatus;

  @Column({ type: 'int', default: 0 })
  points: number;

  @Column({ name: 'due_date', type: 'timestamp', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ManyToMany(() => User)
  @JoinTable({ name: 'task_assignees' })
  assignees: User[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;
}
