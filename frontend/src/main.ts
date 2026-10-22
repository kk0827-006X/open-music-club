import './style.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App.tsx'

const root = document.querySelector<HTMLElement>('#app')
if (root) {
  const application = createRoot(root)
  application.render(createElement(App))
  root.dataset.ready = 'true'
  import.meta.hot?.dispose(() => application.unmount())
}
