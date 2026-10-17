import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginDto } from './dto';
import { JwtAuthGuard, Roles, RolesGuard } from './roles';

@Controller()
export class AuthController {
  constructor(
    private auth: AuthService,
    private users: UsersService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/setup')
  setup(@Body() dto: CreateUserDto) {
    return this.auth.setupFirstAdmin(dto);
  }

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth/me')
  me(@Req() req: { user: { id: string; role: string } }) {
    return this.users.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.auth.create(dto, Role.Member);
  }
}
