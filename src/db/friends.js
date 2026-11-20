const { randomUUID } = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const REQUEST_LIFETIME_MS = 14 * DAY_MS;
const DECLINE_COOLDOWN_MS = 7 * DAY_MS;

function initializeFriendsSchema(database) {
  database.transaction(() =>
    database.exec(`
    CREATE TABLE IF NOT EXISTS friend_request_submissions (
      id TEXT PRIMARY KEY NOT NULL,
      sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_key TEXT NOT NULL,
      masked_email TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE (sender_id, email_key),
      UNIQUE (id, sender_id)
    );
    CREATE INDEX IF NOT EXISTS index_friend_submissions_sender
      ON friend_request_submissions(sender_id, submitted_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS index_friend_submissions_expiry
      ON friend_request_submissions(expires_at);

    CREATE TABLE IF NOT EXISTS friend_relationships (
      id TEXT PRIMARY KEY NOT NULL,
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      submission_id TEXT UNIQUE,
      requested_at INTEGER NOT NULL,
      expires_at INTEGER,
      accepted_at INTEGER,
      CHECK (requester_id <> recipient_id),
      CHECK ((submission_id IS NOT NULL AND expires_at IS NOT NULL AND accepted_at IS NULL)
          OR (submission_id IS NULL AND expires_at IS NULL AND accepted_at IS NOT NULL)),
      FOREIGN KEY (submission_id, requester_id)
        REFERENCES friend_request_submissions(id, sender_id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS unique_friend_relationship_pair
      ON friend_relationships(min(requester_id, recipient_id), max(requester_id, recipient_id));
    CREATE INDEX IF NOT EXISTS index_friend_relationships_requester
      ON friend_relationships(requester_id);
    CREATE INDEX IF NOT EXISTS index_friend_relationships_recipient
      ON friend_relationships(recipient_id, requested_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS index_friend_pending_expiry
      ON friend_relationships(expires_at) WHERE expires_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS friend_request_cooldowns (
      requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      retry_at INTEGER NOT NULL,
      PRIMARY KEY (requester_id, recipient_id)
    );
    CREATE INDEX IF NOT EXISTS index_friend_cooldowns_recipient
      ON friend_request_cooldowns(recipient_id);
    CREATE INDEX IF NOT EXISTS index_friend_cooldowns_expiry
      ON friend_request_cooldowns(retry_at);
  `),
  )();
}

