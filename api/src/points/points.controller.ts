import { ApiOkResponse } from '@nestjs/swagger';
import { LeaderboardRowDto, PointsHistoryDto } from './responses.dto';
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
import { AwardPointsDto, LeaderboardQuery, RevokeDto } from './dto';
import { PointsService } from './points.service';

type Req = { user: { id: string; role: string } };

@Controller('points')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PointsController {
  constructor(private points: PointsService) {}

  /** Own balance and history. */
  @Can(Action.PointsRead)
  @ApiOkResponse({ type: PointsHistoryDto })
  @Get('me')
  mine(@Req() req: Req) {
    return this.points.history(req.user.id);
  }

  /** `period=month|all` (default all). Blocked members are not listed. */
  @Can(Action.PointsRead)
  @ApiOkResponse({ type: [LeaderboardRowDto] })
  @Get('leaderboard')
  leaderboard(@Query() q: LeaderboardQuery) {
    return this.points.leaderboard(q);
  }

  /** Another member's balance and history (staff). */
  @Can(Action.PointsReadAll)
  @ApiOkResponse({ type: PointsHistoryDto })
  @Get('users/:userId')
  ofUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.points.historyOf(userId);
  }

  /** Manual award; a moderator cannot award to self. */
  @Can(Action.PointsAward)
  @Post('award')
  award(@Body() dto: AwardPointsDto, @Req() req: Req) {
    return this.points.award(dto, req.user);
  }

  /** Revoke a manual award with a reason. */
  @Can(Action.PointsRevoke)
  @Post(':entryId/revoke')
  @HttpCode(200)
  revoke(
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Body() dto: RevokeDto,
    @Req() req: Req,
  ) {
    return this.points.revoke(entryId, dto, req.user);
  }
}
