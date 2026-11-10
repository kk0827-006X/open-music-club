const path = require('node:path');
const { Worker } = require('node:worker_threads');
const unavailable = () => new Error('网易云请求暂时不可用');

// 上游 util/request 的错误分支会直接打印响应和 Cookie；只截获该线程输出，不修改全局 console。
function createNeteaseRequestClient({
  requestModule = require.resolve('@neteasecloudmusicapienhanced/api/util/request'),
  timeoutMs = 20000,
} = {}) {
  let worker,
    closed = false,
    sequence = 0;
  const pending = new Map();
  function failAll() {
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(unavailable());
    }
    pending.clear();
  }
  function open() {
    if (worker) return;
    worker = new Worker(path.join(__dirname, 'netease-request.worker.js'), {
      workerData: { requestModule },
      stdout: true,
      stderr: true,
    });
    // 消费并丢弃原始日志；不得把第三方内容逐条转发至服务日志。
    worker.stdout.resume();
    worker.stderr.resume();
    worker.on('message', (message) => {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (!pending.size) worker.unref();
      if (message.ok) entry.resolve(message.result);
      else {
        const error = unavailable();
        if (Number.isSafeInteger(message.code)) error.code = message.code;
        entry.reject(error);
      }
    });
    worker.on('error', failAll);
    worker.on('exit', failAll);
    worker.unref();
  }
  const client = (uri, data, options) =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(unavailable());
        return;
      }
      try {
        open();
        const id = ++sequence;
        const timer = setTimeout(() => {
          failAll();
          // 主线程超时必须终止实际任务，不把挂起请求留在线程中继续累积。
          void worker.terminate().catch(() => {});
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.ref();
        try {
          worker.postMessage({ id, uri, data, options: { ...options, timeout: 10000 } });
        } catch {
          pending.delete(id);
          clearTimeout(timer);
          if (!pending.size) worker.unref();
          reject(unavailable());
        }
      } catch {
        reject(unavailable());
      }
    });
  client.close = async () => {
    failAll();
    if (worker) await worker.terminate();
  };
  return client;
}
module.exports = { createNeteaseRequestClient };
