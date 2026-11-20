const { test, expect, installBusinessScene } = require('./business-test');
const { useIsolatedBusinessServer } = require('./isolated-server');
const { AVATAR, PASSWORD } = require('./fixtures');

const port = 4337;
const origin = `http://127.0.0.1:${port}`;
useIsolatedBusinessServer(test, port);

async function openFriends(page, account) {
  const api = page.context().request;
  const token = await api.get('/api/security/csrf-token');
  const login = await api.post('/api/auth/login', {
    headers: { Origin: origin, 'X-CSRF-Token': (await token.json()).csrfToken },
    data: account,
  });
  expect(login.status()).toBe(200);
  await page.goto('/user');
  await page.locator('[data-user-tab="friends"]').click();
  return page.getByRole('region', { name: '好友管理' });
}

async function submit(page, panel, email) {
  await panel.getByRole('button', { name: '添加好友' }).click();
  const dialog = page.getByRole('dialog', { name: '添加好友' });
  const field = dialog.getByRole('textbox', { name: '对方的邮箱' });
  await expect(field).toBeFocused();
  await field.fill(email);
  await dialog.getByRole('button', { name: '发送申请' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText('申请已提交', { exact: true })).toBeVisible();
}

test('好友页使用真实双账号接口完成提交、拒绝、接受、撤回与解除', async ({ page, browser }) => {
  const other = await browser.newContext({ baseURL: origin, reducedMotion: 'reduce' });
  try {
    await installBusinessScene(other);
    const recipientPage = await other.newPage();
    const [sender, recipient] = await Promise.all([
      openFriends(page, AVATAR),
      openFriends(recipientPage, PASSWORD),
    ]);
    await expect(sender.getByText('还没有好友')).toBeVisible();
    const add = sender.getByRole('button', { name: '添加好友' });
    await expect(add).toHaveText('＋');
    async function addRightGap() {
      const [panel, button] = await Promise.all([sender.boundingBox(), add.boundingBox()]);
      return Math.abs(panel.x + panel.width - (button.x + button.width));
    }
    await expect.poll(addRightGap).toBeLessThan(1);
    const divider = page.getByRole('separator', { name: '调整侧栏宽度' });
    const dividerBox = await divider.boundingBox();
    const panelBefore = await sender.boundingBox();
    const addBefore = await add.boundingBox();
    expect(addBefore.width).toBe(addBefore.height);
    const pointerX = dividerBox.x + dividerBox.width / 2;
    const pointerY = dividerBox.y + dividerBox.height / 2;
    await page.mouse.move(pointerX, pointerY);
    await page.mouse.down();
    try {
      await page.mouse.move(pointerX - 120, pointerY, { steps: 6 });
      await expect
        .poll(async () => (await sender.boundingBox()).width)
        .toBeGreaterThan(panelBefore.width + 90);
      await expect.poll(addRightGap).toBeLessThan(1);
    } finally {
      await page.mouse.up();
    }
    await add.click();
    await expect(page.getByRole('dialog', { name: '添加好友' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '添加好友' })).toBeHidden();
    await expect(page).toHaveURL(`${origin}/user`);

    await submit(page, sender, 'unknown@example.com');
    await submit(page, sender, PASSWORD.email);
    await sender.getByRole('button', { name: '已提交' }).click();
    await expect(sender.getByText('a***@e***', { exact: true })).toBeVisible();
    await expect(sender.getByText('u***@e***', { exact: true })).toBeVisible();
    await expect(sender.getByText(PASSWORD.email, { exact: true })).toHaveCount(0);
    await expect(sender.getByText('密码流程验收成员', { exact: true })).toHaveCount(0);

    await recipient.getByRole('button', { name: '收到的请求' }).click();
    await expect(recipient.getByText('工坊隔离验收成员', { exact: true })).toBeVisible();
    await recipient.getByRole('button', { name: '拒绝', exact: true }).click();
    await expect(recipient.getByText('没有待处理的请求')).toBeVisible();
    await sender.getByRole('button', { name: '已提交' }).click();
    await expect(sender.getByText('a***@e***', { exact: true })).toBeVisible();
    await expect(sender.getByText('已拒绝请求')).toHaveCount(0);
    const unknown = sender.getByRole('listitem').filter({ hasText: 'u***@e***' });
    await unknown.getByRole('button', { name: '撤回', exact: true }).click();
    await expect(unknown).toHaveCount(0);

    await submit(recipientPage, recipient, AVATAR.email);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(addRightGap).toBeLessThan(1);
    await sender.getByRole('button', { name: '收到的请求' }).click();
    const invite = sender.getByRole('listitem').filter({ hasText: '密码流程验收成员' });
    await expect(invite).toBeVisible();
    expect(await sender.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    expect(await invite.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await invite.getByRole('button', { name: '接受', exact: true }).click();
    await expect(sender.getByText('已添加好友', { exact: true })).toBeVisible();

    await sender.getByRole('button', { name: '好友列表' }).click();
    await expect(sender.getByText('密码流程验收成员', { exact: true })).toBeVisible();
    await recipient.getByRole('button', { name: '好友列表' }).click();
    await expect(recipient.getByText('工坊隔离验收成员', { exact: true })).toBeVisible();
    await sender.getByRole('button', { name: '解除好友', exact: true }).click();
    const remove = page.getByRole('dialog', { name: '解除好友' });
    await expect(remove).toBeVisible();
    await remove.getByRole('button', { name: '确认解除' }).click();
    await expect(sender.getByText('还没有好友')).toBeVisible();
    await recipient.getByRole('button', { name: '好友列表' }).click();
    await expect(recipient.getByText('还没有好友')).toBeVisible();
  } finally {
    await other.close();
  }
});
