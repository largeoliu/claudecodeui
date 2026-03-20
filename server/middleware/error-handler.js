import { isClientAbortError, normalizeError } from '../utils/http-errors.js';

export function errorHandler(error, req, res, next) {
  const normalized = normalizeError(error);

  if (res.headersSent) {
    return next(normalized);
  }

  const payload = {
    error: normalized.expose ? normalized.message : 'Internal server error',
  };

  if (normalized.code) {
    payload.code = normalized.code;
  }

  if (normalized.details !== undefined && normalized.expose) {
    payload.details = normalized.details;
  }

  if (process.env.NODE_ENV === 'development' && normalized.stack) {
    payload.stack = normalized.stack;
  }

  if (isClientAbortError(normalized)) {
    console.warn('[WARN] Request aborted by client:', req.method, req.originalUrl);
  } else if (normalized.status >= 500) {
    console.error('[ERROR]', req.method, req.originalUrl, normalized);
  } else {
    console.warn('[WARN]', req.method, req.originalUrl, payload.error);
  }

  res.status(normalized.status).json(payload);
}
