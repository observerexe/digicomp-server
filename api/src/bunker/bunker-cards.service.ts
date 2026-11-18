import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, assertCan, can } from '../auth/policy';
import { escapeLike } from '../common/like';
import type { Plain } from '../common/responses.dto';
import { User } from '../users/user.entity';
import { BunkerCard, BunkerPack, BunkerPackCard } from './bunker.entities';
import { CardFields, cardProblem, normalCard, snapshot } from './cards';
import type {
  CreateCardDto,
  CreatePackDto,
  ImportPackDto,
  ListCardsQuery,
  UpdateCardDto,
  UpdatePackDto,
} from './dto';
import { shuffle, type CardSnap } from './engine';
import { CARD_KINDS, CardKind, cardsNeeded } from './kinds';
import type {
  BunkerCardDto,
  BunkerCardListDto,
  BunkerPackDetailDto,
  BunkerPackDto,
  BunkerPackFileDto,
} from './responses.dto';

type Actor = { id: string; role: string };

export function userRef(u: User | null | undefined, id: string) {
  return {
    id,
    name: u?.name ?? null,
    avatarUrl: u?.avatarUrl ?? null,
    color: u?.color ?? 'gray',
  };
}

const kindOrder = (k: CardKind) => CARD_KINDS.indexOf(k);

