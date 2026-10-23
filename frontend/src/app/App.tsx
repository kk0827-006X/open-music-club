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

const Workspace = lazy(() => import('./Workspace.tsx'))
type Role = 'admin' | 'user'
type Stage = 'entry' | 'login' | 'authorized' | 'workspace'

export interface AppServices {
  restore: typeof restoreSession
  login: typeof loginAndVerify
  logout: typeof logoutSession
}
const services: AppServices = { restore: restoreSession, login: loginAndVerify, logout: logoutSession }

function SessionWorkspace({ onLogout }: { onLogout(): Promise<void> }) {
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
  return session && <ErrorBoundary><Suspense fallback={null}><Workspace {...session} footprintRevision={footprintRevision} onLogout={onLogout} /></Suspense></ErrorBoundary>
}

// App 只调度身份和会话；音频属于认证后的会话，不属于任何单个页面。
export function App({ api = services }: { api?: AppServices }) {
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
  if (stage === 'entry') return <EntryPage onEnter={() => { void enter() }} />
  if (stage === 'login') return <LoginPage onAuthenticate={authenticate} onVerified={verified} />
  if (stage === 'authorized') return <AuthorizedSequence role={role} onComplete={() => setStage('workspace')} />
  return <SessionWorkspace onLogout={logout} />
}
