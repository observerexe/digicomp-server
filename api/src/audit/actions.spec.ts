import { AUDIT_ACTIONS } from './actions';

describe('AUDIT_ACTIONS', () => {
  it('each action once, as «group.what» (the journal filters by the group)', () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    for (const a of AUDIT_ACTIONS) expect(a).toMatch(/^[a-z_]+\.[a-z0-9_]+$/);
  });
});