/** Cards and packs of «Бункер»: the library, packs made of it, the deal. */
@Injectable()
export class BunkerCardsService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  /** Own content, or moderation of another's (the policy). */
  private mayEdit(
    actor: Actor,
    item: { authorId: string | null; builtin: boolean; author?: User | null },
  ) {
    if (item.builtin) return false;
    if (item.authorId === actor.id) return true;
    const target = item.author
      ? { id: item.author.id, role: item.author.role }
      : undefined;
    return can(actor, Action.BunkerModerate, { target });
  }

  private assertEdit(
    actor: Actor,
    item: { authorId: string | null; builtin: boolean; author?: User | null },
  ) {
    if (item.builtin)
      throw new ForbiddenException('Built-in cards are read-only');
    if (item.authorId === actor.id) return;
    const target = item.author
      ? { id: item.author.id, role: item.author.role }
      : undefined;
    assertCan(actor, Action.BunkerModerate, { target });
  }

  private cardView(
    c: BunkerCard,
    actor: Actor,
    packCount: number,
  ): Plain<BunkerCardDto> {
    return {
      id: c.id,
      kind: c.kind,
      title: c.title,
      text: c.text,
      effect: c.effect,
      effectKind: c.effectKind,
      author: c.authorId ? userRef(c.author, c.authorId) : null,
      builtin: c.builtin,
      canEdit: this.mayEdit(actor, c),
      packCount,
      updatedAt: c.updatedAt,
    };
  }

  private async packCounts(m: EntityManager, cardIds: string[]) {
    if (!cardIds.length) return new Map<string, number>();
    const rows: { card_id: string; n: string }[] = await m.query(
      `SELECT "card_id", count(*) AS n FROM "bunker_pack_cards" WHERE "card_id" = ANY($1) GROUP BY "card_id"`,
      [cardIds],
    );
    return new Map(rows.map((r) => [r.card_id, Number(r.n)]));
  }

  async listCards(q: ListCardsQuery, actor: Actor): Promise<BunkerCardListDto> {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const qb = this.ds
      .getRepository(BunkerCard)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author');
    if (q.kind) qb.andWhere('c.kind = :kind', { kind: q.kind });
    if (q.mine) qb.andWhere('c.authorId = :me', { me: actor.id });
    if (q.search) {
      qb.andWhere('(c.text ILIKE :s OR c.title ILIKE :s)', {
        s: `%${escapeLike(q.search)}%`,
      });
    }
    if (q.notInPack) {
      qb.andWhere(
        'NOT EXISTS (SELECT 1 FROM "bunker_pack_cards" pc WHERE pc."card_id" = c.id AND pc."pack_id" = :pack)',
        { pack: q.notInPack },
      );
    }
    // Made by people first, newest on top; the built-in pack after them.
    qb.orderBy('c.builtin', 'ASC')
      .addOrderBy('c.updatedAt', 'DESC')
      .addOrderBy('c.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);
    const [rows, total] = await qb.getManyAndCount();
    const counts = await this.packCounts(
      this.ds.manager,
      rows.map((c) => c.id),
    );
    return {
      items: rows.map((c) => this.cardView(c, actor, counts.get(c.id) ?? 0)),
      total,
      page,
      limit,
    };
  }

  private async card(m: EntityManager, id: string) {
    const c = await m.findOne(BunkerCard, {
      where: { id },
      relations: { author: true },
    });
    if (!c) throw new NotFoundException('Bunker card not found');
    return c;
  }

  private async pack(m: EntityManager, id: string) {
    const p = await m.findOne(BunkerPack, {
      where: { id },
      relations: { author: true },
    });
    if (!p) throw new NotFoundException('Bunker pack not found');
    return p;
  }

  private checkCard(fields: CardFields) {
    const field = cardProblem(fields);
    if (field)
      throw new BadRequestException({ message: 'Invalid card', field });
  }

  async createCard(dto: CreateCardDto, actor: Actor) {
    const fields = normalCard(dto);
    this.checkCard(fields);
    return this.ds.transaction(async (m) => {
      if (dto.packId) this.assertEdit(actor, await this.pack(m, dto.packId));
      const c = await m.save(
        BunkerCard,
        m.create(BunkerCard, { ...fields, authorId: actor.id }),
      );
      if (dto.packId) {
        await m.insert(BunkerPackCard, { packId: dto.packId, cardId: c.id });
        await m.update(BunkerPack, dto.packId, { updatedAt: new Date() });
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.card_created',
          entity: 'bunker_card',
          entityId: c.id,
          meta: { kind: c.kind, packId: dto.packId },
        },
        m,
      );
      return this.cardView(await this.card(m, c.id), actor, dto.packId ? 1 : 0);
    });
  }

  async updateCard(id: string, dto: UpdateCardDto, actor: Actor) {
    return this.ds.transaction(async (m) => {
      const c = await this.card(m, id);
      this.assertEdit(actor, c);
      const fields = normalCard({
        kind: dto.kind ?? c.kind,
        title: dto.title ?? c.title,
        text: dto.text ?? c.text,
        effect: dto.effect !== undefined ? dto.effect : c.effect,
        effectKind:
          dto.effectKind !== undefined ? dto.effectKind : c.effectKind,
      });
      this.checkCard(fields);
      const changed = (Object.keys(fields) as (keyof CardFields)[]).filter(
        (k) => fields[k] !== c[k],
      );
      if (changed.length) {
        await m.update(BunkerCard, id, fields);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'bunker.card_updated',
            entity: 'bunker_card',
            entityId: id,
            meta: { fields: changed, authorId: c.authorId },
          },
          m,
        );
      }
      const counts = await this.packCounts(m, [id]);
      return this.cardView(await this.card(m, id), actor, counts.get(id) ?? 0);
    });
  }

  /** Deletes the card everywhere: from every pack too (games already dealt keep their copy). */
  async deleteCard(id: string, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const c = await this.card(m, id);
      this.assertEdit(actor, c);
      const counts = await this.packCounts(m, [id]);
      await m.delete(BunkerCard, id);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.card_deleted',
          entity: 'bunker_card',
          entityId: id,
          meta: {
            kind: c.kind,
            text: c.text,
            authorId: c.authorId,
            packs: counts.get(id) ?? 0,
          },
        },
        m,
      );
    });
    return { ok: true as const };
  }

  private async kindCounts(m: EntityManager, packIds: string[]) {
    const out = new Map<string, Map<CardKind, number>>();
    if (!packIds.length) return out;
    const rows: { pack_id: string; kind: CardKind; n: string }[] =
      await m.query(
        `SELECT pc."pack_id", c."kind", count(*) AS n FROM "bunker_pack_cards" pc
       JOIN "bunker_cards" c ON c."id" = pc."card_id" WHERE pc."pack_id" = ANY($1) GROUP BY 1, 2`,
        [packIds],
      );
    for (const r of rows) {
      if (!out.has(r.pack_id)) out.set(r.pack_id, new Map());
      out.get(r.pack_id)!.set(r.kind, Number(r.n));
    }
    return out;
  }

  private packView(
    p: BunkerPack,
    actor: Actor,
    counts: Map<CardKind, number> | undefined,
  ): Plain<BunkerPackDto> {
    const list = CARD_KINDS.map((kind) => ({
      kind,
      count: counts?.get(kind) ?? 0,
    }));
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      author: p.authorId ? userRef(p.author, p.authorId) : null,
      builtin: p.builtin,
      canEdit: this.mayEdit(actor, p),
      cardCount: list.reduce((a, c) => a + c.count, 0),
      counts: list,
      updatedAt: p.updatedAt,
    };
  }

  async listPacks(actor: Actor) {
    const packs = await this.ds
      .getRepository(BunkerPack)
      .find({ relations: { author: true } });
    const counts = await this.kindCounts(
      this.ds.manager,
      packs.map((p) => p.id),
    );
    // The built-in one, then the reader's, then the rest by name.
    const rank = (p: BunkerPack) =>
      p.builtin ? 0 : p.authorId === actor.id ? 1 : 2;
    packs.sort(
      (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'uk'),
    );
    return {
      items: packs.map((p) => this.packView(p, actor, counts.get(p.id))),
    };
  }

  async getPack(id: string, actor: Actor): Promise<BunkerPackDetailDto> {
    const m = this.ds.manager;
    const p = await this.pack(m, id);
    const cards = await m
      .getRepository(BunkerCard)
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .innerJoin(BunkerPackCard, 'pc', 'pc.cardId = c.id AND pc.packId = :id', {
        id,
      })
      .getMany();
    cards.sort(
      (a, b) =>
        kindOrder(a.kind) - kindOrder(b.kind) ||
        a.text.localeCompare(b.text, 'uk'),
    );
    const packCounts = await this.packCounts(
      m,
      cards.map((c) => c.id),
    );
    const counts = await this.kindCounts(m, [id]);
    return {
      ...this.packView(p, actor, counts.get(id)),
      cards: cards.map((c) =>
        this.cardView(c, actor, packCounts.get(c.id) ?? 0),
      ),
    };
  }

  async createPack(dto: CreatePackDto, actor: Actor) {
    const id = await this.ds.transaction(async (m) => {
      const source = dto.copyOf ? await this.pack(m, dto.copyOf) : null;
      const p = await m.save(
        BunkerPack,
        m.create(BunkerPack, {
          name: dto.name.trim(),
          description: (dto.description ?? '').trim(),
          authorId: actor.id,
        }),
      );
      if (source) {
        await m.query(
          `INSERT INTO "bunker_pack_cards" ("pack_id", "card_id") SELECT $1, "card_id" FROM "bunker_pack_cards" WHERE "pack_id" = $2`,
          [p.id, source.id],
        );
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.pack_created',
          entity: 'bunker_pack',
          entityId: p.id,
          meta: { name: p.name, copyOf: source?.id },
        },
        m,
      );
      return p.id;
    });
    return this.getPack(id, actor);
  }

  async updatePack(id: string, dto: UpdatePackDto, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const p = await this.pack(m, id);
      this.assertEdit(actor, p);
      const next = {
        name: dto.name?.trim() ?? p.name,
        description: dto.description?.trim() ?? p.description,
      };
      const changed = (['name', 'description'] as const).filter(
        (k) => next[k] !== p[k],
      );
      if (!changed.length) return;
      await m.update(BunkerPack, id, next);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.pack_updated',
          entity: 'bunker_pack',
          entityId: id,
          meta: { fields: changed, authorId: p.authorId },
        },
        m,
      );
    });
    return this.getPack(id, actor);
  }

  async addCards(id: string, cardIds: string[], actor: Actor) {
    await this.ds.transaction(async (m) => {
      const p = await this.pack(m, id);
      this.assertEdit(actor, p);
      const ids = [...new Set(cardIds)];
      if ((await m.countBy(BunkerCard, { id: In(ids) })) !== ids.length) {
        throw new NotFoundException('Bunker card not found');
      }
      if (!ids.length) return;
      await m
        .createQueryBuilder()
        .insert()
        .into(BunkerPackCard)
        .values(ids.map((cardId) => ({ packId: id, cardId })))
        .orIgnore()
        .execute();
      await m.update(BunkerPack, id, { updatedAt: new Date() });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.pack_updated',
          entity: 'bunker_pack',
          entityId: id,
          meta: { added: ids.length, authorId: p.authorId },
        },
        m,
      );
    });
    return this.getPack(id, actor);
  }

  async removeCard(id: string, cardId: string, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const p = await this.pack(m, id);
      this.assertEdit(actor, p);
      const res = await m.delete(BunkerPackCard, { packId: id, cardId });
      if (!res.affected) return;
      await m.update(BunkerPack, id, { updatedAt: new Date() });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.pack_updated',
          entity: 'bunker_pack',
          entityId: id,
          meta: { removed: cardId, authorId: p.authorId },
        },
        m,
      );
    });
    return this.getPack(id, actor);
  }

  /** The pack goes; its cards stay in the library and in other packs. */
  async deletePack(id: string, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const p = await this.pack(m, id);
      this.assertEdit(actor, p);
      await m.delete(BunkerPack, id);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.pack_deleted',
          entity: 'bunker_pack',
          entityId: id,
          meta: { name: p.name, authorId: p.authorId },
        },
        m,
      );
    });
    return { ok: true as const };
  }

  async exportPack(id: string, actor: Actor): Promise<BunkerPackFileDto> {
    const p = await this.getPack(id, actor);
    return {
      format: 'digicomp-bunker-pack',
      name: p.name,
      description: p.description,
      cards: p.cards.map((c) => ({
        kind: c.kind,
        title: c.title,
        text: c.text,
        effect: c.effect,
        effectKind: c.effectKind,
      })),
    };
  }

  /** A pack from a file: its cards become the reader's own new cards. */
  async importPack(dto: ImportPackDto, actor: Actor) {
    const cards = dto.cards.map((c) => normalCard(c));
    cards.forEach((c) => this.checkCard(c));
    const id = await this.ds.transaction(async (m) => {
      const p = await m.save(
        BunkerPack,
        m.create(BunkerPack, {
          name: dto.name.trim(),
          description: (dto.description ?? '').trim(),
          authorId: actor.id,
        }),
      );
      if (cards.length) {
        const saved = await m.save(
          BunkerCard,
          cards.map((c) => m.create(BunkerCard, { ...c, authorId: actor.id })),
        );
        await m.insert(
          BunkerPackCard,
          saved.map((c) => ({ packId: p.id, cardId: c.id })),
        );
      }
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'bunker.pack_created',
          entity: 'bunker_pack',
          entityId: p.id,
          meta: { name: p.name, imported: cards.length },
        },
        m,
      );
      return p.id;
    });
    return this.getPack(id, actor);
  }

  /** Names of the packs that still exist, in the given order. */
  async packRefs(m: EntityManager, ids: string[]) {
    if (!ids.length) return [];
    const rows = await m.find(BunkerPack, {
      where: { id: In(ids) },
      select: { id: true, name: true },
    });
    return ids.flatMap((id) => {
      const p = rows.find((r) => r.id === id);
      return p ? [{ id: p.id, name: p.name }] : [];
    });
  }

  /**
   * The cards a game of `players` is dealt from: those of the chosen packs,
   * and of the built-in pack for every kind they have too few of.
   */
  async pool(m: EntityManager, packIds: string[], players: number) {
    const chosen = packIds.length
      ? await m
          .getRepository(BunkerCard)
          .createQueryBuilder('c')
          .where(
            'EXISTS (SELECT 1 FROM "bunker_pack_cards" pc WHERE pc."card_id" = c.id AND pc."pack_id" = ANY(:ids))',
            { ids: packIds },
          )
          .getMany()
      : [];
    const pool: Partial<Record<CardKind, CardSnap[]>> = {};
    for (const c of chosen) (pool[c.kind] ??= []).push(snapshot(c));
    const lacking = CARD_KINDS.filter(
      (k) => (pool[k]?.length ?? 0) < cardsNeeded(k, players),
    );
    if (lacking.length) {
      const have = new Set(chosen.map((c) => c.id));
      const base = await m.find(BunkerCard, {
        where: { builtin: true, kind: In(lacking) },
      });
      for (const kind of lacking) {
        // Only what is short (and two spare for «Нова карта»): the pack's own cards stay the most.
        const short =
          cardsNeeded(kind, players) - (pool[kind]?.length ?? 0) + 2;
        const extra = shuffle(
          base.filter((c) => c.kind === kind && !have.has(c.id)),
          (n) => randomInt(n),
        ).slice(0, short);
        (pool[kind] ??= []).push(...extra.map(snapshot));
      }
    }
    return pool;
  }
}
