const assert = require('node:assert/strict')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')
const { withReactHarness } = require('./helpers/reactHarness')

const frontend = name => pathToFileURL(path.resolve(__dirname, '../frontend/src/shared/react', name)).href
const items = ['歌单', '喜爱', '最近播放', '我的上传']

async function loadSidebar() {
  return (await import(frontend('LineSidebar.tsx'))).default
}

async function loadLayout() {
  return (await import(frontend('CollapsibleSidebarLayout.tsx'))).CollapsibleSidebarLayout
}

// 仅检验生命周期和语义；不伪造布局尺寸、碰撞或浏览器的原生按键激活。
async function key(h, selector, value) {
  await h.React.act(async () => h.require(selector).dispatchEvent(new h.window.KeyboardEvent('keydown', {
    key: value, bubbles: true, cancelable: true,
  })))
  await h.flush()
}

function allowMotion(h) {
  h.window.matchMedia = query => ({
    media: query, matches: false, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    dispatchEvent: () => true,
  })
  globalThis.matchMedia = h.window.matchMedia
}

describe('统一的 LineSidebar 导航', () => {
  it('采用无编号的原生按钮，受控选中由页面决定，并透传导航属性', async () => {
    await withReactHarness(async h => {
      const LineSidebar = await loadSidebar()
      const clicks = []
      const render = activeIndex => h.React.createElement(LineSidebar, {
        items, activeIndex, ariaLabel: '个人音乐选项', enabled: false, showIndex: false,
        onItemClick: (index, label) => clicks.push([index, label]),
        getItemProps: index => ({ 'data-test-item': index, 'data-user-tab': ['playlists', 'favorites', 'recent', 'uploads'][index] }),
      })
      await h.render(render(0))
      const nav = h.require('[aria-label="个人音乐选项"]')
      const buttons = [...nav.querySelectorAll('li > button')]
      assert.equal(buttons.length, 4)
      assert.deepEqual(buttons.map(button => button.textContent.trim()), items)
      assert.equal(buttons[0].type, 'button')
      assert.equal(buttons[0].getAttribute('aria-current'), 'page')
      assert.equal(buttons[1].getAttribute('aria-current'), null)
      assert.equal(buttons[1].getAttribute('data-user-tab'), 'favorites')
      assert.equal(buttons[1].disabled, false)
      assert.equal(buttons[1].tabIndex, 0)
      await h.click('[data-test-item="1"]')
      assert.deepEqual(clicks, [[1, '喜爱']])
      assert.equal(h.require('[data-test-item="0"]').getAttribute('aria-current'), 'page')
      await h.render(render(1))
      assert.equal(h.require('[data-test-item="1"]').getAttribute('aria-current'), 'page')
      assert.equal(h.require('[data-test-item="0"]').getAttribute('aria-current'), null)
    })
  })

  it('兼容默认选中及自定义中英文字段，不把名称作为 HTML 插入', async () => {
    await withReactHarness(async h => {
      const LineSidebar = await loadSidebar()
      const labels = ['歌单 <img src=x onerror=alert(1)>', '我的上传']
      await h.render(h.React.createElement(LineSidebar, {
        items: labels, defaultActive: 1, enabled: false, ariaLabel: '安全导航',
        getItemProps: index => ({ 'data-test-item': index }),
        renderLabel: (label, index) => h.React.createElement(h.React.Fragment, null,
          h.React.createElement('strong', null, label), h.React.createElement('small', null, index === 0 ? 'PLAYLISTS' : 'MY UPLOADS')),
      }))
      assert.equal(h.require('[data-test-item="1"]').getAttribute('aria-current'), 'page')
      assert.match(h.require('[data-test-item="0"] strong').textContent, /<img src=x/)
      assert.equal(h.query('[aria-label="安全导航"] img'), null)
      assert.equal(h.require('[data-test-item="0"] small').textContent, 'PLAYLISTS')
      await h.click('[data-test-item="0"]')
      assert.equal(h.require('[data-test-item="0"]').getAttribute('aria-current'), 'page')
      assert.equal(h.require('[data-test-item="1"]').getAttribute('aria-current'), null)
    })
  })

  it('页面不可见时停止动画，StrictMode 重挂载和卸载不遗留动画帧', async () => {
    await withReactHarness(async h => {
      allowMotion(h)
      const LineSidebar = await loadSidebar()
      const render = enabled => h.React.createElement(h.React.StrictMode, null,
        h.React.createElement(LineSidebar, { items, enabled, ariaLabel: '动画导航' }))
      await h.render(render(true))
      assert.ok(h.frames.size > 0, '显示且允许动效时应启用线条动画')
      const liveFrames = h.frames.size
      await h.render(render(false))
      assert.equal(h.frames.size, 0, '隐藏页面必须取消仍在排队的动画帧')
      await h.render(render(true))
      assert.equal(h.frames.size, liveFrames, '重新启用不能累积额外动画循环')
      await h.unmount()
      assert.equal(h.frames.size, 0, '卸载后不得遗留动画帧')
    })
  })
})

