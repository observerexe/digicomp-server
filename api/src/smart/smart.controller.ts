import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OkDto } from '../common/responses.dto';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import {
  CreateSmartEntityDto,
  LightStateDto,
  UpdateSmartEntityDto,
} from './dto';
import {
  SmartAllowedDto,
  SmartAllowlistDto,
  SmartDiscoverDto,
  SmartEntityListDto,
  SmartEntityStateDto,
  SmartStatusDto,
} from './responses.dto';
import { SmartService } from './smart.service';

type Req = { user: { id: string; role: string } };

@Controller('smart')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class SmartController {
  constructor(private smart: SmartService) {}

  @Can(Action.SmartRead)
  @ApiOkResponse({ type: SmartEntityListDto })
  @Get('entities')
  list() {
    return this.smart.list();
  }

  @Can(Action.SmartControl)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  @ApiOkResponse({ type: SmartEntityStateDto })
  @Post('lights/:id/state')
  setLight(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LightStateDto,
    @Req() req: Req,
  ) {
    return this.smart.setLight(id, dto, req.user);
  }

  @Can(Action.SmartControl)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  @Post('scenes/:id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.smart.activateScene(id, req.user);
  }

  @Can(Action.SmartAllowlist)
  @ApiOkResponse({ type: SmartStatusDto })
  @Get('status')
  status() {
    return this.smart.status();
  }

  @Can(Action.SmartAllowlist)
  @ApiOkResponse({ type: SmartAllowlistDto })
  @Get('allowlist')
  allowlist() {
    return this.smart.listAll();
  }

  @Can(Action.SmartAllowlist)
  @ApiOkResponse({ type: SmartDiscoverDto })
  @Get('discover')
  discover() {
    return this.smart.discover();
  }

  @Can(Action.SmartAllowlist)
  @ApiCreatedResponse({ type: SmartAllowedDto })
  @Post('allowlist')
  add(@Body() dto: CreateSmartEntityDto, @Req() req: Req) {
    return this.smart.add(dto, req.user);
  }

  @Can(Action.SmartAllowlist)
  @ApiOkResponse({ type: SmartAllowedDto })
  @Patch('allowlist/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSmartEntityDto,
    @Req() req: Req,
  ) {
    return this.smart.update(id, dto, req.user);
  }

  @Can(Action.SmartAllowlist)
  @ApiOkResponse({ type: OkDto })
  @Delete('allowlist/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.smart.remove(id, req.user);
  }
}
