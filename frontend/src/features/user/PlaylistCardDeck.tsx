import { useRef, useState } from 'react'
import { DraggableCardBody, DraggableCardContainer } from '../../shared/react/aceternity/DraggableCard.tsx'
import { Icon } from '../../shared/react/ui.tsx'
import { safeCoverUrl } from '../../shared/music.ts'
import type { UserPlaylist } from '../../services/music/personal-library.ts'

export function PlaylistCardDeck({ lists, disabled, onOpen, onCreate }: {
  lists: UserPlaylist[]; disabled: boolean; onOpen: (id: number) => void; onCreate: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const slots = useRef(new Map<number, number>())
  const nextSlot = useRef(0)
  const slotFor = (id: number) => {
    if (!slots.current.has(id)) slots.current.set(id, nextSlot.current++)
    return slots.current.get(id)!
  }
  const [front, setFront] = useState<number | null>(null)
  return <div className="user-playlist-collection">
    <DraggableCardContainer containerRef={containerRef}>
      <p className="user-playlist-deck-note">{lists.length ? '拖动整理 · 点击聆听' : '把喜欢的声音，收进第一份歌单。'}</p>
      {lists.map((list, index) => <DraggableCardBody key={list.id} containerRef={containerRef}
        index={slotFor(list.id)} layer={index + 1} stackSize={lists.length} raised={front === list.id} disabled={disabled} onRaise={() => setFront(list.id)}>
        <button type="button" className="user-playlist-card" data-user-list={list.id}
          disabled={disabled} onClick={() => onOpen(list.id)} aria-label={`打开歌单：${list.name}`}>
          <span className="user-playlist-art"><img src={safeCoverUrl(list.coverUrl)} alt="" draggable={false}
            onError={event => { const image = event.currentTarget; if (!image.src.endsWith('/images/album-placeholder-01.svg')) image.src = '/images/album-placeholder-01.svg' }} /></span>
          <span className="user-playlist-meta"><strong>{list.name}</strong><small>{list.trackCount} 首歌曲</small><b><Icon name="open" /></b></span>
        </button>
      </DraggableCardBody>)}
    </DraggableCardContainer>
    <button type="button" className="user-new-card" data-user-create disabled={disabled} onClick={onCreate}>
      <span><Icon name="plus" /></span><strong>新建歌单</strong><small>CREATE A NEW ARCHIVE</small>
    </button>
  </div>
}
