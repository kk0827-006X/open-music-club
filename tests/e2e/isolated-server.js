const { fork } = require('node:child_process');
const path = require('node:path');

// 单独进程保留真实安全策略，避免其他测试消耗本流程的限流额度或改变账号状态。
async function startIsolatedServer(port) {
  const child = fork(path.join(__dirname, 'server.js'), [String(port)], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  };
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        child.off('message', ready);
        child.off('exit', exited);
        child.off('error', failed);
      };
      const ready = (message) => {
        if (!message?.ready) return;
        cleanup();
        resolve();
      };
      const exited = () => failed(new Error('独立验收服务提前退出'));
      const failed = (error) => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => failed(new Error('独立验收服务启动超时')), 20000);
      child.on('message', ready);
      child.once('exit', exited);
      child.once('error', failed);
    });
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}

function useIsolatedBusinessServer(test, port) {
  test.use({ baseURL: `http://127.0.0.1:${port}` });
  let stop;
  test.beforeAll(async () => {
    stop = await startIsolatedServer(port);
  });
  test.afterAll(async () => {
    await stop?.();
  });
}

module.exports = { startIsolatedServer, useIsolatedBusinessServer };
