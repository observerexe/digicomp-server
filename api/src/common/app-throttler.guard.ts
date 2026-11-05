import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { AT_COOKIE, RT_COOKIE, readCookie } from '../auth/cookies';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  @Inject(JwtService) private readonly jwt!: JwtService;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path: string = req.path ?? req.url ?? '';
    const body = req.body ?? {};

    if (path === '/auth/login' && typeof body.email === 'string') {
      return 'login:' + body.email.trim().toLowerCase().slice(0, 200);
    }
    if (path === '/auth/refresh' || path === '/auth/logout') {
      const rt =
        typeof body.refreshToken === 'string'
          ? body.refreshToken
          : readCookie(req as { headers: Record<string, unknown> }, RT_COOKIE);
      if (rt) {
        const h = createHash('sha256').update(rt).digest('hex');
        return 'rt:' + h.slice(0, 32);
      }
    }
    const auth = req.headers?.authorization;
    const token =
      typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice(7)
        : readCookie(req as { headers: Record<string, unknown> }, AT_COOKIE);
    if (token) {
      try {
        const payload = this.jwt.verify<{ sub?: string }>(token);
        if (payload.sub) return 'user:' + payload.sub;
      } catch {
        // невалідний токен: рахуємо як анонімний запит
      }
    }
    return 'ip:' + (await super.getTracker(req));
  }
}
