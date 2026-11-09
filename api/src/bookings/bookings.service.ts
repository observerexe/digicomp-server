import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Action, Actor, assertCan, can } from '../auth/policy';
import { PlaceAuthorization } from '../places/place-authorization.entity';
import { PlaceStatus } from '../places/place.entity';
import { authIsValid, PlacesService } from '../places/places.service';
import { Booking } from './booking.entity';
import { CancelBookingDto, CreateBookingDto, ListBookingsQuery } from './dto';
import type { BookingDto } from './responses.dto';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const BOOKING_MAX_HOURS = 12;
export const BOOKING_MAX_DAYS_AHEAD = 60;
/** Small tolerance for clocks: a booking may start up to 5 minutes ago. */
const PAST_TOLERANCE = 5 * 60_000;
const LIST_MAX_DAYS = 62;

export const BookingErrors = {
  Overlap: 'Time slot is already booked',
  Past: 'Booking is in the past',
  TooLong: 'Booking is too long',
  TooFar: 'Booking is too far ahead',
  Cancelled: 'Booking already cancelled',
  Ended: 'Booking already ended',
  ReasonRequired: 'Reason is required to cancel another user booking',
  Range: 'Invalid period',
} as const;

function isExclusionViolation(e: unknown) {
  const err = e as { code?: string; driverError?: { code?: string } };
  return err?.code === '23P01' || err?.driverError?.code === '23P01';
}

function view(b: Booking): BookingDto {
  return {
    id: b.id,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    note: b.note,
    createdAt: b.createdAt,
    cancelled: b.cancelledAt !== null,
    cancelledAt: b.cancelledAt,
    cancelledById: b.cancelledById,
    cancelReason: b.cancelReason,
    user: b.user
      ? { id: b.user.id, name: b.user.name, avatarUrl: b.user.avatarUrl }
      : { id: b.userId },
    place: b.place
      ? { id: b.place.id, code: b.place.code, title: b.place.title }
      : { id: b.placeId },
  };
}

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private repo: Repository<Booking>,
    @InjectDataSource() private ds: DataSource,
    private places: PlacesService,
    private audit: AuditService,
  ) {}

  async create(dto: CreateBookingDto, actor: Actor) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const now = Date.now();
    if (endsAt <= startsAt) throw new BadRequestException(BookingErrors.Range);
    if (startsAt.getTime() < now - PAST_TOLERANCE) {
      throw new BadRequestException(BookingErrors.Past);
    }
    if (endsAt.getTime() - startsAt.getTime() > BOOKING_MAX_HOURS * HOUR) {
      throw new BadRequestException(BookingErrors.TooLong);
    }
    if (startsAt.getTime() > now + BOOKING_MAX_DAYS_AHEAD * DAY) {
      throw new BadRequestException(BookingErrors.TooFar);
    }
    const place = await this.places.resolve(dto.placeId);
    if (place.status !== PlaceStatus.Active) {
      throw new ConflictException('Place is not available');
    }
    if (
      place.needsAuthorization &&
      !can(actor, Action.BookingsCreate, { authorized: false })
    ) {
      const auth = await this.ds
        .getRepository(PlaceAuthorization)
        .findOneBy({ userId: actor.id, placeId: place.id });
      // The authorization must still be valid when the booking ends.
      const valid =
        authIsValid(auth) &&
        (!auth!.expiresAt || auth!.expiresAt.getTime() >= endsAt.getTime());
      assertCan(actor, Action.BookingsCreate, { authorized: valid });
    }
    try {
      const saved = await this.ds.transaction(async (m) => {
        const b = await m.save(
          Booking,
          m.create(Booking, {
            placeId: place.id,
            userId: actor.id,
            startsAt,
            endsAt,
            note: dto.note?.trim() ?? '',
          }),
        );
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'booking.created',
            entity: 'booking',
            entityId: b.id,
            meta: { placeId: place.id, startsAt, endsAt },
          },
          m,
        );
        return b;
      });
      return this.get(saved.id);
    } catch (e) {
      if (isExclusionViolation(e)) {
        throw new ConflictException(BookingErrors.Overlap);
      }
      throw e;
    }
  }

  /** Place calendar: active bookings that intersect [from, to). */
  async forPlace(idOrCode: string, q: ListBookingsQuery) {
    const place = await this.places.resolve(idOrCode);
    const from = q.from ? new Date(q.from) : new Date(Date.now() - DAY);
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 15 * DAY);
    if (to <= from || to.getTime() - from.getTime() > LIST_MAX_DAYS * DAY) {
      throw new BadRequestException(BookingErrors.Range);
    }
    const rows = await this.repo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.user', 'u')
      .leftJoinAndSelect('b.place', 'p')
      .where('b.placeId = :pid', { pid: place.id })
      .andWhere('b.cancelledAt IS NULL')
      .andWhere('b.startsAt < :to AND b.endsAt > :from', { from, to })
      .orderBy('b.startsAt', 'ASC')
      .getMany();
    return rows.map(view);
  }

  /** Own upcoming and current bookings. */
  async mine(actor: Actor) {
    const rows = await this.repo
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.user', 'u')
      .leftJoinAndSelect('b.place', 'p')
      .where('b.userId = :me', { me: actor.id })
      .andWhere('b.cancelledAt IS NULL')
      .andWhere('b.endsAt > now()')
      .orderBy('b.startsAt', 'ASC')
      .getMany();
    return rows.map(view);
  }

  /** Own booking — anyone; someone else's — staff, with a reason. */
  async cancel(id: string, dto: CancelBookingDto, actor: Actor) {
    await this.ds.transaction(async (m) => {
      const b = await m.findOne(Booking, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!b) throw new NotFoundException('Booking not found');
      assertCan(actor, Action.BookingsCancel, { ownerId: b.userId });
      if (b.cancelledAt) throw new ConflictException(BookingErrors.Cancelled);
      if (b.endsAt.getTime() <= Date.now()) {
        throw new ConflictException(BookingErrors.Ended);
      }
      const own = b.userId === actor.id;
      const reason = dto.reason?.trim() ?? '';
      if (!own && !reason) {
        throw new BadRequestException(BookingErrors.ReasonRequired);
      }
      b.cancelledAt = new Date();
      b.cancelledById = actor.id;
      b.cancelReason = reason;
      await m.save(Booking, b);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'booking.cancelled',
          entity: 'booking',
          entityId: b.id,
          meta: { forced: !own, userId: b.userId, reason },
        },
        m,
      );
    });
    return this.get(id);
  }

  private async get(id: string) {
    const b = await this.repo.findOneOrFail({
      where: { id },
      relations: { user: true, place: true },
    });
    return view(b);
  }
}
