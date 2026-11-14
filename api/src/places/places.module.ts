import { Module, OnModuleInit } from '@nestjs/common';
import { Booking } from '../bookings/booking.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { UsersModule } from '../users/users.module';
import {
  AuthorizationsController,
  PlacesController,
  WorkSessionsController,
} from './places.controller';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place, PLACE_CATEGORY } from './place.entity';
import { PlacesService } from './places.service';
import { WorkSession } from './work-session.entity';
import { WorkSessionsService } from './work-sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place, PlaceAuthorization, WorkSession, Booking]),
    UsersModule,
    AuditModule,
    DictionariesModule,
  ],
  controllers: [
    PlacesController,
    WorkSessionsController,
    AuthorizationsController,
  ],
  providers: [PlacesService, WorkSessionsService],
  exports: [PlacesService],
})
export class PlacesModule implements OnModuleInit {
  constructor(private dictionaries: DictionaryUsageRegistry) {}

  onModuleInit() {
    this.dictionaries.registerColumn(PLACE_CATEGORY, Place, 'category');
  }
}
