export class HttpError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = options.code || null;
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
    this.cause = options.cause;
  }
}

export function createHttpError(status, message, options = {}) {
  return new HttpError(status, message, options);
}

export function badRequest(message, options) {
  return createHttpError(400, message, options);
}

export function unauthorized(message, options) {
  return createHttpError(401, message, options);
}

export function forbidden(message, options) {
  return createHttpError(403, message, options);
}

export function notFound(message, options) {
  return createHttpError(404, message, options);
}

export function conflict(message, options) {
  return createHttpError(409, message, options);
}

export function serviceUnavailable(message, options) {
  return createHttpError(503, message, options);
}

export function gatewayTimeout(message, options) {
  return createHttpError(504, message, options);
}

export function isClientAbortError(error) {
  return error?.code === 'ERR_CLIENT_ABORTED';
}

export function normalizeError(error) {
  if (error instanceof HttpError) {
    return error;
  }

  if (isClientAbortError(error)) {
    return createHttpError(499, 'Client closed request', {
      code: error.code,
      expose: true,
      cause: error,
    });
  }

  if (error?.code === 'ETIMEDOUT') {
    return gatewayTimeout(error.message || 'Command timed out', {
      code: error.code,
      details: error.details,
      expose: true,
      cause: error,
    });
  }

  return createHttpError(500, error?.message || 'Internal server error', {
    code: error?.code || null,
    expose: false,
    cause: error,
  });
}

export function asyncRoute(handler) {
  return function wrappedRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
