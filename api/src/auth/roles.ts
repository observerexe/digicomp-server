import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { Action, roleAllowed } from './policy';

export const JwtAuthGuard = AuthGuard('jwt');

export const POLICY_KEY = 'policy:action';

/** Required action for the route; checked against the role layer of policy.ts. */
export const Can = (action: Action) => SetMetadata(POLICY_KEY, action);

/**
 * Fails closed: a route behind this guard without @Can is denied.
 * Context rules (target user, ownership) are checked in services via assertCan.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const action = this.reflector.getAllAndOverride<Action | undefined>(
      POLICY_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    const { user } = ctx
      .switchToHttp()
      .getRequest<{ user?: { role?: string } }>();
    if (!action || !user?.role || !roleAllowed(user.role, action)) {
      throw new ForbiddenException({
        message: action ? `Forbidden: ${action}` : 'Forbidden',
        errorCode: 'FORBIDDEN',
      });
    }
    return true;
  }
}
