import type { CSSProperties } from 'react';
import type { FootprintMilestone } from '../../services/music/footprint.ts';
import { safeCoverUrl } from '../../shared/music.ts';
import { IconButton } from '../../shared/react/ui.tsx';
import { formatDate, formatDuration } from './format.ts';
import { ListeningHours, ListeningStreak } from './MilestoneCharts.tsx';
import { MilestoneNumber } from './MilestoneNumber.tsx';

type TopTrack = FootprintMilestone['topTracks'][number];
const barStyle = (ratio: number, delay: number): CSSProperties =>
  ({ '--fp-ratio': ratio, '--fp-delay': `${delay}ms` }) as CSSProperties;

// wqh 最新听歌里程设计的 React 实现，数据及播放动作由页面统一提供。
export function MilestoneView({
  data,
  loading,
  active,
  offset,
  play,
}: {
  data: FootprintMilestone | null;
  loading: boolean;
  active: boolean;
  offset: number;
  play?: (track: TopTrack) => void;
}) {
  if (!data?.totalPlays)
    return (
      <section className="fp-view fp-milestone" aria-label="听歌里程">
        {!loading && <p className="fp-empty">还没有听歌里程，播放一首歌开启旅程。</p>}
      </section>
    );
  const monthlyPeak = Math.max(1, ...data.monthly.map((item) => item.plays));
  const playsPeak = Math.max(1, ...data.topTracks.map((track) => track.plays));
  return (
    <section className="fp-view fp-milestone" data-motion-active={active} aria-label="听歌里程">
      <header className="fp-milestone-heading">
        <p>MILESTONE / 听歌里程</p>
        <h3>我的听歌里程</h3>
        <span>
          {data.firstPlayedAt ? `${formatDate(data.firstPlayedAt, offset)} 起 · ` : ''}共{' '}
          {data.activeDays} 天有声音
        </span>
      </header>
      <section className="fp-hero">
        <i className="fp-vinyl" aria-hidden="true" />
        <div className="fp-hero-main">
          <p className="fp-hero-label">TOTAL PLAYS / 累计播放</p>
          <p className="fp-hero-num">
            <b>
              <MilestoneNumber value={data.totalPlays} active={active} />
            </b>
            <span>次</span>
          </p>
          <p className="fp-hero-sub">
            每一段旋律都被记在这里
            {data.busiestDay && (
              <>
                {' '}
                · 最投入的一天是 <b>{data.busiestDay.date}</b>，听了 {data.busiestDay.plays} 次
              </>
            )}
          </p>
        </div>
        <div className="fp-hero-ring">
          <ListeningStreak days={data.streakDays} activeDays={data.activeDays} />
        </div>
      </section>
      <div className="fp-stat-grid">
        <article className="fp-stat">
          <small>陪伴时长</small>
          <strong>{formatDuration(data.totalDurationMs)}</strong>
          <span>累计 · 相当于一张专辑循环了很多遍</span>
        </article>
        <article className="fp-stat">
          <small>听过的歌</small>
          <strong>
            <MilestoneNumber value={data.distinctTracks} active={active} />
          </strong>
          <span>首 · {data.distinctArtists} 位艺术家</span>
        </article>
        <article className="fp-stat">
          <small>听歌随笔</small>
          <strong>
            <MilestoneNumber value={data.noteCount} active={active} />
          </strong>
          <span>篇 · 写给某首歌的一句话</span>
        </article>
      </div>
      <section className="fp-panel">
        <h4>听歌时刻 · 一天里的节奏</h4>
        <ListeningHours hourly={data.hourly} />
        <div className="fp-hours-axis">
          {[0, 6, 12, 18, 23].map((hour) => (
            <span key={hour}>{hour}</span>
          ))}
        </div>
      </section>
      <section className="fp-panel">
        <h4>每月聆听 · 最近 12 个月</h4>
        <div className="fp-months">
          {data.monthly.map((item, index) => (
            <div key={item.month} className="fp-month">
              <i style={barStyle(item.plays / monthlyPeak, index * 55)} />
              <b>{item.month.slice(2)}</b>
              <small>{item.plays} 次</small>
            </div>
          ))}
          {!data.monthly.length && <p className="fp-empty">暂无月度数据</p>}
        </div>
      </section>
      <section className="fp-panel">
        <h4>热听榜 · 循环最多的歌</h4>
        <ol className="fp-top-tracks">
          {data.topTracks.map((track, index) => (
            <li key={track.trackKey}>
              <span className={`fp-rank fp-rank-${index + 1}`}>{index + 1}</span>
              <img src={safeCoverUrl(track.coverUrl)} alt="" loading="lazy" />
              <div className="fp-top-body">
                <strong>{track.title}</strong>
                <small>
                  {track.artist} · {track.plays} 次
                </small>
                <i className="fp-top-bar" style={barStyle(track.plays / playsPeak, index * 70)} />
              </div>
              <IconButton
                icon="play"
                className="fp-icon"
                aria-label={`播放 ${track.title}`}
                disabled={!play}
                onClick={() => play?.(track)}
              />
            </li>
          ))}
          {!data.topTracks.length && <li className="fp-empty">暂无数据</li>}
        </ol>
      </section>
    </section>
  );
}
