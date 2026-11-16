import { Module, OnModuleInit } from '@nestjs/common';
import { Booking } from '../bookings/booking.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { DictionariesModule } from '../dictionaries/dictionaries.module';
import { DictionaryUsageRegistry } from '../dictionaries/dictionary-usage';
import { LinkRegistry } from '../links/link-registry';
import { LinksModule } from '../links/links.module';
import { PaperAdapterRegistry } from '../paperwork/adapters';
import { PaperworkModule } from '../paperwork/paperwork.module';
import { UsersModule } from '../users/users.module';
import {
  AuthorizationsController,
  PlacesController,
  WorkSessionsController,
} from './places.controller';
import { PlaceAuthorization } from './place-authorization.entity';
import { Place, PLACE_CATEGORY } from './place.entity';
import { PLACE_LINKS } from './place.links';
import { PLACE_READER } from './place.reader';
import { PlacesService } from './places.service';
import { WorkSession } from './work-session.entity';
import { WorkSessionsService } from './work-sessions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Place, PlaceAuthorization, WorkSession, Booking]),
    UsersModule,
    AuditModule,
    DictionariesModule,
    LinksModule,
    PaperworkModule,
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
  constructor(
    private dictionaries: DictionaryUsageRegistry,
    private links: LinkRegistry,
    private papers: PaperAdapterRegistry,
  ) {}

  onModuleInit() {
    this.dictionaries.registerColumn(PLACE_CATEGORY, Place, 'category');
    this.links.register('place', PLACE_LINKS);
    this.papers.registerReader('place', PLACE_READER);
  }
}
