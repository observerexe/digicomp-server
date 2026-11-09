import { Module } from '@nestjs/common';
import { DocsController, DocsService } from './docs.controller';

@Module({
  controllers: [DocsController],
  providers: [DocsService],
  exports: [DocsService],
})
export class DocsModule {}
