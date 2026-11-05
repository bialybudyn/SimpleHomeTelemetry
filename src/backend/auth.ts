import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';

/**
 * Logowanie HTTP Basic dla całego panelu (strony, API, WebSocket).
 * Przeglądarka sama pokazuje okno logowania i zapamiętuje dane — frontend nie wymaga zmian.
 * Włączane ustawieniem PANEL_PASSWORD.
 */
export function checkBasicAuth(header: string | undefined, user: string, password: string): boolean {
  if (!password) return true;
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  return safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), password);
}

function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function basicAuthMiddleware(user: string, password: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (checkBasicAuth(req.headers.authorization, user, password)) return next();
    res.setHeader('WWW-Authenticate', 'Basic realm="SimpleHome", charset="UTF-8"');
    res.status(401).send('Wymagane logowanie.');
  };
}

export function isUpgradeAuthorized(req: IncomingMessage, user: string, password: string): boolean {
  return checkBasicAuth(req.headers.authorization, user, password);
}
