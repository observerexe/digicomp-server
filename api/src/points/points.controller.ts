import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Can, PolicyGuard } from '../auth/roles';
import { Action } from '../auth/policy';
import { PointsService } from './points.service';

@Controller('points')
@UseGuards(JwtAuthGuard, PolicyGuard)
export class PointsController {
  constructor(private points: PointsService) {}

  @Can(Action.PointsRead)
  @Get('me')
  mine(@Req() req: { user: { id: string } }) {
    return this.points.mine(req.user.id);
  }

  @Can(Action.PointsRead)
  @Get('leaderboard')
  leaderboard() {
    return this.points.leaderboard();
  }
}
