import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { PointsController } from './points.controller';
import { PointsEntry } from './points-entry.entity';
import { pointsEntryAdapter } from './points-entry.adapter';
import { PointsService } from './points.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PointsEntry]),
    AuditModule,
    PaperworkModule,
  ],
  controllers: [PointsController],
  providers: [PointsService],
  exports: [PointsService],
})
export class PointsModule implements OnModuleInit {
  constructor(
    private papers: PaperAdapterRegistry,
    private points: PointsService,
  ) {}

  onModuleInit() {
    this.papers.register('points_entry', pointsEntryAdapter(this.points));
  }
}
