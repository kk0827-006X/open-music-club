import { TimelineView } from './TimelineView.tsx';
import { SquareView } from './SquareView.tsx';
import { MilestoneView } from './MilestoneView.tsx';
import { CardStylePicker } from './CardStylePicker.tsx';
import { useCardStyles } from './use-card-styles.ts';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Icon, IconButton, Modal } from '../../shared/react/ui.tsx';
import { motion } from 'motion/react';
import { useLatest } from '../../shared/react/hooks.ts';
import { usePageMotion, useSectionTransition } from '../../shared/react/page-transitions.ts';
import LineSidebar from '../../shared/react/LineSidebar.tsx';
import { CollapsibleSidebarLayout } from '../../shared/react/CollapsibleSidebarLayout.tsx';
import { safeCoverUrl, type MusicActions } from '../../shared/music.ts';
import {
  createFootprintClient,
  isFootprintAbort,
  type FootprintDetail,
  type FootprintEvent,
  type FootprintMilestone,
  type FootprintPost,
  type FootprintOverview,
  type MemoryCard,
} from '../../services/music/footprint.ts';
import { CardArtwork, downloadCardArtwork } from './CardArtwork.tsx';
import { formatClock, formatDate, formatDuration, siteOffset, toFootprintSong } from './format.ts';
type Tab = 'timeline' | 'milestone' | 'studio' | 'square';
type Dialog = { kind: 'share'; card: MemoryCard } | { kind: 'card' | 'post'; id: number } | null;
export interface FootprintPageHandle {
  readonly hasOpenDialog: boolean;
}
export interface FootprintPageProps {
  active: boolean;
  play?: MusicActions['play'];
  enqueue?: MusicActions['enqueue'];
  client?: ReturnType<typeof createFootprintClient>;
  revision?: number;
}
const tabs: { id: Tab; label: string; english: string; title: string }[] = [
  { id: 'timeline', label: '时光轴', english: 'TIMELINE', title: '音乐足迹时光轴' },
  { id: 'milestone', label: '听歌里程', english: 'MILESTONE', title: '我的听歌里程' },
  { id: 'studio', label: '回忆卡片', english: 'CARD STUDIO', title: '回忆卡片工坊' },
  { id: 'square', label: '足迹广场', english: 'SQUARE', title: '足迹广场' },
];

