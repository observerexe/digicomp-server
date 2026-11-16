import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { TEMPLATE_MIGRATIONS } from './seed-templates';

/** A migration that writes templates only when an admin exists. */
const WAITS_FOR_ADMIN = /WHERE "role" = 'admin' AND "active"/;

describe('початкові шаблони при створенні першого адміна', () => {
  it('setup запускає кожну міграцію, що чекає на адміна, і в порядку міграцій', () => {
    const dir = join(__dirname, '..', 'migrations');
    const waiting = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .sort()
      .filter((f) => WAITS_FOR_ADMIN.test(readFileSync(join(dir, f), 'utf8')))
      .map((f) => f.replace(/^(\d+)-(\w+)\.ts$/, '$2$1'));
    expect(TEMPLATE_MIGRATIONS.map((M) => new M().name)).toEqual(waiting);
  });
});
