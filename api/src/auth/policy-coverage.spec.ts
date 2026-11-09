import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { Action } from './policy';
import { POLICY_KEY, PolicyGuard } from './roles';

// Кожен маршрут за PolicyGuard має мати @Can. Інакше гард відмовить усім,
// а цей тест покаже, де забули правило.

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return controllerFiles(p);
    return name.endsWith('.controller.ts') ? [p] : [];
  });
}

type Ctor = { name: string; prototype: Record<string, unknown> };

function controllers(): Ctor[] {
  const out: Ctor[] = [];
  for (const file of controllerFiles(join(__dirname, '..'))) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const v of Object.values(mod)) {
      if (typeof v === 'function' && Reflect.hasMetadata('path', v)) {
        out.push(v as unknown as Ctor);
      }
    }
  }
  return out;
}

describe('Покриття маршрутів правилами', () => {
  const all = controllers();
  const guarded = all.filter((c) =>
    ((Reflect.getMetadata(GUARDS_METADATA, c) as unknown[]) ?? []).includes(
      PolicyGuard,
    ),
  );

  it('знайдено контролери з PolicyGuard', () => {
    expect(guarded.length).toBeGreaterThan(5);
  });

  it('кожен маршрут має @Can з відомою дією', () => {
    const missing: string[] = [];
    const known = new Set<string>(Object.values(Action));
    for (const c of guarded) {
      const classAction = Reflect.getMetadata(POLICY_KEY, c) as
        string | undefined;
      for (const key of Object.getOwnPropertyNames(c.prototype)) {
        const fn = c.prototype[key];
        if (typeof fn !== 'function' || key === 'constructor') continue;
        if (Reflect.getMetadata(METHOD_METADATA, fn) === undefined) continue;
        const action =
          (Reflect.getMetadata(POLICY_KEY, fn) as string | undefined) ??
          classAction;
        if (!action || !known.has(action)) missing.push(`${c.name}.${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
