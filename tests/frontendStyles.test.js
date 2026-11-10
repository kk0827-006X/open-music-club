const assert = require('node:assert/strict');
const fs = require('node:fs');
const { it } = require('node:test');
const { readCss } = require('./helpers/frontendSource');
const postcss = require(
  require.resolve('postcss', {
    paths: [require.resolve('../frontend/node_modules/vite/package.json')],
  }),
);
it('登录 2FA 弹窗使用独立响应式尺寸，保留居中和原有进出动画', () => {
  const rules = new Map();
  postcss.parse(readCss()).walkRules((rule) => {
    if (rule.parent.type !== 'root') return;
    if (!rules.has(rule.selector)) rules.set(rule.selector, new Map());
    rule.walkDecls((declaration) =>
      rules.get(rule.selector).set(declaration.prop, declaration.value),
    );
  });
  assert.equal(
    rules.get('.login-factor-dialog.is-challenge').get('width'),
    'min(420px, calc(100vw - 32px))',
  );
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('scale'), undefined);
  assert.equal(rules.get('.login-factor-dialog').get('margin'), 'auto');
  assert.equal(rules.get('.login-factor-dialog.is-challenge').get('transform'), undefined);
  assert.match(rules.get('.login-factor-dialog[open]').get('animation'), /settings-enter/);
  assert.match(rules.get('.login-factor-dialog.is-closing').get('animation'), /settings-exit/);
});
it('全部页面与主题样式文件可解析，入口导入也可完整解析', () => {
  const files = [
    'frontend/public/theme.css',
    'frontend/src/style.css',
    ...fs
      .readdirSync('frontend/src/styles')
      .filter((name) => name.endsWith('.css'))
      .map((name) => `frontend/src/styles/${name}`),
  ].sort();
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotThrow(() => postcss.parse(source, { from: file }), `${file} 应为合法 CSS`);
  }
  assert.doesNotThrow(() => postcss.parse(readCss()), '入口导入的样式必须存在且可解析');
  assert.match(fs.readFileSync('frontend/src/style.css', 'utf8'), /^@import/);
});
