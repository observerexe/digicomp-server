import { Module } from '@nestjs/common';
import { RecordsController } from './records.controller';

/** Registry of record schemas (records.registry.ts). */
@Module({ controllers: [RecordsController] })
export class RecordsModule {}
