import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { PlaceAuthorization } from '../places/place-authorization.entity';
import { PlacesModule } from '../places/places.module';
import { Booking } from './booking.entity';
import {
  BookingsController,
  PlaceBookingsController,
} from './bookings.controller';
import { BookingsService } from './bookings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Booking, PlaceAuthorization]),
    PlacesModule,
    AuditModule,
  ],
  controllers: [BookingsController, PlaceBookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
