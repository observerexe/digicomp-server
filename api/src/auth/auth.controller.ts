import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  RT_COOKIE,
  clearAuthCookies,
  isWebClient,
  readCookie,
  setAuthCookies,
} from './cookies';
import { CreateUserDto, LoginDto, OptionalRefreshDto } from './dto';
import { JwtAuthGuard, Can, PolicyGuard } from './roles';
import { Action } from './policy';

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
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto);
    if (isWebClient(req)) {
      setAuthCookies(req, res, result.accessToken, result.refreshToken);
      return { user: result.user };
    }
    return result;
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('auth/refresh')
  async refresh(
    @Body() dto: OptionalRefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = dto.refreshToken ?? readCookie(req, RT_COOKIE);
    if (!token) throw new UnauthorizedException('Invalid refresh token');
    const result = await this.auth.refresh(token);
    if (isWebClient(req)) {
      setAuthCookies(req, res, result.accessToken, result.refreshToken);
      return { user: result.user };
    }
    return result;
  }

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(200)
  @Post('auth/logout')
  async logout(
    @Body() dto: OptionalRefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = dto.refreshToken ?? readCookie(req, RT_COOKIE);
    if (token) await this.auth.logout(token);
    clearAuthCookies(req, res);
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('auth/logout-all')
  async logoutAll(
    @Req() req: Request & { user: { id: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logoutAll(req.user.id);
    clearAuthCookies(req, res);
    return result;
  }

  @UseGuards(JwtAuthGuard)
  @Get('auth/me')
  me(@Req() req: { user: { id: string; role: string } }) {
    return this.users.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.UsersCreate)
  @Post('users')
  createUser(@Body() dto: CreateUserDto, @Req() req: { user: { id: string } }) {
    return this.auth.create(dto, Role.Member, req.user.id);
  }
}
