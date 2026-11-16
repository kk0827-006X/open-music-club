import { AvatarArtwork } from './AvatarArtwork.tsx';
import {
  catalog,
  displaySlots,
  slotNames,
  slotEnglish,
  slotDurations,
  partName,
  type AvatarConfig,
} from './model.ts';

export function AvatarEditor({
  config,
  disabled,
  onChange,
}: {
  config: AvatarConfig;
  disabled: boolean;
  onChange: (config: AvatarConfig) => void;
}) {
  return (
    <fieldset className="view avatar-source-editor" disabled={disabled}>
      <legend className="sr-only">手动换装设置</legend>
      <section className="preview-card">
        <div className="preview-stage">
          <AvatarArtwork config={config} />
        </div>
        <div className="preview-meta">
          <section className="meta-section">
            <h2>
              调色板 <em>Palette</em>
            </h2>
            <p className="hint">
              8
              套莫兰迪主题色板（苔绿/雾蓝/灰紫/暖驼/灰粉/烟青/栗棕/奶咖），切换时所有染色部件按色板替换。
            </p>
            <div className="selector-row" role="radiogroup" aria-label="调色板">
              {catalog.themes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className="palette-chip"
                  role="radio"
                  aria-label={`${theme.name}主题色`}
                  title={`${theme.name}主题色`}
                  aria-checked={config.theme === theme.id}
                  style={{
                    background: `linear-gradient(135deg, ${theme.light} 0%, ${theme.primary} 50%, ${theme.dark} 100%)`,
                  }}
                  onClick={() => onChange({ ...config, theme: theme.id })}
                />
              ))}
            </div>
          </section>
          <section className="meta-section">
            <h2>
              肤色 <em>Skin</em>
            </h2>
            <p className="hint">4 套肤色（浅瓷/暖米/琥珀/深陶），影响脸部、四肢、颈部。</p>
            <div className="selector-row" role="radiogroup" aria-label="肤色">
              {catalog.skins.map((skin) => (
                <button
                  key={skin.id}
                  type="button"
                  className="skin-chip"
                  role="radio"
                  aria-label={`${skin.name}肤色`}
                  title={`${skin.name}肤色`}
                  aria-checked={config.skin === skin.id}
                  style={{ background: skin.color }}
                  onClick={() => onChange({ ...config, skin: skin.id })}
                />
              ))}
            </div>
          </section>
          <section className="meta-section">
            <h2>
              当前穿搭 <em>Now Equipped</em>
            </h2>
            <ul className="current-slots">
              {displaySlots.map((slot) => {
                const part = catalog.parts[slot].find((item) => item.id === config[slot]);
                return (
                  <li key={slot} className={part ? '' : 'empty'}>
                    <div className="slot-thumb">
                      {part && <AvatarArtwork config={config} part={part} />}
                    </div>
                    <div className="slot-info">
                      <strong>
                        {slotNames[slot]} / {slotEnglish[slot]}
                      </strong>
                      <span className="slot-id">{partName(slot, config[slot])}</span>
                    </div>
                    <span className="slot-duration">{slotDurations[slot]}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </section>
      <section className="picker-grid" aria-label="六类部件">
        {displaySlots.map((slot, index) => (
          <div className="slot-card" key={slot}>
            <header>
              <h3>
                <span className="slot-order">#{String(index + 1).padStart(2, '0')}</span>{' '}
                {slotNames[slot]} / {slotEnglish[slot]}
              </h3>
              <button
                type="button"
                className="clear"
                data-clear-slot={slot}
                onClick={() => onChange({ ...config, [slot]: null })}
              >
                清除
              </button>
            </header>
            <div className="options" role="group" aria-label={`${slotNames[slot]}部件`}>
              {catalog.parts[slot].map((part) => (
                <button
                  key={part.id}
                  type="button"
                  className="option"
                  data-avatar-part={part.id}
                  aria-pressed={config[slot] === part.id}
                  onClick={() => onChange({ ...config, [slot]: part.id })}
                >
                  <AvatarArtwork config={config} part={part} label={part.label} />
                  <span>{part.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </fieldset>
  );
}
