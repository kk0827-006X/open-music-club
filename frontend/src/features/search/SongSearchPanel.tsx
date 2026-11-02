import { useEffect, useRef, useState } from 'react'
import { QueuePanel } from '../queue/QueuePanel'
import { createSongSearch } from '../../services/music/song-search'
import type { SearchItem } from '../../shared/music'
import { useReducedMotion } from '../../shared/react/hooks'

export function SongSearchPanel({ query, onClose, onFocusToggle, onPlay, onSave }: {
  query: { term: string; serial: number }; onClose(): void; onFocusToggle(): void
  onPlay(item: SearchItem): Promise<void>; onSave(item: SearchItem): void
}) {
  const [items, setItems] = useState<SearchItem[]>([])
  const [message, setMessage] = useState('正在搜索…')
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const nextRef = useRef<() => void>(() => {})
  const reduced = useReducedMotion()
  useEffect(() => {
    const controller = new AbortController()
    const session = createSongSearch(query.term, undefined, controller.signal)
    let pending = false
    setItems([]); setMore(false)
    const next = async () => {
      if (pending || controller.signal.aborted) return
      pending = true; setLoading(true); setMessage('正在搜索…')
      try {
        const result = await session.next()
        if (controller.signal.aborted) return
        setItems(previous => [...previous, ...result.items]); setMore(result.hasMore); setMessage(result.warning)
      } catch {
        if (!controller.signal.aborted) setMessage('搜索暂时不可用，请重试。')
      } finally { pending = false; if (!controller.signal.aborted) setLoading(false) }
    }
    nextRef.current = () => { void next() }
    void next()
    return () => { controller.abort() }
  }, [query])
  return <QueuePanel mode="search" open items={items} reduced={reduced} likes={new Map()} pendingLikes={new Set()} orderStatus="" message={message} loading={loading} hasMore={more} onLoadMore={() => nextRef.current()} onClose={onClose} onFocusToggle={onFocusToggle} onClear={() => {}} onRemove={() => {}} onLike={() => {}} onReorder={() => {}} onSave={onSave} onPlay={item => { void onPlay(item).catch(() => setMessage('歌曲暂时无法播放，请尝试其他歌曲。')) }} />
}
