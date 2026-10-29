import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Проверяет Authorization: Bearer <APP_API_KEY>. */
export function bearerAuth(expectedToken: string): RequestHandler {
  return (req, res, next) => {
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    const token = match?.[1];

    if (!token || !safeEqual(token, expectedToken)) {
      res.status(401).json({
        error: 'unauthorized',
        message: 'valid Bearer token required'
      });
      return;
    }
    next();
  };
}
