import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { RefreshSession } from './refresh-session.entity';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REUSE_GRACE_MS = 10 * 1000;

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionsService {
  constructor(
    @InjectRepository(RefreshSession) private repo: Repository<RefreshSession>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  async issue(userId: string, familyId: string = randomUUID()) {
    return this.create(this.repo, userId, familyId);
  }

  async rotate(token: string) {
    const result = await this.ds.transaction(async (m) => {
      const s = await m.findOne(RefreshSession, {
        where: { tokenHash: hash(token) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!s) return { error: true as const, reuse: false };
      const now = Date.now();
      if (s.revokedAt) {
        const recent = now - s.revokedAt.getTime() < REUSE_GRACE_MS;
        if (!recent) {
          await m.update(
            RefreshSession,
            { familyId: s.familyId, revokedAt: IsNull() },
            { revokedAt: new Date() },
          );
        }
        return { error: true as const, reuse: !recent };
      }
      if (s.expiresAt.getTime() < now) {
        return { error: true as const, reuse: false };
      }
      s.revokedAt = new Date();
      await m.save(RefreshSession, s);
      const next = await this.create(
        m.getRepository(RefreshSession),
        s.userId,
        s.familyId,
      );
      return { error: false as const, userId: s.userId, token: next };
    });
    if (result.error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    return { userId: result.userId, token: result.token };
  }

  async revokeByToken(token: string) {
    const s = await this.repo.findOneBy({ tokenHash: hash(token) });
    if (!s) return;
    await this.repo.update(
      { familyId: s.familyId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string, manager?: EntityManager) {
    const repo = manager ? manager.getRepository(RefreshSession) : this.repo;
    await repo.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private async create(
    repo: Repository<RefreshSession>,
    userId: string,
    familyId: string,
  ) {
    const token = randomBytes(48).toString('base64url');
    await repo.save(
      repo.create({
        userId,
        familyId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + TTL_MS),
        revokedAt: null,
      }),
    );
    return token;
  }
}
