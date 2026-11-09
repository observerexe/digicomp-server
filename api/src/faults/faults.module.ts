import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { PlacesModule } from '../places/places.module';
import { User } from '../users/user.entity';
import { FaultPhoto, FaultReport } from './fault.entities';
import { FaultsController } from './faults.controller';
import { FaultsService } from './faults.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FaultReport, FaultPhoto, User]),
    PlacesModule,
    FilesModule,
    AuditModule,
  ],
  controllers: [FaultsController],
  providers: [FaultsService],
})
export class FaultsModule {}
