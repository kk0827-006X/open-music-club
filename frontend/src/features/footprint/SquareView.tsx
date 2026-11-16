import type { ReactNode } from 'react';
import type { FootprintPost, FootprintOverview } from '../../services/music/footprint.ts';
import { PostCardArtwork } from './PostCardArtwork.tsx';
import { SquareOverview } from './SquareOverview.tsx';
import { authorColor, relativePostTime } from './square-format.ts';

export function SquareView({
  posts,
  overview,
  total,
  viewerId,
  filter,
  loading,
  disabled,
  offset,
  onFilter,
  onOpen,
  onRemove,
  like,
  more,
}: {
  posts: FootprintPost[];
  overview: FootprintOverview | null;
  total: number;
  viewerId?: number;
  filter: 'all' | 'mine';
  loading: boolean;
  disabled: boolean;
  offset: number;
  onFilter: (filter: 'all' | 'mine') => void;
  onOpen: (id: number) => void;
  onRemove: (post: FootprintPost) => void;
  like: (post: FootprintPost) => ReactNode;
  more: ReactNode;
}) {
  const ownOnly = filter === 'mine';
  return (
    <section className="fp-view fp-square fp-square-gallery">
      <header className="fp-square-heading">
        <p>SQUARE / 足迹广场</p>
        <h3>{ownOnly ? '我的音乐足迹分享' : '大家在听什么'}</h3>
        <span>{total} 份足迹卡片</span>
      </header>
      <SquareOverview overview={overview} loading={loading} />
      <div className="fp-square-filter" role="group" aria-label="筛选分享">
        {(['all', 'mine'] as const).map((value) => (
          <button
            type="button"
            key={value}
            data-fp-filter={value}
            aria-pressed={filter === value}
            disabled={disabled}
            onClick={() => onFilter(value)}
          >
            {value === 'all' ? '全部成员' : '我的分享'}
          </button>
        ))}
      </div>
      <div className="fp-square-grid">
        {posts.map((post) => {
          const own = post.authorId === viewerId;
          return (
            <article className="fp-post-card" key={post.id}>
              <header>
                <span className="fp-post-author">
                  <i
                    className="fp-square-avatar"
                    data-color={authorColor(post.authorNickname)}
                    aria-hidden="true"
                  >
                    {Array.from(post.authorNickname || '·')[0]}
                  </i>
                  {post.authorNickname}
                  {own ? ' · 我' : ''}
                </span>
                <time dateTime={post.createdAt}>{relativePostTime(post.createdAt, offset)}</time>
              </header>
              <button
                type="button"
                className="fp-post-open"
                data-fp-open-post={post.id}
                onClick={() => onOpen(post.id)}
              >
                {post.card ? (
                  <PostCardArtwork card={post.card} offset={offset} />
                ) : (
                  <span className="fp-post-fallback">回忆卡片 #{post.cardId}</span>
                )}
                <strong>{post.caption || '分享了一段音乐足迹'}</strong>
                <em>查看卡片与评论 →</em>
              </button>
              <footer>
                {like(post)}
                <span className="fp-post-foot">
                  <button type="button" className="fp-text" onClick={() => onOpen(post.id)}>
                    {post.commentCount} 条评论
                  </button>
                  {own && (
                    <button
                      type="button"
                      className="fp-text fp-post-remove"
                      data-fp-remove-post={post.id}
                      disabled={disabled}
                      onClick={() => onRemove(post)}
                    >
                      撤下
                    </button>
                  )}
                </span>
              </footer>
            </article>
          );
        })}
      </div>
      {!posts.length && !loading && (
        <p className="fp-empty">
          {ownOnly
            ? '你还没有分享过足迹。在「回忆卡片」里生成一张卡片，就能分享到这里。'
            : '还没有人分享足迹。在「回忆卡片」里生成一张卡片，就能分享到这里。'}
        </p>
      )}
      {more}
    </section>
  );
}
