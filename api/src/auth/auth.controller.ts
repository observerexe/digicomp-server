import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CreateUserDto, LoginDto, RefreshDto } from './dto';
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

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('auth/logout')
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('auth/logout-all')
  logoutAll(@Req() req: { user: { id: string } }) {
    return this.auth.logoutAll(req.user.id);
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
