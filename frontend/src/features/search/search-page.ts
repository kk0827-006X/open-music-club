import { createElement, createRef } from "react"
import { mountReactElement, renderReactMarkup } from "../../shared/react/mount.ts"
import type { SearchFetcher, SearchItem } from "../../services/music/search.ts"
import { SearchPage, selectedDetail, type SearchPageHandle } from "./SearchPage.tsx"

export { SearchPage, selectedDetail }

// 旧静态标记接口保留字符串返回，但内容来自真实 React 组件的 SSR，不再拼接 HTML。
export function selectedMarkup(item: SearchItem | undefined) {
  return renderReactMarkup(selectedDetail(item, () => undefined, () => undefined))
}

export function createSearchPageMarkup() {
  return renderReactMarkup(createElement(SearchPage, { active: false }))
}

export function mountSearchPage(
  root: HTMLElement,
  onPlay: (item: SearchItem) => Promise<void> | void = () => undefined,
  fetcher: SearchFetcher = window.fetch.bind(window) as SearchFetcher,
  onQueue: (item: SearchItem) => void = () => undefined,
) {
  const ref = createRef<SearchPageHandle>()
  const unmount = mountReactElement(root, createElement(SearchPage, {
    ref,
    active: true,
    play: onPlay,
    enqueue: onQueue,
    fetcher,
  }))
  return {
    element: root.querySelector<HTMLElement>('[data-search-page]')!,
    ownsKeyboardTarget: (target: EventTarget | null) => ref.current?.ownsKeyboardTarget(target) ?? false,
    focus: () => ref.current?.focus(),
    refresh: () => ref.current?.refresh(),
    destroy: () => {
      unmount()
      root.replaceChildren()
    },
  }
}
