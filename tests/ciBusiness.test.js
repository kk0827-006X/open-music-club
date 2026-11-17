const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { unitFiles, visualUnitFiles } = require('./helpers/test-suites.cjs');
const { businessPassed } = require('../scripts/ci-merge-gate.cjs');

it('业务与视觉单元分组互斥且覆盖全部文件，安全回归不能遗漏', () => {
  const business = unitFiles('business'),
    visual = unitFiles('visual');
  assert.deepEqual(
    business.filter((file) => visual.includes(file)),
    [],
  );
  assert.deepEqual([...business, ...visual].sort(), unitFiles('all'));
  for (const file of visualUnitFiles) assert.ok(fs.existsSync(`tests/${file}`), file);
  for (const name of [
    'auth',
    'twoFactor',
    'security',
    'localMusic',
    'password',
    'avatarStudio',
    'footprint',
    'ciBusiness',
  ])
    assert.ok(business.includes(`tests/${name}.test.js`));
});

it('业务场景替身遵守详情与销毁契约，不创建图形渲染器', async () => {
  const { businessSceneSource } = require('./e2e/business-scene');
  assert.doesNotMatch(businessSceneSource, /\bimport\b|WebGL|requestAnimationFrame/);
  const window = {};
  const Scene = vm.runInNewContext(
    businessSceneSource.replace('export class', 'class') + '\nArchiveScene',
    { window },
  );
  const scene = new Scene({});
  await scene.load();
  scene.setMode('detail');
  assert.equal(scene.detailVisibility, 1);
  scene.setMode('archive');
  assert.equal(scene.detailVisibility, 0);
  scene.select(7);
  assert.equal(scene.selectedIndex, 7);
  scene.dispose();
  assert.equal(window.__migrationScenes[0].live, false);
});

it('合并门禁仅接受成功，失败、取消、跳过及缺失均返回非零状态', () => {
  for (const result of ['success', 'failure', 'cancelled', 'skipped', 'pending', '']) {
    assert.equal(businessPassed(result), result === 'success');
    const executed = spawnSync(process.execPath, ['scripts/ci-merge-gate.cjs'], {
      env: { ...process.env, BUSINESS_RESULT: result },
    });
    assert.equal(executed.status, result === 'success' ? 0 : 1);
  }
  assert.equal(businessPassed(undefined), false);
});

it('CI 只执行业务入口，固定门禁必须运行且不放宽依赖或覆盖率', () => {
  const workflow = fs.readFileSync('.github/workflows/acceptance.yml', 'utf8');
  assert.match(workflow, /merge-gate:[\s\S]*if: always\(\)[\s\S]*needs: \[business\]/);
  assert.match(workflow, /BUSINESS_RESULT: \$\{\{ needs\.business\.result \}\}/);
  assert.match(workflow, /--audit-level=high/);
  assert.doesNotMatch(workflow, /continue-on-error|test:e2e:visual|test:visual:unit/);
  assert.equal((workflow.match(/pnpm install --frozen-lockfile/g) || []).length, 1);
  assert.match(
    require('../package.json').scripts['test:coverage'],
    /--lines 80 --functions 80 --branches 80 --statements 80/,
  );
  const config = require('../playwright.config');
  assert.equal(config.testIgnore, '**/*.visual.spec.js');
  const visualConfig = require('../playwright.visual.config');
  assert.equal(visualConfig.testMatch, '**/*.visual.spec.js');
});

it('全部业务浏览器文件使用业务夹具，不再包含画面样式断言或成功截图', () => {
  const files = fs
    .readdirSync('tests/e2e')
    .filter((file) => file.endsWith('.spec.js') && !file.endsWith('.visual.spec.js'));
  for (const file of files) {
    const source = fs.readFileSync(`tests/e2e/${file}`, 'utf8');
    assert.match(source, /require\('\.\/business-test'\)/, file);
    assert.doesNotMatch(
      source,
      /toHaveCSS\(|\.screenshot\(|graphicsProfile|projectCard|getComputedStyle|data-render-quality|data-acceptance-frames|data-acceptance-selection/,
      file,
    );
  }
});
