const { test: base, expect } = require('@playwright/test');
const { businessSceneSource } = require('./business-scene');

// 只替换图形模块，页面、网络、Session、权限及音频仍由各业务流程真实执行。
async function installBusinessScene(context) {
  await context.route('**/assets/scene-*.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: businessSceneSource }),
  );
}

const test = base.extend({
  context: async ({ context }, use) => {
    await installBusinessScene(context);
    await use(context);
  },
});

module.exports = { test, expect, installBusinessScene };
