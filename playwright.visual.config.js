const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config');

// 仅由手动命令运行；没有进入 CI 合并门禁。
module.exports = defineConfig(base, {
  testIgnore: [],
  testMatch: '**/*.visual.spec.js',
  outputDir: 'artifacts/visual/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/visual/report', open: 'never' }],
    ['json', { outputFile: 'artifacts/visual/results.json' }],
  ],
  use: { deviceScaleFactor: 0.25 },
});
