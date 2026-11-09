import { NestFactory } from '@nestjs/core';
import { createServer } from 'http';
import { panelPort } from './admin-panel/panel-port';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  await app.listen(process.env.PORT ?? 3000);
  // Second listener for the extended panel (tailnet only, see panel-port.ts).
  const port = panelPort();
  if (port !== null && port !== Number(process.env.PORT ?? 3000)) {
    createServer(app.getHttpAdapter().getInstance()).listen(port);
  }
}
void bootstrap();
