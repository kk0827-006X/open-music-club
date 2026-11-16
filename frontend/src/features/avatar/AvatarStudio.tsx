import { Fragment, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createAvatarClient } from '../../services/avatar-studio.ts';
import { AvatarArtwork } from './AvatarArtwork.tsx';
import { AvatarEditor } from './AvatarEditor.tsx';
import { AvatarAutoView, type RecentOutfit } from './AvatarAutoView.tsx';
import { AvatarSaveDialog } from './AvatarSaveDialog.tsx';
import { OutfitLibrary } from './OutfitLibrary.tsx';
import { useAvatarStudio } from './use-avatar-studio.ts';
import { catalog, slots, randomOutfit, type Slot } from './model.ts';

type Tab = 'manual' | 'auto' | 'saved';
const views = {
  manual: {
    title: '换装工坊',
    english: 'Manual',
    sub: '逐槽位微调你的角色形象 — 服饰 / 发型 / 配饰自由混搭',
  },
  auto: {
    title: '自动换装',
    english: 'Auto Styling',
    sub: '挑一个风格预设，一键随机组合出整套协调搭配',
  },
  saved: {
    title: '我的形象',
    english: 'Saved',
    sub: '所有保存过的形象都归属当前账号，随时取回继续编辑',
  },
};

function AvatarWorkroom({
  studio,
  onDialogChange,
}: {
  studio: ReturnType<typeof useAvatarStudio>;
  onDialogChange?: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>('manual');
  const [preset, setPreset] = useState('street');
  const [locks, setLocks] = useState<Slot[]>([]);
  const [keepTheme, setKeepTheme] = useState(true);
  const [recent, setRecent] = useState<RecentOutfit[]>([]);
  const [caption, setCaption] = useState('选择一种风格，点「一键换装」生成整套搭配。');
  const [saveOpen, setSaveOpen] = useState(false);
  const serial = useRef(0);
  const { session, config, setConfig, name, setName, busy, notice } = studio;
  const theme = catalog.themes.find((item) => item.id === config.theme)!;
  function defaultName() {
    return `${catalog.presets.find((item) => item.id === preset)!.name} · ${theme.name}`;
  }
  function openSave() {
    setName(defaultName());
    setSaveOpen(true);
  }
  function roll(id: string) {
    const next = randomOutfit(config, id, locks, keepTheme);
    const label = catalog.presets.find((item) => item.id === id)?.name ?? '完全随机';
    setConfig(next);
    setCaption(
      id === 'random'
        ? '完全随机 — 可能很怪，但偶尔会惊喜'
        : `${label} · ${catalog.themes.find((item) => item.id === next.theme)!.name}主题 — 不满意就再摇一次`,
    );
    setRecent((previous) =>
      [
        {
          id: ++serial.current,
          config: next,
          label,
          at: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
        },
        ...previous,
      ].slice(0, 6),
    );
  }
  return (
    <div
      className="avatar-studio avatar-studio-original"
      data-avatar-studio
      data-avatar-view={tab}
      style={
        {
          '--as-avatar-theme': theme.primary,
          '--as-avatar-theme-dark': theme.dark,
          '--as-avatar-theme-light': theme.light,
        } as CSSProperties
      }
    >
      <div className="app-shell">
        <nav className="side-nav" aria-label="工坊功能">
          <div className="nav-brand">
            <div className="brand-logo brand-logo--sm" aria-hidden="true" />
            <div className="nav-brand-text">
              <span className="nav-brand-title">Avatar Studio</span>
              <span className="nav-brand-sub">Open Music Club</span>
            </div>
          </div>
          <p className="nav-group-label">Styling</p>
          {(['manual', 'auto', 'saved'] as const).map((value) => (
            <Fragment key={value}>
              {value === 'saved' && <p className="nav-group-label">Library</p>}
              <button
                key={value}
                type="button"
                className="nav-item"
                data-avatar-tab={value}
                aria-current={tab === value ? 'page' : undefined}
                disabled={busy}
                onClick={() => setTab(value)}
              >
                <span className="nav-ico" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path
                      d={
                        value === 'manual'
                          ? 'M8 3l4 2 4-2 3 2-2 3-1-.6V21H8V7.4L7 8 5 5z'
                          : value === 'auto'
                            ? 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1'
                            : 'M6 3h12a1 1 0 011 1v17l-7-4.5L5 21V4a1 1 0 011-1z'
                      }
                    />
                    {value === 'auto' && <circle cx="12" cy="12" r="3.2" />}
                  </svg>
                </span>
                <span className="nav-text">
                  <strong>{views[value].title}</strong>
                  <em>{views[value].english}</em>
                </span>
              </button>
            </Fragment>
          ))}
          <div className="nav-foot">
            <span className="nav-db" data-avatar-session>
              已登录 · 私人形象库
            </span>
          </div>
        </nav>
        <main className="page">
          <header className="page-header">
            <div className="brand">
              <div className="brand-text">
                <h1 className="brand-title">{views[tab].title}</h1>
                <p className="brand-sub">{views[tab].sub}</p>
              </div>
            </div>
            <div className="header-actions">
              <span className="status">{busy ? '保存中…' : 'Connected'}</span>
              {tab !== 'saved' && (
                <button
                  className="btn btn--primary avatar-save-open"
                  type="button"
                  disabled={busy || session!.outfits.length >= 50}
                  onClick={openSave}
                >
                  保存形象
                </button>
              )}
            </div>
          </header>
          <p className="studio-status" role="status" data-avatar-status>
            {notice}
          </p>
          {tab === 'manual' && (
            <AvatarEditor config={config} disabled={busy} onChange={setConfig} />
          )}
          {tab === 'auto' && (
            <AvatarAutoView
              config={config}
              disabled={busy}
              preset={preset}
              locks={locks}
              keepTheme={keepTheme}
              recent={recent}
              caption={caption}
              onPreset={setPreset}
              onLock={(slot) =>
                setLocks((previous) =>
                  previous.includes(slot)
                    ? previous.filter((item) => item !== slot)
                    : [...previous, slot],
                )
              }
              onKeepTheme={setKeepTheme}
              onRoll={roll}
              onApply={setConfig}
            />
          )}
          {tab === 'saved' && (
            <OutfitLibrary
              outfits={session!.outfits}
              disabled={busy}
              onEdit={(next) => {
                setConfig(next);
                setTab('manual');
              }}
              onSelect={studio.select}
              onRemove={studio.remove}
              onSave={openSave}
              onRefresh={() => void studio.reload()}
            />
          )}
        </main>
      </div>
      <footer className="page-footer">
        <div className="player-track">
          <div className="player-thumb">
            <AvatarArtwork config={config} />
          </div>
          <div className="player-info">
            <span className="now-playing">♬ Now Styling</span>
            <span className="track-name">
              已选 {slots.filter((slot) => config[slot]).length} / 6 槽位 · {theme.name}主题
            </span>
          </div>
        </div>
        <span className="legend">
          <kbd>Click</kbd> 切换部件
        </span>
      </footer>
      <AvatarSaveDialog
        open={saveOpen}
        busy={busy}
        name={name}
        onName={setName}
        onClose={() => setSaveOpen(false)}
        onSave={() => {
          void studio.save(name.trim() || defaultName()).then((saved) => {
            if (saved) setSaveOpen(false);
          });
        }}
        onDialogChange={onDialogChange}
      />
    </div>
  );
}

export function AvatarStudio({
  active,
  client,
  onDialogChange,
}: {
  active: boolean;
  client?: ReturnType<typeof createAvatarClient>;
  onDialogChange?: (open: boolean) => void;
}) {
  const api = useMemo(() => client ?? createAvatarClient(), [client]);
  const studio = useAvatarStudio(active, api);
  if (!active) return null;
  if (studio.phase === 'ready' && studio.session)
    return (
      <AvatarWorkroom
        key={studio.session.context}
        studio={studio}
        onDialogChange={onDialogChange}
      />
    );
  return (
    <section
      className="avatar-studio avatar-studio-original"
      data-avatar-studio
      aria-label="像素小人工坊"
    >
      <p className="studio-status" role="status" data-avatar-status>
        {studio.notice}
      </p>
      <button
        className="btn"
        type="button"
        disabled={studio.phase === 'loading'}
        onClick={() => void studio.reload()}
      >
        重新验证并读取
      </button>
    </section>
  );
}
export default AvatarStudio;
