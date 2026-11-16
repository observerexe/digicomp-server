import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { OkDto } from '../common/responses.dto';
import { ListTrashQuery, TrashRecordParams } from './dto';
import { TrashListDto } from './responses.dto';
import { TrashService } from './trash.service';

type Req = { user: { id: string; role: string } };

/** The trash. A record goes here by its module's DELETE. */
@Controller('trash')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class TrashController {
  constructor(private trash: TrashService) {}

  @Can(Action.TrashManage)
  @ApiOkResponse({ type: TrashListDto })
  @Get()
  list(@Query() q: ListTrashQuery) {
    return this.trash.list(q);
  }

  @Can(Action.TrashManage)
  @ApiOkResponse({ type: OkDto })
  @HttpCode(200)
  @Post(':type/:id/restore')
  restore(@Param() p: TrashRecordParams, @Req() req: Req) {
    return this.trash.restore(p.type, p.id, req.user);
  }

  /** «Видалити назавжди». */
  @Can(Action.TrashPurge)
  @ApiOkResponse({ type: OkDto })
  @Delete(':type/:id')
  purge(@Param() p: TrashRecordParams, @Req() req: Req) {
    return this.trash.purge(p.type, p.id, req.user);
  }
}
