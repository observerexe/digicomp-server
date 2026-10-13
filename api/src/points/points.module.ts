import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PointsController } from './points.controller';
import { PointsEntry } from './points-entry.entity';
import { PointsService } from './points.service';

@Module({
  imports: [TypeOrmModule.forFeature([PointsEntry])],
  controllers: [PointsController],
  providers: [PointsService],
})
export class PointsModule {}
