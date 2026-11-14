import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { Dictionary, DictionaryItem } from './dictionary.entities';

/**
 * What a module tells the dictionaries about itself. A module that stores
 * item keys in its records registers one of these in onModuleInit.
 */
export type DictionaryUsage = {
  /** Dictionaries the module relies on: they cannot be deleted. */
  dictionaries: readonly string[];
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
      dictionaries: [dictionaryKey],
      countItem: (d, itemKey, m) =>
        d === dictionaryKey
          ? m.getRepository(entity).countBy({ [property]: itemKey } as never)
          : Promise.resolve(0),
    });
  }

  required(dictionaryKey: string) {
    return this.usages.some((u) => u.dictionaries.includes(dictionaryKey));
  }

  async itemUsed(dictionaryKey: string, itemKey: string, m: EntityManager) {
    for (const u of this.usages) {
      if ((await u.countItem(dictionaryKey, itemKey, m)) > 0) return true;
    }
    return false;
  }
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
