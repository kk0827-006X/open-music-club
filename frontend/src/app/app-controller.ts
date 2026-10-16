import { loginAndVerify, logoutSession, restoreSession } from "../services/auth/session.ts"
import { mountEntryPage } from "../features/auth/entry-page.ts"
import { mountLoginPage } from "../features/auth/login-page.ts"
import { mountAuthorizedSequence } from "../features/auth/authorized-sequence.ts"
import { mountMusicWorkspace } from './music-workspace.ts'
import { MusicQueue } from "../features/queue/model.ts"
import { resolvePlaybackUrl } from "../services/music/search.ts"
import { createPlayerController } from '../features/player/player-core.ts'

type Dependencies = {
  restore: typeof restoreSession; login: typeof loginAndVerify
  entry: typeof mountEntryPage; loginPage: typeof mountLoginPage; authorizedPage: typeof mountAuthorizedSequence
}
export function mountApplication(root: HTMLElement, overrides: Partial<Dependencies> = {}) {
  const api = { restore: restoreSession, login: loginAndVerify, entry: mountEntryPage,
    loginPage: mountLoginPage, authorizedPage: mountAuthorizedSequence, ...overrides }
  let cleanup = () => undefined as void, disposed = false, generation = 0, timer = 0
  const replace = (mount: () => () => void) => {
    window.clearTimeout(timer); timer = 0; generation++; cleanup(); cleanup = mount()
  }
  const authorized = (role: 'admin' | 'user') => {
    if (disposed) return
    replace(() => {
      const current = generation
      return api.authorizedPage(root, role, () => {
        if (disposed || current !== generation) return
        replace(() => {
          const queue = new MusicQueue()
          const player = createPlayerController({ queue, resolveUrl: (track, signal) => resolvePlaybackUrl(track, undefined, signal) })
          const destroyWorkspace = mountMusicWorkspace(root, { player, queue,
            onLogout: async () => { await logoutSession(); if (!disposed) login() },
          })
          return () => { destroyWorkspace(); player.destroy() }
        })
      })
    })
  }
  const schedule = (role: 'admin' | 'user', current: number) => {
    if (disposed || current !== generation) return
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { timer = 0; if (!disposed && current === generation) authorized(role) }, 1150)
  }
  const login = () => {
    if (disposed) return
    replace(() => {
      const current = generation
      return api.loginPage(root, async credentials => {
        const result = await api.login(credentials)
        if (disposed || current !== generation) return {}
        if (!result.user) return result
        schedule(result.user.role, current)
        return { role: result.user.role }
      }, role => schedule(role, current))
    })
  }
  replace(() => {
    const current = generation
    return api.entry(root, () => {
      void api.restore().then(user => {
        if (disposed || current !== generation) return
        if (user) authorized(user.role)
        else login()
      })
    })
  })
  root.dataset.ready = 'true'
  return { destroy() { if (disposed) return; disposed = true; generation++; window.clearTimeout(timer); cleanup(); root.replaceChildren() } }
}
