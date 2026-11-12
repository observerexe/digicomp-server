import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { OkDto } from '../common/responses.dto';
import { MeDto } from '../users/responses.dto';
import { RecoveryCodesDto, TwoFactorSetupDto } from './responses.dto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import {
  CreateUserDto,
  LoginDto,
  OptionalRefreshDto,
  TwoFactorCodeDto,
  TwoFactorProofDto,
  TwoFactorVerifyDto,
} from './dto';
import { TwoFactorService } from './two-factor.service';
import { JwtAuthGuard, Can, PolicyGuard } from './roles';
import { Action } from './policy';

@Controller()
export class AuthController {
  constructor(
    private auth: AuthService,
    private users: UsersService,
    private twoFactor: TwoFactorService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiCreatedResponse({ type: MeDto })
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
    // 2FA on: no tokens yet, the client sends the code to /auth/2fa/verify.
    if ('twoFactorRequired' in result) return result;
    if (isWebClient(req)) {
      setAuthCookies(req, res, result.accessToken, result.refreshToken);
      return { user: result.user };
    }
    return result;
  }

  /** Second login step: challengeToken from /auth/login + code or recovery code. */
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @Post('auth/2fa/verify')
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.verifyTwoFactor(dto);
    if (isWebClient(req)) {
      setAuthCookies(req, res, result.accessToken, result.refreshToken);
      return { user: result.user };
    }
    return result;
  }

  /** Start 2FA setup: secret and otpauth:// link for a QR code. */
  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.ProfileTwoFactor)
  @HttpCode(200)
  @ApiOkResponse({ type: TwoFactorSetupDto })
  @Post('auth/2fa/setup')
  setupTwoFactor(@Req() req: { user: { id: string; role: string } }) {
    return this.twoFactor.setup(req.user);
  }

  /** Confirm with a code: 2FA on, recovery codes returned once, all sessions closed. */
  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.ProfileTwoFactor)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(200)
  @ApiOkResponse({ type: RecoveryCodesDto })
  @Post('auth/2fa/enable')
  enableTwoFactor(
    @Body() dto: TwoFactorCodeDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.twoFactor.enable(req.user, dto.code);
  }

  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.ProfileTwoFactor)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  @Post('auth/2fa/disable')
  disableTwoFactor(
    @Body() dto: TwoFactorProofDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.twoFactor.disable(req.user, dto);
  }

  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.ProfileTwoFactor)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  @ApiOkResponse({ type: RecoveryCodesDto })
  @Post('auth/2fa/recovery-codes')
  regenerateRecoveryCodes(
    @Body() dto: TwoFactorCodeDto,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.twoFactor.regenerateRecoveryCodes(req.user, dto.code);
  }

  /** Admin turns off 2FA of a user who lost access to the app. */
  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.UsersResetTwoFactor)
  @HttpCode(200)
  @ApiOkResponse({ type: OkDto })
  @Post('users/:id/2fa/reset')
  resetTwoFactor(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: { user: { id: string; role: string } },
  ) {
    return this.twoFactor.reset(id, req.user);
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
  @ApiOkResponse({ type: MeDto })
  @Get('auth/me')
  me(@Req() req: { user: { id: string; role: string } }) {
    return this.users.me(req.user.id);
  }

  @UseGuards(JwtAuthGuard, PolicyGuard)
  @Can(Action.UsersCreate)
  @ApiCreatedResponse({ type: MeDto })
  @Post('users')
  createUser(@Body() dto: CreateUserDto, @Req() req: { user: { id: string } }) {
    return this.auth.create(dto, Role.Member, req.user.id);
  }
}
