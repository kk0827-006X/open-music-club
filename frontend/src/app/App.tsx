import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { loginAndVerify, logoutSession, restoreSession, type LoginCredentials } from '../services/auth/session.ts'
import { EntryPage } from '../features/auth/EntryPage.tsx'
import { LoginPage } from '../features/auth/LoginPage.tsx'
import { AuthorizedSequence } from '../features/auth/AuthorizedSequence.tsx'
import { MusicQueue } from '../features/queue/model.ts'
import { createPlayerController, type PlayerController } from '../features/player/player-core.ts'
import { resolvePlaybackUrl } from '../services/music/search.ts'
import { ErrorBoundary } from '../shared/react/ErrorBoundary.tsx'
import { createFootprintClient, durationToMs } from '../services/music/footprint.ts'
import { ApplicationLinkPage } from '../features/auth/ApplicationLinkPage.tsx'
import { AdminApplicationsPage } from '../features/auth/AdminApplicationsPage.tsx'

const Workspace = lazy(() => import('./Workspace.tsx'))
type Role = 'admin' | 'user'
type Stage = 'entry' | 'login' | 'authorized' | 'workspace'

export interface AppServices {
  restore: typeof restoreSession
  login: typeof loginAndVerify
  logout: typeof logoutSession
}
const services: AppServices = { restore: restoreSession, login: loginAndVerify, logout: logoutSession }

function SessionWorkspace({ onLogout, role }: { onLogout(): Promise<void>; role: Role }) {
  const [session, setSession] = useState<{ queue: MusicQueue; player: PlayerController; footprintClient: ReturnType<typeof createFootprintClient> } | null>(null)
  const [footprintRevision, setFootprintRevision] = useState(0)
  useEffect(() => {
    const queue = new MusicQueue()
    const footprintClient = createFootprintClient()
    const reports = new Set<AbortController>()
    let disposed = false
    const player = createPlayerController({
      queue, resolveUrl: (track, signal) => resolvePlaybackUrl(track, undefined, signal),
      onPlayed: async track => {
        if (disposed || track.kind !== 'song') return
        const controller = new AbortController()
        reports.add(controller)
        try {
          await footprintClient.report({ ...track, durationMs: durationToMs(track.duration) }, controller.signal)
          if (!disposed) setFootprintRevision(value => value + 1)
        } finally { reports.delete(controller) }
      },
    })
    setSession({ queue, player, footprintClient })
    return () => { disposed = true; reports.forEach(controller => controller.abort()); reports.clear(); player.destroy() }
  }, [])
  return session && <ErrorBoundary><Suspense fallback={null}><Workspace {...session} role={role} footprintRevision={footprintRevision} onLogout={onLogout} /></Suspense></ErrorBoundary>
}

// App 只调度身份和会话；音频属于认证后的会话，不属于任何单个页面。
function SessionApp({ api = services, adminRoute = false }: { api?: AppServices; adminRoute?: boolean }) {
  const [stage, setStage] = useState<Stage>('entry')
  const [role, setRole] = useState<Role>('user')
  const generation = useRef(0)
  const disposed = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    disposed.current = false
    return () => { disposed.current = true; generation.current++; clearTimeout(timer.current) }
  }, [])
  const enter = async () => {
    const current = ++generation.current
    const user = await api.restore()
    if (disposed.current || current !== generation.current) return
    if (user) { setRole(user.role); setStage('authorized') }
    else setStage('login')
  }
  useEffect(() => { if (adminRoute) void enter() }, [adminRoute])
  const authenticate = async (credentials: LoginCredentials) => {
    const current = generation.current
    const result = await api.login(credentials)
    if (disposed.current || current !== generation.current) return {}
    if (!result.user) return result
    return { role: result.user.role }
  }
  const verified = (nextRole: Role) => {
    if (disposed.current) return
    clearTimeout(timer.current)
    const current = generation.current
    timer.current = setTimeout(() => {
      if (disposed.current || current !== generation.current) return
      setRole(nextRole); setStage('authorized')
    }, 1150)
  }
  const logout = async () => {
    await api.logout()
    if (disposed.current) return
    generation.current++; clearTimeout(timer.current)
    setStage('login')
  }
  if (adminRoute && stage === 'entry') return <main className="application-standalone"><p role="status">正在验证管理会话…</p></main>
  if (stage === 'entry') return <EntryPage onEnter={() => { void enter() }} />
  if (stage === 'login') return <LoginPage onAuthenticate={authenticate} onVerified={verified} />
  if (stage === 'authorized') return <AuthorizedSequence role={role} onComplete={() => setStage('workspace')} />
  if (adminRoute) return role === 'admin' ? <AdminApplicationsPage onLogout={logout} /> : <main className="application-standalone"><h2>无权访问申请审核</h2><p>此页面仅供已完成两步验证的管理员使用。</p><a href="/">返回音乐俱乐部</a></main>
  return <SessionWorkspace role={role} onLogout={logout} />
}

// 凭证只留在当前组件内存；首次渲染即移除 fragment，邮件扫描 GET 不会提交验证。
export function App({ api = services }: { api?: AppServices }) {
  const [route] = useState(() => {
    const path = window.location.pathname
    const purpose = path === '/activate' ? 'activate' : path === '/verify-email' ? 'verify' : null
    let token = ''
    if (purpose) {
      const value = new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
      token = /^[A-Za-z0-9_-]{43}$/.test(value) ? value : ''
      window.history.replaceState(null, '', path)
    }
    return { purpose, token, admin: path === '/admin/applications' } as const
  })
  if (route.purpose) return <ApplicationLinkPage purpose={route.purpose} initialToken={route.token} />
  return <SessionApp api={api} adminRoute={route.admin} />
}
