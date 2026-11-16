import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { FootprintDetail } from '../../services/music/footprint.ts';
import { IconButton } from '../../shared/react/ui.tsx';
import { useLatest } from '../../shared/react/hooks.ts';
import { CardArtwork } from './CardArtwork.tsx';
import { downloadCardPng } from './card-export.ts';
import { relativePostTime } from './square-format.ts';

export function ShareDetailView({
  detail,
  loading,
  active,
  disabled,
  offset,
  onBack,
  onRemove,
  onNotice,
  children,
}: {
  detail: FootprintDetail | null;
  loading: boolean;
  active: boolean;
  disabled: boolean;
  offset: number;
  onBack: () => void;
  onRemove: () => void;
  onNotice: (message: string, error?: boolean) => void;
  children: ReactNode;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    if (!active) controller.current?.abort();
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [active]);
  const [exporting, setExporting] = useState(false);
  const latest = useLatest({ active, id: detail?.post.id, onNotice });
  const exportPng = async () => {
    if (!svg.current || !detail?.card || pending.current) return;
    const id = detail.post.id;
    controller.current = new AbortController();
    pending.current = true;
    setExporting(true);
    try {
      await downloadCardPng(svg.current, detail.card.title, controller.current.signal);
    } catch {
      if (
        mounted.current &&
        latest.current.active &&
        latest.current.id === id &&
        !controller.current?.signal.aborted
      )
        latest.current.onNotice('卡片图片导出失败，请重试', true);
    } finally {
      pending.current = false;
      if (mounted.current) setExporting(false);
    }
  };
  return (
    <section className="fp-view fp-detail" data-motion-active={active} aria-label="足迹分享详情">
      <header className="fp-detail-head">
        <IconButton icon="left" className="fp-back" data-fp-back onClick={onBack}>
          返回列表
        </IconButton>
        <div>
          <p>DETAIL / 足迹详情</p>
          <h3>{detail?.card?.title || '音乐足迹'}</h3>
          {detail && (
            <span>
              {detail.post.authorNickname} · {relativePostTime(detail.post.createdAt, offset)}
            </span>
          )}
        </div>
        {detail?.canDelete && (
          <button
            type="button"
            className="fp-danger"
            data-fp-delete-post
            disabled={disabled}
            onClick={onRemove}
          >
            删除分享
          </button>
        )}
      </header>
      {detail ? (
        <>
          {detail.post.caption && <p className="fp-detail-caption">{detail.post.caption}</p>}
          <div className="fp-detail-body">
            <div className="fp-detail-card">
              {detail.card ? (
                <>
                  <CardArtwork ref={svg} card={detail.card} offset={offset} />
                  <div className="fp-detail-card-actions">
                    <button
                      type="button"
                      className="fp-ghost"
                      data-fp-download
                      disabled={exporting}
                      onClick={() => void exportPng()}
                    >
                      {exporting ? '正在导出…' : '下载为图片'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="fp-empty">卡片已被作者删除</p>
              )}
            </div>
            {children}
          </div>
        </>
      ) : (
        <p className="fp-empty">
          {loading ? '正在读取这条分享…' : '这条分享无法读取，请重试或返回列表。'}
        </p>
      )}
    </section>
  );
}
