import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export type HaState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
};

const TIMEOUT_MS = 5000;

@Injectable()
export class HomeAssistantClient {
  private get base() {
    return (process.env.HA_URL ?? 'http://host.docker.internal:8123').replace(
      /\/+$/,
      '',
    );
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: unknown }> {
    const token = process.env.HA_TOKEN;
    if (!token) {
      throw new ServiceUnavailableException('Smart home is not configured');
    }
    let res: Response;
    try {
      res = await fetch(this.base + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException('Smart home is unavailable');
    }
    if (res.status === 401 || res.status === 403) {
      throw new ServiceUnavailableException(
        'Smart home rejected the access token',
      );
    }
    if (res.status >= 500) {
      throw new ServiceUnavailableException('Smart home is unavailable');
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  }

  async info() {
    const { status, data } = await this.request('GET', '/api/config');
    if (status !== 200) {
      throw new ServiceUnavailableException('Smart home is unavailable');
    }
    const cfg = data as { version?: string; location_name?: string };
    return { version: cfg.version ?? null, name: cfg.location_name ?? null };
  }

  async states(): Promise<HaState[]> {
    const { status, data } = await this.request('GET', '/api/states');
    if (status !== 200 || !Array.isArray(data)) {
      throw new ServiceUnavailableException('Smart home is unavailable');
    }
    return data as HaState[];
  }

  async state(entityId: string): Promise<HaState | null> {
    const { status, data } = await this.request(
      'GET',
      `/api/states/${encodeURIComponent(entityId)}`,
    );
    if (status === 404) return null;
    if (status !== 200) {
      throw new ServiceUnavailableException('Smart home is unavailable');
    }
    return data as HaState;
  }

  async callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ) {
    const { status } = await this.request(
      'POST',
      `/api/services/${domain}/${service}`,
      data,
    );
    if (status < 200 || status >= 300) {
      throw new ServiceUnavailableException('Smart home is unavailable');
    }
  }
}
