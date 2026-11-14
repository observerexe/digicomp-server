import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Actor } from '../auth/policy';
import type { RecordType } from '../records/field-types';

/** What a link shows about the record on the other side. */
export type LinkedRecord = { title: string; archived: boolean };

/**
 * What a module tells the links about its record type. A module whose
 * records may be linked registers one of these in onModuleInit; types that
 * are not registered cannot be linked.
 */
export type LinkableType = {
  /**
   * May the actor edit the record (and so link it to others)? `true` or the
   * errorCode the module gives when its record cannot be edited. Goes through
   * policy.ts: `check(actor, Action.X, ctx)`.
   */
  checkEdit(actor: Actor, id: string, m: EntityManager): Promise<true | string>;
  /** Records among `ids` that the actor may see, by id. */
  find(
    ids: string[],
    actor: Actor,
    m: EntityManager,
  ): Promise<Map<string, LinkedRecord>>;
};

@Injectable()
export class LinkRegistry {
  private types = new Map<string, LinkableType>();

  register(type: RecordType, linkable: LinkableType) {
    this.types.set(type, linkable);
  }

  get(type: string): LinkableType | undefined {
    return this.types.get(type);
  }

  /** Registered types, sorted (for docs and tests). */
  registered(): string[] {
    return [...this.types.keys()].sort();
  }
}
