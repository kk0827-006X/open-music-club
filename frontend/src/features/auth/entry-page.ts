import { createElement } from 'react'
import { mountReactElement, renderReactMarkup } from '../../shared/react/mount.ts'
import { EntryPage, OpenMusicMark } from './EntryPage.tsx'

export const openMusicMark = renderReactMarkup(createElement(OpenMusicMark))
export function createEntryMarkup() { return renderReactMarkup(createElement(EntryPage)) }
export function mountEntryPage(root: HTMLElement, onEnter: () => void) {
  return mountReactElement(root, createElement(EntryPage, { onEnter }))
}
