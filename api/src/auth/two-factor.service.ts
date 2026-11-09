import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SessionsService } from '../sessions/sessions.service';
import { User } from '../users/user.entity';
import { Action, Actor, assertCan } from './policy';
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateSecret,
  normalizeRecoveryCode,
  otpauthUri,
  totpKey,
  verifyTotp,
} from './totp';

export const TwoFactorErrors = {
  NotConfigured: 'Two-factor is not configured on the server',
  AlreadyEnabled: 'Two-factor is already enabled',
  NotEnabled: 'Two-factor is not enabled',
  NoSetup: 'Two-factor setup was not started',
  InvalidCode: 'Invalid two-factor code',
  Locked: 'Too many invalid codes, try later',
  InvalidChallenge: 'Invalid or expired two-factor challenge',
  CodeRequired: 'Two-factor code is required',
} as const;

function requireProof(p: Proof) {
  if (!p.code && !p.recoveryCode) {
    throw new BadRequestException(TwoFactorErrors.CodeRequired);
  }
}

/** After this many wrong codes in a row, code checks pause for LOCK_MS. */
export const MAX_FAILED = 10;
export const LOCK_MS = 15 * 60_000;
const CHALLENGE_TTL = '5m';

type Proof = { code?: string; recoveryCode?: string };

