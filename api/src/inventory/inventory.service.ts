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
  EntityManager,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, can } from '../auth/policy';
import {
  assertDictionaryItem,
  itemTitleLike,
  itemTitles,
} from '../dictionaries/dictionary-usage';
import {
  CreateItemDto,
  ListItemsQuery,
  ListMovementsQuery,
  MovementDto,
  UpdateItemDto,
  WriteOffDto,
} from './dto';
import {
  INVENTORY_CATEGORY,
  InventoryItem,
  InventoryMovement,
} from './inventory.entities';
import { csvCell } from '../common/csv';
import type { Plain } from '../common/responses.dto';
import { isUUID } from 'class-validator';
import type {
  InventoryItemDto,
  InventoryItemListDto,
  InventoryMovementDto,
  InventoryMovementListDto,
} from './responses.dto';
import { escapeLike } from '../common/like';

type Actor = { id: string; role: string };

/** One movement of an item, made in the caller's transaction. */
type Move = {
  delta: number;
  note: string;
  projectId: string | null;
  paperId: string | null;
  idempotencyKey: string | null;
};

const RELATIONS = { item: true, actor: true, paper: true } as const;

const INTEGER_UNITS = ['шт', 'pcs', 'уп'];

function isIntegerUnit(unit: string) {
  return INTEGER_UNITS.includes(unit.trim().toLowerCase());
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function itemView(i: InventoryItem): Plain<InventoryItemDto> {
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
    createdById: i.createdById,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

function movementView(m: InventoryMovement): InventoryMovementDto {
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
    paper: m.paper ? { id: m.paper.id, number: m.paper.number } : null,
    actor: m.actor ? { id: m.actor.id, name: m.actor.name } : { id: m.actorId },
    createdAt: m.createdAt,
  };
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem) private items: Repository<InventoryItem>,
    @InjectRepository(InventoryMovement)
    private moves: Repository<InventoryMovement>,
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  async list(q: ListItemsQuery): Promise<InventoryItemListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(200, Math.max(1, Number(q.limit ?? 100)));
    const qb = this.items.createQueryBuilder('i');
    if (q.category) qb.andWhere('i.category = :cat', { cat: q.category });
    if (q.lowStock) {
      qb.andWhere('i.minQuantity > 0 AND i.quantity <= i.minQuantity');
    }
    if (q.search) {
      qb.andWhere(
        `(i.title ILIKE :s OR i.code ILIKE :s OR i.location ILIKE :s OR ${itemTitleLike('i.category', 'dict', 's')})`,
        { s: `%${escapeLike(q.search)}%`, dict: INVENTORY_CATEGORY },
      );
    }
    qb.orderBy('i.title', 'ASC')
      .addOrderBy('i.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map(itemView),
      total,
      page,
      limit,
    };
  }

  /** By id or by the QR code printed on the sticker. */
  async get(idOrCode: string): Promise<Plain<InventoryItemDto>> {
    const i = await this.items.findOneBy(
      isUUID(idOrCode, 'all')
        ? { id: idOrCode }
        : { code: idOrCode.toUpperCase() },
    );
    if (!i) throw new NotFoundException('Item not found');
    return itemView(i);
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
      await assertDictionaryItem(m, INVENTORY_CATEGORY, dto.category);
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
      return itemView(item);
    });
  }

  async update(id: string, dto: UpdateItemDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const item = await m.findOne(InventoryItem, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item) throw new NotFoundException('Item not found');
      if (dto.category !== undefined) {
        await assertDictionaryItem(
          m,
          INVENTORY_CATEGORY,
          dto.category,
          item.category,
        );
      }
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
    if (dto.delta > 0 && !can(actor, Action.InventoryRestock)) {
      throw new ForbiddenException('Not allowed to receive stock');
    }
    return this.ds.transaction(async (m) => {
      // The item first: a repeat of the same key waits for the first one.
      const locked = await m.findOne(InventoryItem, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundException('Item not found');
      if (dto.idempotencyKey) {
        const prev = await m.findOne(InventoryMovement, {
          where: { actorId: actor.id, idempotencyKey: dto.idempotencyKey },
          relations: RELATIONS,
        });
        if (prev) return movementView(prev);
      }
      const saved = await this.apply(m, id, actor, {
        delta: dto.delta,
        note: dto.note,
        projectId: dto.projectId ?? null,
        paperId: null,
        idempotencyKey: dto.idempotencyKey ?? null,
      });
      return movementView(
        await m.findOneOrFail(InventoryMovement, {
          where: { id: saved.id },
          relations: RELATIONS,
        }),
      );
    });
  }

  /**
   * A row of «Акт списання» (`paperId`), in the document's transaction:
   * the stock goes down as if taken. Returns the movement's id.
   */
  async writeOff(
    m: EntityManager,
    dto: WriteOffDto,
    actor: Actor,
    paperId: string,
  ) {
    const saved = await this.apply(m, dto.itemId, actor, {
      delta: -dto.quantity,
      note: dto.note,
      projectId: null,
      paperId,
      idempotencyKey: null,
    });
    return saved.id;
  }

  /**
   * Its act is cancelled: what it wrote off comes back by a new movement
   * (the journal is never changed). Staff only.
   */
  async returnWriteOff(
    m: EntityManager,
    id: string,
    reason: string,
    actor: Actor,
  ) {
    if (!can(actor, Action.InventoryManage)) {
      throw new ForbiddenException('Not allowed to return a write-off');
    }
    const w = await m.findOneBy(InventoryMovement, { id });
    if (!w || w.delta >= 0) return;
    await this.apply(m, w.itemId, actor, {
      delta: -w.delta,
      note: `Скасовано списання: ${reason}`.slice(0, 500),
      projectId: null,
      paperId: w.paperId,
      idempotencyKey: null,
    });
  }

  /** Changes the balance of an item and writes the movement and audit. */
  private async apply(
    m: EntityManager,
    id: string,
    actor: Actor,
    mv: Move,
  ): Promise<InventoryMovement> {
    if (mv.delta === 0) {
      throw new BadRequestException('Delta must not be zero');
    }
    const note = mv.note.trim();
    if (!note) throw new BadRequestException('Note is required');
    const item = await m.findOne(InventoryItem, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!item) throw new NotFoundException('Item not found');
    if (isIntegerUnit(item.unit) && !Number.isInteger(mv.delta)) {
      throw new BadRequestException('Delta must be an integer for this unit');
    }
    const next = round3(item.quantity + mv.delta);
    if (next < 0) throw new ConflictException('Insufficient stock');
    item.quantity = next;
    await m.save(InventoryItem, item);
    const saved = await m.save(
      InventoryMovement,
      m.create(InventoryMovement, {
        itemId: id,
        delta: mv.delta,
        quantityAfter: next,
        note,
        projectId: mv.projectId,
        paperId: mv.paperId,
        actorId: actor.id,
        idempotencyKey: mv.idempotencyKey,
      }),
    );
    await this.audit.log(
      {
        actorId: actor.id,
        action: 'inventory.movement',
        entity: 'inventory_item',
        entityId: id,
        meta: {
          delta: mv.delta,
          after: next,
          ...(mv.paperId ? { paperId: mv.paperId } : {}),
        },
      },
      m,
    );
    return saved;
  }

  async listMovements(
    q: ListMovementsQuery,
  ): Promise<InventoryMovementListDto> {
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
      relations: RELATIONS,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items: rows.map(movementView), total, page, limit };
  }

  /** Categories as titles: the file is read by people and spreadsheets. */
  async exportCsv() {
    const rows = await this.items.find({ order: { title: 'ASC' } });
    const titles = await itemTitles(this.ds.manager, INVENTORY_CATEGORY);
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
        titles.get(r.category) ?? r.category,
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
}
