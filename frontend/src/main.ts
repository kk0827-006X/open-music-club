import './style.css'
import { mountApplication } from './app/app-controller.ts'

const root = document.querySelector<HTMLElement>('#app')
if (root) {
  const application = mountApplication(root)
  import.meta.hot?.dispose(() => application.destroy())
}