@Injectable()
export class TwoFactorService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private jwt: JwtService,
    private sessions: SessionsService,
    private audit: AuditService,
  ) {}

  private key() {
    const key = totpKey();
    if (!key)
      throw new ServiceUnavailableException(TwoFactorErrors.NotConfigured);
    return key;
  }

  /** Challenge tokens use their own secret, so they never work as access tokens. */
  private challengeSecret() {
    return `${process.env.JWT_SECRET}:2fa-challenge`;
  }

  challenge(userId: string) {
    return this.jwt.signAsync(
      { sub: userId, typ: '2fa' },
      { secret: this.challengeSecret(), expiresIn: CHALLENGE_TTL },
    );
  }

  async readChallenge(token: string) {
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; typ: string }>(
        token,
        {
          secret: this.challengeSecret(),
        },
      );
      if (p.typ !== '2fa') throw new Error('typ');
      return p.sub;
    } catch {
      throw new UnauthorizedException(TwoFactorErrors.InvalidChallenge);
    }
  }

  /** Step 1: new secret (not active until confirmed with a code). */
  async setup(actor: Actor) {
    const key = this.key();
    return this.ds.transaction(async (m) => {
      const u = await this.lockUser(m, actor.id);
      if (u.totpEnabledAt)
        throw new ConflictException(TwoFactorErrors.AlreadyEnabled);
      const secret = generateSecret();
      u.totpSecretEnc = encryptSecret(secret, key);
      u.totpLastStep = null;
      await m.save(User, u);
      return { secret, otpauthUri: otpauthUri(secret, u.email) };
    });
  }

  /**
   * Step 2: confirm with a code. Returns recovery codes (shown once).
   * All sessions are closed: the next login goes through 2FA.
   */
  async enable(actor: Actor, code: string) {
    const key = this.key();
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => argon2.hash(c)));
    await this.ds.transaction(async (m) => {
      const u = await this.lockUser(m, actor.id);
      if (u.totpEnabledAt)
        throw new ConflictException(TwoFactorErrors.AlreadyEnabled);
      if (!u.totpSecretEnc)
        throw new ConflictException(TwoFactorErrors.NoSetup);
      const step = verifyTotp(
        decryptSecret(u.totpSecretEnc, key),
        code,
        Date.now(),
        null,
      );
      if (step === null)
        throw new ForbiddenException(TwoFactorErrors.InvalidCode);
      u.totpEnabledAt = new Date();
      u.totpLastStep = step;
      u.totpFailedAttempts = 0;
      u.totpLockedUntil = null;
      u.recoveryCodes = hashes;
      await m.save(User, u);
      await this.sessions.revokeAllForUser(u.id, m);
      await this.audit.log(
        {
          actorId: u.id,
          action: 'user.2fa_enabled',
          entity: 'user',
          entityId: u.id,
        },
        m,
      );
    });
    return { recoveryCodes: codes };
  }

  async disable(actor: Actor, proof: Proof) {
    requireProof(proof);
    const ok = await this.ds.transaction(async (m) => {
      const u = await this.lockUser(m, actor.id);
      if (!u.totpEnabledAt)
        throw new ConflictException(TwoFactorErrors.NotEnabled);
      if (!(await this.checkProof(m, u, proof))) return false;
      this.clear(u);
      await m.save(User, u);
      await this.audit.log(
        {
          actorId: u.id,
          action: 'user.2fa_disabled',
          entity: 'user',
          entityId: u.id,
        },
        m,
      );
      return true;
    });
    if (!ok) throw new ForbiddenException(TwoFactorErrors.InvalidCode);
    return { ok: true };
  }

  /** New set of recovery codes; the old ones stop working. */
  async regenerateRecoveryCodes(actor: Actor, code: string) {
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => argon2.hash(c)));
    const ok = await this.ds.transaction(async (m) => {
      const u = await this.lockUser(m, actor.id);
      if (!u.totpEnabledAt)
        throw new ConflictException(TwoFactorErrors.NotEnabled);
      if (!(await this.checkProof(m, u, { code }))) return false;
      u.recoveryCodes = hashes;
      await m.save(User, u);
      await this.audit.log(
        {
          actorId: u.id,
          action: 'user.2fa_recovery_regenerated',
          entity: 'user',
          entityId: u.id,
        },
        m,
      );
      return true;
    });
    if (!ok) throw new ForbiddenException(TwoFactorErrors.InvalidCode);
    return { recoveryCodes: codes };
  }

  /** Admin turns off 2FA of another user who lost the phone. */
  async reset(targetId: string, actor: Actor) {
    assertCan(actor, Action.UsersResetTwoFactor);
    await this.ds.transaction(async (m) => {
      const u = await m.findOne(User, {
        where: { id: targetId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!u) throw new NotFoundException('User not found');
      if (!u.totpEnabledAt && !u.totpSecretEnc) {
        throw new ConflictException(TwoFactorErrors.NotEnabled);
      }
      this.clear(u);
      await m.save(User, u);
      await this.sessions.revokeAllForUser(u.id, m);
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'user.2fa_reset',
          entity: 'user',
          entityId: u.id,
        },
        m,
      );
    });
    return { ok: true };
  }

  /** Second login step; returns the user when the proof is valid. */
  async verifyLogin(challengeToken: string, proof: Proof) {
    requireProof(proof);
    const userId = await this.readChallenge(challengeToken);
    const user = await this.ds.transaction(async (m) => {
      const u = await this.lockUser(m, userId);
      if (!u.active || !u.totpEnabledAt) {
        throw new UnauthorizedException(TwoFactorErrors.InvalidChallenge);
      }
      const used = await this.checkProof(m, u, proof);
      if (!used) return null;
      await this.audit.log(
        {
          actorId: u.id,
          action: 'auth.2fa_login',
          entity: 'user',
          entityId: u.id,
          meta: { recoveryCode: used === 'recovery' },
        },
        m,
      );
      return u;
    });
    if (!user) throw new ForbiddenException(TwoFactorErrors.InvalidCode);
    return user;
  }

  /**
   * Checks a TOTP or a recovery code with lockout. Always saves the user in
   * the same transaction (counters, used step or recovery code) and returns
   * null on a wrong code; callers commit and then reply 403, so failed
   * attempts are counted and cannot be bypassed.
   */
  private async checkProof(m: EntityManager, u: User, proof: Proof) {
    const now = Date.now();
    if (u.totpLockedUntil && u.totpLockedUntil.getTime() > now) {
      throw new ForbiddenException(TwoFactorErrors.Locked);
    }
    let used: 'totp' | 'recovery' | null = null;
    if (proof.code) {
      const secret = decryptSecret(u.totpSecretEnc!, this.key());
      const step = verifyTotp(secret, proof.code, now, u.totpLastStep);
      if (step !== null) {
        u.totpLastStep = step;
        used = 'totp';
      }
    } else if (proof.recoveryCode) {
      const norm = normalizeRecoveryCode(proof.recoveryCode);
      if (norm) {
        for (let i = 0; i < u.recoveryCodes.length; i++) {
          if (await argon2.verify(u.recoveryCodes[i], norm)) {
            u.recoveryCodes = u.recoveryCodes.filter((_, j) => j !== i);
            used = 'recovery';
            break;
          }
        }
      }
    }
    if (!used) {
      u.totpFailedAttempts += 1;
      if (u.totpFailedAttempts >= MAX_FAILED) {
        u.totpLockedUntil = new Date(now + LOCK_MS);
        u.totpFailedAttempts = 0;
      }
      await m.save(User, u);
      return null;
    }
    u.totpFailedAttempts = 0;
    u.totpLockedUntil = null;
    await m.save(User, u);
    return used;
  }

  private clear(u: User) {
    u.totpSecretEnc = null;
    u.totpEnabledAt = null;
    u.totpLastStep = null;
    u.totpFailedAttempts = 0;
    u.totpLockedUntil = null;
    u.recoveryCodes = [];
  }

  private async lockUser(m: EntityManager, id: string) {
    const u = await m.findOne(User, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!u) throw new UnauthorizedException();
    return u;
  }
}