function createFriendsRepository(database) {
  const pruneSubmissions = database.prepare(
    'DELETE FROM friend_request_submissions WHERE expires_at <= ?',
  );
  const pruneRequests = database.prepare('DELETE FROM friend_relationships WHERE expires_at <= ?');
  const pruneCooldowns = database.prepare(
    'DELETE FROM friend_request_cooldowns WHERE retry_at <= ?',
  );
  const saveSubmission = database.prepare(`
    INSERT INTO friend_request_submissions (id, sender_id, email_key, masked_email, submitted_at, expires_at)
    VALUES (@id, @senderId, @emailKey, @maskedEmail, @now, @expiresAt)
    ON CONFLICT(sender_id, email_key) DO UPDATE SET
      submitted_at = excluded.submitted_at, expires_at = excluded.expires_at
    RETURNING id
  `);
  const deliverRequest = database.prepare(`
    INSERT INTO friend_relationships (id, requester_id, recipient_id, submission_id, requested_at, expires_at)
    SELECT @id, @senderId, target.id, @submissionId, @now, @expiresAt
    FROM users AS target
    WHERE target.email = @email AND target.status = 'active' AND target.id <> @senderId
      AND NOT EXISTS (
        SELECT 1 FROM friend_request_cooldowns
        WHERE requester_id = @senderId AND recipient_id = target.id AND retry_at > @now
      )
    ON CONFLICT DO NOTHING
  `);
  const selectIncoming = database.prepare(`
    SELECT relation.id, sender.nickname, relation.requested_at AS requestedAt,
           relation.expires_at AS expiresAt
    FROM friend_relationships AS relation
    JOIN users AS sender ON sender.id = relation.requester_id AND sender.status = 'active'
    WHERE relation.recipient_id = @userId AND relation.expires_at > @now
    ORDER BY relation.requested_at DESC, relation.id DESC LIMIT @limit OFFSET @offset
  `);
  const selectOutgoing = database.prepare(`
    SELECT id, masked_email AS maskedEmail, submitted_at AS submittedAt, expires_at AS expiresAt
    FROM friend_request_submissions
    WHERE sender_id = @userId AND expires_at > @now
    ORDER BY submitted_at DESC, id DESC LIMIT @limit OFFSET @offset
  `);
  const selectFriends = database.prepare(`
    SELECT friend.id AS userId, friend.nickname, relation.accepted_at AS acceptedAt
    FROM friend_relationships AS relation
    JOIN users AS friend ON friend.id = CASE WHEN relation.requester_id = @userId
      THEN relation.recipient_id ELSE relation.requester_id END AND friend.status = 'active'
    WHERE (relation.requester_id = @userId OR relation.recipient_id = @userId)
      AND relation.accepted_at IS NOT NULL
    ORDER BY relation.accepted_at DESC, friend.id DESC LIMIT @limit OFFSET @offset
  `);
  const findIncoming = database.prepare(`
    SELECT relation.requester_id, relation.submission_id
    FROM friend_relationships AS relation
    JOIN users AS sender ON sender.id = relation.requester_id AND sender.status = 'active'
    WHERE relation.id = ? AND relation.recipient_id = ? AND relation.expires_at > ?
  `);
  const acceptRequest = database.prepare(`
    UPDATE friend_relationships SET accepted_at = ?, submission_id = NULL, expires_at = NULL
    WHERE id = ?
  `);
  const deleteRequest = database.prepare('DELETE FROM friend_relationships WHERE id = ?');
  const saveCooldown = database.prepare(`
    INSERT INTO friend_request_cooldowns (requester_id, recipient_id, retry_at) VALUES (?, ?, ?)
    ON CONFLICT(requester_id, recipient_id) DO UPDATE SET retry_at = excluded.retry_at
  `);
  const deleteSubmission = database.prepare('DELETE FROM friend_request_submissions WHERE id = ?');
  const withdrawSubmission = database.prepare(`
    DELETE FROM friend_request_submissions WHERE id = ? AND sender_id = ? AND expires_at > ?
  `);
  const deleteFriendship = database.prepare(`
    DELETE FROM friend_relationships
    WHERE min(requester_id, recipient_id) = min(@userId, @friendId)
      AND max(requester_id, recipient_id) = max(@userId, @friendId)
      AND accepted_at IS NOT NULL
  `);

  function cleanup(now) {
    pruneSubmissions.run(now);
    pruneRequests.run(now);
    pruneCooldowns.run(now);
  }
  database.transaction(cleanup).immediate(Date.now());

  const submit = database.transaction((senderId, { email, emailKey, maskedEmail }) => {
    const now = Date.now();
    cleanup(now);
    const expiresAt = now + REQUEST_LIFETIME_MS;
    // 每种邮箱使用相同的提交记录。重新提交可刷新这条记录，但不会延长已送达请求的有效期。
    const submission = saveSubmission.get({
      id: randomUUID(),
      senderId,
      emailKey,
      maskedEmail,
      now,
      expiresAt,
    });
    deliverRequest.run({
      id: randomUUID(),
      senderId,
      email,
      submissionId: submission.id,
      now,
      expiresAt,
    });
  });

  const reply = database.transaction((userId, requestId, action) => {
    const now = Date.now();
    const incoming = findIncoming.get(requestId, userId, now);
    if (!incoming) return false;
    if (action === 'accept') {
      acceptRequest.run(now, requestId);
      deleteSubmission.run(incoming.submission_id);
    } else {
      // 拒绝后只清除实际请求，发送者的提交记录仍独立保留。
      deleteRequest.run(requestId);
      saveCooldown.run(incoming.requester_id, userId, now + DECLINE_COOLDOWN_MS);
    }
    return true;
  });

  return {
    submit: submit.immediate,
    reply: reply.immediate,
    listIncoming: (userId, page) => selectIncoming.all({ ...page, userId, now: Date.now() }),
    listOutgoing: (userId, page) => selectOutgoing.all({ ...page, userId, now: Date.now() }),
    listFriends: (userId, page) => selectFriends.all({ ...page, userId }),
    withdraw: (userId, submissionId) =>
      withdrawSubmission.run(submissionId, userId, Date.now()).changes > 0,
    remove: (userId, friendId) => deleteFriendship.run({ userId, friendId }).changes > 0,
  };
}

module.exports = { initializeFriendsSchema, createFriendsRepository };
