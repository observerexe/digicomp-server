import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import { PointsService } from './points.service';

@Controller('points')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PointsController {
  constructor(private points: PointsService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get('me')
  mine(@Req() req: { user: { id: string } }) {
    return this.points.mine(req.user.id);
  }

  @Roles('admin', 'coordinator', 'member')
  @Get('leaderboard')
  leaderboard() {
    return this.points.leaderboard();
  }
}
