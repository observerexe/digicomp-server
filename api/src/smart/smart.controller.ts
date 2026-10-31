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
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import {
  CreateSmartEntityDto,
  LightStateDto,
  UpdateSmartEntityDto,
} from './dto';
import { SmartService } from './smart.service';

type Req = { user: { id: string; role: string } };

@Controller('smart')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SmartController {
  constructor(private smart: SmartService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get('entities')
  list() {
    return this.smart.list();
  }

  @Roles('admin', 'coordinator')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  @Post('lights/:id/state')
  setLight(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LightStateDto,
    @Req() req: Req,
  ) {
    return this.smart.setLight(id, dto, req.user);
  }

  @Roles('admin', 'coordinator')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(200)
  @Post('scenes/:id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.smart.activateScene(id, req.user);
  }

  @Roles('admin')
  @Get('status')
  status() {
    return this.smart.status();
  }

  @Roles('admin')
  @Get('allowlist')
  allowlist() {
    return this.smart.listAll();
  }

  @Roles('admin')
  @Get('discover')
  discover() {
    return this.smart.discover();
  }

  @Roles('admin')
  @Post('allowlist')
  add(@Body() dto: CreateSmartEntityDto, @Req() req: Req) {
    return this.smart.add(dto, req.user);
  }

  @Roles('admin')
  @Patch('allowlist/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSmartEntityDto,
    @Req() req: Req,
  ) {
    return this.smart.update(id, dto, req.user);
  }

  @Roles('admin')
  @Delete('allowlist/:id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.smart.remove(id, req.user);
  }
}
