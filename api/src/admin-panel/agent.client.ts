import {
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { request } from 'http';

/** Allowed agent actions; the agent has the same fixed list. */
export const AGENT_ACTIONS = [
  'backup',
  'restore-check',
  'restart-api',
  'restart-ha',
] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

const TIMEOUT_MS = 15_000;

/**
 * Talks to the server agent over a unix socket with a shared token.
 * The API itself never runs shell commands or touches the docker socket.
 */
@Injectable()
export class AgentClient {
  private logger = new Logger('AgentClient');

  private config() {
    const socketPath = process.env.AGENT_SOCKET?.trim();
    const token = process.env.AGENT_TOKEN?.trim();
    if (!socketPath || !token) {
      throw new ServiceUnavailableException('Server agent is unavailable');
    }
    return { socketPath, token };
  }

  get<T>(path: string) {
    return this.call<T>('GET', path);
  }

  post<T>(path: string, body: unknown) {
    return this.call<T>('POST', path, body);
  }

  private call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { socketPath, token } = this.config();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    return new Promise<T>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path,
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
          },
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let data: unknown;
            try {
              data = text ? JSON.parse(text) : {};
            } catch {
              data = {};
            }
            const status = res.statusCode ?? 500;
            if (status === 409) {
              return reject(
                new ConflictException('Another server action is running'),
              );
            }
            if (status >= 400) {
              this.logger.warn(`Agent ${method} ${path} -> ${status}`);
              return reject(
                new ServiceUnavailableException('Server agent is unavailable'),
              );
            }
            resolve(data as T);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Agent timeout')));
      req.on('error', (e) => {
        this.logger.warn(`Agent ${method} ${path} failed: ${e.message}`);
        reject(new ServiceUnavailableException('Server agent is unavailable'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }
}
