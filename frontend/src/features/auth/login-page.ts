import { createElement } from 'react'
import { mountReactElement, renderReactMarkup } from '../../shared/react/mount.ts'
import { Icon } from '../../shared/react/ui.tsx'
import { LoginPage } from './LoginPage.tsx'

// 旧入口仅桥接同一套 React 视图，不再维护另一份表单和事件逻辑。
export function passwordEyeMarkup(visible: boolean) {
  return renderReactMarkup(createElement(Icon, { name: visible ? 'eye' : 'eyeOff' }))
}
export function createLoginMarkup() { return renderReactMarkup(createElement(LoginPage)) }
export function mountLoginPage(
  root: HTMLElement,
  onAuthenticate?: Parameters<typeof LoginPage>[0]['onAuthenticate'],
  onVerified?: Parameters<typeof LoginPage>[0]['onVerified'],
) {
  return mountReactElement(root, createElement(LoginPage, { onAuthenticate, onVerified }))
}
