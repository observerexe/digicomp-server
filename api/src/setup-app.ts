import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { apiNoStore, csrfGuard, securityHeaders } from './common/web';

/**
 * Global middleware, filters and pipes. Shared by main.ts and e2e tests,
 * so tests run against the same security setup as production.
 */
export function setupApp(app: INestApplication) {
  app.use(securityHeaders);
  app.use(csrfGuard);
  app.use(apiNoStore);
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
}
