const { parentPort, workerData } = require('node:worker_threads')
// 仅隔离第三方请求的原始输出，不向主线程传递异常正文或堆栈。
const request = require(workerData.requestModule)
parentPort.on('message', async ({ id, uri, data, options }) => {
  try { parentPort.postMessage({ id, ok: true, result: await request(uri, data, options) }) }
  catch (error) { parentPort.postMessage({ id, ok: false, code: Number.isSafeInteger(error?.body?.code) ? error.body.code : undefined }) }
})
