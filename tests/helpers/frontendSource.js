const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../../frontend/src')
function readCss(file = path.join(root, 'style.css')) {
  const text = fs.readFileSync(file, 'utf8')
  return text.replace(/@import\s+['"]([^'"]+)['"];\s*/g, (_, name) => readCss(path.resolve(path.dirname(file), name)))
}
function readFrontendSource(file) {
  const relative = path.isAbsolute(file) ? path.relative(root, file) : file.replace(/^frontend\/src\//, '')
  if (relative === 'style.css') return readCss()
  return fs.readFileSync(path.join(root, relative), 'utf8')
}
module.exports = { readFrontendSource, readCss }
