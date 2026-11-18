import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Role, User } from '../users/user.entity';
import type { UpdateOrgSettingsDto } from './dto';
import { OrgSettings } from './org-settings.entity';
import type { OrgSettingsDto } from './responses.dto';

type Actor = { id: string; role: string };

const TEXT_FIELDS = ['institution', 'groupName', 'signerPosition'] as const;

@Injectable()
export class OrgService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private audit: AuditService,
  ) {}

  /** The single row; the migration creates it, an empty one stands in if it is gone. */
  private async load(m: EntityManager, lock = false) {
    await m.query(
      `INSERT INTO "org_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING`,
    );
    return m.getRepository(OrgSettings).findOneOrFail({
      where: { id: 1 },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  private async view(
    m: EntityManager,
    s: OrgSettings,
  ): Promise<OrgSettingsDto> {
    const signer = s.signerId
      ? await m.getRepository(User).findOneBy({ id: s.signerId })
      : null;
    return {
      institution: s.institution,
      groupName: s.groupName,
      signer: signer
        ? { id: signer.id, name: signer.name, active: signer.active }
        : null,
      signerPosition: s.signerPosition,
      updatedAt: s.updatedAt,
    };
  }

  async get(): Promise<OrgSettingsDto> {
    return this.view(this.ds.manager, await this.load(this.ds.manager));
  }

  async update(
    dto: UpdateOrgSettingsDto,
    actor: Actor,
  ): Promise<OrgSettingsDto> {
    return this.ds.transaction(async (m) => {
      const s = await this.load(m, true);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const f of TEXT_FIELDS) {
        const v = dto[f]?.trim();
        if (v !== undefined && v !== s[f]) {
          changes[f] = { from: s[f], to: v };
          s[f] = v;
        }
      }
      if (dto.signerId !== undefined && dto.signerId !== s.signerId) {
        if (dto.signerId !== null) {
          const u = await m.getRepository(User).findOneBy({ id: dto.signerId });
          if (!u?.active || u.role === Role.Guest) {
            throw new BadRequestException('Signer is unknown or blocked');
          }
        }
        changes.signerId = { from: s.signerId, to: dto.signerId };
        s.signerId = dto.signerId;
      }
      if (Object.keys(changes).length) {
        await m.getRepository(OrgSettings).save(s);
        await this.audit.log(
          {
            actorId: actor.id,
            action: 'org_settings.updated',
            entity: 'org_settings',
            meta: { changes },
          },
          m,
        );
      }
      return this.view(m, await this.load(m));
    });
  }
}
