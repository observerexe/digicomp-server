// Writes the OpenAPI document to api/openapi.json without a database
// (preview mode does not instantiate providers). Used to generate front types.
// Run: npm run build && npm run openapi
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { buildOpenApi } from './docs/openapi';

async function main() {
  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  });
  const out = join(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApi(app), null, 2) + '\n');
  await app.close();
  console.log(`OpenAPI: ${out}`);
}
void main();
