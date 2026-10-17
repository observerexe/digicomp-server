import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { UsersModule } from '../users/users.module';
import {
  AuthorizationsController,
  PlacesController,
  WorkSessionsController,
} from './places.controller';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place } from './place.entity';
import { PlacesService } from './places.service';
import { WorkSession } from './work-session.entity';
import { WorkSessionsService } from './work-sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place, PlaceAuthorization, WorkSession]),
    UsersModule,
    AuditModule,
  ],
  controllers: [
    PlacesController,
    WorkSessionsController,
    AuthorizationsController,
  ],
  providers: [PlacesService, WorkSessionsService],
})
export class PlacesModule {}
