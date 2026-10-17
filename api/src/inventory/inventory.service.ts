import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  DataSource,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AccessScope, Doc } from '../documents/doc.entity';
import {
  CreateItemDto,
  ListItemsQuery,
  ListMovementsQuery,
  MovementDto,
  UpdateItemDto,
} from './dto';
import { InventoryItem, InventoryMovement } from './inventory.entities';

type Actor = { id: string; role: string };

const INTEGER_UNITS = ['шт', 'pcs', 'уп'];

function isIntegerUnit(unit: string) {
  return INTEGER_UNITS.includes(unit.trim().toLowerCase());
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function supervisor(role: string) {
  return role === 'admin' || role === 'coordinator';
}

function escapeLike(s: string) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}

function itemView(i: InventoryItem, documentsCount = 0) {
  return {
    id: i.id,
    code: i.code,
    title: i.title,
    category: i.category,
    quantity: i.quantity,
    unit: i.unit,
    minQuantity: i.minQuantity,
    lowStock: i.minQuantity > 0 && i.quantity <= i.minQuantity,
    location: i.location,
    notes: i.notes,
    documentsCount,
    createdById: i.createdById,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

function movementView(m: InventoryMovement) {
  return {
    id: m.id,
    itemId: m.itemId,
    item: m.item
      ? {
          id: m.item.id,
          code: m.item.code,
          title: m.item.title,
          unit: m.item.unit,
        }
      : undefined,
    delta: m.delta,
    quantityAfter: m.quantityAfter,
    note: m.note,
    projectId: m.projectId,
    actor: m.actor ? { id: m.actor.id, name: m.actor.name } : { id: m.actorId },
    createdAt: m.createdAt,
  };
}

function csvCell(v: unknown) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",;\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem) private items: Repository<InventoryItem>,
    @InjectRepository(InventoryMovement)
    private moves: Repository<InventoryMovement>,
    @InjectRepository(Doc) private docs: Repository<Doc>,
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  async list(q: ListItemsQuery, actor: Actor) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 100)));
    const qb = this.items.createQueryBuilder('i');
    if (q.category) qb.andWhere('i.category = :cat', { cat: q.category });
    if (q.lowStock) {
      qb.andWhere('i.minQuantity > 0 AND i.quantity <= i.minQuantity');
    }
    if (q.search) {
      qb.andWhere(
        '(i.title ILIKE :s OR i.code ILIKE :s OR i.category ILIKE :s OR i.location ILIKE :s)',
        { s: `%${escapeLike(q.search)}%` },
      );
    }
    qb.orderBy('i.title', 'ASC')
      .addOrderBy('i.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    const counts = await this.docCounts(
      rows.map((r) => r.id),
      actor,
    );
    return {
      items: rows.map((r) => itemView(r, counts.get(r.id) ?? 0)),
      total,
      page,
      limit,
    };
  }

  async get(id: string, actor: Actor) {
    const i = await this.items.findOneBy({ id });
    if (!i) throw new NotFoundException('Item not found');
    const qb = this.docs
      .createQueryBuilder('d')
      .where('d.inventoryItemId = :id AND d.archivedAt IS NULL', { id });
    if (!supervisor(actor.role)) {
      qb.andWhere('d.accessScope = :s', { s: AccessScope.Members });
    }
    const docs = await qb.orderBy('d.title', 'ASC').getMany();
    return {
      ...itemView(i, docs.length),
      documents: docs.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
      })),
    };
  }

  async create(dto: CreateItemDto, actor: Actor) {
    const code = dto.code.toUpperCase();
    const unit = dto.unit ?? 'шт';
    const quantity = dto.quantity ?? 0;
    const minQuantity = dto.minQuantity ?? 0;
    if (isIntegerUnit(unit)) {
      if (!Number.isInteger(quantity) || !Number.isInteger(minQuantity)) {
        throw new BadRequestException(
          'Quantity must be an integer for this unit',
        );
      }
    }
    if (await this.items.findOneBy({ code })) {
      throw new ConflictException('Item code already used');
    }
    return this.ds.transaction(async (m) => {
      const item = await m.save(
        InventoryItem,
        m.create(InventoryItem, {
          code,
          title: dto.title,
          category: dto.category,
          unit,
          quantity,
          minQuantity,
          location: dto.location ?? '',
          notes: dto.notes ?? '',
          createdById: actor.id,
        }),
      );
      if (quantity > 0) {
        await m.save(
          InventoryMovement,
          m.create(InventoryMovement, {
            itemId: item.id,
            delta: quantity,
            quantityAfter: quantity,
            note: 'Початковий залишок',
            projectId: null,
            actorId: actor.id,
            idempotencyKey: null,
          }),
        );
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'inventory.item_created',
          entity: 'inventory_item',
          entityId: item.id,
          meta: { code, title: item.title, quantity },
        },
        m,
      );
      return itemView(item, 0);
    });
  }

  async update(id: string, dto: UpdateItemDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const item = await m.findOne(InventoryItem, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Item not found');
      const unit = dto.unit ?? item.unit;
      const min = dto.minQuantity ?? item.minQuantity;
      if (isIntegerUnit(unit)) {
        if (!Number.isInteger(item.quantity) || !Number.isInteger(min)) {
          throw new ConflictException(
            'Quantity must be an integer for this unit',
          );
        }
      }
      const changed: string[] = [];
      for (const k of [
        'title',
        'category',
        'unit',
        'minQuantity',
        'location',
        'notes',
      ] as const) {
        const v = dto[k];
        if (v !== undefined && v !== item[k]) {
          (item as unknown as Record<string, unknown>)[k] = v;
          changed.push(k);
        }
      }
      if (changed.length) {
        await m.save(InventoryItem, item);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'inventory.item_updated',
            entity: 'inventory_item',
            entityId: id,
            meta: { fields: changed },
          },
          m,
        );
      }
      return itemView(item);
    });
  }

  async move(id: string, dto: MovementDto, actor: Actor) {
    if (dto.delta === 0) {
      throw new BadRequestException('Delta must not be zero');
    }
    if (dto.delta > 0 && !supervisor(actor.role)) {
      throw new ForbiddenException(
        'Only admin or coordinator can receive stock',
      );
    }
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Note is required');
    return this.ds.transaction(async (m) => {
      const item = await m.findOne(InventoryItem, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Item not found');
      if (dto.idempotencyKey) {
        const prev = await m.findOne(InventoryMovement, {
          where: { actorId: actor.id, idempotencyKey: dto.idempotencyKey },
          relations: { item: true, actor: true },
        });
        if (prev) return movementView(prev);
      }
      if (isIntegerUnit(item.unit) && !Number.isInteger(dto.delta)) {
        throw new BadRequestException('Delta must be an integer for this unit');
      }
      const next = round3(item.quantity + dto.delta);
      if (next < 0) throw new ConflictException('Insufficient stock');
      item.quantity = next;
      await m.save(InventoryItem, item);
      const saved = await m.save(
        InventoryMovement,
        m.create(InventoryMovement, {
          itemId: id,
          delta: dto.delta,
          quantityAfter: next,
          note,
          projectId: dto.projectId ?? null,
          actorId: actor.id,
          idempotencyKey: dto.idempotencyKey ?? null,
        }),
      );
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'inventory.movement',
          entity: 'inventory_item',
          entityId: id,
          meta: { delta: dto.delta, after: next },
        },
        m,
      );
      const full = await m.findOneOrFail(InventoryMovement, {
        where: { id: saved.id },
        relations: { item: true, actor: true },
      });
      return movementView(full);
    });
  }

  async listMovements(q: ListMovementsQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 50)));
    const where: FindOptionsWhere<InventoryMovement> = {};
    if (q.itemId) where.itemId = q.itemId;
    if (q.from && q.to) {
      where.createdAt = Between(new Date(q.from), new Date(q.to));
    } else if (q.from) {
      where.createdAt = MoreThanOrEqual(new Date(q.from));
    } else if (q.to) {
      where.createdAt = LessThanOrEqual(new Date(q.to));
    }
    const [rows, total] = await this.moves.findAndCount({
      where,
      relations: { item: true, actor: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items: rows.map(movementView), total, page, limit };
  }

  async exportCsv() {
    const rows = await this.items.find({ order: { title: 'ASC' } });
    const head = [
      'code',
      'title',
      'category',
      'quantity',
      'unit',
      'minQuantity',
      'location',
      'notes',
    ];
    const lines = rows.map((r) =>
      [
        r.code,
        r.title,
        r.category,
        r.quantity,
        r.unit,
        r.minQuantity,
        r.location,
        r.notes,
      ]
        .map(csvCell)
        .join(','),
    );
    return '\ufeff' + [head.join(','), ...lines].join('\r\n') + '\r\n';
  }

  private async docCounts(ids: string[], actor: Actor) {
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const qb = this.docs
      .createQueryBuilder('d')
      .select('d.inventoryItemId', 'id')
      .addSelect('COUNT(*)', 'n')
      .where('d.inventoryItemId IN (:...ids) AND d.archivedAt IS NULL', {
        ids,
      });
    if (!supervisor(actor.role)) {
      qb.andWhere('d.accessScope = :s', { s: AccessScope.Members });
    }
    const raw = await qb
      .groupBy('d.inventoryItemId')
      .getRawMany<{ id: string; n: string }>();
    for (const r of raw) map.set(r.id, Number(r.n));
    return map;
  }
}
