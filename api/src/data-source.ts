import { join } from 'path';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database';

export default new DataSource({
  ...databaseOptions,
  entities: [join(__dirname, '**', '*.{entity,entities}.{js,ts}')],
});
