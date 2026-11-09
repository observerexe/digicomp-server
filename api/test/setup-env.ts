// Готує змінні середовища для e2e-тестів до завантаження AppModule.
// Тести працюють з окремою базою digicomp_test (див. docker-compose.dev.yml),
// або з адресою з TEST_DATABASE_URL.
import { readFileSync } from 'fs';
import { join } from 'path';

function readDotEnv(): Record<string, string> {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', '.env'), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

const env = readDotEnv();
const user = env.POSTGRES_USER ?? 'digicomp';
const password = encodeURIComponent(env.POSTGRES_PASSWORD ?? '');

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://${user}:${password}@127.0.0.1:5433/digicomp_test`;
process.env.JWT_SECRET ??= 'e2e-test-secret-not-for-production';
process.env.STORAGE_DIR ??= join(__dirname, '..', '.e2e-files');
delete process.env.HA_TOKEN;
