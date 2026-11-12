import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';
import type { ListAuditQuery } from './dto';
import type { AuditEntryDto } from './responses.dto';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private repo: Repository<AuditLog>) {}

  log(
    entry: {
      actorId?: string;
      action: string;
      entity: string;
      entityId?: string;
      meta?: Record<string, unknown>;
    },
    manager?: EntityManager,
  ) {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    return repo.save(repo.create(entry));
  }

  history(entity: string, entityId: string, limit = 100) {
    return this.repo.find({
      where: { entity, entityId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async list(q: ListAuditQuery = {}): Promise<AuditEntryDto[]> {
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 100)));
    const qb = this.repo
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.actor_id')
      .select('a')
      .addSelect(['u.id', 'u.name'])
      .orderBy('a.created_at', 'DESC')
      .addOrderBy('a.id', 'DESC')
      .limit(limit);
    if (q.action) {
      // «user.» is a group, anything else an exact action.
      if (q.action.endsWith('.')) {
        qb.andWhere("a.action LIKE :p ESCAPE '\\'", {
          p: q.action.replace(/_/g, '\\_') + '%',
        });
      } else {
        qb.andWhere('a.action = :action', { action: q.action });
      }
    }
    if (q.actorId) qb.andWhere('a.actor_id = :actorId', { actorId: q.actorId });
    if (q.entity) qb.andWhere('a.entity = :entity', { entity: q.entity });
    if (q.before) {
      // An unknown cursor would quietly look like the end of the journal.
      if (!(await this.repo.existsBy({ id: q.before }))) {
        throw new NotFoundException('Audit cursor not found');
      }
      // Cursor by the row itself: the timestamp keeps its full precision.
      qb.andWhere(
        '(a.created_at, a.id) < (SELECT b.created_at, b.id FROM audit_log b WHERE b.id = :before)',
        { before: q.before },
      );
    }
    const { entities, raw } = await qb.getRawAndEntities<{
      u_id: string | null;
      u_name: string | null;
    }>();
    return entities.map((a, i) => {
      const r = raw[i];
      return {
        id: a.id,
        actorId: a.actorId,
        actor: r?.u_id ? { id: r.u_id, name: r.u_name ?? '' } : null,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        meta: a.meta,
        createdAt: a.createdAt,
      };
    });
  }
}
