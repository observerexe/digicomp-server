import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { Dictionary, DictionaryItem } from './dictionary.entities';

/**
 * What a module tells the dictionaries about itself. A module that stores
 * item keys in its records registers one of these in onModuleInit.
 */
export type DictionaryUsage = {
  /** Dictionaries the module relies on: they cannot be deleted. */
  dictionaries(m: EntityManager): Promise<readonly string[]>;
  /** How many of the module's records hold this item (0 = free to delete). */
  countItem(
    dictionaryKey: string,
    itemKey: string,
    m: EntityManager,
  ): Promise<number>;
};

@Injectable()
export class DictionaryUsageRegistry {
  private usages: DictionaryUsage[] = [];

  register(usage: DictionaryUsage) {
    this.usages.push(usage);
  }

  /** The common case: one column of an entity holds keys of one dictionary. */
  registerColumn<T extends ObjectLiteral>(
    dictionaryKey: string,
    entity: EntityTarget<T>,
    property: keyof T & string,
  ) {
    this.register({
      dictionaries: () => Promise.resolve([dictionaryKey]),
      countItem: (d, itemKey, m) =>
        d === dictionaryKey
          ? m.getRepository(entity).countBy({ [property]: itemKey } as never)
          : Promise.resolve(0),
    });
  }

  /** Keys of dictionaries some module relies on. */
  async required(m: EntityManager): Promise<Set<string>> {
    const out = new Set<string>();
    for (const u of this.usages) {
      for (const key of await u.dictionaries(m)) out.add(key);
    }
    return out;
  }

  async itemUsed(dictionaryKey: string, itemKey: string, m: EntityManager) {
    for (const u of this.usages) {
      if ((await u.countItem(dictionaryKey, itemKey, m)) > 0) return true;
    }
    return false;
  }
}

/**
 * The item a module files its own records under (signed scans in the
 * archive): the one with `key`, else the one titled `title` (staff made it
 * by hand), else a new one — also when staff deleted it. Archived stays
 * archived: the item is still valid. `created` — the new item, for the audit.
 */
export async function ensureDictionaryItem(
  m: EntityManager,
  dictionaryKey: string,
  key: string,
  title: string,
): Promise<{ key: string; created: DictionaryItem | null }> {
  // The dictionary row lock serialises changes to its items.
  const d = await m.findOne(Dictionary, {
    where: { key: dictionaryKey },
    lock: { mode: 'pessimistic_write' },
  });
  if (!d) throw new Error(`Dictionary ${dictionaryKey} is missing`);
  const items = await m.findBy(DictionaryItem, { dictionaryId: d.id });
  const found =
    items.find((i) => i.key === key) ??
    items.find(
      (i) => i.title.toLocaleLowerCase('uk') === title.toLocaleLowerCase('uk'),
    );
  if (found) return { key: found.key, created: null };
  const created = await m.save(
    m.create(DictionaryItem, {
      dictionaryId: d.id,
      key,
      title,
      color: 'gray',
      position: items.reduce((n, i) => Math.max(n, i.position + 1), 0),
      archivedAt: null,
    }),
  );
  return { key, created };
}

/**
 * A record may get only an active item of the dictionary. An archived item
 * stays valid where it is already set (`current`), so old records still save.
 */
export async function assertDictionaryItem(
  m: EntityManager,
  dictionaryKey: string,
  itemKey: string,
  current?: string,
) {
  if (itemKey === current) return;
  const item = await m
    .createQueryBuilder(DictionaryItem, 'i')
    .innerJoin(Dictionary, 'd', 'd.id = i.dictionaryId')
    .where('d.key = :dictionaryKey AND i.key = :itemKey', {
      dictionaryKey,
      itemKey,
    })
    .getOne();
  if (!item || item.archivedAt) {
    throw new BadRequestException('Unknown dictionary item');
  }
}

/**
 * SQL condition for text search by item title in a column of item keys.
 * The caller passes the dictionary key and the ILIKE pattern as parameters.
 */
export function itemTitleLike(
  column: string,
  dictionaryParam: string,
  patternParam: string,
) {
  return `${column} IN (SELECT di.key FROM dictionary_items di JOIN dictionaries dd ON dd.id = di.dictionary_id WHERE dd.key = :${dictionaryParam} AND di.title ILIKE :${patternParam})`;
}

/** Item key → title of one dictionary, archived items included. */
export async function itemTitles(m: EntityManager, dictionaryKey: string) {
  const rows = await m
    .createQueryBuilder(DictionaryItem, 'i')
    .innerJoin(Dictionary, 'd', 'd.id = i.dictionaryId')
    .where('d.key = :dictionaryKey', { dictionaryKey })
    .getMany();
  return new Map(rows.map((i) => [i.key, i.title]));
}

/** Which of these item keys are active (existing and not archived). */
export async function activeItemKeys(
  m: EntityManager,
  dictionaryKey: string,
  keys: readonly string[],
): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await m
    .createQueryBuilder(DictionaryItem, 'i')
    .innerJoin(Dictionary, 'd', 'd.id = i.dictionaryId')
    .where('d.key = :dictionaryKey AND i.key IN (:...keys)', {
      dictionaryKey,
      keys,
    })
    .andWhere('i.archivedAt IS NULL')
    .getMany();
  return new Set(rows.map((i) => i.key));
}
