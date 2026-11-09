import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { BookingsService } from './bookings.service';
import { CancelBookingDto, CreateBookingDto, ListBookingsQuery } from './dto';

type Req = { user: { id: string; role: string } };

@Controller('bookings')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  /** Book a slot; overlapping slots of one place are rejected. */
  @Can(Action.BookingsCreate)
  @Post()
  create(@Body() dto: CreateBookingDto, @Req() req: Req) {
    return this.bookings.create(dto, req.user);
  }

  @Can(Action.BookingsCreate)
  @Get('me')
  mine(@Req() req: Req) {
    return this.bookings.mine(req.user);
  }

  @Can(Action.BookingsCancel)
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelBookingDto,
    @Req() req: Req,
  ) {
    return this.bookings.cancel(id, dto, req.user);
  }
}

@Controller('places')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PlaceBookingsController {
  constructor(private bookings: BookingsService) {}

  /** Calendar of a place (id or QR code). */
  @Can(Action.PlacesRead)
  @Get(':id/bookings')
  list(@Param('id') id: string, @Query() q: ListBookingsQuery) {
    return this.bookings.forPlace(id, q);
  }
}
