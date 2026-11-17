const fs = require('node:fs');
const path = require('node:path');

// 新增测试默认进入业务门禁，只有明确归属画面/动效的测试进入手动组。
const visualUnitFiles = new Set([
  'acceptanceGraphics.test.js',
  'frontendAmbientBackground.test.js',
  'frontendArchiveEntry.test.js',
  'frontendAudioReactive.test.js',
  'frontendGraphicsResources.test.js',
  'frontendIcons.test.js',
  'frontendInteractionBindings.test.js',
  'frontendLoginBackground.test.js',
  'frontendPageTransitions.test.js',
  'frontendQueueAnimation.test.js',
  'frontendSceneAssets.test.js',
  'frontendSceneHost.test.js',
  'frontendSceneState.test.js',
  'frontendStyles.test.js',
]);

function unitFiles(mode) {
  if (!['business', 'visual', 'all'].includes(mode)) throw new Error('测试分组无效');
  return fs
    .readdirSync(path.resolve(__dirname, '..'))
    .filter((file) => file.endsWith('.test.js'))
    .filter((file) => mode === 'all' || visualUnitFiles.has(file) === (mode === 'visual'))
    .sort()
    .map((file) => `tests/${file}`);
}

module.exports = { unitFiles, visualUnitFiles };
