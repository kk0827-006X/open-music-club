const { createHmac } = require('node:crypto');
const express = require('express');
const { createFriendsRepository } = require('../db/friends');
const { isValidEmail, normalizeEmail } = require('../db/users');
const { requireLogin } = require('../middleware/requireLogin');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function parseInteger(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return NaN;
  return Number(value);
}

function listResponse(res, query, key, fetchRows, format) {
  const limit = parseInteger(query.limit ?? '20');
  const offset = parseInteger(query.offset ?? '0');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(offset)) {
    return res.status(400).json({ success: false, message: '分页参数无效' });
  }
  const rows = fetchRows({ limit: limit + 1, offset });
  return res.json({
    success: true,
    [key]: rows.slice(0, limit).map(format),
    hasMore: rows.length > limit,
  });
}

function formatOutgoing(row) {
  return {
    ...row,
    submittedAt: new Date(row.submittedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}

function formatIncoming(row) {
  return {
    ...row,
    requestedAt: new Date(row.requestedAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
  };
}

function formatFriend(row) {
  return { ...row, acceptedAt: new Date(row.acceptedAt).toISOString() };
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${Array.from(local)[0]}***@${Array.from(domain)[0]}***`;
}

function createFriendsRouter({ database, sessionSecret, submitLimiter }) {
  const router = express.Router();
  const friends = createFriendsRepository(database);
  // 派生独立用途的密钥，避免在申请记录中保存完整邮箱或可直接猜测的普通摘要。
  const signingSecret = Array.isArray(sessionSecret) ? sessionSecret[0] : sessionSecret;
  const emailKeySecret = createHmac('sha256', signingSecret)
    .update('open-music-club:friend-request-email:v1')
    .digest();

  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  }, requireLogin);

  router.get('/', (req, res) =>
    listResponse(
      res,
      req.query,
      'friends',
      (page) => friends.listFriends(req.user.id, page),
      formatFriend,
    ),
  );
  router.get('/requests/incoming', (req, res) =>
    listResponse(
      res,
      req.query,
      'requests',
      (page) => friends.listIncoming(req.user.id, page),
      formatIncoming,
    ),
  );
  router.get('/requests/outgoing', (req, res) =>
    listResponse(
      res,
      req.query,
      'submissions',
      (page) => friends.listOutgoing(req.user.id, page),
      formatOutgoing,
    ),
  );

  router.post('/requests', ...(submitLimiter ? [submitLimiter] : []), (req, res) => {
    const input = req.body?.email;
    const email = normalizeEmail(input);
    if (!isValidEmail(input) || /[\p{Cc}\p{Cf}]/u.test(email)) {
      return res.status(400).json({ success: false, message: '请提供有效的邮箱' });
    }
    const emailKey = createHmac('sha256', emailKeySecret)
      .update(`${req.user.id}:${email}`)
      .digest('hex');
    friends.submit(req.user.id, { email, emailKey, maskedEmail: maskEmail(email) });
    return res.status(202).json({ success: true, message: '申请已提交' });
  });

  router.patch('/requests/incoming/:id', (req, res) => {
    const { id } = req.params;
    const action = req.body?.action;
    if (!UUID.test(id) || (action !== 'accept' && action !== 'decline')) {
      return res.status(400).json({ success: false, message: '请求编号或处理操作无效' });
    }
    if (!friends.reply(req.user.id, id, action)) {
      return res.status(404).json({ success: false, message: '待处理的好友请求不存在' });
    }
    return res.status(204).end();
  });

  router.delete('/requests/outgoing/:id', (req, res) => {
    const { id } = req.params;
    if (!UUID.test(id)) {
      return res.status(400).json({ success: false, message: '提交编号无效' });
    }
    if (!friends.withdraw(req.user.id, id)) {
      return res.status(404).json({ success: false, message: '提交记录不存在' });
    }
    return res.status(204).end();
  });

  router.delete('/:userId', (req, res) => {
    const friendId = parseInteger(req.params.userId);
    if (!Number.isSafeInteger(friendId) || friendId < 1) {
      return res.status(400).json({ success: false, message: '用户编号无效' });
    }
    if (!friends.remove(req.user.id, friendId)) {
      return res.status(404).json({ success: false, message: '好友关系不存在' });
    }
    return res.status(204).end();
  });

  return router;
}

module.exports = { createFriendsRouter };
