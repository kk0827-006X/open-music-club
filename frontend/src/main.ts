import './style.css'
import { loginAndVerify } from './auth-client.ts'
import { mountAuthorizedSequence } from './authorized-sequence.ts'
import { mountEntryPage } from './entry-page.ts'
import { mountLoginPage } from './login-page.ts'

const app = document.querySelector<HTMLElement>('#app')

if (app) {
  let cleanup: () => void = () => undefined
  const showLogin = () => {
    cleanup()
    cleanup = mountLoginPage(app, async (credentials) => {
      const result = await loginAndVerify(credentials)
      window.setTimeout(() => {
        cleanup()
        cleanup = mountAuthorizedSequence(app, result.user.role)
      }, 1_150)
      return { role: result.user.role }
    })
  }
  cleanup = mountEntryPage(app, showLogin)
  app.dataset.ready = 'true'
}