export const FootprintPage = forwardRef<FootprintPageHandle, FootprintPageProps>(
  function FootprintPage({ active, play, enqueue, client, revision = 0 }, ref) {
    const api = useMemo(() => client ?? createFootprintClient(), [client]);
    const pageMotion = usePageMotion(active);
    const {
      changing,
      run: transitionSection,
      finish: finishSection,
    } = useSectionTransition(active);
    const latest = useLatest({ active, play, enqueue });
    const [tab, setTab] = useState<Tab>('timeline');
    const [squareFilter, setSquareFilter] = useState<'all' | 'mine'>('all');
    const [overview, setOverview] = useState<FootprintOverview | null>(null);
    const [viewerId, setViewerId] = useState<number>();
    const [postId, setPostId] = useState<number | null>(null);
    const [offset, setOffset] = useState(480);
    const [pageOffset, setPageOffset] = useState(0);
    const [reload, setReload] = useState(0);
    const [events, setEvents] = useState<FootprintEvent[]>([]);
    const [total, setTotal] = useState(0);
    const [cards, setCards] = useState<MemoryCard[]>([]);
    const [cardTotal, setCardTotal] = useState(0);
    const [posts, setPosts] = useState<FootprintPost[]>([]);
    const [published, setPublished] = useState<number[]>([]);
    const [milestone, setMilestone] = useState<FootprintMilestone | null>(null);
    const [detail, setDetail] = useState<FootprintDetail | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [appliedRevision, setAppliedRevision] = useState(revision);
    const [notice, setNotice] = useState({ text: '', error: false });
    const [editingId, setEditingId] = useState<number | null>(null);
    const [noteDraft, setNoteDraft] = useState('');
    const [selected, setSelected] = useState<number[]>([]);
    const [title, setTitle] = useState('我的听歌回忆');
    const [preview, setPreview] = useState<MemoryCard | null>(null);
    const [comment, setComment] = useState('');
    const [commentsComplete, setCommentsComplete] = useState(false);
    const [caption, setCaption] = useState('');
    const [dialog, setDialog] = useState<Dialog>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const requestRef = useRef<AbortController | null>(null);
    const actionRef = useRef<AbortController | null>(null);
    const serial = useRef(0);
    const busyRef = useRef(false);
    const dialogRef = useLatest(dialog);
    useImperativeHandle(
      ref,
      () => ({
        get hasOpenDialog() {
          return dialogRef.current !== null;
        },
      }),
      [dialogRef],
    );

    const say = (text: string, error = false) => setNotice({ text, error });
    const invalidate = () => {
      serial.current++;
      requestRef.current?.abort();
      actionRef.current?.abort();
      busyRef.current = false;
      setBusy(false);
    };
    const refresh = () => {
      setPageOffset(0);
      setReload((value) => value + 1);
    };
    const switchView = (next: Tab, id: number | null = null) => {
      invalidate();
      transitionSection(() => {
        setTab(next);
        if (next === 'square' && tab !== 'square' && id === null) setSquareFilter('all');
        setPostId(id);
        setPageOffset(0);
        setEvents([]);
        setCards([]);
        setPosts([]);
        setTotal(0);
        setMilestone(null);
        setDetail(null);
        setEditingId(null);
        setNoteDraft('');
        setComment('');
        setCommentsComplete(false);
        setDialog(null);
        say('');
        setReload((value) => value + 1);
      });
    };

    // 播放上报可随时到达；正在提交时先保留版本，提交结束后再统一刷新。
    useEffect(() => {
      if (!busyRef.current) setAppliedRevision(revision);
    }, [revision, busy]);
    useEffect(() => {
      setPageOffset(0);
    }, [active, appliedRevision]);

    useEffect(() => {
      const controller = new AbortController();
      requestRef.current?.abort();
      actionRef.current?.abort();
      requestRef.current = controller;
      const generation = ++serial.current;
      busyRef.current = false;
      setBusy(false);
      if (!active) {
        setLoading(false);
        setDialog(null);
        return () => controller.abort();
      }
      setLoading(true);
      setNotice({ text: '正在读取音乐足迹…', error: false });
      const current = () => !controller.signal.aborted && serial.current === generation;
      const read = async () => {
        if (postId !== null) {
          const data = await api.post(postId, controller.signal);
          if (!current()) return;
          setDetail(data);
          setCommentsComplete(data.comments.length < 50 || data.comments.length >= 500);
          if (data.timezoneOffsetMinutes !== undefined)
            setOffset(siteOffset(data.timezoneOffsetMinutes));
        } else if (tab === 'timeline') {
          const data = await api.timeline(30, pageOffset, controller.signal);
          if (!current()) return;
          setEvents((previous) =>
            pageOffset
              ? [
                  ...previous,
                  ...data.events.filter((event) => !previous.some((old) => old.id === event.id)),
                ]
              : data.events,
          );
          setTotal(data.total);
          setOffset(siteOffset(data.timezoneOffsetMinutes));
        } else if (tab === 'milestone') {
          const data = await api.milestone(controller.signal);
          if (!current()) return;
          setMilestone(data);
          setOffset(siteOffset(data?.timezoneOffsetMinutes));
        } else if (tab === 'studio') {
          const [timeline, saved, shares] = await Promise.all([
            api.timeline(50, 0, controller.signal),
            api.cards(30, pageOffset, controller.signal),
            api.myPosts(50, 0, controller.signal),
          ]);
          if (!current()) return;
          setEvents(timeline.events);
          setOffset(siteOffset(timeline.timezoneOffsetMinutes));
          setSelected((previous) =>
            previous.filter((id) => timeline.events.some((event) => event.id === id)),
          );
          setCards((previous) =>
            pageOffset
              ? [
                  ...previous,
                  ...saved.cards.filter((card) => !previous.some((old) => old.id === card.id)),
                ]
              : saved.cards,
          );
          setCardTotal(saved.total);
          setPublished(shares.map((post) => post.cardId));
          setPreview(
            (previous) =>
              previous &&
              (saved.cards.find((card) => card.id === previous.id) ||
                (pageOffset ? previous : null)),
          );
        } else {
          const ownOnly = squareFilter === 'mine';
          const readPosts = async () => {
            if (!ownOnly) return api.posts(12, pageOffset, controller.signal);
            if (api.myPostsPage) return api.myPostsPage(12, pageOffset, controller.signal);
            const posts = await api.myPosts(30, pageOffset, controller.signal);
            return {
              posts,
              total: pageOffset + posts.length + (posts.length === 30 ? 1 : 0),
              viewerId: undefined,
            };
          };
          const [data, summary] = await Promise.all([
            readPosts(),
            api.overview
              ? api.overview(controller.signal).catch(() => null)
              : Promise.resolve(null),
          ]);
          if (!current()) return;
          setPosts((previous) =>
            pageOffset
              ? [
                  ...previous,
                  ...data.posts.filter((post) => !previous.some((old) => old.id === post.id)),
                ]
              : data.posts,
          );
          setTotal(data.total);
          setViewerId(data.viewerId);
          setOverview(summary);
        }
        if (current()) say('足迹已更新');
      };
      void read()
        .catch((error) => {
          if (current() && !isFootprintAbort(error))
            say(error instanceof Error ? error.message : '足迹读取失败，请重试', true);
        })
        .finally(() => {
          if (current()) {
            setLoading(false);
            finishSection();
          }
        });
      return () => {
        controller.abort();
        actionRef.current?.abort();
        serial.current++;
      };
    }, [active, api, tab, postId, appliedRevision, reload, pageOffset, squareFilter]);

    // 写操作和读操作共享页面代数；离页或切换详情后，迟到响应不能更新当前界面。
    const mutate = async (
      action: (signal: AbortSignal) => Promise<unknown>,
      message: string,
      after?: () => void,
      shouldRefresh = true,
    ) => {
      if (busyRef.current || !latest.current.active) return;
      busyRef.current = true;
      setBusy(true);
      const controller = new AbortController();
      actionRef.current = controller;
      const generation = serial.current;
      const current = () =>
        !controller.signal.aborted && generation === serial.current && latest.current.active;
      try {
        await action(controller.signal);
        if (!current()) return;
        after?.();
        say(message);
        if (shouldRefresh) refresh();
      } catch (error) {
        if (current() && !isFootprintAbort(error))
          say(error instanceof Error ? error.message : '操作失败，请重试', true);
      } finally {
        if (current()) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    };
    const cardStyles = useCardStyles({
      api,
      preview,
      setPreview,
      setCards,
      setCardTotal,
      setSelected,
      title,
      selected,
      mutate,
    });
    const playTrack = (track: Parameters<typeof toFootprintSong>[0]) => {
      const generation = serial.current;
      void Promise.resolve()
        .then(() => latest.current.play?.(toFootprintSong(track)))
        .catch(() => {
          if (latest.current.active && serial.current === generation) say('歌曲暂时无法播放', true);
        });
    };
    const download = (card: Pick<MemoryCard, 'title'>) => {
      try {
        if (svgRef.current) downloadCardArtwork(svgRef.current, card.title);
      } catch {
        say('卡片下载失败，请重试', true);
      }
    };
    const loadMoreComments = () => {
      if (!detail || commentsComplete || detail.comments.length >= 500) return;
      const id = detail.post.id;
      const count = detail.comments.length;
      void mutate(
        async (signal) => {
          const comments = await api.comments(id, Math.min(50, 500 - count), count, signal);
          if (signal.aborted) return;
          const added = comments.filter(
            (item) => !detail.comments.some((previous) => previous.id === item.id),
          );
          setDetail((previous) =>
            previous?.post.id === id
              ? { ...previous, comments: [...previous.comments, ...added] }
              : previous,
          );
          setCommentsComplete(comments.length < 50 || !added.length || count + added.length >= 500);
        },
        '评论已更新',
        undefined,
        false,
      );
    };
    const heading = tabs.find((item) => item.id === tab)!;
    const disabled = busy || loading;
    const moreComments = postId !== null &&
      detail &&
      !commentsComplete &&
      detail.comments.length < Math.min(500, detail.post.commentCount) && (
        <div className="fp-comment-actions">
          <span>
            已显示 {detail.comments.length} / {detail.post.commentCount} 条评论
          </span>
          <button
            type="button"
            className="fp-more"
            data-fp-more-comments
            disabled={disabled}
            onClick={loadMoreComments}
          >
            加载更多评论
          </button>
        </div>
      );
    const more = (count: number, all: number, label: string) =>
      count < all && (
        <button
          type="button"
          className="fp-more"
          data-fp-more
          disabled={disabled}
          onClick={() => setPageOffset(count)}
        >
          {loading ? '读取中…' : label}
        </button>
      );
    const like = (post: FootprintPost, detailed = false) => (
      <IconButton
        icon="heart"
        filled={post.liked}
        type="button"
        className={`fp-like${post.liked ? ' is-liked' : ''}`}
        data-fp-like={post.id}
        aria-label={post.liked ? '取消赞' : '点赞'}
        aria-pressed={post.liked}
        disabled={disabled}
        onClick={() => {
          const liked = !post.liked;
          void mutate(
            async (signal) => {
              const likeCount = await api.setLiked(post.id, liked, signal);
              if (signal.aborted) return;
              if (detailed)
                setDetail(
                  (previous) =>
                    previous && { ...previous, post: { ...previous.post, liked, likeCount } },
                );
              else
                setPosts((previous) =>
                  previous.map((item) =>
                    item.id === post.id ? { ...item, liked, likeCount } : item,
                  ),
                );
              if (api.overview) {
                const summary = await api.overview(signal).catch(() => null);
                if (!signal.aborted) setOverview(summary);
              }
            },
            liked ? '已点赞' : '已取消赞',
            undefined,
            false,
          );
        }}
      >
        <span>{post.likeCount}</span>
      </IconButton>
    );

    return (
      <motion.section
        className="footprint-page"
        data-footprint-page
        data-active={active}
        data-fp-mode={postId === null ? tab : 'detail'}
        {...pageMotion}
        aria-label="音乐足迹"
      >
        <CollapsibleSidebarLayout
          active={active}
          variant="footprint"
          sidebarClassName="fp-sidebar"
          sidebar={(expanded) => (
            <>
              <p className="fp-eyebrow">MUSIC FOOTPRINT / 音乐足迹</p>
              <LineSidebar
                ariaLabel="音乐足迹功能"
                items={tabs.map((item) => item.label)}
                activeIndex={tabs.findIndex((item) => item.id === tab)}
                enabled={active && expanded}
                showIndex={false}
                markerLength={26}
                markerGap={12}
                maxShift={12}
                itemGap={20}
                fontSize={0.83}
                className="member-line-sidebar"
                getItemProps={(index) => ({
                  'data-fp-tab': tabs[index].id,
                  title: tabs[index].label,
                })}
                renderLabel={(label, index) => (
                  <>
                    <strong>{label}</strong>
                    <small>{tabs[index].english}</small>
                  </>
                )}
                onItemClick={(index) => switchView(tabs[index].id)}
              />
              <p className="fp-sidebar-foot">
                <i />
                听过、写过、分享过
                <br />
                都算数。
              </p>
            </>
          )}
        >
          <div className="fp-shell">
            <header className="fp-header">
              <h2 className="sr-only">{postId !== null ? '足迹详情' : heading.title}</h2>
            </header>
            <div
              className={`fp-content section-content${changing ? ' is-changing' : ''}`}
              data-fp-content
              inert={changing}
              aria-busy={loading || changing}
            >
              {postId !== null && (
                <div className="fp-detail-toolbar">
                  <IconButton
                    icon="left"
                    className="fp-back"
                    data-fp-back
                    onClick={() => switchView(tab)}
                  >
                    返回列表
                  </IconButton>
                </div>
              )}
              {postId === null && tab === 'timeline' && (
                <TimelineView
                  events={events}
                  total={total}
                  offset={offset}
                  active={active}
                  loading={loading}
                  busy={busy}
                  disabled={disabled}
                  editingId={editingId}
                  noteDraft={noteDraft}
                  onPlay={play ? playTrack : undefined}
                  onEnqueue={
                    enqueue
                      ? (event) => {
                          latest.current.enqueue?.(toFootprintSong(event));
                          say('已加入播放队列');
                        }
                      : undefined
                  }
                  onEdit={(event) => {
                    setEditingId(event.id);
                    setNoteDraft(event.note?.content || '');
                  }}
                  onCancel={() => setEditingId(null)}
                  onDraft={setNoteDraft}
                  onSaveNote={(id, draft) => {
                    const content = draft.trim();
                    if (!content) {
                      say('随笔内容不能为空', true);
                      return;
                    }
                    void mutate(
                      (signal) => api.saveNote(id, content, signal),
                      '随笔已保存',
                      () => setEditingId(null),
                    );
                  }}
                  onDeleteNote={(id) => {
                    void mutate((signal) => api.deleteNote(id, signal), '随笔已删除');
                  }}
                  more={more(events.length, total, '加载更早的足迹')}
                />
              )}

              {postId === null && tab === 'milestone' && (
                <MilestoneView
                  data={milestone}
                  loading={loading}
                  active={active}
                  offset={offset}
                  play={play ? playTrack : undefined}
                />
              )}

              {postId === null && tab === 'studio' && (
                <section className="fp-view fp-studio">
                  <div className="fp-studio-body">
                    <div className="fp-picker">
                      <div className="fp-picker-head">
                        <h4>选择听歌记录</h4>
                        <span>{selected.length}/12 已选</span>
                      </div>
                      <ul className="fp-picker-list">
                        {events.map((event) => (
                          <li key={event.id}>
                            <label>
                              <input
                                type="checkbox"
                                data-fp-pick={event.id}
                                checked={selected.includes(event.id)}
                                disabled={
                                  disabled ||
                                  (!selected.includes(event.id) && selected.length >= 12)
                                }
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  setSelected((previous) =>
                                    checked
                                      ? previous.length < 12
                                        ? [...previous, event.id]
                                        : previous
                                      : previous.filter((id) => id !== event.id),
                                  );
                                }}
                              />
                              <img src={safeCoverUrl(event.coverUrl)} alt="" loading="lazy" />
                              <span>
                                <strong>{event.title}</strong>
                                <small>
                                  {event.artist} · {formatDate(event.playedAt, offset)}{' '}
                                  {formatClock(event.playedAt, offset)}
                                </small>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {!events.length && !loading && <p className="fp-empty">还没有可选择的足迹</p>}
                    </div>
                    <div className="fp-studio-side">
                      <label className="fp-field">
                        <span>卡片标题</span>
                        <input
                          maxLength={60}
                          data-fp-title
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          disabled={busy}
                        />
                      </label>
                      <CardStylePicker
                        value={cardStyles.value}
                        disabled={disabled}
                        onChange={cardStyles.change}
                      />
                      <div className="fp-studio-actions">
                        <button
                          type="button"
                          data-fp-generate
                          disabled={disabled || !selected.length}
                          onClick={() => void cardStyles.generate()}
                        >
                          生成回忆卡片
                        </button>
                        {preview && (
                          <>
                            <button
                              type="button"
                              className="fp-ghost"
                              data-fp-download
                              onClick={() => download(preview)}
                            >
                              下载卡片
                            </button>
                            {!published.includes(preview.id) && (
                              <button
                                type="button"
                                className="fp-ghost"
                                data-fp-share
                                disabled={disabled}
                                onClick={() => {
                                  setCaption('');
                                  setDialog({ kind: 'share', card: preview });
                                }}
                              >
                                分享到广场
                              </button>
                            )}
                            <button
                              type="button"
                              className="fp-danger"
                              data-fp-delete-card
                              disabled={disabled}
                              onClick={() => setDialog({ kind: 'card', id: preview.id })}
                            >
                              删除卡片
                            </button>
                          </>
                        )}
                      </div>
                      {preview ? (
                        <>
                          <div className="fp-card-preview">
                            <CardArtwork ref={svgRef} card={preview} offset={offset} />
                          </div>
                          <dl className="fp-card-meta">
                            <div>
                              <dt>覆盖时段</dt>
                              <dd>
                                {formatDate(preview.data.period.from, offset)} —{' '}
                                {formatDate(preview.data.period.to, offset)}
                              </dd>
                            </div>
                            <div>
                              <dt>记录数</dt>
                              <dd>
                                {preview.data.trackCount} 段 ·{' '}
                                {formatDuration(preview.data.totalDurationMs)}
                              </dd>
                            </div>
                            {preview.data.highlight && (
                              <div>
                                <dt>听得最多</dt>
                                <dd>
                                  {preview.data.highlight.title} × {preview.data.highlight.plays}
                                </dd>
                              </div>
                            )}
                            {published.includes(preview.id) && (
                              <div>
                                <dt>状态</dt>
                                <dd>已分享到广场</dd>
                              </div>
                            )}
                          </dl>
                        </>
                      ) : (
                        <p className="fp-empty">勾选左侧记录后生成卡片，这里会出现预览。</p>
                      )}
                    </div>
                  </div>
                  <section className="fp-panel">
                    <h4>我做过的卡片（{cardTotal}）</h4>
                    <div className="fp-card-shelf">
                      {cards.map((card) => (
                        <article className="fp-card-chip" key={card.id}>
                          <button
                            type="button"
                            data-fp-open-card={card.id}
                            aria-pressed={preview?.id === card.id}
                            onClick={() => setPreview(card)}
                          >
                            <span className="fp-card-mini">
                              <CardArtwork card={card} offset={offset} />
                            </span>
                            <strong>{card.title}</strong>
                            <small>
                              {formatDate(card.createdAt, offset)} · {card.data.trackCount} 段
                              {published.includes(card.id) ? ' · 已分享' : ''}
                            </small>
                          </button>
                        </article>
                      ))}
                    </div>
                    {!cards.length && !loading && <p className="fp-empty">还没有生成过卡片</p>}
                    {more(cards.length, cardTotal, '加载更多卡片')}
                  </section>
                </section>
              )}

              {postId === null && tab === 'square' && (
                <SquareView
                  posts={posts}
                  overview={overview}
                  total={total}
                  viewerId={viewerId}
                  filter={squareFilter}
                  loading={loading}
                  disabled={disabled}
                  offset={offset}
                  onFilter={(value) => {
                    if (value === squareFilter) return;
                    invalidate();
                    transitionSection(() => {
                      setSquareFilter(value);
                      setPosts([]);
                      setPageOffset(0);
                      setTotal(0);
                    });
                  }}
                  onOpen={(id) => switchView(tab, id)}
                  onRemove={(post) => setDialog({ kind: 'post', id: post.id })}
                  like={(post) => like(post)}
                  more={more(posts.length, total, '加载更多分享')}
                />
              )}

              {postId !== null && (
                <section className="fp-view fp-detail">
                  {detail ? (
                    <>
                      <header className="fp-view-header fp-detail-head">
                        <div>
                          <h3>{detail.card?.title || '音乐足迹'}</h3>
                          <span>
                            {detail.post.authorNickname} ·{' '}
                            {formatDate(detail.post.createdAt, offset)}{' '}
                            {formatClock(detail.post.createdAt, offset)}
                          </span>
                        </div>
                        {detail.canDelete && (
                          <button
                            type="button"
                            className="fp-danger"
                            data-fp-delete-post
                            disabled={disabled}
                            onClick={() => setDialog({ kind: 'post', id: detail.post.id })}
                          >
                            删除分享
                          </button>
                        )}
                      </header>
                      {detail.post.caption && (
                        <p className="fp-detail-caption">{detail.post.caption}</p>
                      )}
                      <div className="fp-detail-body">
                        <div className="fp-detail-card">
                          {detail.card ? (
                            <>
                              <CardArtwork ref={svgRef} card={detail.card} offset={offset} />
                              <button
                                type="button"
                                className="fp-ghost"
                                data-fp-download
                                onClick={() => detail.card && download(detail.card)}
                              >
                                下载卡片
                              </button>
                            </>
                          ) : (
                            <p className="fp-empty">卡片已被作者删除</p>
                          )}
                        </div>
                        <div className="fp-comments">
                          <div className="fp-comment-head">
                            <h4>评论 {detail.comments.length}</h4>
                            {like(detail.post, true)}
                          </div>
                          <ol className="fp-comment-list">
                            {detail.comments.map((item) => (
                              <li key={item.id}>
                                <div>
                                  <strong>{item.authorNickname}</strong>
                                  <time>
                                    {formatDate(item.createdAt, offset)}{' '}
                                    {formatClock(item.createdAt, offset)}
                                  </time>
                                </div>
                                <p>{item.content}</p>
                                {(item.canDelete ||
                                  (detail.viewerId !== undefined &&
                                    item.authorId === detail.viewerId)) && (
                                  <button
                                    type="button"
                                    className="fp-text"
                                    data-fp-delete-comment={item.id}
                                    disabled={disabled}
                                    onClick={() => {
                                      void mutate(
                                        (signal) => api.deleteComment(item.id, signal),
                                        '评论已删除',
                                      );
                                    }}
                                  >
                                    删除
                                  </button>
                                )}
                              </li>
                            ))}
                          </ol>
                          {moreComments}
                          {!detail.comments.length && (
                            <p className="fp-empty">还没有评论，来说点什么吧。</p>
                          )}
                          <form
                            className="fp-comment-form"
                            data-fp-comment-form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const content = comment.trim();
                              if (!content) {
                                say('评论内容不能为空', true);
                                return;
                              }
                              void mutate(
                                (signal) => api.addComment(detail.post.id, content, signal),
                                '评论已发布',
                                () => setComment(''),
                              );
                            }}
                          >
                            <textarea
                              name="content"
                              maxLength={300}
                              rows={2}
                              aria-label="评论内容"
                              placeholder="写一句评论…"
                              value={comment}
                              disabled={busy}
                              onChange={(e) => setComment(e.target.value)}
                            />
                            <div className="fp-comment-actions">
                              <span>{comment.length}/300</span>
                              <button type="submit" disabled={disabled}>
                                {busy ? '发送中…' : '发送'}
                              </button>
                            </div>
                          </form>
                        </div>
                      </div>
                    </>
                  ) : (
                    <p className="fp-empty">
                      {loading ? '正在读取这条分享…' : '这条分享无法读取，请重试或返回列表。'}
                    </p>
                  )}
                </section>
              )}
            </div>
            <p className="fp-feedback" data-fp-feedback data-error={notice.error} role="status">
              {notice.text}
              {notice.error && (
                <button type="button" className="fp-text" disabled={disabled} onClick={refresh}>
                  重新读取
                </button>
              )}
            </p>
          </div>
        </CollapsibleSidebarLayout>
        <Modal
          open={dialog !== null && active}
          busy={busy}
          onClose={() => setDialog(null)}
          className="fp-dialog"
          data-fp-dialog
          aria-labelledby="fp-dialog-title"
        >
          <form
            data-fp-dialog-form
            onSubmit={(e) => {
              e.preventDefault();
              if (!dialog) return;
              const choice = dialog;
              if (choice.kind === 'share') {
                void mutate(
                  (signal) => api.publish(choice.card.id, caption.trim(), signal),
                  '已分享到足迹广场',
                  () => {
                    setPublished((previous) => [...previous, choice.card.id]);
                    setDialog(null);
                  },
                  false,
                );
              } else if (choice.kind === 'card') {
                void mutate(
                  (signal) => api.deleteCard(choice.id, signal),
                  '卡片已删除',
                  () => {
                    setDialog(null);
                    setPreview(null);
                  },
                );
              } else {
                void mutate(
                  (signal) => api.deletePost(choice.id, signal),
                  '分享已删除',
                  () => {
                    setDialog(null);
                    if (postId !== null) switchView(tab);
                  },
                );
              }
            }}
          >
            <h3 id="fp-dialog-title">
              {dialog?.kind === 'share'
                ? '分享到足迹广场'
                : dialog?.kind === 'card'
                  ? '删除回忆卡片？'
                  : '删除这条分享？'}
            </h3>
            {dialog?.kind === 'share' ? (
              <label className="fp-field">
                <span>写一句分享语（可以留空）</span>
                <textarea
                  autoFocus
                  name="caption"
                  maxLength={300}
                  rows={3}
                  value={caption}
                  disabled={busy}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </label>
            ) : (
              <p>{dialog?.kind === 'card' ? '已分享的内容也会一起移除。' : '评论也会一并移除。'}</p>
            )}
            <div className="fp-dialog-actions">
              <button
                type="button"
                className="fp-ghost"
                data-fp-dialog-cancel
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className={dialog?.kind === 'share' ? 'fp-ghost' : 'fp-danger'}
                disabled={busy}
              >
                {busy ? '处理中…' : dialog?.kind === 'share' ? '确认分享' : '确认删除'}
              </button>
            </div>
          </form>
        </Modal>
      </motion.section>
    );
  },
);

export default FootprintPage;
