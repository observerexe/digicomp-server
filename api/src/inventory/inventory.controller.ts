import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  InventoryItemDetailDto,
  InventoryItemDto,
  InventoryItemListDto,
  InventoryMovementDto,
  InventoryMovementListDto,
} from './responses.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import {
  CreateItemDto,
  ListItemsQuery,
  ListMovementsQuery,
  MovementDto,
  UpdateItemDto,
} from './dto';
import { InventoryService } from './inventory.service';

type Req = { user: { id: string; role: string } };

@Controller('inventory')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class InventoryController {
  constructor(private inv: InventoryService) {}

  @Can(Action.InventoryRead)
  @ApiOkResponse({ type: InventoryItemListDto })
  @Get('items')
  list(@Query() q: ListItemsQuery, @Req() req: Req) {
    return this.inv.list(q, req.user);
  }

  @Can(Action.InventoryRead)
  @ApiOkResponse({ type: InventoryItemDetailDto })
  @Get('items/:id')
  get(@Param('id') id: string, @Req() req: Req) {
    return this.inv.get(id, req.user);
  }

  @Can(Action.InventoryManage)
  @ApiCreatedResponse({ type: InventoryItemDto })
  @Post('items')
  create(@Body() dto: CreateItemDto, @Req() req: Req) {
    return this.inv.create(dto, req.user);
  }

  @Can(Action.InventoryManage)
  @ApiOkResponse({ type: InventoryItemDto })
  @Patch('items/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateItemDto,
    @Req() req: Req,
  ) {
    return this.inv.update(id, dto, req.user);
  }

  @Can(Action.InventoryTake)
  @ApiCreatedResponse({ type: InventoryMovementDto })
  @Post('items/:id/movements')
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MovementDto,
    @Req() req: Req,
  ) {
    return this.inv.move(id, dto, req.user);
  }

  @Can(Action.InventoryRead)
  @ApiOkResponse({ type: InventoryMovementListDto })
  @Get('movements')
  movements(@Query() q: ListMovementsQuery) {
    return this.inv.listMovements(q);
  }

  @Can(Action.InventoryManage)
  @Get('export')
  async export(@Res({ passthrough: true }) res: Response) {
    const csv = await this.inv.exportCsv();
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="inventory.csv"',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(Buffer.from(csv, 'utf8'));
  }
}
