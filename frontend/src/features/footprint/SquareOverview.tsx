import type { FootprintOverview } from '../../services/music/footprint.ts';

export function SquareOverview({
  overview,
  loading,
}: {
  overview: FootprintOverview | null;
  loading: boolean;
}) {
  if (!overview)
    return (
      <p className="fp-square-stat-status" role="status">
        {loading ? '正在读取社区统计…' : '社区统计暂时不可用'}
      </p>
    );
  return (
    <dl className="fp-square-overview" aria-label="社区分享统计">
      {(
        [
          ['posts', '份分享'],
          ['likes', '次赞'],
          ['comments', '条评论'],
          ['authors', '位成员'],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd>{overview[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
