import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan, can } from '../auth/policy';
import {
  DOCUMENT_EXTENSIONS,
  UploadedFileLike,
  validateUpload,
} from '../files/file-validation';
import { StorageService } from '../files/storage.service';
import { PointsEntry, PointsKind } from '../points/points-entry.entity';
import { PaperworkService } from '../paperwork/paperwork.service';
import { RecordFieldsService } from '../records/record-fields.service';
import { User } from '../users/user.entity';
import {
  CancelTaskDto,
  CommentDto,
  CreateTaskDto,
  ListTasksQuery,
  UpdateTaskDto,
} from './dto';
import { removeLinksOf } from '../links/links.sql';
import {
  paperOfRecords,
  papersOf,
  type RecordPaper,
} from '../paperwork/paper-targets';
import { splitPoints } from './split-points';
import {
  Task,
  TaskAssignee,
  TaskComment,
  TaskCommentKind,
  TaskFile,
  TaskStatus,
} from './task.entities';
import type { OkDto, Plain } from '../common/responses.dto';
import type {
  TaskCommentDto,
  TaskDetailDto,
  TaskDto,
  TaskFileDto,
} from './responses.dto';

/** Messages mapped to stable errorCode in common/http-exception.filter.ts. */
export const TaskErrors = {
  Full: 'Task is full',
  AlreadyTaken: 'Task already taken',
  AlreadyStarted: 'Task already started',
  Completed: 'Task already completed',
  Transition: 'Invalid task status transition',
  HasAssignees: 'Task has assignees',
  MaxTooLow: 'Max assignees is below the current number of assignees',
  HasPaper: 'Task has a paper',
} as const;

const STORAGE_DIR = 'tasks';

function userRef(u: User | null | undefined, id: string) {
  return { id, name: u?.name ?? null, avatarUrl: u?.avatarUrl ?? null };
}

function sortAssignees(list: TaskAssignee[]) {
  return [...list].sort(
    (a, b) =>
      a.takenAt.getTime() - b.takenAt.getTime() ||
      a.userId.localeCompare(b.userId),
  );
}

function taskView(t: Task, paper: RecordPaper | undefined): Plain<TaskDto> {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    points: t.points,
    maxAssignees: t.maxAssignees,
    dueDate: t.dueDate,
    createdById: t.createdById,
    extra: t.extra,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    submittedAt: t.submittedAt,
    completedAt: t.completedAt,
    acceptedById: t.acceptedById,
    assignees: sortAssignees(t.assignees ?? []).map((a) => ({
      ...userRef(a.user, a.userId),
      takenAt: a.takenAt,
    })),
    paper: paper ?? null,
  };
}

/** Views of tasks with their documents (one query). */
async function taskViews(m: EntityManager, tasks: Task[]) {
  const papers = await paperOfRecords(
    m,
    'task',
    tasks.map((t) => t.id),
  );
  return tasks.map((t) => taskView(t, papers.get(t.id)));
}

function commentView(c: TaskComment): TaskCommentDto {
  return {
    id: c.id,
    kind: c.kind,
    body: c.body,
    author: userRef(c.author, c.authorId),
    createdAt: c.createdAt,
  };
}

function fileView(f: TaskFile): TaskFileDto {
  return {
    id: f.id,
    fileName: f.fileName,
    mimeType: f.mimeType,
    size: f.size,
    uploadedById: f.uploadedById,
    createdAt: f.createdAt,
  };
}

