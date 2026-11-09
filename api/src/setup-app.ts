import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocsService } from './docs/docs.controller';
import { buildOpenApi } from './docs/openapi';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { applyGlobalPrefix } from './common/api-prefix';
import { serveWeb } from './web/serve-web';
import { panelPortGuard } from './admin-panel/panel-port';
import { apiNoStore, csrfGuard, securityHeaders } from './common/web';

/**
 * Global middleware, filters and pipes. Shared by main.ts and e2e tests,
 * so tests run against the same security setup as production.
 */
export function setupApp(app: INestApplication) {
  applyGlobalPrefix(app);
  app.use(securityHeaders);
  app.use(panelPortGuard);
  app.use(csrfGuard);
  app.use(apiNoStore);
  serveWeb(app);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  const trust = process.env.TRUST_PROXY?.trim();
  if (trust) {
    const value =
      trust === 'true' ? true : /^\d+$/.test(trust) ? Number(trust) : trust;
    app.getHttpAdapter().getInstance().set('trust proxy', value);
  }
  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (origins.length) {
    app.enableCors({
      origin: origins,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      maxAge: 600,
    });
  }
  // Served by DocsController at /docs (admin only).
  app.get(DocsService).document = buildOpenApi(app);
}
