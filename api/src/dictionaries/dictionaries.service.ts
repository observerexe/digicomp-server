import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { OkDto } from '../common/responses.dto';
import { Dictionary, DictionaryItem } from './dictionary.entities';
import { DictionaryUsageRegistry } from './dictionary-usage';
import type {
  CreateDictionaryDto,
  CreateDictionaryItemDto,
  ReorderDictionaryItemsDto,
  UpdateDictionaryDto,
  UpdateDictionaryItemDto,
} from './dto';
import { uniqueKey } from './keys';
import type { DictionaryDto, DictionaryItemDto } from './responses.dto';

type Actor = { id: string; role: string };

function itemView(i: DictionaryItem): DictionaryItemDto {
  return {
    id: i.id,
    key: i.key,
    title: i.title,
    color: i.color,
    position: i.position,
    archived: i.archivedAt !== null,
  };
}

@Injectable()
export class DictionariesService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private usage: DictionaryUsageRegistry,
    private audit: AuditService,
  ) {}

  private view(
    d: Dictionary,
    items: DictionaryItem[],
    required: Set<string>,
  ): DictionaryDto {
    return {
      id: d.id,
      key: d.key,
      title: d.title,
      required: required.has(d.key),
      items: [...items].sort((a, b) => a.position - b.position).map(itemView),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  async list(): Promise<DictionaryDto[]> {
    const rows = await this.ds.getRepository(Dictionary).find({
      relations: { items: true },
      order: { title: 'ASC' },
    });
    const required = await this.usage.required(this.ds.manager);
    return rows.map((d) => this.view(d, d.items ?? [], required));
  }

  async get(key: string): Promise<DictionaryDto> {
    const d = await this.find(this.ds.manager, key);
    return this.view(
      d,
      await this.itemsOf(this.ds.manager, d.id),
      await this.usage.required(this.ds.manager),
    );
  }

  async create(dto: CreateDictionaryDto, actor: Actor): Promise<DictionaryDto> {
    const title = dto.title.trim();
    return this.ds.transaction(async (m) => {
      // One creator at a time: keys and titles are checked, then inserted.
      await m.query(`LOCK TABLE "dictionaries" IN SHARE ROW EXCLUSIVE MODE`);
      await this.assertTitleFree(m, title);
      const keys = (await m.find(Dictionary, { select: { key: true } })).map(
        (d) => d.key,
      );
      const d = await m.save(
        m.create(Dictionary, { key: uniqueKey(title, keys), title }),
      );
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'dictionary.created',
          entity: 'dictionary',
          entityId: d.id,
          meta: { key: d.key, title },
        },
        m,
      );
      return this.view(d, [], await this.usage.required(m));
    });
  }

  async update(
    key: string,
    dto: UpdateDictionaryDto,
    actor: Actor,
  ): Promise<DictionaryDto> {
    const title = dto.title.trim();
    return this.ds.transaction(async (m) => {
      const d = await this.find(m, key, true);
      if (d.title !== title) {
        await this.assertTitleFree(m, title, d.id);
        const from = d.title;
        d.title = title;
        await m.save(d);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'dictionary.updated',
            entity: 'dictionary',
            entityId: d.id,
            meta: { key, from, to: title },
          },
          m,
        );
      }
      return this.view(
        d,
        await this.itemsOf(m, d.id),
        await this.usage.required(m),
      );
    });
  }

  async remove(key: string, actor: Actor): Promise<OkDto> {
    return this.ds.transaction(async (m) => {
      const d = await this.find(m, key, true);
      if ((await this.usage.required(m)).has(key)) {
        throw new ConflictException('Dictionary is in use');
      }
      if (await m.existsBy(DictionaryItem, { dictionaryId: d.id })) {
        throw new ConflictException('Dictionary is not empty');
      }
      await m.delete(Dictionary, { id: d.id });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'dictionary.deleted',
          entity: 'dictionary',
          entityId: d.id,
          meta: { key, title: d.title },
        },
        m,
      );
      return { ok: true };
    });
  }

  async addItem(
    key: string,
    dto: CreateDictionaryItemDto,
    actor: Actor,
  ): Promise<DictionaryItemDto> {
    const title = dto.title.trim();
    return this.ds.transaction(async (m) => {
      // The dictionary row lock serialises changes to its items.
      const d = await this.find(m, key, true);
      const items = await this.itemsOf(m, d.id);
      this.assertItemTitleFree(items, title);
      const item = await m.save(
        m.create(DictionaryItem, {
          dictionaryId: d.id,
          key: uniqueKey(
            title,
            items.map((i) => i.key),
          ),
          title,
          color: dto.color ?? 'gray',
          position: items.reduce((n, i) => Math.max(n, i.position + 1), 0),
          archivedAt: null,
        }),
      );
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'dictionary.item_created',
          entity: 'dictionary_item',
          entityId: item.id,
          meta: { dictionary: key, key: item.key, title, color: item.color },
        },
        m,
      );
      return itemView(item);
    });
  }

  async updateItem(
    key: string,
    itemKey: string,
    dto: UpdateDictionaryItemDto,
    actor: Actor,
  ): Promise<DictionaryItemDto> {
    return this.ds.transaction(async (m) => {
      const d = await this.find(m, key, true);
      const items = await this.itemsOf(m, d.id);
      const item = this.findItem(items, itemKey);
      const changed: Record<string, unknown> = {};
      const title = dto.title?.trim();
      if (title !== undefined && title !== item.title) {
        this.assertItemTitleFree(items, title, item.id);
        changed.title = { from: item.title, to: title };
        item.title = title;
      }
      if (dto.color !== undefined && dto.color !== item.color) {
        changed.color = { from: item.color, to: dto.color };
        item.color = dto.color;
      }
      if (dto.archived !== undefined && dto.archived !== !!item.archivedAt) {
        changed.archived = dto.archived;
        item.archivedAt = dto.archived ? new Date() : null;
      }
      if (Object.keys(changed).length) {
        await m.save(item);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'dictionary.item_updated',
            entity: 'dictionary_item',
            entityId: item.id,
            meta: { dictionary: key, key: itemKey, ...changed },
          },
          m,
        );
      }
      return itemView(item);
    });
  }

  async reorder(
    key: string,
    dto: ReorderDictionaryItemsDto,
    actor: Actor,
  ): Promise<DictionaryDto> {
    return this.ds.transaction(async (m) => {
      const d = await this.find(m, key, true);
      const items = await this.itemsOf(m, d.id);
      const byKey = new Map(items.map((i) => [i.key, i]));
      if (
        dto.keys.length !== items.length ||
        new Set(dto.keys).size !== dto.keys.length ||
        dto.keys.some((k) => !byKey.has(k))
      ) {
        throw new BadRequestException('Order must list every item once');
      }
      dto.keys.forEach((k, position) => {
        byKey.get(k)!.position = position;
      });
      await m.save(items);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'dictionary.items_reordered',
          entity: 'dictionary',
          entityId: d.id,
          meta: { key, order: dto.keys },
        },
        m,
      );
      return this.view(d, items, await this.usage.required(m));
    });
  }

  async removeItem(key: string, itemKey: string, actor: Actor): Promise<OkDto> {
    return this.ds.transaction(async (m) => {
      const d = await this.find(m, key, true);
      const item = this.findItem(await this.itemsOf(m, d.id), itemKey);
      if (await this.usage.itemUsed(key, itemKey, m)) {
        throw new ConflictException('Dictionary item is in use');
      }
      await m.delete(DictionaryItem, { id: item.id });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'dictionary.item_deleted',
          entity: 'dictionary_item',
          entityId: item.id,
          meta: { dictionary: key, key: itemKey, title: item.title },
        },
        m,
      );
      return { ok: true };
    });
  }

  private async find(m: EntityManager, key: string, lock = false) {
    const d = await m.findOne(Dictionary, {
      where: { key },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!d) throw new NotFoundException('Dictionary not found');
    return d;
  }

  private itemsOf(m: EntityManager, dictionaryId: string) {
    return m.find(DictionaryItem, {
      where: { dictionaryId },
      order: { position: 'ASC' },
    });
  }

  private findItem(items: DictionaryItem[], itemKey: string) {
    const item = items.find((i) => i.key === itemKey);
    if (!item) throw new NotFoundException('Dictionary item not found');
    return item;
  }

  private async assertTitleFree(m: EntityManager, title: string, id?: string) {
    const qb = m
      .createQueryBuilder(Dictionary, 'd')
      .where('lower(d.title) = lower(:title)', { title });
    if (id) qb.andWhere('d.id <> :id', { id });
    if (await qb.getExists()) {
      throw new ConflictException('Dictionary title already used');
    }
  }

  private assertItemTitleFree(
    items: DictionaryItem[],
    title: string,
    id?: string,
  ) {
    const lower = title.toLowerCase();
    if (items.some((i) => i.id !== id && i.title.toLowerCase() === lower)) {
      throw new ConflictException('Dictionary item title already used');
    }
  }
}
