import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  @Inject(JwtService) private readonly jwt!: JwtService;

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const path: string = req.path ?? req.url ?? '';
    const body = req.body ?? {};

    if (path === '/auth/login' && typeof body.email === 'string') {
      return 'login:' + body.email.trim().toLowerCase().slice(0, 200);
    }
    if (
      (path === '/auth/refresh' || path === '/auth/logout') &&
      typeof body.refreshToken === 'string'
    ) {
      const h = createHash('sha256').update(body.refreshToken).digest('hex');
      return 'rt:' + h.slice(0, 32);
    }
    const auth = req.headers?.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      try {
        const payload = this.jwt.verify<{ sub?: string }>(auth.slice(7));
        if (payload.sub) return 'user:' + payload.sub;
      } catch {
        // невалідний токен: рахуємо як анонімний запит
      }
    }
    return 'ip:' + (await super.getTracker(req));
  }
}
