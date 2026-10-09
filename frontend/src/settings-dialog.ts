import { uiIcons } from './ui-icons.ts'
import { mountTwoFactorPanel } from './two-factor-panel.ts'

const categories = [['account', '账号与安全'], ['playback', '播放偏好'], ['appearance', '外观与动效'], ['upload', '上传偏好'], ['about', '数据与关于']] as const
type Category = typeof categories[number][0]
const row = (name: string, description: string, control: string) => `<div class="settings-row"><div><b>${name}</b><p>${description}</p></div><div class="settings-control">${control}</div></div>`
const pending = '<span class="settings-pending">未接入</span>'
const toggle = (label: string) => `<button type="button" class="settings-switch" role="switch" aria-label="${label}" aria-checked="false" disabled><span></span></button>`

export function createSettingsMarkup() {
  return `<dialog class="settings-dialog" data-settings-dialog aria-labelledby="settings-title">
    <header class="settings-header"><div><p>OPEN MUSIC CLUB / SYSTEM PREFERENCES</p><h2 id="settings-title">设置</h2></div><button type="button" data-settings-close aria-label="关闭设置">${uiIcons.close}</button></header>
    <div class="settings-layout"><aside class="settings-sidebar"><nav aria-label="设置分类">${categories.map(([id, label]) => `<button type="button" data-settings-category="${id}" aria-current="${id === 'appearance' ? 'page' : 'false'}">${label}</button>`).join('')}</nav><p>PERSONAL PREFERENCES<span>个人偏好设置</span></p></aside>
    <section class="settings-operations" aria-labelledby="settings-section-title"><div data-settings-content></div><footer><span>两步验证已接入；其他偏好仅展示</span><span data-settings-status role="status"></span></footer></section></div>
  </dialog>`
}

export function settingsSectionMarkup(category: Category, canLogout: boolean) {
  const heading = (en: string, title: string) => `<div class="settings-section-heading"><p>${en}</p><h3 id="settings-section-title">${title}</h3><span>仅展示界面；设置功能尚未接入</span></div>`
  if (category === 'appearance') return heading('APPEARANCE', '外观与动效')
    + row('界面主题', '暖昼与深夜配色', '<button type="button" disabled>暖昼</button><button type="button" disabled>深夜</button>')
    + row('减少动态效果', '简化界面过渡和三维动态', toggle('减少动态效果'))
    + row('播放器常驻显示', '保留原有播放器动效，此处不控制播放器', toggle('播放器常驻显示'))
    + row('歌词字号', '展开播放器中的歌词文字大小', '<select aria-label="歌词字号" disabled><option>标准</option><option>小</option><option>大</option></select>')
    + row('三维档案墙画质', '画质与设备性能之间的选择', '<select aria-label="三维档案墙画质" disabled><option>原始</option><option>流畅</option><option>高清</option></select>')
    + row('节省流量', '图片与资源加载偏好', toggle('节省流量'))
  if (category === 'playback') return heading('PLAYBACK', '播放偏好')
    + row('默认音量', '此处不改变当前音乐音量', '<input type="range" min="0" max="100" value="62" aria-label="默认音量" disabled/><span>62%</span>')
    + row('播放模式', '顺序、随机与循环播放', '<select aria-label="播放模式" disabled><option>顺序播放</option><option>随机播放</option><option>单曲循环</option></select>')
    + row('默认音质', '音源实际可用性以上游返回为准', pending)
    + row('播放进度恢复', '重新打开网站后的播放位置', toggle('播放进度恢复'))
  if (category === 'account') return `<div class="settings-section-heading"><p>ACCOUNT & SECURITY</p><h3 id="settings-section-title">账号与安全</h3><span>两步验证与退出登录已接入，其他设置暂不开放</span></div>`
    + row('账户资料', '头像与个人音乐收藏仍在用户页管理', pending)
    + row('修改密码', '账号密码管理', '<button type="button" disabled>修改密码</button>')
    + row('两步验证', '认证器与一次性恢复码管理', '<button type="button" data-settings-factor>管理 2FA</button>')
    + row('设备与登录', '登录设备与会话管理', pending)
    + row('退出当前登录', '清除当前会话，停止播放并返回登录页', `<button type="button" data-settings-logout${canLogout ? '' : ' disabled'}>退出登录</button>`)
  if (category === 'upload') return heading('UPLOAD', '上传偏好')
    + row('音频标签识别', '沿用上传页现有流程，此处不改变识别行为', toggle('音频标签识别'))
    + row('默认封面', '无内嵌封面时的展示样式', '<select aria-label="默认封面" disabled><option>网站默认</option></select>')
    + row('上传前确认', '元数据与音频信息确认', toggle('上传前确认'))
  return heading('DATA & ABOUT', '数据与关于')
    + row('恢复默认设置', '当前界面不保存任何偏好', '<button type="button" disabled>恢复默认</button>')
    + row('清理缓存', '不删除音乐、歌单或收藏', '<button type="button" disabled>清理缓存</button>')
    + row('音乐来源', '本地音乐与网易云独立存储，共用播放器', '<span>LOCAL / NETEASE</span>')
    + row('Open Music Club', '社区音乐终端', '<span>MUSIC ARCHIVE</span>')
}

