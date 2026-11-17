import { useEffect, useState } from 'react';
import { AvatarArtwork } from './AvatarArtwork.tsx';
import { catalog, partName, type AvatarConfig, type AvatarOutfit } from './model.ts';

export function OutfitLibrary({
  outfits,
  disabled,
  onEdit,
  onSelect,
  onRemove,
}: {
  outfits: AvatarOutfit[];
  disabled: boolean;
  onEdit: (config: AvatarConfig) => void;
  onSelect: (id: number) => Promise<boolean>;
  onRemove: (id: number) => Promise<boolean>;
}) {
  const [armed, setArmed] = useState<number | null>(null);
  useEffect(() => {
    if (armed === null) return;
    const timer = setTimeout(() => setArmed(null), 3200);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <section className="view" aria-label="我的形象">
      <div className="saved-grid">
        {outfits.map((outfit) => {
          const theme = catalog.themes.find((item) => item.id === outfit.config.theme)!;
          return (
            <article
              key={outfit.id}
              className={`saved-card${outfit.current ? ' is-current' : ''}`}
              data-avatar-outfit={outfit.id}
            >
              <div className="saved-thumb">
                <AvatarArtwork config={outfit.config} label={outfit.name} />
              </div>
              <div className="saved-body">
                <header>
                  <h4>{outfit.name}</h4>
                  {outfit.current && <span className="saved-badge">当前</span>}
                </header>
                <p className="saved-meta">
                  <span className="dot" style={{ background: theme.primary }} />
                  {theme.name}主题 · {outfit.createdAt}
                </p>
                <p className="saved-parts">
                  {(['top', 'bottom', 'shoes', 'accessory'] as const)
                    .map((slot) => partName(slot, outfit.config[slot]))
                    .join(' / ')}
                </p>
                <div className="saved-actions">
                  <button
                    className="btn btn--tiny btn--primary"
                    type="button"
                    disabled={disabled}
                    onClick={() => onEdit(outfit.config)}
                  >
                    套用
                  </button>
                  <button
                    className="btn btn--tiny"
                    type="button"
                    disabled={disabled || outfit.current}
                    onClick={() => void onSelect(outfit.id)}
                  >
                    设为当前
                  </button>
                  <button
                    className={`btn btn--tiny btn--ghost${armed === outfit.id ? ' is-armed' : ''}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (armed !== outfit.id) {
                        setArmed(outfit.id);
                        return;
                      }
                      void onRemove(outfit.id).then((removed) => {
                        if (removed) setArmed(null);
                      });
                    }}
                  >
                    {armed === outfit.id ? '确认删除' : '删除'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!outfits.length && (
        <div className="saved-empty">
          <p className="saved-empty-title">还没有保存的形象</p>
          <p className="hint">在「换装工坊」或「自动换装」里搭配好，点右上角「保存形象」。</p>
        </div>
      )}
    </section>
  );
}
