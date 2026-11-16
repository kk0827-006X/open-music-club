import type { ReactNode } from 'react';
import type { FootprintComment } from '../../services/music/footprint.ts';
import { relativePostTime } from './square-format.ts';

// 评论分页、提交与权限仍由页面管理；组件保留受控草稿及可访问名称。
export function FootprintComments({
  comments,
  viewerId,
  offset,
  like,
  moreComments,
  comment,
  busy,
  disabled,
  onDelete,
  onSubmit,
  onChange,
}: {
  comments: FootprintComment[];
  viewerId?: number;
  offset: number;
  like: ReactNode;
  moreComments: ReactNode;
  comment: string;
  busy: boolean;
  disabled: boolean;
  onDelete: (id: number) => void;
  onSubmit: (value: string) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="fp-comments">
      <div className="fp-comment-head">
        <h4>评论 {comments.length}</h4>
        {like}
      </div>
      <ol className="fp-comment-list">
        {comments.map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.authorNickname}</strong>
              <time>{relativePostTime(item.createdAt, offset)}</time>
            </div>
            <p>{item.content}</p>
            {(item.canDelete || (viewerId !== undefined && item.authorId === viewerId)) && (
              <button
                type="button"
                className="fp-text"
                data-fp-delete-comment={item.id}
                disabled={disabled}
                onClick={() => onDelete(item.id)}
              >
                删除
              </button>
            )}
          </li>
        ))}
      </ol>
      {moreComments}
      {!comments.length && <p className="fp-empty">还没有评论，来说点什么吧。</p>}
      <form
        className="fp-comment-form"
        data-fp-comment-form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(comment);
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
          onChange={(e) => onChange(e.target.value)}
        />
        <div className="fp-comment-actions">
          <span>{comment.length}/300</span>
          <button type="submit" disabled={disabled}>
            {busy ? '发送中…' : '发送'}
          </button>
        </div>
      </form>
    </div>
  );
}
