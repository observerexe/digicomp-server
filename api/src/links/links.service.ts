import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { Actor } from '../auth/policy';
import type { OkDto } from '../common/responses.dto';
import type { RecordType } from '../records/field-types';
import { CreateLinkDto, ListLinksQuery } from './dto';
import { LinkableType, LinkRegistry } from './link-registry';
import { RecordLink } from './record-link.entity';
import type { LinkDto } from './responses.dto';

export const LinkErrors = {
  TypeInvalid: 'Record type cannot be linked',
  Self: 'Cannot link a record to itself',
  Duplicate: 'Link already exists',
} as const;

const UNIQUE_VIOLATION = '23505';

@Injectable()
export class LinksService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private registry: LinkRegistry,
    private audit: AuditService,
  ) {}

  /** Links of a record in both directions; records the actor cannot see are left out. */
  async list(q: ListLinksQuery, actor: Actor): Promise<LinkDto[]> {
    const m = this.ds.manager;
    await this.visible(this.linkable(q.type), q.id, actor, m);
    const rows = await m
      .createQueryBuilder(RecordLink, 'l')
      .where('(l.fromType = :type AND l.fromId = :id)', q)
      .orWhere('(l.toType = :type AND l.toId = :id)', q)
      .orderBy('l.createdAt', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .getMany();

    // The other side of each link, grouped by type for one lookup per type.
    const sides = rows.map((l) => {
      const out = l.fromType === q.type && l.fromId === q.id;
      return out
        ? { l, out, type: l.toType, id: l.toId }
        : { l, out, type: l.fromType, id: l.fromId };
    });
    const byType = new Map<string, string[]>();
    for (const s of sides)
      byType.set(s.type, [...(byType.get(s.type) ?? []), s.id]);
    const found = new Map<
      string,
      Map<string, { title: string; archived: boolean }>
    >();
    for (const [type, ids] of byType) {
      const reg = this.registry.get(type);
      if (reg) found.set(type, await reg.find([...new Set(ids)], actor, m));
    }
    // Who may remove: the editor of the source, checked once per record.
    const edit = new Map<string, boolean>();
    const canEdit = async (type: string, id: string) => {
      const key = `${type}:${id}`;
      if (!edit.has(key)) {
        const reg = this.registry.get(type);
        edit.set(key, !!reg && (await reg.checkEdit(actor, id, m)) === true);
      }
      return edit.get(key)!;
    };

    const out: LinkDto[] = [];
    for (const s of sides) {
      const rec = found.get(s.type)?.get(s.id);
      if (!rec) continue;
      out.push({
        id: s.l.id,
        direction: s.out ? 'out' : 'in',
        type: s.type as RecordType,
        recordId: s.id,
        title: rec.title,
        archived: rec.archived,
        role: s.l.role,
        createdById: s.l.createdById,
        createdAt: s.l.createdAt,
        canRemove: await canEdit(s.l.fromType, s.l.fromId),
      });
    }
    return out;
  }

  async create(dto: CreateLinkDto, actor: Actor): Promise<LinkDto> {
    const from = this.linkable(dto.fromType);
    const to = this.linkable(dto.toType);
    if (dto.fromType === dto.toType && dto.fromId === dto.toId) {
      throw new BadRequestException(LinkErrors.Self);
    }
    const role = dto.role ?? '';
    try {
      return await this.ds.transaction(async (m) => {
        await this.visible(from, dto.fromId, actor, m);
        await this.assertEdit(from, dto.fromId, actor, m);
        const target = await this.visible(to, dto.toId, actor, m);
        const link = await m.save(
          RecordLink,
          m.create(RecordLink, {
            fromType: dto.fromType,
            fromId: dto.fromId,
            toType: dto.toType,
            toId: dto.toId,
            role,
            createdById: actor.id,
          }),
        );
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'link.created',
            entity: dto.fromType,
            entityId: dto.fromId,
            meta: { toType: dto.toType, toId: dto.toId, role },
          },
          m,
        );
        return {
          id: link.id,
          direction: 'out',
          type: dto.toType,
          recordId: dto.toId,
          title: target.title,
          archived: target.archived,
          role,
          createdById: actor.id,
          createdAt: link.createdAt,
          canRemove: true,
        };
      });
    } catch (e) {
      if (
        e instanceof QueryFailedError &&
        (e.driverError as { code?: string }).code === UNIQUE_VIOLATION
      ) {
        throw new ConflictException(LinkErrors.Duplicate);
      }
      throw e;
    }
  }

  async remove(id: string, actor: Actor): Promise<OkDto> {
    return this.ds.transaction(async (m) => {
      const link = await m.findOneBy(RecordLink, { id });
      if (!link) throw new NotFoundException('Link not found');
      const from = this.registry.get(link.fromType);
      if (!from) throw new ForbiddenException();
      await this.visible(from, link.fromId, actor, m);
      await this.assertEdit(from, link.fromId, actor, m);
      await m.delete(RecordLink, { id });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'link.removed',
          entity: link.fromType,
          entityId: link.fromId,
          meta: { toType: link.toType, toId: link.toId, role: link.role },
        },
        m,
      );
      return { ok: true };
    });
  }

  private linkable(type: string): LinkableType {
    const reg = this.registry.get(type);
    if (!reg) throw new BadRequestException(LinkErrors.TypeInvalid);
    return reg;
  }

  /** The record exists and the actor sees it; otherwise 404. */
  private async visible(
    reg: LinkableType,
    id: string,
    actor: Actor,
    m: EntityManager,
  ) {
    const rec = (await reg.find([id], actor, m)).get(id);
    if (!rec) throw new NotFoundException('Record not found');
    return rec;
  }

  private async assertEdit(
    reg: LinkableType,
    id: string,
    actor: Actor,
    m: EntityManager,
  ) {
    const res = await reg.checkEdit(actor, id, m);
    if (res !== true) {
      throw new ForbiddenException({
        message: 'Forbidden: edit the source record',
        errorCode: res,
      });
    }
  }
}
