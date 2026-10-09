import './style.css'
import { loginAndVerify, logoutSession, restoreSession } from './auth-client.ts'
import { mountAlbumArchive } from './album-archive.ts'
import { mountAuthorizedSequence } from './authorized-sequence.ts'
import { mountEntryPage } from './entry-page.ts'
import { mountLoginPage } from './login-page.ts'

const app = document.querySelector<HTMLElement>('#app')

if (app) {
  let cleanup: () => void = () => undefined
  const showAuthorized = (role: 'admin' | 'user') => {
    cleanup()
    cleanup = mountAuthorizedSequence(app, role, () => {
      cleanup()
      cleanup = mountAlbumArchive(app, { onLogout: async () => { await logoutSession(); showLogin() } })
    })
  }
  const showLogin = () => {
    cleanup()
    cleanup = mountLoginPage(app, async (credentials) => {
      const result = await loginAndVerify(credentials)
      if (!result.user) return result
      window.setTimeout(() => {
        showAuthorized(result.user.role)
      }, 1_150)
      return { role: result.user.role }
    }, role => { window.setTimeout(() => showAuthorized(role), 1150) })
  }
  cleanup = mountEntryPage(app, () => {
    // 保留点击进入及原版授权动画；仅有效会话可以跳过密码表单。
    void restoreSession().then((user) => {
      if (user) showAuthorized(user.role)
      else showLogin()
    })
  })
  app.dataset.ready = 'true'
}
