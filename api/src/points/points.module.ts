import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PointsController } from './points.controller';
import { PointsEntry } from './points-entry.entity';
import { PointsService } from './points.service';

@Module({
  imports: [TypeOrmModule.forFeature([PointsEntry]), AuditModule],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule {}
