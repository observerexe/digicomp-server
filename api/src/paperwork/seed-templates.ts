import type { QueryRunner } from 'typeorm';
import { StarterTemplates1809000000000 } from '../migrations/1809000000000-StarterTemplates';
import { TaskTemplates1812000000000 } from '../migrations/1812000000000-TaskTemplates';
import { DisciplineTemplates1813000000000 } from '../migrations/1813000000000-DisciplineTemplates';
import { PointsTemplates1815000000000 } from '../migrations/1815000000000-PointsTemplates';
import { ReportTemplates1819000000000 } from '../migrations/1819000000000-ReportTemplates';
import { AuthorizationTemplates1821000000000 } from '../migrations/1821000000000-AuthorizationTemplates';
import { ProjectInventoryTemplates1823000000000 } from '../migrations/1823000000000-ProjectInventoryTemplates';
import { TaskTypeTemplates1826000000000 } from '../migrations/1826000000000-TaskTypeTemplates';

/**
 * The migrations that publish the templates every installation starts with.
 * Each takes the first active admin as the author and, without one, makes
 * nothing; on a new installation they run before `POST /auth/setup` makes
 * that admin, so setup runs them again. They add only the templates that
 * are missing (fixed ids): a second run changes nothing.
 */
export const TEMPLATE_MIGRATIONS = [
  StarterTemplates1809000000000,
  TaskTemplates1812000000000,
  DisciplineTemplates1813000000000,
  PointsTemplates1815000000000,
  ReportTemplates1819000000000,
  AuthorizationTemplates1821000000000,
  ProjectInventoryTemplates1823000000000,
  TaskTypeTemplates1826000000000,
];

export async function seedTemplates(q: QueryRunner) {
  for (const M of TEMPLATE_MIGRATIONS) await new M().up(q);
}
