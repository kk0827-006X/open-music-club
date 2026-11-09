// 只用于验证工作线程日志隔离，全部为合成标记，不访问网络。
module.exports = async (uri, data, options) => {
  console.log('isolated-secret-password', 'MUSIC_U=isolated-secret-cookie')
  console.error('isolated-secret-cookie')
  if (uri === 'throw') throw Object.assign(new Error('isolated-secret-password'), { body: { code: 460, cookie: 'isolated-secret-cookie' } })
  if (uri === 'exit') process.exit(1)
  if (uri === 'hang') return new Promise(() => {})
  return { status: 200, body: { code: 200, data, timeout: options.timeout }, cookie: [] }
}
