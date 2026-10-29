import type { ErrorRequestHandler, RequestHandler } from 'express';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'error'
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'not_found' });
};

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }

  if ((error as { type?: string } | undefined)?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: 'invalid_json',
      message: 'request body must be valid JSON'
    });
    return;
  }

  console.error('[error]', error);
  res.status(500).json({ error: 'internal_error' });
};
