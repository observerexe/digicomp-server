import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import { DictionariesService } from './dictionaries.service';
import {
  CreateDictionaryDto,
  CreateDictionaryItemDto,
  ReorderDictionaryItemsDto,
  UpdateDictionaryDto,
  UpdateDictionaryItemDto,
} from './dto';
import { DictionaryDto, DictionaryItemDto } from './responses.dto';

type Req = { user: { id: string; role: string } };

@Controller('dictionaries')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class DictionariesController {
  constructor(private dicts: DictionariesService) {}

  @Can(Action.DictionariesRead)
  @ApiOkResponse({ type: [DictionaryDto] })
  @Get()
  list() {
    return this.dicts.list();
  }

  @Can(Action.DictionariesRead)
  @ApiOkResponse({ type: DictionaryDto })
  @Get(':key')
  get(@Param('key') key: string) {
    return this.dicts.get(key);
  }

  @Can(Action.DictionariesManage)
  @ApiCreatedResponse({ type: DictionaryDto })
  @Post()
  create(@Body() dto: CreateDictionaryDto, @Req() req: Req) {
    return this.dicts.create(dto, req.user);
  }

  @Can(Action.DictionariesManage)
  @ApiOkResponse({ type: DictionaryDto })
  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateDictionaryDto,
    @Req() req: Req,
  ) {
    return this.dicts.update(key, dto, req.user);
  }

  @Can(Action.DictionariesManage)
  @ApiOkResponse({ type: OkDto })
  @Delete(':key')
  remove(@Param('key') key: string, @Req() req: Req) {
    return this.dicts.remove(key, req.user);
  }

  @Can(Action.DictionariesManage)
  @ApiCreatedResponse({ type: DictionaryItemDto })
  @Post(':key/items')
  addItem(
    @Param('key') key: string,
    @Body() dto: CreateDictionaryItemDto,
    @Req() req: Req,
  ) {
    return this.dicts.addItem(key, dto, req.user);
  }

  @Can(Action.DictionariesManage)
  @ApiOkResponse({ type: DictionaryDto })
  @Put(':key/items/order')
  reorder(
    @Param('key') key: string,
    @Body() dto: ReorderDictionaryItemsDto,
    @Req() req: Req,
  ) {
    return this.dicts.reorder(key, dto, req.user);
  }

  @Can(Action.DictionariesManage)
  @ApiOkResponse({ type: DictionaryItemDto })
  @Patch(':key/items/:itemKey')
  updateItem(
    @Param('key') key: string,
    @Param('itemKey') itemKey: string,
    @Body() dto: UpdateDictionaryItemDto,
    @Req() req: Req,
  ) {
    return this.dicts.updateItem(key, itemKey, dto, req.user);
  }

  @Can(Action.DictionariesManage)
  @ApiOkResponse({ type: OkDto })
  @Delete(':key/items/:itemKey')
  removeItem(
    @Param('key') key: string,
    @Param('itemKey') itemKey: string,
    @Req() req: Req,
  ) {
    return this.dicts.removeItem(key, itemKey, req.user);
  }
}
