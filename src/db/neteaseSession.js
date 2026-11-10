const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
function initializeNeteaseSessionSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS netease_session (
    id INTEGER PRIMARY KEY CHECK(id=1), ciphertext TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}
function createNeteaseSessionStore(db, auth) {
  const clear = () => {
    db.prepare('DELETE FROM netease_session WHERE id=1').run();
  };
  if (auth.storage === 'memory') {
    clear();
    return { load: () => null, save() {}, clear };
  }
  const key = Buffer.from(auth.encryptionKey || '', 'base64');
  if (key.length !== 32 || key.toString('base64') !== auth.encryptionKey)
    throw new Error('网易云登录态加密密钥未配置或无效');
  const aad = Buffer.from('omc:netease:session:v1');
  return {
    load() {
      const row = db.prepare('SELECT ciphertext FROM netease_session WHERE id=1').get();
      if (!row) return null;
      const [iv, tag, body] = row.ciphertext
        .split('.')
        .map((value) => Buffer.from(value, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
    },
    save(cookie) {
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad);
      const body = Buffer.concat([cipher.update(JSON.stringify(cookie), 'utf8'), cipher.final()]);
      const value = [iv, cipher.getAuthTag(), body]
        .map((part) => part.toString('base64'))
        .join('.');
      db.prepare(
        `INSERT INTO netease_session(id,ciphertext) VALUES(1,?)
        ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,updated_at=CURRENT_TIMESTAMP`,
      ).run(value);
    },
    clear,
  };
}
module.exports = { initializeNeteaseSessionSchema, createNeteaseSessionStore };
