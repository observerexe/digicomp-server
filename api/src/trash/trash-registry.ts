import { Injectable } from '@nestjs/common';
import type { EntityManager, EntityTarget } from 'typeorm';
import type { Action, Actor } from '../auth/policy';

/** Record types that go to the trash on «Видалити». */
export const TRASH_TYPES = [
  'place',
  'inventory_item',
  'document',
  'project',
] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

/** Days in the trash before the server deletes for good. */
export const TRASH_DAYS = 90;

/** The columns every record of the trash has. */
export type TrashRow = {
  id: string;
  title: string;
  deletedAt: Date | null;
  deletedById: string | null;
  purgedAt: Date | null;
};

/**
 * What a module tells the trash about its records. The trash knows no
 * sections: a module registers one of these in onModuleInit. Each method
 * works in the trash's transaction (`m`), the record's row locked.
 */
export type TrashableType = {
  entity: EntityTarget<TrashRow>;
  /** The module's right to move a record to the trash. */
  manage: Action;
  /**
   * Before the record goes to the trash: throws to refuse (equipment in
   * use), does what goes with it (bookings cancelled, stock written off).
   */
  beforeDelete?(id: string, actor: Actor, m: EntityManager): Promise<void>;
  /**
   * Rows of the module refer to the record (sessions, faults, movements):
   * deleted for good, it keeps its title. Documents of the editor are
   * checked by the trash itself.
   */
  hasHistory(id: string, m: EntityManager): Promise<boolean>;
  /**
   * Deleted for good: erases what goes with the record. `keep` — its row
   * stays with the title (and code) only; otherwise its dependents go so
   * the row may be deleted. Returns storage paths to remove after the commit.
   */
  purge(id: string, keep: boolean, m: EntityManager): Promise<string[]>;
};

@Injectable()
export class TrashRegistry {
  private types = new Map<TrashType, TrashableType>();

  register(type: TrashType, t: TrashableType) {
    this.types.set(type, t);
  }

  get(type: TrashType): TrashableType | undefined {
    return this.types.get(type);
  }

  /** Registered types, in the order of TRASH_TYPES. */
  entries(): [TrashType, TrashableType][] {
    return TRASH_TYPES.flatMap((k) => {
      const t = this.types.get(k);
      return t ? [[k, t] as [TrashType, TrashableType]] : [];
    });
  }
}
