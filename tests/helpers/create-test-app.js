import express from 'express';

export function createTestApp(router, options = {}) {
  const app = express();
  app.use(express.json());

  if (options.user) {
    app.use((req, _res, next) => {
      req.user = options.user;
      next();
    });
  }

  app.use(router);
  return app;
}
