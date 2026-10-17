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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../auth/roles';
import {
  ChangePasswordDto,
  ListUsersQuery,
  ResetPasswordDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto';
import { UsersService } from './users.service';

type Req = { user: { id: string; role: string } };

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Roles('admin', 'coordinator', 'member')
  @Get()
  list(@Query() q: ListUsersQuery, @Req() req: Req) {
    return this.users.list(q, req.user);
  }

  @Roles('admin', 'coordinator', 'member')
  @Patch('me')
  updateMe(@Body() dto: UpdateProfileDto, @Req() req: Req) {
    return this.users.updateProfile(req.user.id, dto);
  }

  @Roles('admin', 'coordinator', 'member')
  @Patch('me/password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: Req) {
    return this.users.changePassword(
      req.user.id,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Roles('admin', 'coordinator', 'member')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Req) {
    return this.users.get(id, req.user);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Req,
  ) {
    return this.users.update(id, dto, req.user);
  }

  @Roles('admin')
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: Req,
  ) {
    return this.users.resetPassword(id, dto.newPassword, req.user);
  }
}
