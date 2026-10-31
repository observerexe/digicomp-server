import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { HomeAssistantClient } from './ha.client';
import { SmartEntity } from './smart-entity.entity';
import { SmartController } from './smart.controller';
import { SmartService } from './smart.service';

@Module({
  imports: [TypeOrmModule.forFeature([SmartEntity]), AuditModule],
  controllers: [SmartController],
  providers: [SmartService, HomeAssistantClient],
})
export class SmartModule {}
