import { AvatarArtwork } from './AvatarArtwork.tsx';
import { catalog, slots, slotNames, type AvatarConfig, type Slot } from './model.ts';
export type RecentOutfit = { config: AvatarConfig; label: string; at: string; id: number };

export function AvatarAutoView({
  config,
  disabled,
  preset,
  locks,
  keepTheme,
  recent,
  caption,
  onPreset,
  onLock,
  onKeepTheme,
  onRoll,
  onApply,
}: {
  config: AvatarConfig;
  disabled: boolean;
  preset: string;
  locks: Slot[];
  keepTheme: boolean;
  recent: RecentOutfit[];
  caption: string;
  onPreset: (id: string) => void;
  onLock: (slot: Slot) => void;
  onKeepTheme: (keep: boolean) => void;
  onRoll: (id: string) => void;
  onApply: (config: AvatarConfig) => void;
}) {
  return (
    <fieldset className="view avatar-source-editor" disabled={disabled}>
      <legend className="sr-only">自动换装设置</legend>
      <div className="auto-layout">
        <aside className="auto-stage-card">
          <div className="auto-stage-inner">
            <AvatarArtwork config={config} label="自动换装预览" />
          </div>
          <p className="auto-caption">{caption}</p>
        </aside>
        <div className="auto-panel">
          <div className="panel-head">
            <h2>
              风格预设 <em>Style Presets</em>
            </h2>
            <p className="hint">点击风格即可生成搭配；一键换装可按当前风格再换一套。</p>
          </div>
          <div className="style-grid" role="group" aria-label="风格预设">
            {catalog.presets.map((item) => (
              <button
                key={item.id}
                className="style-card"
                data-preset={item.id}
                type="button"
                aria-pressed={preset === item.id}
                onClick={() => onPreset(item.id)}
              >
                <span className="style-card-top">
                  <span className="style-dots">
                    {item.themes.map((id) => (
                      <i
                        key={id}
                        style={{
                          background: catalog.themes.find((theme) => theme.id === id)!.primary,
                        }}
                      />
                    ))}
                  </span>
                  <span className="style-en">{item.en}</span>
                </span>
                <strong>{item.name}</strong>
                <em>{item.desc}</em>
              </button>
            ))}
          </div>
          <div className="panel-head panel-head--tight">
            <h2>
              锁定槽位 <em>Lock Slots</em>
            </h2>
            <p className="hint">锁定后自动换装会保留该槽位当前的部件。</p>
          </div>
          <div className="lock-row" role="group" aria-label="锁定槽位">
            {slots.map((slot) => (
              <button
                key={slot}
                type="button"
                className="lock-chip"
                data-lock={slot}
                aria-pressed={locks.includes(slot)}
                onClick={() => onLock(slot)}
              >
                <span className="lock-ico" aria-hidden="true">
                  {locks.includes(slot) ? '●' : '○'}
                </span>
                {slotNames[slot]}
              </button>
            ))}
          </div>
          <div className="auto-actions">
            <button className="btn btn--primary" type="button" onClick={() => onRoll(preset)}>
              一键换装
            </button>
            <button className="btn" type="button" onClick={() => onRoll('random')}>
              完全随机
            </button>
            <label className="auto-check">
              <input
                type="checkbox"
                checked={keepTheme}
                onChange={(event) => onKeepTheme(event.target.checked)}
              />
              <span>保持当前配色</span>
            </label>
          </div>
          <div className="panel-head panel-head--tight">
            <h2>
              最近方案 <em>Recent</em>
            </h2>
          </div>
          <div className="auto-recent">
            {recent.length ? (
              recent.map((item, index) => (
                <button
                  key={item.id}
                  className="recent-row"
                  type="button"
                  aria-label={`套用第 ${index + 1} 个最近方案`}
                  onClick={() => onApply(item.config)}
                >
                  <span className="recent-thumb">
                    <AvatarArtwork config={item.config} />
                  </span>
                  <span className="recent-info">
                    <strong>{item.label}</strong>
                    <em>{item.at}</em>
                  </span>
                  <span className="recent-apply">套用</span>
                </button>
              ))
            ) : (
              <p className="auto-recent-empty">还没有生成记录 — 换几套试试。</p>
            )}
          </div>
        </div>
      </div>
    </fieldset>
  );
}
