import { createElement } from 'react'
import { renderReactMarkup } from '../../shared/react/mount.ts'
import { AlbumInformation, AlbumDetail } from './LibraryView.tsx'
import { demoAlbums, type DemoAlbum } from './album-data.ts'

export const albumInformation = (album: DemoAlbum, index: number) => renderReactMarkup(createElement(AlbumInformation, { album, index }))
export const createAlbumDetailMarkup = (album: DemoAlbum, trackState: 'ready' | 'loading' | 'unavailable' = 'ready') => renderReactMarkup(createElement(AlbumDetail, { album, trackState }))
export const wrapAlbumIndex = (value: number, count = demoAlbums.length) => ((value % count) + count) % count
