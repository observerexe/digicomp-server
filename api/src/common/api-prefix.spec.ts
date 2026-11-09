import { apiPath } from './api-prefix';

describe('apiPath', () => {
  it('прибирає префікс /api', () => {
    expect(apiPath('/api/auth/login')).toBe('/auth/login');
    expect(apiPath('/api')).toBe('/');
  });
  it('не чіпає інші шляхи', () => {
    expect(apiPath('/health')).toBe('/health');
    expect(apiPath('/apiary')).toBe('/apiary');
    expect(apiPath('/tasks')).toBe('/tasks');
  });
});
