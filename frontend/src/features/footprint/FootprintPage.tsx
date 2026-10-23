import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { Icon, IconButton, Modal } from '../../shared/react/ui.tsx'
import { useLatest, usePageVisibility } from '../../shared/react/hooks.ts'
import LineSidebar from '../../shared/react/LineSidebar.tsx'
import { CollapsibleSidebarLayout } from '../../shared/react/CollapsibleSidebarLayout.tsx'
import { safeCoverUrl, type MusicActions } from '../../shared/music.ts'
import { createFootprintClient, isFootprintAbort, type FootprintDetail, type FootprintEvent, type FootprintMilestone, type FootprintPost, type MemoryCard } from '../../services/music/footprint.ts'
import { CardArtwork, downloadCardArtwork } from './CardArtwork.tsx'
import { dayKey, formatClock, formatDate, formatDuration, formatTrackDuration, siteOffset, toFootprintSong } from './format.ts'

type Tab = 'timeline' | 'milestone' | 'studio' | 'square' | 'mine'
type Dialog = { kind: 'share'; card: MemoryCard } | { kind: 'card' | 'post'; id: number } | null
export interface FootprintPageHandle { readonly hasOpenDialog: boolean }
export interface FootprintPageProps {
  active: boolean; play?: MusicActions['play']; enqueue?: MusicActions['enqueue'];
  client?: ReturnType<typeof createFootprintClient>; revision?: number
}
const tabs: { id: Tab; label: string; english: string; title: string; subtitle: string }[] = [
  { id: 'timeline', label: '时光轴', english: 'TIMELINE', title: '音乐足迹时光轴', subtitle: '播放过的每一首歌，都会按时间留在这里。' },
  { id: 'milestone', label: '听歌里程', english: 'MILESTONE', title: '我的听歌里程', subtitle: '把零碎的播放，折算成一段可以回看的旅程。' },
  { id: 'studio', label: '回忆卡片', english: 'CARD STUDIO', title: '回忆卡片工坊', subtitle: '挑几段足迹，做成一张可以保存和分享的卡片。' },
  { id: 'square', label: '足迹广场', english: 'SQUARE', title: '足迹广场', subtitle: '看看其他成员这段时间在听什么。' },
  { id: 'mine', label: '我的分享', english: 'MY SHARES', title: '我的分享', subtitle: '管理你分享出去的音乐足迹。' },
]

