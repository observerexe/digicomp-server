import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PointsEntry } from '../points/points-entry.entity';
import { User } from '../users/user.entity';
import { CreateTaskDto, UpdateStatusDto } from './dto';
import { Task, TaskStatus } from './task.entity';

function toView(t: Task) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    points: t.points,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    createdAt: t.createdAt,
    assignees: (t.assignees ?? []).map((a) => ({ id: a.id, name: a.name })),
  };
}

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(Task) private tasks: Repository<Task>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  async list() {
    const rows = await this.tasks.find({
      relations: { assignees: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toView);
  }

  async create(dto: CreateTaskDto, actorId: string) {
    const ids = dto.assigneeIds ?? [];
    const assignees = ids.length ? await this.users.findBy({ id: In(ids) }) : [];
    if (assignees.length !== new Set(ids).size) {
      throw new BadRequestException('Unknown assignee');
    }
    const task = await this.tasks.save(
      this.tasks.create({
        title: dto.title,
        description: dto.description ?? null,
        points: dto.points,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: actorId,
        assignees,
      }),
    );
    await this.audit.log({
      actorId,
      action: 'task.created',
      entity: 'task',
      entityId: task.id,
      meta: { title: task.title, points: task.points },
    });
    return toView(task);
  }

  async setStatus(
    id: string,
    dto: UpdateStatusDto,
    actor: { id: string; role: string },
  ) {
    const task = await this.tasks.findOne({
      where: { id },
      relations: { assignees: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status === TaskStatus.Done) {
      throw new ConflictException('Task already completed');
    }
    if (actor.role !== 'admin') {
      if (!task.assignees.some((a) => a.id === actor.id)) {
        throw new ForbiddenException('Not your task');
      }
      if (dto.status === TaskStatus.Done) {
        throw new ForbiddenException('Only admin can confirm completion');
      }
    }

    return this.ds.transaction(async (m) => {
      const from = task.status;
      task.status = dto.status;
      if (dto.status === TaskStatus.Done) {
        task.completedAt = new Date();
        if (task.points > 0) {
          for (const a of task.assignees) {
            await m.save(
              PointsEntry,
              m.create(PointsEntry, {
                userId: a.id,
                amount: task.points,
                reason: 'task_completed',
                taskId: task.id,
              }),
            );
          }
        }
      }
      await m.save(Task, task);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'task.status_changed',
          entity: 'task',
          entityId: task.id,
          meta: { from, to: dto.status },
        },
        m,
      );
      return toView(task);
    });
  }
}
