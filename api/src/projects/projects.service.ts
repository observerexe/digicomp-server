import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  DOCUMENT_EXTENSIONS,
  UploadedFileLike,
  validateUpload,
} from '../files/file-validation';
import { StorageService } from '../files/storage.service';
import { User } from '../users/user.entity';
import { CreateProjectDto, ListProjectsQuery, UpdateProjectDto } from './dto';
import { Project, ProjectFile, ProjectMember } from './project.entities';

type Actor = { id: string; role: string };

function supervisor(role: string) {
  return role === 'admin' || role === 'coordinator';
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function memberView(u: User) {
  return {
    id: u.id,
    name: u.name,
    position: u.position,
    avatarUrl: u.avatarUrl,
  };
}

function projectView(p: Project) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    progress: p.progress,
    accomplishments: p.accomplishments,
    sources: p.sources,
    createdById: p.createdById,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function fileView(f: ProjectFile) {
  return {
    id: f.id,
    fileName: f.fileName,
    mimeType: f.mimeType,
    size: f.size,
    uploadedById: f.uploadedById,
    createdAt: f.createdAt,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private projects: Repository<Project>,
    @InjectRepository(ProjectMember)
    private members: Repository<ProjectMember>,
    @InjectRepository(ProjectFile) private files: Repository<ProjectFile>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private storage: StorageService,
    private audit: AuditService,
  ) {}

  async list(q: ListProjectsQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.projects
      .createQueryBuilder('p')
      .where('p.archivedAt IS NULL');
    if (q.status) qb.andWhere('p.status = :st', { st: q.status });
    if (q.memberId) {
      qb.andWhere(
        'p.id IN (SELECT pm.project_id FROM project_members pm WHERE pm.user_id = :mid)',
        { mid: q.memberId },
      );
    }
    if (q.search) {
      qb.andWhere('(p.title ILIKE :s OR p.description ILIKE :s)', {
        s: `%${escapeLike(q.search)}%`,
      });
    }
    qb.orderBy('p.updatedAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    const ids = rows.map((r) => r.id);
    const mem = ids.length
      ? await this.members.find({
          where: { projectId: In(ids) },
          relations: { user: true },
        })
      : [];
    const items = rows.map((p) => ({
      ...projectView(p),
      members: mem
        .filter((m) => m.projectId === p.id)
        .map((m) => memberView(m.user)),
    }));
    return { items, total, page, limit };
  }

  async get(id: string, actor: Actor) {
    const p = await this.find(id);
    const [mem, files, canEdit] = await Promise.all([
      this.members.find({
        where: { projectId: id },
        relations: { user: true },
      }),
      this.files.find({
        where: { projectId: id },
        order: { createdAt: 'DESC' },
      }),
      this.canEdit(id, actor),
    ]);
    return {
      ...projectView(p),
      members: mem.map((m) => memberView(m.user)),
      files: files.map(fileView),
      canEdit,
    };
  }

  async create(dto: CreateProjectDto, actor: Actor) {
    const memberIds = await this.validMembers(dto.memberIds);
    const id = await this.ds.transaction(async (m) => {
      const p = await m.save(
        Project,
        m.create(Project, {
          title: dto.title,
          description: dto.description ?? '',
          status: dto.status ?? 'Планується',
          progress: dto.progress ?? 0,
          accomplishments: dto.accomplishments ?? '',
          sources: dto.sources ?? [],
          createdById: actor.id,
          archivedAt: null,
        }),
      );
      await this.setMembers(m, p.id, memberIds);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'project.created',
          entity: 'project',
          entityId: p.id,
          meta: { title: p.title, members: memberIds.length },
        },
        m,
      );
      return p.id;
    });
    return this.get(id, actor);
  }

  async update(id: string, dto: UpdateProjectDto, actor: Actor) {
    if (dto.memberIds !== undefined && !supervisor(actor.role)) {
      throw new ForbiddenException(
        'Only admin or coordinator can change members',
      );
    }
    const memberIds =
      dto.memberIds !== undefined
        ? await this.validMembers(dto.memberIds)
        : undefined;
    await this.ds.transaction(async (m) => {
      const p = await m.findOne(Project, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p || p.archivedAt) throw new NotFoundException('Project not found');
      if (!(await this.canEdit(id, actor, m))) {
        throw new ForbiddenException('No rights to edit this project');
      }
      const meta: Record<string, unknown> = {};
      const fields: string[] = [];
      for (const k of [
        'title',
        'description',
        'status',
        'progress',
        'accomplishments',
      ] as const) {
        const v = dto[k];
        if (v !== undefined && v !== p[k]) {
          if (k === 'status' || k === 'progress') {
            meta[k] = { from: p[k], to: v };
          }
          (p as unknown as Record<string, unknown>)[k] = v;
          fields.push(k);
        }
      }
      if (
        dto.sources !== undefined &&
        JSON.stringify(dto.sources) !== JSON.stringify(p.sources)
      ) {
        p.sources = dto.sources;
        fields.push('sources');
      }
      if (memberIds) {
        const current = (
          await m.find(ProjectMember, { where: { projectId: id } })
        ).map((x) => x.userId);
        const added = memberIds.filter((x) => !current.includes(x));
        const removed = current.filter((x) => !memberIds.includes(x));
        if (added.length || removed.length) {
          await this.setMembers(m, id, memberIds);
          meta.membersAdded = added;
          meta.membersRemoved = removed;
          fields.push('members');
        }
      }
      if (fields.length) {
        await m.save(Project, p);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'project.updated',
            entity: 'project',
            entityId: id,
            meta: { ...meta, fields },
          },
          m,
        );
      }
    });
    return this.get(id, actor);
  }

  async archive(id: string, actor: Actor) {
    const p = await this.find(id);
    p.archivedAt = new Date();
    await this.projects.save(p);
    await this.audit.log({
      actorId: actor.id,
      action: 'project.archived',
      entity: 'project',
      entityId: id,
      meta: { title: p.title },
    });
    return { ok: true };
  }

  async addFile(id: string, file: UploadedFileLike | undefined, actor: Actor) {
    await this.find(id);
    if (!(await this.canEdit(id, actor))) {
      throw new ForbiddenException('No rights to edit this project');
    }
    const info = validateUpload(file, DOCUMENT_EXTENSIONS);
    const storedName = randomUUID();
    await this.storage.save(`projects/${storedName}`, file!.buffer);
    try {
      return await this.ds.transaction(async (m) => {
        const saved = await m.save(
          ProjectFile,
          m.create(ProjectFile, {
            projectId: id,
            fileName: info.fileName,
            mimeType: info.mime,
            size: file!.size,
            sha256: createHash('sha256').update(file!.buffer).digest('hex'),
            storedName,
            uploadedById: actor.id,
          }),
        );
        await m.update(Project, { id }, { updatedAt: new Date() });
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'project.file_added',
            entity: 'project',
            entityId: id,
            meta: { fileName: saved.fileName },
          },
          m,
        );
        return fileView(saved);
      });
    } catch (e) {
      await this.storage.remove(`projects/${storedName}`);
      throw e;
    }
  }

  async downloadFile(id: string, fileId: string) {
    await this.find(id);
    const f = await this.files.findOneBy({ id: fileId, projectId: id });
    if (!f) throw new NotFoundException('File not found');
    const stream = await this.storage.streamOrFail(`projects/${f.storedName}`);
    return { file: f, stream };
  }

  async removeFile(id: string, fileId: string, actor: Actor) {
    await this.find(id);
    const f = await this.files.findOneBy({ id: fileId, projectId: id });
    if (!f) throw new NotFoundException('File not found');
    await this.files.delete({ id: fileId });
    await this.storage.remove(`projects/${f.storedName}`);
    await this.audit.log({
      actorId: actor.id,
      action: 'project.file_removed',
      entity: 'project',
      entityId: id,
      meta: { fileName: f.fileName },
    });
    return { ok: true };
  }

  async history(id: string) {
    await this.find(id);
    const rows = await this.audit.history('project', id);
    const ids = [
      ...new Set(rows.map((r) => r.actorId).filter(Boolean)),
    ] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      for (const u of await this.users.find({ where: { id: In(ids) } })) {
        names.set(u.id, u.name);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actor: r.actorId
        ? { id: r.actorId, name: names.get(r.actorId) ?? null }
        : null,
      meta: r.meta,
      createdAt: r.createdAt,
    }));
  }

  private async find(id: string) {
    const p = await this.projects.findOneBy({ id });
    if (!p || p.archivedAt) throw new NotFoundException('Project not found');
    return p;
  }

  private async canEdit(id: string, actor: Actor, m?: EntityManager) {
    if (supervisor(actor.role)) return true;
    const repo = m ? m.getRepository(ProjectMember) : this.members;
    return repo.existsBy({ projectId: id, userId: actor.id });
  }

  private async validMembers(ids: string[] | undefined) {
    const unique = [...new Set(ids ?? [])];
    if (!unique.length) return unique;
    const found = await this.users.find({
      where: { id: In(unique), active: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('Unknown or inactive member');
    }
    return unique;
  }

  private async setMembers(m: EntityManager, id: string, userIds: string[]) {
    await m.delete(ProjectMember, { projectId: id });
    if (userIds.length) {
      await m.insert(
        ProjectMember,
        userIds.map((userId) => ({ projectId: id, userId })),
      );
    }
  }
}
