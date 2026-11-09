import type { NextFunction, Request, Response } from 'express';

/**
 * The extended panel is served only on PANEL_PORT (default 3001). That port
 * is published on 127.0.0.1 and exposed through `tailscale serve`
 * (tailnet only); Funnel points at the main port, where these routes 404.
 */
export const PANEL_PREFIX = '/admin-panel';

export function panelPort(): number | null {
  const raw = process.env.PANEL_PORT ?? '3001';
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isPanelRequest(req: Request) {
  const port = panelPort();
  return port !== null && req.socket.localPort === port;
}

export function panelPortGuard(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const path = req.path;
  if (
    (path === PANEL_PREFIX || path.startsWith(PANEL_PREFIX + '/')) &&
    !isPanelRequest(req)
  ) {
    res.status(404).json({
      statusCode: 404,
      errorCode: 'NOT_FOUND',
      message: `Cannot ${req.method} ${path}`,
    });
    return;
  }
  next();
}
