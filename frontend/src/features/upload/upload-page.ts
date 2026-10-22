import { createElement } from "react"
import { mountReactElement, renderReactMarkup } from "../../shared/react/mount.ts"
import { UploadPage } from "./UploadPage.tsx"

export { UploadPage }

export function createUploadPageMarkup() {
  return renderReactMarkup(createElement(UploadPage, { active: false }))
}

export function mountUploadPage(root: HTMLElement) {
  const unmount = mountReactElement(root, createElement(UploadPage, { active: true }))
  return {
    element: root.querySelector<HTMLElement>('[data-upload-page]')!,
    destroy: () => {
      unmount()
      root.replaceChildren()
    },
  }
}
