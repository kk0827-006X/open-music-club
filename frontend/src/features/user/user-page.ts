import { createElement, createRef } from "react"
import { mountReactElement, renderReactMarkup } from "../../shared/react/mount.ts"
import { createPersonalLibraryClient, type PersonalTrack, type UserPlaylist } from "../../services/music/personal-library.ts"
import type { SearchItem } from "../../services/music/search.ts"
import {
  PlaylistHeader,
  UserPage,
  UserTrackRow,
  validateAvatarFile,
  playPlaylistTracks,
  type UserPageHandle,
} from "./UserPage.tsx"

export { PlaylistHeader, UserPage, UserTrackRow, validateAvatarFile, playPlaylistTracks }

// 旧 SSR 接口继续返回字符串，但由真实 React 组件渲染，不维护第二份 DOM 模板。
export function createPlaylistHeaderMarkup(list: Pick<UserPlaylist, 'id' | 'name'>, playable: boolean) {
  return renderReactMarkup(createElement(PlaylistHeader, { list, playable }))
}

export function createUserTrackMarkup(track: PersonalTrack, liked: boolean, removable: boolean) {
  return renderReactMarkup(createElement(UserTrackRow, { track, liked, removable }))
}

export function createUserPageMarkup() {
  return renderReactMarkup(createElement(UserPage, { active: false }))
}

export function mountUserPage(host: HTMLElement, options: {
  play?: (song: SearchItem) => Promise<unknown>; enqueue?: (song: SearchItem) => void;
  choosePlaylist?: (song: SearchItem) => void; changed?: () => void;
  client?: ReturnType<typeof createPersonalLibraryClient>
} = {}) {
  const ref = createRef<UserPageHandle>()
  const unmount = mountReactElement(host, createElement(UserPage, {
    ref,
    active: true,
    play: options.play,
    enqueue: options.enqueue,
    choosePlaylist: options.choosePlaylist,
    changed: options.changed,
    client: options.client,
  }))
  return {
    element: host.querySelector<HTMLElement>('[data-user-page]')!,
    get hasOpenDialog() { return ref.current?.hasOpenDialog ?? false },
    refresh: () => ref.current?.refresh() ?? Promise.resolve(false),
    destroy: () => {
      unmount()
      host.replaceChildren()
    },
  }
}
