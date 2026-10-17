import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { ListUsersQuery, UpdateProfileDto, UpdateUserDto } from './dto';
import { toBasicView, toExtendedView, toProfile } from './profile';
import { Role, User } from './user.entity';

export type Actor = { id: string; role: string };

function isExtended(role: string) {
  return role === Role.Admin || role === Role.Coordinator;
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  async me(id: string) {
    const u = await this.repo.findOneBy({ id });
    if (!u) throw new NotFoundException('User not found');
    return toProfile(u);
  }

  async list(q: ListUsersQuery, actor: Actor) {
    const extended = isExtended(actor.role);
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.repo.createQueryBuilder('u');
    if (!extended) {
      qb.andWhere('u.active = true');
    } else if (q.active !== undefined) {
      qb.andWhere('u.active = :active', { active: q.active === 'true' });
    }
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.search) {
      const cond = [
        'u.name ILIKE :s',
        'u.position ILIKE :s',
        'u.specialty ILIKE :s',
      ];
      if (extended) cond.push('u.email ILIKE :s');
      qb.andWhere(`(${cond.join(' OR ')})`, {
        s: `%${escapeLike(q.search)}%`,
      });
    }
    qb.orderBy('u.name', 'ASC')
      .addOrderBy('u.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map(extended ? toExtendedView : toBasicView),
      total,
      page,
      limit,
    };
  }

  async get(id: string, actor: Actor) {
    const extended = isExtended(actor.role);
    const u = await this.repo.findOneBy({ id });
    if (!u || (!extended && !u.active)) {
      throw new NotFoundException('User not found');
    }
    return extended ? toExtendedView(u) : toBasicView(u);
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const u = await this.repo.findOneBy({ id });
    if (!u) throw new NotFoundException('User not found');
    const fields = this.applyProfileFields(u, dto);
    if (fields.length) {
      await this.repo.save(u);
      await this.audit.log({
        actorId: id,
        action: 'user.profile_updated',
        entity: 'user',
        entityId: id,
        meta: { fields },
      });
    }
    return toProfile(u);
  }

  async update(id: string, dto: UpdateUserDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const u = await m.findOne(User, { where: { id } });
      if (!u) throw new NotFoundException('User not found');

      const meta: Record<string, unknown> = {};
      const fields = this.applyProfileFields(u, dto);

      if (dto.email !== undefined) {
        const email = dto.email.toLowerCase();
        if (email !== u.email) {
          const taken = await m.findOne(User, { where: { email } });
          if (taken) throw new ConflictException('Email already used');
          u.email = email;
          fields.push('email');
        }
      }

      const nextRole = dto.role ?? u.role;
      const nextActive = dto.active ?? u.active;
      const losesAdmin =
        u.role === Role.Admin &&
        u.active &&
        (nextRole !== Role.Admin || !nextActive);
      if (losesAdmin) {
        const others = await m.count(User, {
          where: { role: Role.Admin, active: true },
        });
        if (others <= 1) {
          throw new ConflictException('Cannot remove the last active admin');
        }
      }
      if (nextRole !== u.role) {
        meta.role = { from: u.role, to: nextRole };
        u.role = nextRole;
        fields.push('role');
      }
      if (nextActive !== u.active) {
        meta.active = { from: u.active, to: nextActive };
        u.active = nextActive;
        fields.push('active');
      }

      if (fields.length) {
        await m.save(User, u);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'user.updated',
            entity: 'user',
            entityId: id,
            meta: { ...meta, fields },
          },
          m,
        );
      }
      return toExtendedView(u);
    });
  }

  async changePassword(id: string, current: string, next: string) {
    const u = await this.repo.findOneBy({ id });
    if (!u) throw new NotFoundException('User not found');
    if (!(await argon2.verify(u.passwordHash, current))) {
      throw new BadRequestException('Invalid current password');
    }
    u.passwordHash = await argon2.hash(next);
    await this.repo.save(u);
    await this.audit.log({
      actorId: id,
      action: 'user.password_changed',
      entity: 'user',
      entityId: id,
    });
    return { ok: true };
  }

  async resetPassword(id: string, next: string, actor: Actor) {
    const u = await this.repo.findOneBy({ id });
    if (!u) throw new NotFoundException('User not found');
    u.passwordHash = await argon2.hash(next);
    await this.repo.save(u);
    await this.audit.log({
      actorId: actor.id,
      action: 'user.password_reset',
      entity: 'user',
      entityId: id,
    });
    return { ok: true };
  }

  private applyProfileFields(u: User, dto: UpdateProfileDto) {
    const changed: string[] = [];
    for (const k of ['name', 'position', 'specialty', 'bio'] as const) {
      const v = dto[k];
      if (v !== undefined && v !== u[k]) {
        u[k] = v;
        changed.push(k);
      }
    }
    return changed;
  }
}
