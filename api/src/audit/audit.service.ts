import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

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

  list(limit = 100) {
    return this.repo.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
