const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { withReactHarness } = require('./helpers/reactHarness');

async function withLogin(run) {
  return withReactHarness(async (h) => {
    const { LoginPage } = await import('../frontend/src/features/auth/LoginPage.tsx');
    await h.render(h.React.createElement(LoginPage));
    await run(h);
  });
}

describe('登录页面（真实 React 组件）', () => {
  it('字符背景仅作为无交互的透明动效层，不搬入演示背景和文字', async () => {
    await withLogin(async (h) => {
      assert.equal(h.require('[data-login-background]').getAttribute('aria-hidden'), 'true');
      assert.doesNotMatch(h.document.body.textContent, /LIVE SIMULATION|让光，随你流动/);
      assert.equal(h.query('#surface'), null);
    });
  });

  it('登录页与音乐库复用同一 Logo 的定位、字形和内容，登录不显示统计', async () => {
    await withLogin(async (h) => {
      const header = h.require('header.archive-brand');
      const title = header.querySelector('h1').textContent;
      const subtitle = header.querySelector('p').textContent;
      assert.equal(header.querySelector('small'), null);
      const { Brand } = await import('../frontend/src/shared/react/ui.tsx');
      await h.render(h.React.createElement(Brand, { statistics: true }));
      assert.equal(h.require('header.archive-brand h1').textContent, title);
      assert.equal(h.require('header.archive-brand p').textContent, subtitle);
      assert.ok(h.query('header.archive-brand small'));
    });
  });

  it('两步验证使用默认关闭的独立弹窗，密码表单下方只保留无交互占位', async () => {
    await withLogin(async (h) => {
      assert.equal(h.require('[data-login-factor-dialog]').open, false);
      assert.equal(h.query('[data-login-factor]'), null);
      assert.equal(h.query('main .factor-challenge'), null);
      const spacer = h.require('[data-login-factor-spacer]');
      assert.equal(spacer.getAttribute('aria-hidden'), 'true');
      assert.equal(spacer.hasAttribute('inert'), true);
    });
  });

  it('只渲染登录所需内容，不提前显示业务导航或播放器', async () => {
    await withLogin(async (h) => {
      for (const selector of [
        '[data-login-form]',
        '[type="email"]',
        '[type="password"]',
        '.login-layout-spacer',
        '[data-forgot-password-open]',
      ])
        h.require(selector);
      assert.match(h.document.body.textContent, /AUTHENTICATOR \/ 两步验证/);
      assert.match(h.require('[data-forgot-password-open]').textContent, /忘记密码/);
      assert.doesNotMatch(h.document.body.textContent, /申请访问|AUTHENTICATION PROTOCOL/);
      for (const selector of [
        '.system-status',
        '.access-footer',
        '[data-business-navigation]',
        '[data-global-player]',
      ])
        assert.equal(h.query(selector), null);
    });
  });

  // 旧 login-motion 的采样和圆弧函数已无生产调用；入场动画由现有 Motion/浏览器用例验收。
  it('密码眼睛按钮真实切换可见性与图标，保持登录复选框可以操作', async () => {
    await withLogin(async (h) => {
      const button = h.require('[data-reveal-password]');
      const hiddenIcon = button.querySelector('svg').innerHTML;
      assert.equal(button.getAttribute('aria-pressed'), 'false');
      assert.equal(h.require('[name="password"]').type, 'password');
      await h.click('[data-reveal-password]');
      assert.equal(button.getAttribute('aria-pressed'), 'true');
      assert.equal(h.require('[name="password"]').type, 'text');
      assert.notEqual(button.querySelector('svg').innerHTML, hiddenIcon);
      await h.click('[data-reveal-password]');
      assert.equal(h.require('[name="password"]').type, 'password');
      await h.click('[data-remember-me]');
      assert.equal(h.require('[data-remember-me]').checked, true);
      assert.doesNotMatch(button.textContent, /◉/);
    });
  });
});
