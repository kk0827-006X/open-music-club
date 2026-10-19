// 全部为隔离验收账号和合成音频，绝不读取本地 .env 或真实数据库。
const ADMIN = { email: 'acceptance-admin@example.com', password: 'Acceptance-admin-only-2026!' }
const MEMBER = { email: 'acceptance-member@example.com', password: 'Acceptance-member-only-2026!' }
const CLOUD = { id: 900001, name: '验收云端歌曲', ar: [{ id: 1, name: '验收歌手' }], al: { id: 1, name: '验收专辑', picUrl: 'https://e2e.music.126.net/cover.svg' }, dt: 60000 }
function wave() {
  const buffer = Buffer.alloc(44 + 8000 * 60 * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36)
  buffer.writeUInt32LE(buffer.length - 44, 40)
  return buffer
}
module.exports = { ADMIN, MEMBER, CLOUD, wave }
