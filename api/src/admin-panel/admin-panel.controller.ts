import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Matches } from 'class-validator';
import { Action } from '../auth/policy';
import { Can, JwtAuthGuard, PolicyGuard } from '../auth/roles';
import { AdminPanelService } from './admin-panel.service';
import { LogsQuery, RestartDto } from './dto';

type Req = { user: { id: string; role: string; mfa?: boolean } };

/** The session must have passed 2FA (and 2FA must still be on). */
@Injectable()
export class MfaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const { user } = ctx.switchToHttp().getRequest<Req>();
    if (!user?.mfa) {
      throw new ForbiddenException('Two-factor authentication required');
    }
    return true;
  }
}

class JobParams {
  @Matches(/^[a-f0-9]{8,64}$/)
  id: string;
}

/** Extended panel: admin only, 2FA session only, panel port only. */
@Controller('admin-panel')
@UseGuards(JwtAuthGuard, PolicyGuard, MfaGuard)
@Can(Action.AdminPanel)
export class AdminPanelController {
  constructor(private panel: AdminPanelService) {}

  /** CPU, RAM, disks, uptime, containers (api, db, homeassistant), last backup. */
  @Get('overview')
  overview() {
    return this.panel.overview();
  }

  /** Last lines of the API log. */
  @Get('logs')
  logs(@Query() q: LogsQuery) {
    const n = Math.min(500, Math.max(1, Number(q.lines ?? 200)));
    return this.panel.logs(n);
  }

  @Post('actions/backup')
  @HttpCode(202)
  backup(@Req() req: Req) {
    return this.panel.run('backup', req.user);
  }

  @Post('actions/restore-check')
  @HttpCode(202)
  restoreCheck(@Req() req: Req) {
    return this.panel.run('restore-check', req.user);
  }

  /** Restart the API or Home Assistant (not the database). */
  @Post('actions/restart')
  @HttpCode(202)
  restart(@Body() dto: RestartDto, @Req() req: Req) {
    return this.panel.run(
      dto.target === 'api' ? 'restart-api' : 'restart-ha',
      req.user,
    );
  }

  /** Status and last output lines of a started action. */
  @Get('jobs/:id')
  job(@Param() p: JobParams) {
    return this.panel.job(p.id);
  }
}