export function mountSettingsDialog(root: HTMLElement, options: { logout?: () => Promise<void>; onOpen: () => void; onClose: () => void }) {
  root.insertAdjacentHTML('beforeend', createSettingsMarkup())
  const dialog = root.querySelector<HTMLDialogElement>('[data-settings-dialog]')!
  const content = dialog.querySelector<HTMLElement>('[data-settings-content]')!
  const status = dialog.querySelector<HTMLElement>('[data-settings-status]')!
  let category: Category = 'appearance'
  let opener: HTMLElement | null = null
  let timer = 0, disposed = false, closing = false, busy = false
  let factorCleanup = () => undefined as void
  const render = () => {
    factorCleanup()
    content.innerHTML = settingsSectionMarkup(category, Boolean(options.logout))
    dialog.querySelectorAll<HTMLButtonElement>('[data-settings-category]').forEach(button => button.setAttribute('aria-current', button.dataset.settingsCategory === category ? 'page' : 'false'))
  }
  const close = () => {
    if (closing || busy || !dialog.open) return
    closing = true
    dialog.classList.add('is-closing')
    timer = window.setTimeout(() => {
      dialog.close(); closing = false; dialog.classList.remove('is-closing')
      factorCleanup()
      options.onClose(); opener?.focus()
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180)
  }
  const click = (event: MouseEvent) => {
    if (busy || closing) return
    const target = event.target instanceof Element ? event.target : null
    const tab = target?.closest<HTMLButtonElement>('[data-settings-category]')
    if (tab) { category = tab.dataset.settingsCategory as Category; render(); return }
    if (target?.closest('[data-settings-factor]')) { factorCleanup(); factorCleanup = mountTwoFactorPanel(content); status.textContent = '安全设置已接入；其他偏好仍仅展示'; return }
    if (target?.closest('[data-settings-close]')) { close(); return }
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
    }
    const logout = target?.closest<HTMLButtonElement>('[data-settings-logout]')
    if (logout && options.logout) {
      busy = true; logout.disabled = true; status.textContent = '正在退出…'
      void options.logout().catch(() => {
        if (!disposed) { busy = false; logout.disabled = false; status.textContent = '退出失败，请稍后重试' }
      })
    }
  }
  const cancel = (event: Event) => { event.preventDefault(); close() }
  dialog.addEventListener('click', click)
  dialog.addEventListener('cancel', cancel)
  render()
  return {
    get open() { return dialog.open },
    show(button: HTMLElement) {
      if (disposed || dialog.open) return
      opener = button; category = 'appearance'; status.textContent = ''; render()
      dialog.showModal(); options.onOpen()
      dialog.querySelector<HTMLButtonElement>('[data-settings-close]')?.focus()
    },
    destroy() {
      disposed = true; window.clearTimeout(timer)
      factorCleanup()
      dialog.removeEventListener('click', click); dialog.removeEventListener('cancel', cancel)
      if (dialog.open) dialog.close()
      dialog.remove()
    },
  }
}
