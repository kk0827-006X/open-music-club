import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { IconButton, Modal } from '../../shared/react/ui.tsx'
import { useReducedMotion } from '../../shared/react/hooks.ts'
import { getThemeState, setThemePreference, subscribeTheme } from '../../shared/theme.ts'
import { TwoFactorPanel } from '../auth/TwoFactorPanel.tsx'

const categories = [['account', '账号与安全'], ['playback', '播放偏好'], ['appearance', '外观与动效'], ['upload', '上传偏好'], ['about', '数据与关于']] as const
type Category = typeof categories[number][0]
export interface SettingsDialogHandle {
  readonly open: boolean
  show(opener?: HTMLElement): void
  close(): void
}

function SettingsRow({ name, description, children }: { name: string; description: string; children: ReactNode }) {
  return <div className="settings-row"><div><b>{name}</b><p>{description}</p></div><div className="settings-control">{children}</div></div>
}
function Pending() { return <span className="settings-pending">未接入</span> }
function PreviewToggle({ label }: { label: string }) {
  return <button type="button" className="settings-switch" role="switch" aria-label={label} aria-checked={false} disabled><span /></button>
}

export const SettingsDialog = forwardRef<SettingsDialogHandle, {
  logout?: () => Promise<void>
  onOpen: () => void
  onClose: () => void
}>(function SettingsDialog({ logout, onOpen, onClose }, ref) {
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<Category>('appearance')
  const [factor, setFactor] = useState(false)
  const [closing, setClosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [theme, setTheme] = useState(getThemeState)
  const reduced = useReducedMotion()
  const openRef = useRef(false)
  const busyRef = useRef(false)
  const closingRef = useRef(false)
  const mounted = useRef(false)
  const timer = useRef(0)
  const generation = useRef(0)
  const opener = useRef<HTMLElement | null>(null)
  const restoreFocus = useRef(false)
  const callbacks = useRef({ logout, onOpen, onClose })
  callbacks.current = { logout, onOpen, onClose }

  useEffect(() => {
    mounted.current = true
    const unsubscribe = subscribeTheme(setTheme)
    return () => { mounted.current = false; generation.current++; window.clearTimeout(timer.current); unsubscribe() }
  }, [])
  useEffect(() => {
    if (!open && restoreFocus.current) {
      restoreFocus.current = false
      opener.current?.focus()
    }
  }, [open])
  const reportBusy = (value: boolean) => {
    if (!mounted.current) return
    busyRef.current = value
    setBusy(value)
  }
  const close = () => {
    if (!openRef.current || closingRef.current || busyRef.current) return
    closingRef.current = true
    setClosing(true)
    const id = generation.current
    timer.current = window.setTimeout(() => {
      if (!mounted.current || id !== generation.current) return
      openRef.current = false; closingRef.current = false
      setOpen(false); setClosing(false); setFactor(false)
      callbacks.current.onClose()
      restoreFocus.current = true
    }, reduced ? 0 : 180)
  }
  useImperativeHandle(ref, () => ({
    get open() { return openRef.current },
    show(button?: HTMLElement) {
      if (!mounted.current || openRef.current) return
      opener.current = button ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
      generation.current++
      setCategory('appearance'); setFactor(false); setStatus(''); setTheme(getThemeState())
      openRef.current = true
      setOpen(true)
      callbacks.current.onOpen()
    },
    close,
  }))

  async function exit() {
    if (!callbacks.current.logout || busyRef.current || closingRef.current) return
    const id = generation.current
    reportBusy(true); setStatus('正在退出…')
    try { await callbacks.current.logout() }
    catch {
      if (mounted.current && id === generation.current) { reportBusy(false); setStatus('退出失败，请稍后重试') }
    }
  }
  const heading = (en: string, title: string) => <div className="settings-section-heading"><p>{en}</p><h3 id="settings-section-title">{title}</h3><span>{category === 'appearance' ? '主题立即生效；其他偏好仅展示' : '仅展示界面；设置功能尚未接入'}</span></div>
  const section = () => {
    if (factor) return <TwoFactorPanel onBusyChange={reportBusy} />
    if (category === 'appearance') return <>
      {heading('APPEARANCE', '外观与动效')}
      <SettingsRow name="界面主题" description="立即生效；跟随系统会自动响应系统配色变化"><div className="settings-theme-options" role="group" aria-label="界面主题">
        {([['light', '暖昼'], ['dark', '深夜'], ['system', '跟随系统']] as const).map(([mode, label]) => <button key={mode} type="button" data-theme-preference={mode} aria-pressed={theme.preference === mode} onClick={() => setThemePreference(mode)}>{label}</button>)}
      </div></SettingsRow>
      <SettingsRow name="减少动态效果" description="简化界面过渡和三维动态"><PreviewToggle label="减少动态效果" /></SettingsRow>
      <SettingsRow name="播放器常驻显示" description="保留原有播放器动效，此处不控制播放器"><PreviewToggle label="播放器常驻显示" /></SettingsRow>
      <SettingsRow name="歌词字号" description="展开播放器中的歌词文字大小"><select aria-label="歌词字号" disabled><option>标准</option><option>小</option><option>大</option></select></SettingsRow>
      <SettingsRow name="三维档案墙画质" description="画质与设备性能之间的选择"><select aria-label="三维档案墙画质" disabled><option>原始</option><option>流畅</option><option>高清</option></select></SettingsRow>
      <SettingsRow name="节省流量" description="图片与资源加载偏好"><PreviewToggle label="节省流量" /></SettingsRow>
    </>
    if (category === 'playback') return <>
      {heading('PLAYBACK', '播放偏好')}
      <SettingsRow name="默认音量" description="此处不改变当前音乐音量"><input type="range" min="0" max="100" defaultValue="62" aria-label="默认音量" disabled /><span>62%</span></SettingsRow>
      <SettingsRow name="播放模式" description="顺序、随机与循环播放"><select aria-label="播放模式" disabled><option>顺序播放</option><option>随机播放</option><option>单曲循环</option></select></SettingsRow>
      <SettingsRow name="默认音质" description="音源实际可用性以上游返回为准"><Pending /></SettingsRow>
      <SettingsRow name="播放进度恢复" description="重新打开网站后的播放位置"><PreviewToggle label="播放进度恢复" /></SettingsRow>
    </>
    if (category === 'account') return <>
      <div className="settings-section-heading"><p>ACCOUNT &amp; SECURITY</p><h3 id="settings-section-title">账号与安全</h3><span>两步验证与退出登录已接入，其他设置暂不开放</span></div>
      <SettingsRow name="账户资料" description="头像与个人音乐收藏仍在用户页管理"><Pending /></SettingsRow>
      <SettingsRow name="修改密码" description="账号密码管理"><button type="button" disabled>修改密码</button></SettingsRow>
      <SettingsRow name="两步验证" description="认证器与一次性恢复码管理"><button type="button" data-settings-factor onClick={() => { setFactor(true); setStatus('安全设置已接入；其他偏好仍仅展示') }}>管理 2FA</button></SettingsRow>
      <SettingsRow name="设备与登录" description="登录设备与会话管理"><Pending /></SettingsRow>
      <SettingsRow name="退出当前登录" description="清除当前会话，停止播放并返回登录页"><button type="button" data-settings-logout disabled={!logout || busy} onClick={() => void exit()}>退出登录</button></SettingsRow>
    </>
    if (category === 'upload') return <>
      {heading('UPLOAD', '上传偏好')}
      <SettingsRow name="音频标签识别" description="沿用上传页现有流程，此处不改变识别行为"><PreviewToggle label="音频标签识别" /></SettingsRow>
      <SettingsRow name="默认封面" description="无内嵌封面时的展示样式"><select aria-label="默认封面" disabled><option>网站默认</option></select></SettingsRow>
      <SettingsRow name="上传前确认" description="元数据与音频信息确认"><PreviewToggle label="上传前确认" /></SettingsRow>
    </>
    return <>
      {heading('DATA & ABOUT', '数据与关于')}
      <SettingsRow name="恢复默认设置" description="主题偏好保存在当前浏览器；其他设置暂未接入"><button type="button" disabled>恢复默认</button></SettingsRow>
      <SettingsRow name="清理缓存" description="不删除音乐、歌单或收藏"><button type="button" disabled>清理缓存</button></SettingsRow>
      <SettingsRow name="音乐来源" description="本地音乐与网易云独立存储，共用播放器"><span>LOCAL / NETEASE</span></SettingsRow>
      <SettingsRow name="Open Music Club" description="社区音乐终端"><span>MUSIC ARCHIVE</span></SettingsRow>
    </>
  }
  const feedback = status || (category === 'appearance' ? `${theme.preference === 'system' ? '跟随系统 · ' : ''}当前为${theme.resolved === 'dark' ? '深色' : '浅色'}${theme.persisted ? '' : '；浏览器无法保存偏好'}` : '')
  return <Modal open={open} onClose={close} busy={busy || closing} className={`settings-dialog${closing ? ' is-closing' : ''}`} data-settings-dialog aria-labelledby="settings-title">
    <header className="settings-header"><div><p>OPEN MUSIC CLUB / SYSTEM PREFERENCES</p><h2 id="settings-title">设置</h2></div><IconButton icon="close" type="button" data-settings-close aria-label="关闭设置" disabled={busy || closing} onClick={close} /></header>
    <div className="settings-layout"><aside className="settings-sidebar"><nav aria-label="设置分类">
      {categories.map(([id, label]) => <button key={id} type="button" data-settings-category={id} aria-current={category === id ? 'page' : 'false'} disabled={busy || closing} onClick={() => { setCategory(id); setFactor(false); setStatus('') }}>{label}</button>)}
    </nav><p>PERSONAL PREFERENCES<span>个人偏好设置</span></p></aside>
      <section className="settings-operations" aria-labelledby="settings-section-title"><div data-settings-content>{section()}</div><footer><span>主题、两步验证已接入；其他偏好仅展示</span><span data-settings-status role="status">{feedback}</span></footer></section>
    </div>
  </Modal>
})
