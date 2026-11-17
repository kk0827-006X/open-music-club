const { defineConfig } = require('@playwright/test');
// 本地可为并行验收指定基础端口；不复用已占用的服务或真实账号数据。
const port = Number(process.env.OMC_E2E_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('验收端口无效');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/*.visual.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir: 'artifacts/e2e/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/e2e/report', open: 'never' }],
    ['json', { outputFile: 'artifacts/e2e/results.json' }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    // 业务组使用标准像素比与减少动态效果，图形替身由业务夹具统一提供。
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    actionTimeout: 30000,
    screenshot: 'only-on-failure',
    // 保留操作与 DOM 诊断，避免 trace 持续录屏触发软件 WebGL 逐帧读回。
    trace: { mode: 'retain-on-failure', screenshots: false, snapshots: true, sources: true },
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: `node tests/e2e/server.js ${port}`,
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    timeout: 30000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
