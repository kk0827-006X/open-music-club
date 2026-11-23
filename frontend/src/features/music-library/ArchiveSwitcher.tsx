import { ARCHIVE_START_ROW, type ArchiveLayout } from '../../rhine/data.ts';
import { Icon } from '../../shared/react/ui.tsx';

const TICKS_PER_SHELF = 8;

export function ArchiveSwitcher({
  active,
  albumCount,
  albumIndex,
  layout,
  selectedRecord,
  navigate,
  selectRecord,
}: {
  active: boolean;
  albumCount: number;
  albumIndex: number;
  layout: ArchiveLayout;
  selectedRecord: number;
  navigate(axis: 'row', direction: number): void;
  selectRecord(index: number): void;
}) {
  const { lane, row } = layout.locations[selectedRecord];
  const position = row - ARCHIVE_START_ROW;
  const tickStart = Math.floor(position / TICKS_PER_SHELF) * TICKS_PER_SHELF;
  return (
    <>
      <aside className="archive-callout">
        <p>ALBUM / SELECT</p>
        <strong data-album-counter>{String(albumIndex + 1).padStart(2, '0')}</strong>
        <span>/ {albumCount}</span>
      </aside>
      <div
        className="archive-switcher"
        aria-label="当前排专辑位置"
        inert={active ? undefined : true}
      >
        <button
          type="button"
          data-album-previous
          aria-label="上一张专辑"
          onClick={() => navigate('row', -1)}
        >
          <Icon name="up" />
        </button>
        <div className="archive-position-ticks">
          {layout.columns[lane]
            .slice(tickStart, tickStart + TICKS_PER_SHELF)
            .map((recordIndex, offset) => (
              <button
                key={recordIndex}
                type="button"
                data-album-tick={tickStart + offset}
                aria-label={`当前排第 ${tickStart + offset + 1} 张专辑`}
                aria-current={recordIndex === selectedRecord ? 'true' : undefined}
                onClick={() => selectRecord(recordIndex)}
              />
            ))}
        </div>
        <button
          type="button"
          data-album-next
          aria-label="下一张专辑"
          onClick={() => navigate('row', 1)}
        >
          <Icon name="down" />
        </button>
      </div>
    </>
  );
}