describe('共享的可收起侧栏布局', () => {
  it('第二根触点不能结束当前拖拽，Escape 取消后不会吞掉键盘产生的点击', async () => {
    await withReactHarness(async h => {
      const Layout = await loadLayout()
      await h.render(h.React.createElement(Layout, { active: true, variant: 'user', sidebarClassName: 'test-sidebar', sidebar: '导航' }, h.React.createElement('main', null, '内容')))
      const divider = h.require('.sidebar-divider'), captured = new Set()
      divider.setPointerCapture = id => captured.add(id)
      divider.hasPointerCapture = id => captured.has(id)
      divider.releasePointerCapture = id => captured.delete(id)
      const pointer = async (type, id, x = 100) => {
        const event = new h.window.MouseEvent(type, { bubbles: true, button: 0, clientX: x })
        Object.defineProperty(event, 'pointerId', { value: id })
        await h.React.act(async () => divider.dispatchEvent(event))
      }
      await pointer('pointerdown', 1)
      await pointer('pointermove', 1, 80)
      assert.equal(h.require('.sidebar-layout').dataset.dragging, 'true')
      await pointer('pointerdown', 2)
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        await pointer(event, 2)
        assert.equal(h.require('.sidebar-layout').dataset.dragging, 'true')
        assert.deepEqual([...captured], [1])
      }
      await key(h, '.sidebar-divider', 'Escape')
      assert.equal(h.require('.sidebar-layout').dataset.dragging, 'false')
      assert.equal(h.require('.sidebar-layout').style.getPropertyValue('--sidebar-drag-width'), '')
      assert.equal(captured.size, 0)
      await h.click('.sidebar-divider')
      assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'true')
    })
  })
  it('桌面收起后缩到窄屏会恢复可访问的菜单，返回桌面保留收起偏好', async () => {
    await withReactHarness(async h => {
      const media = new Map()
      h.window.matchMedia = query => {
        if (!media.has(query)) media.set(query, {
          media: query, matches: query.includes('prefers-reduced-motion'),
          listeners: new Set(), addEventListener(_, fn) { this.listeners.add(fn) },
          removeEventListener(_, fn) { this.listeners.delete(fn) },
        })
        return media.get(query)
      }
      const Layout = await loadLayout()
      for (const variant of ['user', 'footprint']) {
        await h.render(h.React.createElement(Layout, { key: variant, active: true, variant, sidebarClassName: 'test-sidebar', sidebar: '导航' }, h.React.createElement('main', null, '内容')))
        await h.click('.sidebar-divider')
        assert.ok(h.require('aside').hasAttribute('inert'))
        const query = media.get(`(max-width: ${variant === 'user' ? 600 : 860}px)`)
        await h.React.act(async () => { query.matches = true; query.listeners.forEach(fn => fn()) })
        assert.equal(h.require('aside').hasAttribute('inert'), false)
        assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'false')
        await h.React.act(async () => { query.matches = false; query.listeners.forEach(fn => fn()) })
        assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'true')
      }
      await h.unmount()
      assert.equal([...media.values()].reduce((sum, query) => sum + query.listeners.size, 0), 0)
    })
  })
  it('点击竖线收起及恢复，不卸载侧栏或右侧内容、不丢失草稿', async () => {
    await withReactHarness(async h => {
      const Layout = await loadLayout()
      let contentMounts = 0
      let contentUnmounts = 0
      function Content() {
        h.React.useEffect(() => { contentMounts++; return () => { contentUnmounts++ } }, [])
        return h.React.createElement('input', { 'data-draft': '', defaultValue: '未提交草稿', 'aria-label': '草稿' })
      }
      await h.render(h.React.createElement(Layout, {
        active: true, variant: 'user', sidebarClassName: 'user-sidebar',
        sidebar: h.React.createElement('button', { type: 'button', 'data-sidebar-action': '' }, '歌单'),
      }, h.React.createElement(Content)))
      const root = h.require('.sidebar-layout')
      const sidebar = h.require('aside.user-sidebar')
      const input = h.require('[data-draft]')
      const divider = h.require('button.sidebar-divider')
      assert.equal(divider.getAttribute('role'), 'separator')
      assert.equal(divider.getAttribute('aria-orientation'), 'vertical')
      assert.equal(divider.getAttribute('aria-label'), '调整侧栏宽度')
      assert.equal(root.dataset.collapsed, 'false')
      await h.input('[data-draft]', '正在编辑的歌单')
      await h.click('.sidebar-divider')
      assert.equal(root.dataset.collapsed, 'true')
      assert.equal(h.require('aside.user-sidebar'), sidebar)
      assert.equal(sidebar.getAttribute('aria-hidden'), 'true')
      assert.ok(sidebar.hasAttribute('inert'), '收起的导航不应继续接受键盘焦点')
      assert.equal(h.require('.sidebar-divider').getAttribute('aria-label'), '展开侧栏')
      assert.equal(h.require('[data-draft]'), input)
      assert.equal(input.value, '正在编辑的歌单')
      await h.click('.sidebar-divider')
      assert.equal(root.dataset.collapsed, 'false')
      assert.notEqual(sidebar.getAttribute('aria-hidden'), 'true')
      assert.equal(sidebar.hasAttribute('inert'), false)
      assert.equal(contentMounts, 1)
      assert.equal(contentUnmounts, 0)
      await h.unmount()
      assert.equal(contentUnmounts, 1)
    })
  })

  it('个人中心及足迹布局均可通过原生按钮点击和方向键恢复侧栏', async () => {
    await withReactHarness(async h => {
      const Layout = await loadLayout()
      for (const variant of ['user', 'footprint']) {
        await h.render(h.React.createElement(Layout, {
          key: variant, active: true, variant, sidebarClassName: `${variant}-sidebar`,
          sidebar: h.React.createElement('nav', { 'aria-label': `${variant}选项` }, '导航'),
        }, h.React.createElement('main', null, '原有右侧内容')))
        // 原生 Enter／空格激活留给真实浏览器，JSDOM 不模拟按键产生的 click。
        await h.click('.sidebar-divider')
        assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'true')
        await key(h, '.sidebar-divider', 'ArrowRight')
        assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'false')
        // 左方向键逐步缩窄，最终收起；测试不依赖 JSDOM 的任何虚构几何。
        for (let count = 0; count < 30 && h.require('.sidebar-layout').dataset.collapsed !== 'true'; count++) {
          await key(h, '.sidebar-divider', 'ArrowLeft')
        }
        assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'true')
        await h.click('.sidebar-divider')
        assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'false')
        assert.equal(h.require('main').textContent, '原有右侧内容')
      }
    })
  })

  it('页面隐藏及再次显示保留侧栏收起状态与内容实例', async () => {
    await withReactHarness(async h => {
      const Layout = await loadLayout()
      const sidebar = h.React.createElement('nav', { 'aria-label': '足迹选项' }, '导航')
      const child = h.React.createElement('textarea', { 'data-footprint-draft': '', defaultValue: '足迹草稿' })
      const render = active => h.React.createElement(Layout, {
        active, variant: 'footprint', sidebarClassName: 'fp-sidebar', sidebar,
      }, child)
      await h.render(render(true))
      const originalDraft = h.require('[data-footprint-draft]')
      await h.click('.sidebar-divider')
      await h.render(render(false))
      assert.equal(h.require('.sidebar-layout').dataset.dragging, 'false')
      assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'true')
      await h.render(render(true))
      assert.equal(h.require('.sidebar-layout').dataset.collapsed, 'true')
      assert.equal(h.require('[data-footprint-draft]'), originalDraft)
      assert.equal(originalDraft.value, '足迹草稿')
    })
  })
})
