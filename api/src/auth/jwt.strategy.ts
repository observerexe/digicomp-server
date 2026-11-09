import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { AT_COOKIE, readCookie } from './cookies';
import { User } from '../users/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@InjectRepository(User) private users: Repository<User>) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: { headers: Record<string, unknown> }) =>
          readCookie(req, AT_COOKIE) ?? null,
      ]),
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  async validate(payload: { sub: string; mfa?: boolean }) {
    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user || !user.active) throw new UnauthorizedException();
    // mfa: this login passed 2FA and 2FA is still on for the user.
    const mfa = payload.mfa === true && user.totpEnabledAt !== null;
    return { id: user.id, role: user.role, mfa };
  }
}
