/**
 * Splits task points equally between assignees. The remainder goes one point
 * each to the earliest takers (owner decision, docs/PLAN.md, stage 2).
 * `assignees` must be sorted by taking order.
 */
export function splitPoints<T>(
  total: number,
  assignees: readonly T[],
): { assignee: T; amount: number }[] {
  const n = assignees.length;
  if (n === 0 || total <= 0) return [];
  const base = Math.floor(total / n);
  const rest = total % n;
  return assignees
    .map((assignee, i) => ({ assignee, amount: base + (i < rest ? 1 : 0) }))
    .filter((s) => s.amount > 0);
}
