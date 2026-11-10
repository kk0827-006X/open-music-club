const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');
const { ESLint } = require('eslint');
const { baselineAtBase } = require('../scripts/frontend-ratchet.cjs');
const exceptions = require('./fixtures/frontend-import-exceptions.json');
const eslint = new ESLint({ cwd: path.resolve(__dirname, '..') });
const lint = async (source, file = 'features/user/LintProbe.tsx') =>
  (await eslint.lintText(source, { filePath: `frontend/src/${file}` }))[0].messages;

it('首轮只启用约定规则，features 与 app 的超限组件均只警告', async () => {
  for (const file of ['features/user/LintProbe.tsx', 'app/LintProbe.tsx']) {
    const messages = await lint('export const probe = 1;\n' + '\n'.repeat(400), file);
    assert.deepEqual(
      messages.map((message) => [message.ruleId, message.severity]),
      [['max-lines', 1]],
    );
  }
  assert.deepEqual(await lint('const unused = unknownGlobal;'), []);
});

it('阻止跨 feature 静态导入和 re-export，同时允许 app 装配与共享层', async () => {
  for (const source of [
    "import { QueuePanel } from '../queue/QueuePanel.tsx';",
    "export { QueuePanel } from '../queue/QueuePanel.tsx';",
    "import type { QueuePanel } from '../../features/queue/QueuePanel.tsx';",
    "import { App } from '../../app/App.tsx';",
  ])
    assert.ok(
      (await lint(source)).some((message) => message.ruleId === 'no-restricted-imports'),
      source,
    );
  assert.deepEqual(
    await lint(
      "import { QueuePanel } from '../features/queue/QueuePanel.tsx';",
      'app/LintProbe.tsx',
    ),
    [],
  );
  assert.deepEqual(await lint("import { safeCoverUrl } from '../../shared/music.ts';"), []);
  assert.deepEqual(
    await lint(
      "import type { MusicQueue } from '../queue/model.ts';",
      'features/player/player-core.ts',
    ),
    [],
  );
  assert.ok(
    (
      await lint(
        "import type { MusicQueue } from '../queue/other.ts';",
        'features/player/player-core.ts',
      )
    ).some((message) => message.ruleId === 'no-restricted-imports'),
  );
});

it('shared、services 和 graphics 不反向依赖应用或业务页面', async () => {
  for (const file of ['shared/Probe.ts', 'services/Probe.ts', 'graphics/Probe.ts']) {
    assert.ok(
      (await lint("import { App } from '../app/App.tsx';", file)).some(
        (message) => message.ruleId === 'no-restricted-imports',
      ),
      file,
    );
  }
  assert.ok(
    (await lint("import { api } from '../services/api.ts';", 'shared/Probe.ts')).some(
      (message) => message.ruleId === 'no-restricted-imports',
    ),
  );
});

it('features 与 app 禁止字面量、可选链和模板中的 class 查询', async () => {
  for (const file of ['features/user/LintProbe.tsx', 'app/LintProbe.tsx']) {
    for (const source of [
      "root.querySelector('.blocked');",
      "root?.querySelectorAll('li.is-active');",
      "root['querySelector']('.blocked');",
      "root.closest('.blocked');",
      "root.matches('.blocked');",
      "root.querySelector(`[data-id='${id}'] .blocked`);",
      'root.querySelector(`.blocked${id}`);',
      "root.querySelector(`[data-id='${id}'] .blocked[data-active]`);",
    ])
      assert.ok(
        (await lint(source, file)).some((message) => message.ruleId === 'no-restricted-syntax'),
        `${file}: ${source}`,
      );
    for (const source of [
      "root.querySelector('[data-search-input]');",
      "root.querySelector('#app');",
      'root.querySelector(\'[data-url="cover.example.svg"]\');',
      "root.querySelector(`[data-id='${id}']`);",
      'root.querySelector(`[data-queue-key=${JSON.stringify(id)}]`);',
      "root.querySelector(`[data-url='${url}.svg']`);",
      "root.querySelector(`[data-url='cover.svg${suffix}']`);",
      "root.querySelector(`[data-url='${url}.svg${suffix}']`);",
      'root.querySelector(`[data-url="${url}.svg"]`);',
      "root.querySelector(`[data-url='cover.example.svg']`);",
    ])
      assert.deepEqual(await lint(source, file), [], `${file}: ${source}`);
  }
});

it('现有跨 feature 精确引用白名单不得新增，删除后不能复活', () => {
  const flatten = (data) =>
    Object.entries(data).flatMap(([file, imports]) =>
      imports.map((specifier) => `${file}:${specifier}`),
    );
  const entries = flatten(exceptions);
  assert.equal(new Set(entries).size, entries.length);
  const previous = baselineAtBase('tests/fixtures/frontend-import-exceptions.json');
  if (previous) {
    const old = new Set(flatten(previous));
    assert.deepEqual(
      entries.filter((entry) => !old.has(entry)),
      [],
      '精确引用白名单只能缩小',
    );
  }
});

it('CI 在验收基线前执行 lint，提交钩子检查暂存文件及递减白名单', () => {
  const workflow = fs.readFileSync('.github/workflows/acceptance.yml', 'utf8');
  assert.ok(workflow.indexOf('run: pnpm lint') < workflow.indexOf('run: pnpm verify:baseline'));
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /RATCHET_BASE_REF:/);
  assert.match(
    fs.readFileSync('.husky/pre-commit', 'utf8'),
    /pnpm exec lint-staged --hide-unstaged/,
  );
  assert.equal(require('../lint-staged.config.cjs')['*']([]), 'node scripts/lint-staged-check.cjs');
  const { stagedCommands } = require('../scripts/lint-staged-check.cjs');
  const files = [
    path.resolve("frontend/src/app/带空格与'单引号.tsx"),
    path.resolve('docs/修改记录.md'),
  ];
  const commands = stagedCommands(files);
  assert.equal(commands[0].at(-1), files[0]);
  assert.equal(commands[1].at(-1), files[0]);
  assert.ok(commands.some((command) => command.includes('tests/frontendFileSize.test.js')));
  assert.ok(commands.every((command) => !command.includes(files[1])));
});
