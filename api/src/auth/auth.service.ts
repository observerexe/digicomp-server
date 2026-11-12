import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SessionsService } from '../sessions/sessions.service';
import { Role, User } from '../users/user.entity';
import { toProfile } from '../users/profile';
import type { MeDto } from '../users/responses.dto';
import type { Plain } from '../common/responses.dto';
import { CreateUserDto, LoginDto, TwoFactorVerifyDto } from './dto';
import { TwoFactorService } from './two-factor.service';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private jwt: JwtService,
    private sessions: SessionsService,
    private audit: AuditService,
    private twoFactor: TwoFactorService,
  ) {}

  async setupFirstAdmin(dto: CreateUserDto) {
    const count = await this.users.count();
    if (count > 0) {
      throw new ConflictException('Setup already completed');
    }
    return this.create(dto, Role.Admin);
  }

  async create(dto: CreateUserDto, role: Role, actorId?: string) {
    const exists = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (exists) throw new ConflictException('Email already used');
    const user = await this.users.save(
      this.users.create({
        email: dto.email.toLowerCase(),
        name: dto.name,
        position: dto.position ?? '',
        specialty: dto.specialty ?? '',
        passwordHash: await argon2.hash(dto.password),
        role,
      }),
    );
    await this.audit.log({
      actorId: actorId ?? user.id,
      action: 'user.created',
      entity: 'user',
      entityId: user.id,
      meta: { role, setup: actorId === undefined },
    });
    return this.publicUser(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    const ok = user && (await argon2.verify(user.passwordHash, dto.password));
    if (!user || !ok || !user.active)
      throw new UnauthorizedException('Invalid credentials');
    if (user.totpEnabledAt) {
      // Password is right; tokens are issued only after the 2FA code.
      return {
        twoFactorRequired: true as const,
        challengeToken: await this.twoFactor.challenge(user.id),
      };
    }
    return this.issueTokens(user, false);
  }

  /** Second step of a 2FA login. */
  async verifyTwoFactor(dto: TwoFactorVerifyDto) {
    const user = await this.twoFactor.verifyLogin(dto.challengeToken, dto);
    return this.issueTokens(user, true);
  }

  private async issueTokens(user: User, mfa: boolean) {
    const accessToken = await this.signAccess(user, mfa);
    const refreshToken = await this.sessions.issue(user.id, mfa);
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  async refresh(token: string) {
    const {
      userId,
      token: refreshToken,
      mfa,
    } = await this.sessions.rotate(token);
    const user = await this.users.findOneBy({ id: userId });
    if (!user || !user.active) {
      await this.sessions.revokeAllForUser(userId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    const accessToken = await this.signAccess(user, mfa);
    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  async logout(token: string) {
    await this.sessions.revokeByToken(token);
    return { ok: true };
  }

  async logoutAll(userId: string) {
    await this.sessions.revokeAllForUser(userId);
    return { ok: true };
  }

  private signAccess(user: User, mfa: boolean) {
    return this.jwt.signAsync(
      mfa
        ? { sub: user.id, role: user.role, mfa: true }
        : { sub: user.id, role: user.role },
    );
  }

  publicUser(u: User): Plain<MeDto> {
    return toProfile(u);
  }
}