const transition = () => new ConflictException(TaskErrors.Transition);

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private tasks: Repository<Task>,
    @InjectRepository(TaskComment) private comments: Repository<TaskComment>,
    @InjectRepository(TaskFile) private files: Repository<TaskFile>,
    @InjectDataSource() private ds: DataSource,
    private storage: StorageService,
    private audit: AuditService,
    private fields: RecordFieldsService,
    private papers: PaperworkService,
  ) {}

  async list(q: ListTasksQuery, actor: Actor): Promise<TaskDto[]> {
    const qb = this.tasks
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.assignees', 'a')
      .leftJoinAndSelect('a.user', 'u');
    // Done tasks: the most recently completed first (the board shows the last ones).
    if (q.status === TaskStatus.Done) {
      qb.orderBy('t.completedAt', 'DESC', 'NULLS LAST');
      qb.addOrderBy('t.createdAt', 'DESC');
    } else {
      qb.orderBy('t.createdAt', 'DESC');
    }
    qb.addOrderBy('t.id', 'ASC');
    if (q.limit) qb.take(Math.min(500, Math.max(1, Number(q.limit))));
    if (q.status) qb.andWhere('t.status = :status', { status: q.status });
    if (q.mine === 'true') {
      qb.andWhere(
        'EXISTS (SELECT 1 FROM task_assignees x WHERE x.task_id = t.id AND x.user_id = :me)',
        { me: actor.id },
      );
    }
    return taskViews(this.ds.manager, await qb.getMany());
  }

  async get(id: string): Promise<TaskDetailDto> {
    const task = await this.tasks.findOne({
      where: { id },
      relations: { assignees: { user: true } },
    });
    if (!task) throw new NotFoundException('Task not found');
    const [comments, files] = await Promise.all([
      this.comments.find({
        where: { taskId: id },
        relations: { author: true },
        order: { createdAt: 'ASC' },
      }),
      this.files.find({ where: { taskId: id }, order: { createdAt: 'ASC' } }),
    ]);
    const [view] = await taskViews(this.ds.manager, [task]);
    return {
      ...view,
      comments: comments.map(commentView),
      files: files.map(fileView),
    };
  }

  /**
   * Only through a document (its adapter, in the document's transaction):
   * the caller checks TasksCreate.
   */
  async create(
    dto: CreateTaskDto,
    actor: Actor,
    m: EntityManager,
  ): Promise<TaskDto> {
    const { extra } = await this.fields.applyExtra(m, 'task', dto.extra, null);
    const task = await m.save(
      m.create(Task, {
        title: dto.title.trim(),
        description: dto.description ?? null,
        points: dto.points,
        maxAssignees: dto.maxAssignees ?? 1,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: actor.id,
        extra,
      }),
    );
    await this.log(m, actor, 'task.created', task.id, {
      title: task.title,
      points: task.points,
      ...(Object.keys(extra).length ? { extra } : {}),
    });
    return taskView(task, undefined);
  }

  /** Only through its document (the document's transaction): staff, until done. */
  update(
    id: string,
    dto: UpdateTaskDto,
    actor: Actor,
    m: EntityManager,
  ): Promise<TaskDto> {
    return this.locked(
      id,
      async (m, task, assignees) => {
        if (task.status === TaskStatus.Done) {
          throw new ConflictException(TaskErrors.Completed);
        }
        if (
          dto.maxAssignees !== undefined &&
          dto.maxAssignees < assignees.length
        ) {
          throw new ConflictException({
            message: TaskErrors.MaxTooLow,
            field: 'maxAssignees',
          });
        }
        const changes: Record<string, unknown> = {};
        if (dto.title !== undefined)
          task.title = changes.title = dto.title.trim();
        if (dto.description !== undefined) {
          task.description = dto.description;
          changes.description = true;
        }
        if (dto.points !== undefined) task.points = changes.points = dto.points;
        if (dto.maxAssignees !== undefined) {
          task.maxAssignees = changes.maxAssignees = dto.maxAssignees;
        }
        if (dto.dueDate !== undefined) {
          task.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
          changes.dueDate = dto.dueDate;
        }
        if (dto.extra !== undefined) {
          const { extra, changed } = await this.fields.applyExtra(
            m,
            'task',
            dto.extra,
            task.extra,
          );
          task.extra = extra;
          if (Object.keys(changed).length) changes.extra = changed;
        }
        await m.save(Task, task);
        await this.log(m, actor, 'task.updated', task.id, changes);
      },
      m,
    );
  }

  /**
   * A task without a document is taken off with a reason (only free,
   * without assignees); one with a document — by cancelling the document.
   */
  async cancel(id: string, dto: CancelTaskDto, actor: Actor): Promise<OkDto> {
    const stored = await this.ds.transaction((m) =>
      this.drop(m, id, actor, { reason: dto.reason.trim() }, true),
    );
    await this.removeFiles(stored);
    return { ok: true };
  }

  /**
   * Its document is cancelled (in the document's transaction): the task
   * goes as by cancel() — only free, without assignees. Files are removed
   * after the commit (the returned function).
   */
  async cancelByPaper(
    m: EntityManager,
    id: string,
    reason: string,
    actor: Actor,
  ): Promise<() => Promise<void>> {
    assertCan(actor, Action.TasksManage);
    const stored = await this.drop(m, id, actor, { reason }, false);
    return () => this.removeFiles(stored);
  }

  /**
   * Deletes a free task without assignees (the reason — in the audit);
   * returns its stored files. `alone` — not through its document: a task
   * with one stays.
   */
  private async drop(
    m: EntityManager,
    id: string,
    actor: Actor,
    meta: Record<string, unknown>,
    alone: boolean,
  ) {
    const task = await this.lock(m, id);
    if (alone && (await papersOf(m, 'task', id))) {
      throw new ConflictException(TaskErrors.HasPaper);
    }
    const count = await m.count(TaskAssignee, { where: { taskId: id } });
    if (task.status !== TaskStatus.Todo || count > 0) {
      throw new ConflictException(TaskErrors.HasAssignees);
    }
    const files = await m.find(TaskFile, { where: { taskId: id } });
    await removeLinksOf(m, 'task', id);
    await m.delete(Task, { id });
    await this.log(m, actor, 'task.deleted', id, {
      title: task.title,
      ...meta,
    });
    return files.map((f) => f.storedName);
  }

  private async removeFiles(stored: string[]) {
    for (const name of stored)
      await this.storage.remove(`${STORAGE_DIR}/${name}`);
  }

  /** Take a free or queued task while there are free slots. */
  take(id: string, actor: Actor): Promise<TaskDto> {
    return this.locked(id, async (m, task, assignees) => {
      if (task.status === TaskStatus.Done) {
        throw new ConflictException(TaskErrors.Completed);
      }
      if (
        task.status !== TaskStatus.Todo &&
        task.status !== TaskStatus.Queued
      ) {
        throw new ConflictException(TaskErrors.AlreadyStarted);
      }
      if (assignees.some((a) => a.userId === actor.id)) {
        throw new ConflictException(TaskErrors.AlreadyTaken);
      }
      if (assignees.length >= task.maxAssignees) {
        throw new ConflictException(TaskErrors.Full);
      }
      await m.insert(TaskAssignee, { taskId: id, userId: actor.id });
      const from = task.status;
      if (from === TaskStatus.Todo) {
        task.status = TaskStatus.Queued;
        await m.save(Task, task);
      }
      await this.log(m, actor, 'task.taken', id, { from, to: task.status });
    });
  }

  /** An assignee drops the task; the last one leaving frees it. */
  leave(id: string, actor: Actor): Promise<TaskDto> {
    return this.locked(id, async (m, task, assignees) => {
      this.assertParticipant(actor, Action.TasksWork, assignees);
      if (task.status === TaskStatus.Done) {
        throw new ConflictException(TaskErrors.Completed);
      }
      if (
        task.status !== TaskStatus.Queued &&
        task.status !== TaskStatus.InProgress
      ) {
        throw transition();
      }
      await m.delete(TaskAssignee, { taskId: id, userId: actor.id });
      const from = task.status;
      if (assignees.length === 1) {
        task.status = TaskStatus.Todo;
        await m.save(Task, task);
      }
      await this.log(m, actor, 'task.left', id, { from, to: task.status });
    });
  }

  /** queued -> in_progress; nobody can join after that. */
  start(id: string, actor: Actor): Promise<TaskDto> {
    return this.move(
      id,
      actor,
      Action.TasksWork,
      TaskStatus.Queued,
      TaskStatus.InProgress,
      'task.started',
    );
  }

  /** in_progress -> review. */
  submit(id: string, actor: Actor): Promise<TaskDto> {
    return this.move(
      id,
      actor,
      Action.TasksWork,
      TaskStatus.InProgress,
      TaskStatus.Review,
      'task.submitted',
      (_m, task) => {
        task.submittedAt = new Date();
        return Promise.resolve();
      },
    );
  }

  /** review -> in_progress with a mandatory comment. */
  returnForRework(id: string, dto: CommentDto, actor: Actor): Promise<TaskDto> {
    return this.move(
      id,
      actor,
      Action.TasksAccept,
      TaskStatus.Review,
      TaskStatus.InProgress,
      'task.returned',
      async (m, task) => {
        await m.insert(TaskComment, {
          taskId: task.id,
          authorId: actor.id,
          kind: TaskCommentKind.Return,
          body: dto.body.trim(),
        });
      },
    );
  }

  /** review -> done; points are split between assignees. */
  accept(id: string, actor: Actor): Promise<TaskDto> {
    return this.move(
      id,
      actor,
      Action.TasksAccept,
      TaskStatus.Review,
      TaskStatus.Done,
      'task.accepted',
      async (m, task, assignees) => {
        task.completedAt = new Date();
        task.acceptedById = actor.id;
        const shares = splitPoints(task.points, assignees);
        for (const s of shares) {
          await m.insert(PointsEntry, {
            userId: s.assignee.userId,
            amount: s.amount,
            kind: PointsKind.Task,
            reason: 'task_completed',
            taskId: task.id,
            createdById: actor.id,
          });
        }
        return {
          points: task.points,
          shares: shares.map((s) => ({
            userId: s.assignee.userId,
            amount: s.amount,
          })),
        };
      },
    );
  }

  async addComment(id: string, dto: CommentDto, actor: Actor) {
    await this.mustExist(id);
    const c = await this.comments.save(
      this.comments.create({
        taskId: id,
        authorId: actor.id,
        kind: TaskCommentKind.Comment,
        body: dto.body.trim(),
      }),
    );
    const saved = await this.comments.findOneOrFail({
      where: { id: c.id },
      relations: { author: true },
    });
    return commentView(saved);
  }

  async addFile(id: string, file: UploadedFileLike | undefined, actor: Actor) {
    await this.mustExist(id);
    const assignees = await this.ds
      .getRepository(TaskAssignee)
      .find({ where: { taskId: id } });
    this.assertParticipant(actor, Action.TasksAttach, assignees);
    const info = validateUpload(file, DOCUMENT_EXTENSIONS);
    const storedName = randomUUID();
    await this.storage.save(`${STORAGE_DIR}/${storedName}`, file!.buffer);
    try {
      return await this.ds.transaction(async (m) => {
        const saved = await m.save(
          TaskFile,
          m.create(TaskFile, {
            taskId: id,
            fileName: info.fileName,
            mimeType: info.mime,
            size: file!.size,
            sha256: createHash('sha256').update(file!.buffer).digest('hex'),
            storedName,
            uploadedById: actor.id,
          }),
        );
        await this.log(m, actor, 'task.file_added', id, {
          fileName: saved.fileName,
        });
        return fileView(saved);
      });
    } catch (e) {
      await this.storage.remove(`${STORAGE_DIR}/${storedName}`);
      throw e;
    }
  }

  async downloadFile(id: string, fileId: string) {
    const f = await this.files.findOneBy({ id: fileId, taskId: id });
    if (!f) throw new NotFoundException('File not found');
    const stream = await this.storage.streamOrFail(
      `${STORAGE_DIR}/${f.storedName}`,
    );
    return { file: f, stream };
  }

  /** The uploader or staff may remove a file. */
  async removeFile(id: string, fileId: string, actor: Actor): Promise<OkDto> {
    const f = await this.files.findOneBy({ id: fileId, taskId: id });
    if (!f) throw new NotFoundException('File not found');
    if (f.uploadedById !== actor.id && !can(actor, Action.TasksManage)) {
      throw new ForbiddenException('Not allowed');
    }
    await this.files.delete({ id: fileId });
    await this.storage.remove(`${STORAGE_DIR}/${f.storedName}`);
    await this.audit.log({
      actorId: actor.id,
      action: 'task.file_removed',
      entity: 'task',
      entityId: id,
      meta: { fileName: f.fileName },
    });
    return { ok: true };
  }

  // --- helpers ---

  private assertParticipant(
    actor: Actor,
    action: Action,
    assignees: TaskAssignee[],
  ) {
    assertCan(actor, action, {
      participant: assignees.some((a) => a.userId === actor.id),
    });
  }

  /** Status change from -> to with a policy check on the task's assignees. */
  private move(
    id: string,
    actor: Actor,
    action: Action,
    from: TaskStatus,
    to: TaskStatus,
    auditAction: string,
    extra?: (
      m: EntityManager,
      task: Task,
      assignees: TaskAssignee[],
    ) => Promise<Record<string, unknown> | void>,
  ) {
    return this.locked(id, async (m, task, assignees) => {
      this.assertParticipant(actor, action, assignees);
      if (task.status === TaskStatus.Done) {
        throw new ConflictException(TaskErrors.Completed);
      }
      if (task.status !== from) throw transition();
      task.status = to;
      const meta = (await extra?.(m, task, assignees)) ?? {};
      await m.save(Task, task);
      await this.log(m, actor, auditAction, id, { from, to, ...meta });
      // Done: its document may be frozen (if its template says so — itself).
      if (to === TaskStatus.Done) {
        await this.papers.recordReady('task', id, actor, m);
      }
    });
  }

  /**
   * Runs `fn` in a transaction with the task row locked (FOR UPDATE), so
   * concurrent take/accept requests cannot exceed limits or double-award.
   * Returns the fresh task view. `tx` — in the caller's transaction.
   */
  private async locked(
    id: string,
    fn: (
      m: EntityManager,
      task: Task,
      assignees: TaskAssignee[],
    ) => Promise<void>,
    tx?: EntityManager,
  ) {
    const run = async (m: EntityManager) => {
      const task = await this.lock(m, id);
      const assignees = sortAssignees(
        await m.find(TaskAssignee, { where: { taskId: id } }),
      );
      await fn(m, task, assignees);
    };
    if (tx) await run(tx);
    else await this.ds.transaction(run);
    const m = tx ?? this.ds.manager;
    const fresh = await m.findOneOrFail(Task, {
      where: { id },
      relations: { assignees: { user: true } },
    });
    const [view] = await taskViews(m, [fresh]);
    return view;
  }

  private async lock(m: EntityManager, id: string) {
    const task = await m.findOne(Task, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async mustExist(id: string) {
    if (!(await this.tasks.existsBy({ id }))) {
      throw new NotFoundException('Task not found');
    }
  }

  private log(
    m: EntityManager,
    actor: Actor,
    action: string,
    taskId: string,
    meta: Record<string, unknown>,
  ) {
    return this.audit.log(
      { actorId: actor.id, action, entity: 'task', entityId: taskId, meta },
      m,
    );
  }
}
