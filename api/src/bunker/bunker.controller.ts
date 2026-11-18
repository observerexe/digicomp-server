import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import { BunkerCardsService } from './bunker-cards.service';
import { BunkerRoomsService } from './bunker-rooms.service';
import {
  CreateCardDto,
  CreatePackDto,
  CreateRoomDto,
  ImportPackDto,
  ListCardsQuery,
  PackCardsDto,
  PassHostDto,
  RoomActionDto,
  UpdateCardDto,
  UpdatePackDto,
  UpdateRoomDto,
} from './dto';
import {
  BunkerCardDto,
  BunkerCardListDto,
  BunkerPackDetailDto,
  BunkerPackFileDto,
  BunkerPackListDto,
  BunkerRoomDto,
  BunkerRoomListDto,
} from './responses.dto';

type Req = { user: { id: string; role: string } };

/** «Розваги» → «Бункер»: the card library and packs. */
@Controller('bunker')
@UseGuards(JwtAuthGuard, PolicyGuard)
@Can(Action.BunkerPlay)
export class BunkerController {
  constructor(private cards: BunkerCardsService) {}

  @ApiOkResponse({ type: BunkerCardListDto })
  @Get('cards')
  listCards(@Query() q: ListCardsQuery, @Req() req: Req) {
    return this.cards.listCards(q, req.user);
  }

  @ApiCreatedResponse({ type: BunkerCardDto })
  @Post('cards')
  createCard(@Body() dto: CreateCardDto, @Req() req: Req) {
    return this.cards.createCard(dto, req.user);
  }

  @ApiOkResponse({ type: BunkerCardDto })
  @Patch('cards/:id')
  updateCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCardDto,
    @Req() req: Req,
  ) {
    return this.cards.updateCard(id, dto, req.user);
  }

  @ApiOkResponse({ type: OkDto })
  @Delete('cards/:id')
  deleteCard(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.cards.deleteCard(id, req.user);
  }

  @ApiOkResponse({ type: BunkerPackListDto })
  @Get('packs')
  listPacks(@Req() req: Req) {
    return this.cards.listPacks(req.user);
  }

  @ApiCreatedResponse({ type: BunkerPackDetailDto })
  @Post('packs')
  createPack(@Body() dto: CreatePackDto, @Req() req: Req) {
    return this.cards.createPack(dto, req.user);
  }

  @ApiCreatedResponse({ type: BunkerPackDetailDto })
  @Post('packs/import')
  importPack(@Body() dto: ImportPackDto, @Req() req: Req) {
    return this.cards.importPack(dto, req.user);
  }

  @ApiOkResponse({ type: BunkerPackDetailDto })
  @Get('packs/:id')
  getPack(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.cards.getPack(id, req.user);
  }

  @ApiOkResponse({ type: BunkerPackFileDto })
  @Get('packs/:id/export')
  exportPack(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.cards.exportPack(id, req.user);
  }

  @ApiOkResponse({ type: BunkerPackDetailDto })
  @Patch('packs/:id')
  updatePack(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackDto,
    @Req() req: Req,
  ) {
    return this.cards.updatePack(id, dto, req.user);
  }

  @ApiOkResponse({ type: OkDto })
  @Delete('packs/:id')
  deletePack(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.cards.deletePack(id, req.user);
  }

  @ApiCreatedResponse({ type: BunkerPackDetailDto })
  @Post('packs/:id/cards')
  addCards(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PackCardsDto,
    @Req() req: Req,
  ) {
    return this.cards.addCards(id, dto.cardIds, req.user);
  }

  @ApiOkResponse({ type: BunkerPackDetailDto })
  @Delete('packs/:id/cards/:cardId')
  removeCard(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Req() req: Req,
  ) {
    return this.cards.removeCard(id, cardId, req.user);
  }
}

/** Rooms and the game. Polled by the room's page every 2 seconds. */
@Controller('bunker/rooms')
@UseGuards(JwtAuthGuard, PolicyGuard)
@Can(Action.BunkerPlay)
export class BunkerRoomsController {
  constructor(private rooms: BunkerRoomsService) {}

  @ApiOkResponse({ type: BunkerRoomListDto })
  @Get()
  list(@Req() req: Req) {
    return this.rooms.list(req.user);
  }

  @ApiCreatedResponse({ type: BunkerRoomDto })
  @Post()
  create(@Body() dto: CreateRoomDto, @Req() req: Req) {
    return this.rooms.create(dto, req.user);
  }

  @ApiOkResponse({ type: BunkerRoomDto })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.rooms.get(id, req.user);
  }

  @ApiOkResponse({ type: BunkerRoomDto })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoomDto,
    @Req() req: Req,
  ) {
    return this.rooms.update(id, dto, req.user);
  }

  /** Closes the room: its host or moderation. */
  @ApiOkResponse({ type: OkDto })
  @Delete(':id')
  close(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.rooms.close(id, req.user);
  }

  @ApiCreatedResponse({ type: BunkerRoomDto })
  @Post(':id/join')
  join(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.rooms.join(id, req.user);
  }

  @ApiCreatedResponse({ type: OkDto })
  @Post(':id/leave')
  leave(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.rooms.leave(id, req.user);
  }

  @ApiCreatedResponse({ type: BunkerRoomDto })
  @Post(':id/start')
  start(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.rooms.start(id, req.user);
  }

  @ApiCreatedResponse({ type: BunkerRoomDto })
  @Post(':id/restart')
  restart(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.rooms.restart(id, req.user);
  }

  @ApiCreatedResponse({ type: BunkerRoomDto })
  @ApiBody({ type: PassHostDto })
  @Post(':id/host')
  passHost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PassHostDto,
    @Req() req: Req,
  ) {
    return this.rooms.passHost(id, dto.userId, req.user);
  }

  @ApiOkResponse({ type: BunkerRoomDto })
  @Delete(':id/members/:userId')
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() req: Req,
  ) {
    return this.rooms.removeMember(id, userId, req.user);
  }

  @ApiCreatedResponse({ type: BunkerRoomDto })
  @Post(':id/actions')
  act(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RoomActionDto,
    @Req() req: Req,
  ) {
    return this.rooms.act(id, dto, req.user);
  }
}
