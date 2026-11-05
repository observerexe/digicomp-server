import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('app-config')
  config() {
    return {
      publicOrigin: process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '') || null,
    };
  }
}
