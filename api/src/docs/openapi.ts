import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AT_COOKIE } from '../auth/cookies';

export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('DigiComp HUB API')
    .setDescription(
      'Права: docs/tech/ARCHITECTURE.md («Ролі та права»), правила й коди помилок: docs/tech/API.md.',
    )
    .setVersion('1')
    .addBearerAuth()
    .addCookieAuth(AT_COOKIE)
    .build();
  return SwaggerModule.createDocument(app, config);
}
