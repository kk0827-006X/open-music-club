const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireLogin } = require('../middleware/requireLogin');
const { requireAdmin } = require('../middleware/requireAdmin');
const { findUserById } = require('../db/users');
const { sessionIsValid } = require('../services/twoFactor.service');
const { createNeteaseQrService } = require('../services/neteaseQr.service');
function createNeteaseQrRouter({ app, neteaseService, auth, createStore }) {
  const service = createNeteaseQrService({ database: app.locals.database, neteaseService, auth });
  app.locals.neteaseQr = service;
  const router = express.Router();
  router.use(requireLogin, requireAdmin);
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const limiter = (scope, limit, windowMs) =>
    rateLimit({
      limit,
      windowMs,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      ...(createStore ? { store: createStore(scope) } : {}),
      handler: (req, res) =>
        res.status(429).json({ success: false, message: '操作过于频繁，请稍后再试' }),
    });
  router.use(limiter('neteaseQr', 120, 300000));
  const handle = (operation) => async (req, res) => {
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    req.once('aborted', abort);
    res.once('close', abort);
    if (req.aborted || res.destroyed) controller.abort();
    try {
      if (controller.signal.aborted) return;
      const result = await operation(req, controller.signal);
      if (!controller.signal.aborted && !res.destroyed) res.json(result);
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed)
        res.status(error.qrError ? error.status : 502).json({
          success: false,
          message: error.qrError ? error.message : '网易云账号操作暂时不可用',
        });
    } finally {
      req.removeListener('aborted', abort);
      res.removeListener('close', abort);
    }
  };
  router.get(
    '/status',
    handle(() => service.status()),
  );
  router.post(
    '/qr',
    limiter('neteaseQrStart', 5, 900000),
    handle((req, signal) => service.start(req.sessionID, signal)),
  );
  const authorize = (req, signal) =>
    new Promise((resolve, reject) =>
      app.locals.sessionStore.get(req.sessionID, (error, session) => {
        if (error) return reject(new Error('无法检查管理员会话'));
        if (signal.aborted) return resolve(false);
        try {
          const user = session?.userId && findUserById(app.locals.database, session.userId);
          resolve(
            Boolean(
              user &&
              user.status === 'active' &&
              user.role === 'admin' &&
              (!session.rememberUntil || session.rememberUntil > Date.now()) &&
              sessionIsValid({ app, session }, user),
            ),
          );
        } catch {
          reject(new Error('无法检查管理员会话'));
        }
      }),
    );
  router.post(
    '/qr/check',
    handle((req, signal) =>
      service.check(req.sessionID, req.body?.ticket, () => authorize(req, signal), signal),
    ),
  );
  router.post(
    '/qr/cancel',
    handle((req) => service.cancel(req.sessionID, req.body?.ticket)),
  );
  router.post(
    '/logout',
    handle(() => service.logout()),
  );
  return router;
}
module.exports = { createNeteaseQrRouter };
