import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import {
  apiNoStore,
  csrfGuard,
  securityHeaders,
  staticHeaders,
} from './common/web';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(securityHeaders);
  app.useStaticAssets(join(__dirname, '..', 'web'), {
    index: 'index.html',
    setHeaders: staticHeaders,
  });
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
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
