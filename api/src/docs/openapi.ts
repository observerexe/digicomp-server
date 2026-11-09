import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AT_COOKIE } from '../auth/cookies';

export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('DigiComp HUB API')
    .setDescription(
      'Права: docs/PLAN.md («Ролі та права»), коди помилок: docs/API_UA.md.',
    )
    .setVersion('1')
    .addBearerAuth()
    .addCookieAuth(AT_COOKIE)
    .build();
  return SwaggerModule.createDocument(app, config);
}
