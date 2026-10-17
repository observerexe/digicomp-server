import { join } from 'path';

export const databaseOptions = {
  type: 'postgres' as const,
  url: process.env.DATABASE_URL,
  migrations: [join(__dirname, 'migrations', '*.{js,ts}')],
};
