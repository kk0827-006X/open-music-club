// 全部为隔离验收账号和合成音频，绝不读取本地 .env 或真实数据库。
const ADMIN = { email: 'acceptance-admin@example.com', password: 'Acceptance-admin-only-2026!' };
const MEMBER = { email: 'acceptance-member@example.com', password: 'Acceptance-member-only-2026!' };
const REVIEWER = {
  email: 'acceptance-reviewer@example.com',
  password: 'Acceptance-reviewer-only-2026!',
};
const PASSWORD = {
  email: 'acceptance-password@example.com',
  password: 'Acceptance-password-only-2026!',
};
// 工坊会反复切换账号，不复用会被其他流程绑定 2FA 或修改密码的账号。
const AVATAR = {
  email: 'acceptance-avatar@example.com',
  password: 'Acceptance-avatar-only-2026!',
};
const AVATAR_OTHER = {
  email: 'acceptance-avatar-other@example.com',
  password: 'Acceptance-avatar-other-only-2026!',
};
const QRADMIN = {
  email: 'acceptance-qr-admin@example.com',
  password: 'Acceptance-qr-admin-only-2026!',
};
const CLOUD = {
  id: 900001,
  name: '验收云端歌曲',
  ar: [{ id: 1, name: '验收歌手' }],
  al: { id: 1, name: '验收专辑', picUrl: 'https://e2e.music.126.net/cover.svg' },
  dt: 60000,
};
function wave() {
  const buffer = Buffer.alloc(44 + 8000 * 60 * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}
module.exports = { ADMIN, MEMBER, REVIEWER, PASSWORD, AVATAR, AVATAR_OTHER, QRADMIN, CLOUD, wave };

// 仅从隔离服务的模拟邮件产物读取，不增加生产路由或发送真实邮件。
function readApplicationLink(email, purpose, port = 4317) {
  const fs = require('node:fs'),
    path = require('node:path');
  const file = path.resolve(
    __dirname,
    `../../artifacts/e2e/${port === 4317 ? 'mailbox' : `mailbox-${port}`}.json`,
  );
  const route = purpose === 'verify' ? 'verify-email' : 'activate';
  try {
    const message = JSON.parse(fs.readFileSync(file, 'utf8'))
      .filter((item) => item.to === email && item.text.includes(`/${route}#`))
      .at(-1);
    const link = message?.text.match(
      /http:\/\/127\.0\.0\.1:\d+\/(?:verify-email|activate)#token=[A-Za-z0-9_-]+/,
    )?.[0];
    return link && new URL(link).origin === `http://127.0.0.1:${port}` ? link : '';
  } catch {
    return '';
  }
}
module.exports.readApplicationLink = readApplicationLink;
