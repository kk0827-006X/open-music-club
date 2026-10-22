import { createElement } from 'react'
import { mountReactElement } from '../../shared/react/mount.ts'
import { TwoFactorPanel } from './TwoFactorPanel.tsx'

export function mountTwoFactorPanel(root: HTMLElement, onComplete?: (role: 'admin' | 'user') => void) {
  return mountReactElement(root, createElement(TwoFactorPanel, { onComplete }))
}
