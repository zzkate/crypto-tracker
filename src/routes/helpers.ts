import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Оборачивает синхронный обработчик, чтобы ошибки попадали в error middleware. */
export function handle(fn: (req: Request, res: Response) => void): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      fn(req, res);
    } catch (error) {
      next(error);
    }
  };
}

/** Оборачивает асинхронный обработчик. */
export function handleAsync(
  fn: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
