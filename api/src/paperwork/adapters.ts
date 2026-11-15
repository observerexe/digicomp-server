import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { EntityManager } from 'typeorm';
import type { Actor } from '../auth/policy';
import type { RecordType } from '../records/field-types';
import { fieldInvalid } from './paper-fields';

/**
 * Values of a record's fields by the keys of its schema (records/), as JSON:
 * text, numbers, booleans, ISO dates, ids; a list — an array; null — empty.
 */
export type RecordValues = Record<string, unknown>;

/** What a document shows of its record now. */
export type ResolvedRecord = {
  values: RecordValues;
  /** The record is done: its document may be frozen (stage 4). */
  ready: boolean;
};

/**
 * Who sees documents of this type through their records: everyone (`true`),
 * nobody but the usual readers (`false`), or an SQL condition over the
 * document `p` — its record id `p.target_id`, or its own `p.id` for the
 * records of its rows (named parameters, prefixed by the type).
 */
export type TargetSeen =
  boolean | { sql: string; params: Record<string, unknown> };

/**
 * What a module tells the editor about records its documents create. The
 * editor knows no sections: a module registers this in onModuleInit; record
 * types without one have no `creates` templates.
 *
 * Each method works in the document's transaction (`m`) through the module's
 * own service: its policy checks, audit and errorCode. An error about one
 * field of the record carries `field` — the key of the schema field: the
 * editor shows it on the template's field bound to it.
 */
export type PaperAdapter = {
  /**
   * Creates the record from the values of bound fields; returns its id.
   * «Рядок = запис»: called for each row, with the values of its columns.
   * `paperId` — the document being published (a module may keep it).
   */
  publish(
    values: RecordValues,
    actor: Actor,
    m: EntityManager,
    paperId: string,
  ): Promise<string>;
  /**
   * May the actor change the record now (its right and its state): fields
   * of a published document bound to it change only then.
   */
  canUpdate(id: string, actor: Actor, m: EntityManager): Promise<boolean>;
  /**
   * Changes the record: only the given fields (null — emptied), as the
   * module's own PATCH does it.
   */
  update(
    id: string,
    values: RecordValues,
    actor: Actor,
    m: EntityManager,
  ): Promise<void>;
  /**
   * Takes the record off (the document is cancelled). May return work for
   * after the commit (files of a deleted record).
   */
  cancel(
    id: string,
    reason: string,
    actor: Actor,
    m: EntityManager,
  ): Promise<(() => Promise<void>) | void>;
  /** The record now; null — there is none any more. */
  resolve(id: string, m: EntityManager): Promise<ResolvedRecord | null>;
  /** Who sees a published document through its records (see TargetSeen). */
  canView(actor: Actor): TargetSeen;
};

/**
 * The DTO of the module's service from the values of bound fields, checked
 * as the module's controller checks it: a wrong value — PAPER_FIELD_INVALID
 * with the key of the record's field.
 */
export async function recordInput<T extends object>(
  Dto: new () => T,
  plain: RecordValues,
): Promise<T> {
  const dto = plainToInstance(Dto, plain);
  const [error] = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (error) throw fieldInvalid(error.property);
  return dto;
}

@Injectable()
export class PaperAdapterRegistry {
  private adapters = new Map<string, PaperAdapter>();

  register(type: RecordType, adapter: PaperAdapter) {
    this.adapters.set(type, adapter);
  }

  get(type: string): PaperAdapter | undefined {
    return this.adapters.get(type);
  }

  /** Types whose records a template may create, sorted. */
  registered(): RecordType[] {
    return [...this.adapters.keys()].sort() as RecordType[];
  }

  entries(): [string, PaperAdapter][] {
    return [...this.adapters];
  }
}