export const FootprintPage = forwardRef<FootprintPageHandle, FootprintPageProps>(function FootprintPage({ active, play, enqueue, client, revision = 0 }, ref) {
  const api = useMemo(() => client ?? createFootprintClient(), [client])
  const visible = usePageVisibility(active, 280)
  const latest = useLatest({ active, play, enqueue })
  const [tab, setTab] = useState<Tab>('timeline')
  const [postId, setPostId] = useState<number | null>(null)
  const [offset, setOffset] = useState(480)
  const [pageOffset, setPageOffset] = useState(0)
  const [reload, setReload] = useState(0)
  const [events, setEvents] = useState<FootprintEvent[]>([])
  const [total, setTotal] = useState(0)
  const [cards, setCards] = useState<MemoryCard[]>([])
  const [cardTotal, setCardTotal] = useState(0)
  const [posts, setPosts] = useState<FootprintPost[]>([])
  const [published, setPublished] = useState<number[]>([])
  const [milestone, setMilestone] = useState<FootprintMilestone | null>(null)
  const [detail, setDetail] = useState<FootprintDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [appliedRevision, setAppliedRevision] = useState(revision)
  const [notice, setNotice] = useState({ text: '', error: false })
  const [editingId, setEditingId] = useState<number | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [selected, setSelected] = useState<number[]>([])
  const [title, setTitle] = useState('我的听歌回忆')
  const [preview, setPreview] = useState<MemoryCard | null>(null)
  const [comment, setComment] = useState('')
  const [commentsComplete, setCommentsComplete] = useState(false)
  const [caption, setCaption] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const requestRef = useRef<AbortController | null>(null)
  const actionRef = useRef<AbortController | null>(null)
  const serial = useRef(0)
  const busyRef = useRef(false)
  const dialogRef = useLatest(dialog)
  useImperativeHandle(ref, () => ({ get hasOpenDialog() { return dialogRef.current !== null } }), [dialogRef])

  const say = (text: string, error = false) => setNotice({ text, error })
  const invalidate = () => {
    serial.current++
    requestRef.current?.abort()
    actionRef.current?.abort()
    busyRef.current = false
    setBusy(false)
    setLoading(false)
  }
  const refresh = () => { setPageOffset(0); setReload(value => value + 1) }
  const switchView = (next: Tab, id: number | null = null) => {
    invalidate()
    setTab(next); setPostId(id); setPageOffset(0)
    setEvents([]); setCards([]); setPosts([]); setTotal(0); setMilestone(null); setDetail(null)
    setEditingId(null); setNoteDraft(''); setComment(''); setCommentsComplete(false); setDialog(null); say('')
    setReload(value => value + 1)
  }

  // 播放上报可随时到达；正在提交时先保留版本，提交结束后再统一刷新。
  useEffect(() => { if (!busyRef.current) setAppliedRevision(revision) }, [revision, busy])
  useEffect(() => { setPageOffset(0) }, [active, appliedRevision])

  useEffect(() => {
    const controller = new AbortController()
    requestRef.current?.abort()
    actionRef.current?.abort()
    requestRef.current = controller
    const generation = ++serial.current
    busyRef.current = false; setBusy(false)
    if (!active) { setLoading(false); setDialog(null); return () => controller.abort() }
    setLoading(true)
    setNotice({ text: '正在读取音乐足迹…', error: false })
    const current = () => !controller.signal.aborted && serial.current === generation
    const read = async () => {
      if (postId !== null) {
        const data = await api.post(postId, controller.signal)
        if (!current()) return
        setDetail(data)
        setCommentsComplete(data.comments.length < 50 || data.comments.length >= 500)
        if (data.timezoneOffsetMinutes !== undefined) setOffset(siteOffset(data.timezoneOffsetMinutes))
      } else if (tab === 'timeline') {
        const data = await api.timeline(30, pageOffset, controller.signal)
        if (!current()) return
        setEvents(previous => pageOffset ? [...previous, ...data.events.filter(event => !previous.some(old => old.id === event.id))] : data.events)
        setTotal(data.total); setOffset(siteOffset(data.timezoneOffsetMinutes))
      } else if (tab === 'milestone') {
        const data = await api.milestone(controller.signal)
        if (!current()) return
        setMilestone(data)
        setOffset(siteOffset(data?.timezoneOffsetMinutes))
      } else if (tab === 'studio') {
        const [timeline, saved, shares] = await Promise.all([api.timeline(50, 0, controller.signal), api.cards(30, pageOffset, controller.signal), api.myPosts(50, 0, controller.signal)])
        if (!current()) return
        setEvents(timeline.events); setOffset(siteOffset(timeline.timezoneOffsetMinutes))
        setSelected(previous => previous.filter(id => timeline.events.some(event => event.id === id)))
        setCards(previous => pageOffset ? [...previous, ...saved.cards.filter(card => !previous.some(old => old.id === card.id))] : saved.cards)
        setCardTotal(saved.total); setPublished(shares.map(post => post.cardId))
        setPreview(previous => previous && (saved.cards.find(card => card.id === previous.id) || (pageOffset ? previous : null)))
      } else if (tab === 'square') {
        const data = await api.posts(12, pageOffset, controller.signal)
        if (!current()) return
        setPosts(previous => pageOffset ? [...previous, ...data.posts.filter(post => !previous.some(old => old.id === post.id))] : data.posts); setTotal(data.total)
      } else {
        const data = await api.myPosts(30, pageOffset, controller.signal)
        if (!current()) return
        setPosts(previous => pageOffset ? [...previous, ...data.filter(post => !previous.some(old => old.id === post.id))] : data)
        setTotal(pageOffset + data.length + (data.length === 30 ? 1 : 0))
      }
      if (current()) say('足迹已更新')
    }
    void read().catch(error => { if (current() && !isFootprintAbort(error)) say(error instanceof Error ? error.message : '足迹读取失败，请重试', true) })
      .finally(() => { if (current()) setLoading(false) })
    return () => { controller.abort(); actionRef.current?.abort(); serial.current++ }
  }, [active, api, tab, postId, appliedRevision, reload, pageOffset])

  // 写操作和读操作共享页面代数；离页或切换详情后，迟到响应不能更新当前界面。
  const mutate = async (action: (signal: AbortSignal) => Promise<unknown>, message: string, after?: () => void, shouldRefresh = true) => {
    if (busyRef.current || !latest.current.active) return
    busyRef.current = true; setBusy(true)
    const controller = new AbortController()
    actionRef.current = controller
    const generation = serial.current
    const current = () => !controller.signal.aborted && generation === serial.current && latest.current.active
    try {
      await action(controller.signal)
      if (!current()) return
      after?.(); say(message)
      if (shouldRefresh) refresh()
    } catch (error) { if (current() && !isFootprintAbort(error)) say(error instanceof Error ? error.message : '操作失败，请重试', true) }
    finally { if (current()) { busyRef.current = false; setBusy(false) } }
  }
  const playTrack = (track: Parameters<typeof toFootprintSong>[0]) => {
    const generation = serial.current
    void Promise.resolve().then(() => latest.current.play?.(toFootprintSong(track))).catch(() => {
      if (latest.current.active && serial.current === generation) say('歌曲暂时无法播放', true)
    })
  }
  const download = (card: Pick<MemoryCard, 'title'>) => {
    try { if (svgRef.current) downloadCardArtwork(svgRef.current, card.title) }
    catch { say('卡片下载失败，请重试', true) }
  }
  const loadMoreComments = () => {
    if (!detail || commentsComplete || detail.comments.length >= 500) return
    const id = detail.post.id
    const count = detail.comments.length
    void mutate(async signal => {
      const comments = await api.comments(id, Math.min(50, 500 - count), count, signal)
      if (signal.aborted) return
      const added = comments.filter(item => !detail.comments.some(previous => previous.id === item.id))
      setDetail(previous => previous?.post.id === id ? { ...previous, comments: [...previous.comments, ...added] } : previous)
      setCommentsComplete(comments.length < 50 || !added.length || count + added.length >= 500)
    }, '评论已更新', undefined, false)
  }
  const groups = new Map<string, FootprintEvent[]>()
  for (const event of events) { const key = dayKey(event.playedAt, offset); groups.set(key, [...groups.get(key) || [], event]) }
  const heading = tabs.find(item => item.id === tab)!
  const disabled = busy || loading
  const moreComments = postId !== null && detail && !commentsComplete && detail.comments.length < Math.min(500, detail.post.commentCount) && <div className="fp-comment-actions"><span>已显示 {detail.comments.length} / {detail.post.commentCount} 条评论</span><button type="button" className="fp-more" data-fp-more-comments disabled={disabled} onClick={loadMoreComments}>加载更多评论</button></div>
  const more = (count: number, all: number, label: string) => count < all && <button type="button" className="fp-more" data-fp-more disabled={disabled} onClick={() => setPageOffset(count)}>{loading ? '读取中…' : label}</button>
  const like = (post: FootprintPost, detailed = false) => <IconButton icon="heart" filled={post.liked} type="button" className={`fp-like${post.liked ? ' is-liked' : ''}`} data-fp-like={post.id} aria-label={post.liked ? '取消赞' : '点赞'} aria-pressed={post.liked} disabled={disabled} onClick={() => {
    const liked = !post.liked
    void mutate(async signal => {
      const likeCount = await api.setLiked(post.id, liked, signal)
      if (signal.aborted) return
      if (detailed) setDetail(previous => previous && { ...previous, post: { ...previous.post, liked, likeCount } })
      else setPosts(previous => previous.map(item => item.id === post.id ? { ...item, liked, likeCount } : item))
    }, liked ? '已点赞' : '已取消赞', undefined, false)
  }}><span>{post.likeCount}</span></IconButton>

  return <section className="footprint-page" data-footprint-page data-active={active} data-fp-mode={postId === null ? tab : 'detail'} hidden={!visible} inert={!active} aria-label="音乐足迹">
    <CollapsibleSidebarLayout active={active} variant="footprint" sidebarClassName="fp-sidebar" sidebar={expanded => <>
      <p className="fp-eyebrow">MUSIC FOOTPRINT / 音乐足迹</p>
      <LineSidebar ariaLabel="音乐足迹功能" items={tabs.map(item => item.label)}
        activeIndex={tabs.findIndex(item => item.id === tab)} enabled={active && expanded} showIndex={false}
        markerLength={26} markerGap={12} maxShift={12} itemGap={20} fontSize={.83} className="member-line-sidebar"
        getItemProps={index => ({ 'data-fp-tab': tabs[index].id, title: tabs[index].label })}
        renderLabel={(label, index) => <><strong>{label}</strong><small>{tabs[index].english}</small></>}
        onItemClick={index => switchView(tabs[index].id)} />
      <p className="fp-sidebar-foot"><i />听过、写过、分享过<br />都算数。</p></>}>
    <div className="fp-shell"><header className="fp-header"><div><p>PERSONAL TIMELINE / 个人音乐时间档案</p><h2>{postId !== null ? '足迹详情' : heading.title}</h2><span>{postId !== null ? '点赞、评论，看看这段足迹背后的故事。' : heading.subtitle}</span></div>{postId !== null && <IconButton icon="left" className="fp-back" data-fp-back onClick={() => switchView(tab)}>返回列表</IconButton>}</header>
      <div className="fp-content" data-fp-content aria-busy={loading}>
        {postId === null && tab === 'timeline' && <section className="fp-view fp-timeline"><header className="fp-view-header"><p>TIMELINE / 时光轴</p><h3>我的听歌足迹</h3><span>{total} 条播放记录</span></header>
          {[...groups.entries()].map(([key, group]) => <div className="fp-day" key={key}><div className="fp-day-marker"><i /><h4>{formatDate(group[0].playedAt, offset)}</h4><span>{group.length} 段声音</span></div><ol className="fp-day-list">{group.map(event => <li key={event.id} className={`fp-entry${event.note ? ' has-note' : ''}`}><time className="fp-entry-time">{formatClock(event.playedAt, offset)}</time><div className="fp-entry-card"><img src={safeCoverUrl(event.coverUrl)} alt="" loading="lazy" /><div className="fp-entry-body"><strong>{event.title}</strong><small>{event.artist}{event.album ? ` · ${event.album}` : ''}</small><em>{formatTrackDuration(event.durationMs)} · {event.source === 'local' ? '本地' : '网易云'}</em>
            {event.note && editingId !== event.id && <blockquote className="fp-note">{event.note.content}<cite>随笔 · {formatClock(event.note.updatedAt, offset)}</cite></blockquote>}
            {editingId === event.id && <form className="fp-note-form" data-fp-note-form={event.id} onSubmit={e => { e.preventDefault(); const content = noteDraft.trim(); if (!content) { say('随笔内容不能为空', true); return } void mutate(signal => api.saveNote(event.id, content, signal), '随笔已保存', () => setEditingId(null)) }}><textarea autoFocus name="note" rows={3} maxLength={1000} aria-label="听歌随笔" value={noteDraft} disabled={busy} onChange={e => setNoteDraft(e.target.value)} /><div className="fp-note-actions"><span>{noteDraft.length}/1000</span><button type="button" disabled={busy} data-fp-note-cancel onClick={() => setEditingId(null)}>取消</button><button type="submit" disabled={busy}>保存随笔</button></div></form>}
          </div><div className="fp-entry-actions"><IconButton icon="play" className="fp-icon" data-fp-play={event.trackKey} aria-label={`播放 ${event.title}`} disabled={!play} onClick={() => playTrack(event)} /><IconButton icon="plus" className="fp-icon" data-fp-enqueue={event.trackKey} aria-label={`加入队列 ${event.title}`} disabled={!enqueue} onClick={() => { latest.current.enqueue?.(toFootprintSong(event)); say('已加入播放队列') }} />{editingId !== event.id && <button type="button" className="fp-text" data-fp-note-edit={event.id} disabled={disabled} onClick={() => { setEditingId(event.id); setNoteDraft(event.note?.content || '') }}>{event.note ? '修改随笔' : '写随笔'}</button>}{event.note && editingId !== event.id && <button type="button" className="fp-text" data-fp-note-delete={event.id} disabled={disabled} onClick={() => { void mutate(signal => api.deleteNote(event.id, signal), '随笔已删除') }}>删除随笔</button>}</div></div></li>)}</ol></div>)}
          {!events.length && !loading && <p className="fp-empty">还没有足迹。去音乐库或搜索里播放一首歌，它会自己出现在时间轴上。</p>}{more(events.length, total, '加载更早的足迹')}</section>}

        {postId === null && tab === 'milestone' && <section className="fp-view fp-milestone"><header className="fp-view-header"><p>MILESTONE / 听歌里程</p><h3>声音留下的里程</h3></header>{!milestone || !milestone.totalPlays ? !loading && <p className="fp-empty">还没有听歌里程，播放一首歌开启旅程。</p> : <>
          <div className="fp-stat-grid">{[['播放次数', `${milestone.totalPlays} 次`], ['陪伴时长', formatDuration(milestone.totalDurationMs)], ['不同歌曲', `${milestone.distinctTracks} 首`], ['不同艺术家', `${milestone.distinctArtists} 位`], ['活跃天数', `${milestone.activeDays} 天`], ['连续聆听', `${milestone.streakDays} 天`]].map(([label, value]) => <article className="fp-stat" key={label}><small>{label}</small><strong>{value}</strong></article>)}</div>
          <section className="fp-panel"><h4>一天中的听歌时刻</h4><div className="fp-hours" role="img" aria-label="每小时播放次数">{milestone.hourly.map((count, hour) => <i key={hour} title={`${hour}时：${count} 次`} style={{ height: `${8 + count / Math.max(1, ...milestone.hourly) * 84}px` }} />)}</div><div className="fp-hours-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span></div></section>
          <section className="fp-panel"><h4>每月聆听</h4><div className="fp-months">{milestone.monthly.map(month => <div className="fp-month" key={month.month}><i style={{ height: `${10 + month.plays / Math.max(1, ...milestone.monthly.map(item => item.plays)) * 60}px` }} /><b>{month.month}</b><small>{month.plays} 次 · {formatDuration(month.durationMs)}</small></div>)}</div></section>
          <section className="fp-panel"><h4>听得最多的歌曲</h4><ol className="fp-top-tracks">{milestone.topTracks.map((track, index) => <li key={track.trackKey}><span className="fp-rank">{String(index + 1).padStart(2, '0')}</span><img src={safeCoverUrl(track.coverUrl)} alt="" /><div><strong>{track.title}</strong><small>{track.artist} · {track.plays} 次</small></div><IconButton icon="play" className="fp-icon" aria-label={`播放 ${track.title}`} disabled={!play} onClick={() => playTrack(track)} /></li>)}</ol></section>
          <section className="fp-panel fp-panel-foot">{milestone.firstPlayedAt && <p>第一段足迹：{formatDate(milestone.firstPlayedAt, offset)}</p>}{milestone.lastPlayedAt && <p>最近一次：{formatDate(milestone.lastPlayedAt, offset)}</p>}{milestone.busiestDay && <p>最热闹的一天：{milestone.busiestDay.date} · {milestone.busiestDay.plays} 次</p>}<p>写下了 {milestone.noteCount} 篇随笔</p></section>
        </>}</section>}

        {postId === null && tab === 'studio' && <section className="fp-view fp-studio"><header className="fp-view-header"><p>CARD STUDIO / 回忆卡片</p><h3>把一段日子做成卡片</h3><span>最多挑选 12 段足迹，生成一张可保存、可分享的回忆卡片</span></header><div className="fp-studio-body"><div className="fp-picker"><div className="fp-picker-head"><h4>选择听歌记录</h4><span>{selected.length}/12 已选</span></div><ul className="fp-picker-list">{events.map(event => <li key={event.id}><label><input type="checkbox" data-fp-pick={event.id} checked={selected.includes(event.id)} disabled={disabled || (!selected.includes(event.id) && selected.length >= 12)} onChange={e => { const checked = e.target.checked; setSelected(previous => checked ? previous.length < 12 ? [...previous, event.id] : previous : previous.filter(id => id !== event.id)) }} /><img src={safeCoverUrl(event.coverUrl)} alt="" loading="lazy" /><span><strong>{event.title}</strong><small>{event.artist} · {formatDate(event.playedAt, offset)} {formatClock(event.playedAt, offset)}</small></span></label></li>)}</ul>{!events.length && !loading && <p className="fp-empty">还没有可选择的足迹</p>}</div>
          <div className="fp-studio-side"><label className="fp-field"><span>卡片标题</span><input maxLength={60} data-fp-title value={title} onChange={e => setTitle(e.target.value)} disabled={busy} /></label><div className="fp-studio-actions"><button type="button" data-fp-generate disabled={disabled || !selected.length} onClick={() => { void mutate(async signal => { const card = await api.createCard(title.trim() || '我的听歌回忆', selected, signal); if (signal.aborted) return; setPreview(card); setCards(previous => [card, ...previous.filter(item => item.id !== card.id)]); setCardTotal(value => value + 1); setSelected([]) }, '回忆卡片已生成', undefined, false) }}>生成回忆卡片</button>{preview && <><button type="button" className="fp-ghost" data-fp-download onClick={() => download(preview)}>下载卡片</button>{!published.includes(preview.id) && <button type="button" className="fp-ghost" data-fp-share disabled={disabled} onClick={() => { setCaption(''); setDialog({ kind: 'share', card: preview }) }}>分享到广场</button>}<button type="button" className="fp-danger" data-fp-delete-card disabled={disabled} onClick={() => setDialog({ kind: 'card', id: preview.id })}>删除卡片</button></>}</div>
          {preview ? <><div className="fp-card-preview"><CardArtwork ref={svgRef} card={preview} offset={offset} /></div><dl className="fp-card-meta"><div><dt>覆盖时段</dt><dd>{formatDate(preview.data.period.from, offset)} — {formatDate(preview.data.period.to, offset)}</dd></div><div><dt>记录数</dt><dd>{preview.data.trackCount} 段 · {formatDuration(preview.data.totalDurationMs)}</dd></div>{preview.data.highlight && <div><dt>听得最多</dt><dd>{preview.data.highlight.title} × {preview.data.highlight.plays}</dd></div>}{published.includes(preview.id) && <div><dt>状态</dt><dd>已分享到广场</dd></div>}</dl></> : <p className="fp-empty">勾选左侧记录后生成卡片，这里会出现预览。</p>}</div></div>
          <section className="fp-panel"><h4>我做过的卡片（{cardTotal}）</h4><div className="fp-card-shelf">{cards.map(card => <article className="fp-card-chip" key={card.id}><button type="button" data-fp-open-card={card.id} onClick={() => setPreview(card)}><span className="fp-card-mini"><CardArtwork card={card} offset={offset} /></span><strong>{card.title}</strong><small>{formatDate(card.createdAt, offset)} · {card.data.trackCount} 段{published.includes(card.id) ? ' · 已分享' : ''}</small></button></article>)}</div>{!cards.length && !loading && <p className="fp-empty">还没有生成过卡片</p>}{more(cards.length, cardTotal, '加载更多卡片')}</section></section>}

        {postId === null && (tab === 'square' || tab === 'mine') && <section className={`fp-view fp-${tab}`}><header className="fp-view-header"><p>{heading.english}</p><h3>{tab === 'mine' ? '我分享过的音乐回忆' : '在声音里相遇'}</h3></header><div className={tab === 'square' ? 'fp-square-grid' : 'fp-mine-list'}>{posts.map(post => <article className="fp-post-card" key={post.id}><header><strong className="fp-post-author">{post.authorNickname}</strong><time>{formatDate(post.createdAt, offset)} {formatClock(post.createdAt, offset)}</time></header><button type="button" className="fp-post-open" data-fp-open-post={post.id} onClick={() => switchView(tab, post.id)}><strong>{post.caption || '一段音乐足迹'}</strong><span className="fp-post-meta">回忆卡片 #{post.cardId}</span><em>查看回忆 <Icon name="open" /></em></button><footer>{like(post)}<span className="fp-post-meta">评论 {post.commentCount}</span>{tab === 'mine' && <button type="button" className="fp-danger" data-fp-remove-post={post.id} disabled={disabled} onClick={() => setDialog({ kind: 'post', id: post.id })}>删除分享</button>}</footer></article>)}</div>{!posts.length && !loading && <p className="fp-empty">还没有分享{tab === 'mine' ? '。在回忆卡片工坊里分享一张卡片吧。' : '，来分享第一段音乐回忆吧。'}</p>}{more(posts.length, total, '加载更多分享')}</section>}

        {postId !== null && <section className="fp-view fp-detail">{detail ? <><header className="fp-view-header fp-detail-head"><div><p>DETAIL / 足迹详情</p><h3>{detail.card?.title || '音乐足迹'}</h3><span>{detail.post.authorNickname} · {formatDate(detail.post.createdAt, offset)} {formatClock(detail.post.createdAt, offset)}</span></div>{detail.canDelete && <button type="button" className="fp-danger" data-fp-delete-post disabled={disabled} onClick={() => setDialog({ kind: 'post', id: detail.post.id })}>删除分享</button>}</header>{detail.post.caption && <p className="fp-detail-caption">{detail.post.caption}</p>}<div className="fp-detail-body"><div className="fp-detail-card">{detail.card ? <><CardArtwork ref={svgRef} card={detail.card} offset={offset} /><button type="button" className="fp-ghost" data-fp-download onClick={() => detail.card && download(detail.card)}>下载卡片</button></> : <p className="fp-empty">卡片已被作者删除</p>}</div><div className="fp-comments"><div className="fp-comment-head"><h4>评论 {detail.comments.length}</h4>{like(detail.post, true)}</div><ol className="fp-comment-list">{detail.comments.map(item => <li key={item.id}><div><strong>{item.authorNickname}</strong><time>{formatDate(item.createdAt, offset)} {formatClock(item.createdAt, offset)}</time></div><p>{item.content}</p>{(item.canDelete || (detail.viewerId !== undefined && item.authorId === detail.viewerId)) && <button type="button" className="fp-text" data-fp-delete-comment={item.id} disabled={disabled} onClick={() => { void mutate(signal => api.deleteComment(item.id, signal), '评论已删除') }}>删除</button>}</li>)}</ol>{moreComments}{!detail.comments.length && <p className="fp-empty">还没有评论，来说点什么吧。</p>}<form className="fp-comment-form" data-fp-comment-form onSubmit={e => { e.preventDefault(); const content = comment.trim(); if (!content) { say('评论内容不能为空', true); return } void mutate(signal => api.addComment(detail.post.id, content, signal), '评论已发布', () => setComment('')) }}><textarea name="content" maxLength={300} rows={2} aria-label="评论内容" placeholder="写一句评论…" value={comment} disabled={busy} onChange={e => setComment(e.target.value)} /><div className="fp-comment-actions"><span>{comment.length}/300</span><button type="submit" disabled={disabled}>{busy ? '发送中…' : '发送'}</button></div></form></div></div></> : <p className="fp-empty">{loading ? '正在读取这条分享…' : '这条分享无法读取，请重试或返回列表。'}</p>}</section>}
      </div><p className="fp-feedback" data-fp-feedback data-error={notice.error} role="status">{notice.text}{notice.error && <button type="button" className="fp-text" disabled={disabled} onClick={refresh}>重新读取</button>}</p></div>
    </CollapsibleSidebarLayout>
    <Modal open={dialog !== null && active} busy={busy} onClose={() => setDialog(null)} className="fp-dialog" data-fp-dialog aria-labelledby="fp-dialog-title"><form data-fp-dialog-form onSubmit={e => { e.preventDefault(); if (!dialog) return; const choice = dialog; if (choice.kind === 'share') { void mutate(signal => api.publish(choice.card.id, caption.trim(), signal), '已分享到足迹广场', () => { setPublished(previous => [...previous, choice.card.id]); setDialog(null) }, false) } else if (choice.kind === 'card') { void mutate(signal => api.deleteCard(choice.id, signal), '卡片已删除', () => { setDialog(null); setPreview(null) }) } else { void mutate(signal => api.deletePost(choice.id, signal), '分享已删除', () => { setDialog(null); if (postId !== null) switchView(tab) }) } }}><h3 id="fp-dialog-title">{dialog?.kind === 'share' ? '分享到足迹广场' : dialog?.kind === 'card' ? '删除回忆卡片？' : '删除这条分享？'}</h3>{dialog?.kind === 'share' ? <label className="fp-field"><span>写一句分享语（可以留空）</span><textarea autoFocus name="caption" maxLength={300} rows={3} value={caption} disabled={busy} onChange={e => setCaption(e.target.value)} /></label> : <p>{dialog?.kind === 'card' ? '已分享的内容也会一起移除。' : '评论也会一并移除。'}</p>}<div className="fp-dialog-actions"><button type="button" className="fp-ghost" data-fp-dialog-cancel disabled={busy} onClick={() => setDialog(null)}>取消</button><button type="submit" className={dialog?.kind === 'share' ? 'fp-ghost' : 'fp-danger'} disabled={busy}>{busy ? '处理中…' : dialog?.kind === 'share' ? '确认分享' : '确认删除'}</button></div></form></Modal>
  </section>
})

export default FootprintPage
