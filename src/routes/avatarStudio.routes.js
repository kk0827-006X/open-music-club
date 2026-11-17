const express = require('express');
const { randomUUID } = require('node:crypto');
const {
  createAvatarStudioService,
  validateConfig,
  AvatarStudioError,
} = require('../services/avatarStudio.service');
const { sendSecurityError } = require('../middleware/security');

function createAvatarStudioRouter({ database }) {
  const router = express.Router();
  const service = createAvatarStudioService(database);
  const fail = (res, status, text) => sendSecurityError(res, status, text);
  const validBody = (body, keys) =>
    body &&
    !Array.isArray(body) &&
    typeof body === 'object' &&
    Object.keys(body).every((key) => keys.includes(key));
  const readName = (value) =>
    typeof value === 'string' &&
    value.trim().length >= 1 &&
    value.trim().length <= 40 &&
    !/[\u0000-\u001f\u007f]/.test(value)
      ? value.trim()
      : null;
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET') return next();
    // 登录身份发生改变或同一账号重新登录后，旧页面草稿必须重新读取，不能写进新会话。
    if (!req.session.avatarStudioContext || req.body?.context !== req.session.avatarStudioContext)
      return fail(res, 409, '工坊会话已变化，请重新进入工坊');
    next();
  });
  router.get('/', (req, res, next) => {
    if (Object.keys(req.query).length) return fail(res, 400, '查询参数无效');
    const respond = () =>
      res.json({
        viewerId: req.user.id,
        context: req.session.avatarStudioContext,
        outfits: service.list(req.user.id),
      });
    if (req.session.avatarStudioContext) return respond();
    req.session.avatarStudioContext = randomUUID();
    req.session.save((error) => {
      if (error) return next(error);
      // Session Store 回调位于 Express 同步调用栈之外，数据库异常也必须交给统一脱敏处理。
      try {
        return respond();
      } catch (failure) {
        return next(failure);
      }
    });
  });
  router.param('id', (req, res, next, id) => {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      return fail(res, 400, '形象 ID 无效');
    next();
  });
  router.post('/outfits', (req, res) => {
    const name = readName(req.body?.name),
      config = validateConfig(req.body?.config);
    if (!validBody(req.body, ['context', 'name', 'config']) || !name || !config)
      return fail(res, 400, '形象名称或搭配无效');
    res.status(201).json({ outfit: service.create(req.user.id, name, config) });
  });
  router.patch('/outfits/:id', (req, res) => {
    const name = readName(req.body?.name);
    if (!validBody(req.body, ['context', 'name']) || !name) return fail(res, 400, '形象名称无效');
    res.json({ outfit: service.rename(req.user.id, req.params.id, name) });
  });
  router.post('/outfits/:id/current', (req, res) => {
    if (!validBody(req.body, ['context'])) return fail(res, 400, '形象参数无效');
    res.json({ outfit: service.select(req.user.id, req.params.id) });
  });
  router.delete('/outfits/:id', (req, res) => {
    if (!validBody(req.body, ['context'])) return fail(res, 400, '形象参数无效');
    service.remove(req.user.id, req.params.id);
    res.json({ success: true });
  });
  router.use((req, res) => fail(res, 404, '工坊接口不存在'));
  router.use((error, req, res, next) => {
    if (!(error instanceof AvatarStudioError)) return next(error);
    fail(res, error.status, error.message);
  });
  return router;
}

module.exports = { createAvatarStudioRouter };
