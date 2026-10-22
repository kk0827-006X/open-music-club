import { createElement } from 'react'
import { mountReactElement } from '../../shared/react/mount.ts'
import { AuthorizedSequence } from './AuthorizedSequence.tsx'

export { sampleAuthorizedSequence } from './AuthorizedSequence.tsx'
export function mountAuthorizedSequence(root: HTMLElement, role: 'admin' | 'user', onComplete?: () => void) {
  return mountReactElement(root, createElement(AuthorizedSequence, { role, onComplete }))
}
