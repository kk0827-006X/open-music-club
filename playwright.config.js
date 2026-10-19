const { defineConfig } = require('@playwright/test')

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 180000,
  expect: { timeout: 15000 },
  outputDir: 'artifacts/e2e/results',
  reporter: [['list'], ['html', { outputFolder: 'artifacts/e2e/report', open: 'never' }], ['json', { outputFile: 'artifacts/e2e/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4317', browserName: 'chromium',
    // CSS 视口保持桌面布局；降低测试设备像素比，避免无 GPU CI 的原画质离屏渲染阻塞。
    viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 0.5, reducedMotion: 'reduce',
    actionTimeout: 30000, trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'node tests/e2e/server.js', url: 'http://127.0.0.1:4317/health',
    reuseExistingServer: false, timeout: 30000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
})
