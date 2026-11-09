import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PointsModule } from '../points/points.module';
import { User } from '../users/user.entity';
import { DisciplineController } from './discipline.controller';
import { DisciplineRecord } from './discipline.entity';
import { DisciplineService } from './discipline.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DisciplineRecord, User]),
    AuditModule,
    PointsModule,
  ],
  controllers: [DisciplineController],
  providers: [DisciplineService],
})
export class DisciplineModule {}
