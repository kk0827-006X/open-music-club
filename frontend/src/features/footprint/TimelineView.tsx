import type { CSSProperties, ReactNode } from 'react';
import type { FootprintEvent } from '../../services/music/footprint.ts';
import { safeCoverUrl } from '../../shared/music.ts';
import { IconButton } from '../../shared/react/ui.tsx';
import { dayKey, formatClock, formatTrackDuration } from './format.ts';
import { timelineDayLabel } from './timeline-format.ts';

// 视图只负责时光轴展示和输入，写入及取消策略由页面提供。
export function TimelineView({
  events,
  total,
  offset,
  active,
  loading,
  busy,
  disabled,
  editingId,
  noteDraft,
  onPlay,
  onEnqueue,
  onEdit,
  onCancel,
  onDraft,
  onSaveNote,
  onDeleteNote,
  more,
}: {
  events: FootprintEvent[];
  total: number;
  offset: number;
  active: boolean;
  loading: boolean;
  busy: boolean;
  disabled: boolean;
  editingId: number | null;
  noteDraft: string;
  onPlay?: (event: FootprintEvent) => void;
  onEnqueue?: (event: FootprintEvent) => void;
  onEdit: (event: FootprintEvent) => void;
  onCancel: () => void;
  onDraft: (value: string) => void;
  onSaveNote: (id: number, content: string) => void;
  onDeleteNote: (id: number) => void;
  more: ReactNode;
}) {
  const groups = new Map<string, FootprintEvent[]>();
  for (const event of events) {
    const key = dayKey(event.playedAt, offset);
    groups.set(key, [...(groups.get(key) || []), event]);
  }
  return (
    <section
      className="fp-view fp-timeline"
      data-motion-active={active}
      aria-label="音乐足迹时光轴"
    >
      <header className="fp-timeline-heading">
        <p>TIMELINE / 时光轴</p>
        <h3>音乐足迹时光轴</h3>
        <p className="fp-view-summary">{total} 条播放记录</p>
      </header>
      {[...groups.entries()].map(([key, group]) => (
        <div className="fp-day" key={key}>
          <div className="fp-day-marker">
            <i />
            <h4>{timelineDayLabel(group[0].playedAt, offset)}</h4>
            <span>{group.length} 段声音</span>
          </div>
          <ol className="fp-day-list">
            {group.map((event, index) => (
              <li
                key={event.id}
                className={`fp-entry${event.note ? ' has-note' : ''}`}
                style={{ '--fp-i': index } as CSSProperties}
              >
                <time className="fp-entry-time">{formatClock(event.playedAt, offset)}</time>
                <div className="fp-entry-card">
                  <img src={safeCoverUrl(event.coverUrl)} alt="" loading="lazy" />
                  <div className="fp-entry-body">
                    <strong>{event.title}</strong>
                    <small>
                      {event.artist}
                      {event.album ? ` · ${event.album}` : ''}
                    </small>
                    <em>
                      {formatTrackDuration(event.durationMs)} ·{' '}
                      {event.source === 'local' ? '本地' : '网易云'}
                    </em>
                    {event.note && editingId !== event.id && (
                      <blockquote className="fp-note">
                        {event.note.content}
                        <cite>随笔 · {formatClock(event.note.updatedAt, offset)}</cite>
                      </blockquote>
                    )}
                    {editingId === event.id && (
                      <form
                        className="fp-note-form"
                        data-fp-note-form={event.id}
                        onSubmit={(e) => {
                          e.preventDefault();
                          onSaveNote(event.id, noteDraft);
                        }}
                      >
                        <textarea
                          autoFocus
                          name="note"
                          rows={3}
                          maxLength={1000}
                          aria-label="听歌随笔"
                          value={noteDraft}
                          disabled={busy}
                          onChange={(e) => onDraft(e.target.value)}
                        />
                        <div className="fp-note-actions">
                          <span>{noteDraft.length}/1000</span>
                          <button
                            type="button"
                            disabled={busy}
                            data-fp-note-cancel
                            onClick={() => onCancel()}
                          >
                            取消
                          </button>
                          <button type="submit" disabled={busy}>
                            保存随笔
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                  <div className="fp-entry-actions">
                    <IconButton
                      icon="play"
                      className="fp-icon"
                      data-fp-play={event.trackKey}
                      aria-label={`播放 ${event.title}`}
                      disabled={!onPlay}
                      onClick={() => onPlay?.(event)}
                    />
                    <IconButton
                      icon="plus"
                      className="fp-icon"
                      data-fp-enqueue={event.trackKey}
                      aria-label={`加入队列 ${event.title}`}
                      disabled={!onEnqueue}
                      onClick={() => onEnqueue?.(event)}
                    />
                    {editingId !== event.id && (
                      <button
                        type="button"
                        className="fp-text"
                        data-fp-note-edit={event.id}
                        disabled={disabled}
                        onClick={() => {
                          onEdit(event);
                        }}
                      >
                        {event.note ? '修改随笔' : '写随笔'}
                      </button>
                    )}
                    {event.note && editingId !== event.id && (
                      <button
                        type="button"
                        className="fp-text"
                        data-fp-note-delete={event.id}
                        disabled={disabled}
                        onClick={() => onDeleteNote(event.id)}
                      >
                        删除随笔
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ))}
      {!events.length && !loading && (
        <p className="fp-empty">还没有足迹。去音乐库或搜索里播放一首歌，它会自己出现在时间轴上。</p>
      )}
      {more}
    </section>
  );
}
