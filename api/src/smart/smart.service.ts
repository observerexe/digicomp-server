import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  CreateSmartEntityDto,
  LightStateDto,
  UpdateSmartEntityDto,
} from './dto';
import { HaState, HomeAssistantClient } from './ha.client';
import { SmartEntity, SmartKind } from './smart-entity.entity';

type Actor = { id: string; role: string };

const DISCOVER_DOMAINS = ['light', 'sensor', 'scene'];

function unavailable(s: HaState | null | undefined) {
  return !s || s.state === 'unavailable' || s.state === 'unknown';
}

function stateView(e: SmartEntity, s: HaState | undefined) {
  const base = {
    id: e.id,
    kind: e.kind,
    label: e.label,
    room: e.room,
    enabled: e.enabled,
    available: !unavailable(s),
  };
  if (!s) return { ...base, state: null };
  const a = s.attributes ?? {};
  if (e.kind === SmartKind.Light) {
    const raw = typeof a.brightness === 'number' ? a.brightness : null;
    return {
      ...base,
      on: s.state === 'on',
      brightness: raw === null ? null : Math.round((raw / 255) * 100),
    };
  }
  if (e.kind === SmartKind.Sensor) {
    return {
      ...base,
      value: s.state,
      unit:
        typeof a.unit_of_measurement === 'string'
          ? a.unit_of_measurement
          : null,
      deviceClass: typeof a.device_class === 'string' ? a.device_class : null,
    };
  }
  return { ...base };
}

@Injectable()
export class SmartService {
  constructor(
    @InjectRepository(SmartEntity) private repo: Repository<SmartEntity>,
    private ha: HomeAssistantClient,
    private audit: AuditService,
  ) {}

  async status() {
    const info = await this.ha.info();
    const allowed = await this.repo.count();
    return { connected: true, ...info, allowedEntities: allowed };
  }

  async list() {
    const rows = await this.repo.find({
      where: { enabled: true },
      order: { room: 'ASC', label: 'ASC' },
    });
    if (!rows.length) return { items: [] };
    const states = await this.ha.states();
    const map = new Map(states.map((s) => [s.entity_id, s]));
    return { items: rows.map((e) => stateView(e, map.get(e.entityId))) };
  }

  async listAll() {
    const rows = await this.repo.find({ order: { room: 'ASC', label: 'ASC' } });
    return {
      items: rows.map((e) => ({
        id: e.id,
        entityId: e.entityId,
        kind: e.kind,
        label: e.label,
        room: e.room,
        enabled: e.enabled,
      })),
    };
  }

  async discover() {
    const states = await this.ha.states();
    const known = new Set((await this.repo.find()).map((e) => e.entityId));
    return {
      items: states
        .filter((s) => DISCOVER_DOMAINS.includes(s.entity_id.split('.')[0]))
        .filter((s) => !known.has(s.entity_id))
        .map((s) => ({
          entityId: s.entity_id,
          name:
            typeof s.attributes?.friendly_name === 'string'
              ? s.attributes.friendly_name
              : s.entity_id,
          state: s.state,
        })),
    };
  }

  async add(dto: CreateSmartEntityDto, actor: Actor) {
    if (dto.entityId.split('.')[0] !== dto.kind) {
      throw new BadRequestException('Entity kind does not match');
    }
    if (await this.repo.existsBy({ entityId: dto.entityId })) {
      throw new ConflictException('Entity already added');
    }
    if (!(await this.ha.state(dto.entityId))) {
      throw new BadRequestException('Unknown Home Assistant entity');
    }
    const saved = await this.repo.save(
      this.repo.create({
        entityId: dto.entityId,
        kind: dto.kind,
        label: dto.label,
        room: dto.room ?? '',
        enabled: true,
      }),
    );
    await this.audit.log({
      actorId: actor.id,
      action: 'smart.entity_added',
      entity: 'smart_entity',
      entityId: saved.id,
      meta: { haEntity: saved.entityId, kind: saved.kind },
    });
    return {
      id: saved.id,
      entityId: saved.entityId,
      kind: saved.kind,
      label: saved.label,
      room: saved.room,
      enabled: saved.enabled,
    };
  }

  async update(id: string, dto: UpdateSmartEntityDto, actor: Actor) {
    const e = await this.find(id);
    const changed: string[] = [];
    for (const k of ['label', 'room', 'enabled'] as const) {
      const v = dto[k];
      if (v !== undefined && v !== e[k]) {
        (e as unknown as Record<string, unknown>)[k] = v;
        changed.push(k);
      }
    }
    if (changed.length) {
      await this.repo.save(e);
      await this.audit.log({
        actorId: actor.id,
        action: 'smart.entity_updated',
        entity: 'smart_entity',
        entityId: id,
        meta: { haEntity: e.entityId, fields: changed },
      });
    }
    return {
      id: e.id,
      entityId: e.entityId,
      kind: e.kind,
      label: e.label,
      room: e.room,
      enabled: e.enabled,
    };
  }

  async remove(id: string, actor: Actor) {
    const e = await this.find(id);
    await this.repo.delete({ id });
    await this.audit.log({
      actorId: actor.id,
      action: 'smart.entity_removed',
      entity: 'smart_entity',
      entityId: id,
      meta: { haEntity: e.entityId },
    });
    return { ok: true };
  }

  async setLight(id: string, dto: LightStateDto, actor: Actor) {
    const e = await this.findControllable(id, SmartKind.Light);
    if (!dto.on && dto.brightness !== undefined) {
      throw new BadRequestException('Brightness requires on=true');
    }
    const current = await this.ha.state(e.entityId);
    if (unavailable(current))
      throw new ConflictException('Device is not available');
    if (dto.on) {
      const data: Record<string, unknown> = { entity_id: e.entityId };
      if (dto.brightness !== undefined) data.brightness_pct = dto.brightness;
      await this.ha.callService('light', 'turn_on', data);
    } else {
      await this.ha.callService('light', 'turn_off', { entity_id: e.entityId });
    }
    await this.audit.log({
      actorId: actor.id,
      action: 'smart.light_set',
      entity: 'smart_entity',
      entityId: id,
      meta: {
        haEntity: e.entityId,
        on: dto.on,
        brightness: dto.brightness ?? null,
      },
    });
    const after = await this.ha.state(e.entityId);
    return stateView(e, after ?? undefined);
  }

  async activateScene(id: string, actor: Actor) {
    const e = await this.findControllable(id, SmartKind.Scene);
    await this.ha.callService('scene', 'turn_on', { entity_id: e.entityId });
    await this.audit.log({
      actorId: actor.id,
      action: 'smart.scene_activated',
      entity: 'smart_entity',
      entityId: id,
      meta: { haEntity: e.entityId },
    });
    return { ok: true };
  }

  private async find(id: string) {
    const e = await this.repo.findOneBy({ id });
    if (!e) throw new NotFoundException('Smart device not found');
    return e;
  }

  private async findControllable(id: string, kind: SmartKind) {
    const e = await this.find(id);
    if (!e.enabled || e.kind !== kind) {
      throw new NotFoundException('Smart device not found');
    }
    return e;
  }
}
