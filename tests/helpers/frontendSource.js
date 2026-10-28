const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../frontend/src')
// 测试检查真实实现，而不是旧入口的转发文本。
const implementations = {
  'login-page.ts': ['features/auth/LoginPage.tsx'], 'entry-page.ts': ['features/auth/EntryPage.tsx'],
  'authorized-sequence.ts': ['features/auth/AuthorizedSequence.tsx'],
  'album-archive.ts': ['app/Workspace.tsx', 'features/music-library/LibraryView.tsx', 'features/player/PlayerView.tsx'],
  'music-queue.ts': ['features/queue/model.ts'], 'queue-persistence.ts': ['features/queue/persistence.ts'],
  'queue-add-animation.ts': ['features/queue/add-animation.ts', 'features/queue/QueueAddFlights.tsx'], 'player-queue-panel.ts': ['features/queue/QueuePanel.tsx'],
  'user-page.ts': ['features/user/UserPage.tsx'], 'upload-page.ts': ['features/upload/UploadPage.tsx'],
  'search-page.ts': ['features/search/SearchPage.tsx'], 'settings-dialog.ts': ['features/settings/SettingsDialog.tsx'],
}
function readCss(file = path.join(root, 'style.css'), { originalOnly = false } = {}) {
  // 新业务样式独立验收，不混入原 2930 条声明的逐字视觉基线。
  if (originalOnly && ['styles/react-components.css', 'styles/footprint.css', 'styles/member-sidebar.css', 'styles/access-application.css', 'styles/application-activation.css'].some(name => file === path.join(root, name))) return ''
  const text = fs.readFileSync(file, 'utf8')
  return text.replace(/@import\s+['"]([^'"]+)['"];\s*/g, (_, name) => readCss(path.resolve(path.dirname(file), name), { originalOnly }))
}
function readFrontendSource(file) {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file.replace(/^frontend\/src\//, '')
  if (relative === 'style.css') return readCss()
  return (implementations[relative] || [relative]).map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n')
}
module.exports = { readFrontendSource, readCss }
