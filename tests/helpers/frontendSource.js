const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../frontend/src')
// 测试检查真实实现，而不是旧入口的转发文本。
const implementations = {
  'login-page.ts': ['features/auth/login-page.ts'], 'entry-page.ts': ['features/auth/entry-page.ts'],
  'authorized-sequence.ts': ['features/auth/authorized-sequence.ts'],
  'album-archive.ts': ['app/workspace-view.ts', 'app/music-workspace.ts', 'features/music-library/library-view.ts', 'features/music-library/library-controller.ts', 'features/player/player-view.ts'],
  'music-queue.ts': ['features/queue/model.ts'], 'queue-persistence.ts': ['features/queue/persistence.ts'],
  'queue-add-animation.ts': ['features/queue/add-animation.ts'], 'player-queue-panel.ts': ['features/queue/panel.ts'],
  'user-page.ts': ['features/user/user-page.ts'], 'upload-page.ts': ['features/upload/upload-page.ts'],
  'search-page.ts': ['features/search/search-page.ts'], 'settings-dialog.ts': ['features/settings/settings-dialog.ts'],
}
function readCss(file = path.join(root, 'style.css')) {
  const text = fs.readFileSync(file, 'utf8')
  return text.replace(/@import\s+['"]([^'"]+)['"];\s*/g, (_, name) => readCss(path.resolve(path.dirname(file), name)))
}
function readFrontendSource(file) {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file.replace(/^frontend\/src\//, '')
  if (relative === 'style.css') return readCss()
  return (implementations[relative] || [relative]).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
}
module.exports = { readFrontendSource, readCss }
