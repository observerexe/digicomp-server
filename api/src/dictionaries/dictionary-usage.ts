import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

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
