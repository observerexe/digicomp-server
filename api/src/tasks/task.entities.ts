import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Extra } from '../records/extra-values';
import { User } from '../users/user.entity';

/**
 * Task board: todo (free: people take it while there are slots) ->
 * in_progress (an assignee pressed «Почати») -> review -> done. Review may
 * return to in_progress.
 */
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

  @Column({ name: 'max_assignees', type: 'int', default: 1 })
  maxAssignees: number;

  @Column({ name: 'due_date', type: 'timestamp', nullable: true })
  dueDate: Date | null;

  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  /** Extra fields (records/record-field-defs): key → value. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  extra: Extra;

  @OneToMany(() => TaskAssignee, (a) => a.task)
  assignees: TaskAssignee[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** When the task was last sent for review. */
  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  /** Set when the task is accepted (review -> done): that is when it was completed. */
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  /** Who accepted the task; null — not accepted yet, or the user is gone. */
  @Column({ name: 'accepted_by_id', type: 'uuid', nullable: true })
  acceptedById: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'accepted_by_id' })
  acceptedBy?: User | null;
}

@Entity('task_assignees')
export class TaskAssignee {
  @PrimaryColumn({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, (t) => t.assignees, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Index()
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Order of taking: the remainder of a points split goes to the earliest. */
  @CreateDateColumn({ name: 'taken_at', type: 'timestamptz' })
  takenAt: Date;
}

export enum TaskCommentKind {
  Comment = 'comment',
  /** Written by a moderator when returning the task from review. */
  Return = 'return',
}

@Entity('task_comments')
export class TaskComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'author_id', type: 'uuid' })
  authorId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({
    type: 'enum',
    enum: TaskCommentKind,
    default: TaskCommentKind.Comment,
  })
  kind: TaskCommentKind;

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('task_files')
export class TaskFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'task_id', type: 'uuid' })
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Task;

  @Column({ name: 'file_name', type: 'varchar', length: 200 })
  fileName: string;

  @Column({ name: 'mime_type', type: 'varchar', length: 100 })
  mimeType: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ type: 'varchar', length: 64 })
  sha256: string;

  @Column({ name: 'stored_name', type: 'varchar', length: 100 })
  storedName: string;

  @Column({ name: 'uploaded_by_id', type: 'uuid' })
  uploadedById: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
