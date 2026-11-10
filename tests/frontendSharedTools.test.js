const assert = require('node:assert/strict');
const { it } = require('node:test');

it('统一封面回退只替换一次，不反复加载已失败的占位图', async () => {
  const { FALLBACK_COVER } = await import('../frontend/src/shared/music.ts');
  const { replaceBrokenCover } = await import('../frontend/src/shared/react/image.ts');
  let src = 'https://p1.music.126.net/broken.jpg',
    assignments = 0;
  const image = {
    get src() {
      return src;
    },
    set src(value) {
      src = value;
      assignments++;
    },
  };
  replaceBrokenCover({ currentTarget: image });
  assert.equal(src, FALLBACK_COVER);
  replaceBrokenCover({ currentTarget: image });
  assert.equal(assignments, 1);
});

it('公共时长工具保留秒和毫秒单位、分钟跨小时及各入口的边界策略', async () => {
  const { formatDurationSeconds, formatDurationMs, formatPlaybackTime, formatTrackDuration } =
    await import('../frontend/src/shared/format.ts');
  assert.equal(formatDurationSeconds(65), '1:05');
  assert.equal(formatDurationSeconds(61.5), '1:1.5');
  assert.equal(formatDurationMs(65999), '1:05');
  assert.equal(formatDurationMs(3600000), '60:00');
  assert.equal(formatPlaybackTime(65.9), '1:05');
  assert.equal(formatPlaybackTime(NaN), '0:00');
  assert.equal(formatPlaybackTime(Infinity), '0:00');
  assert.equal(formatPlaybackTime(-Number.MIN_VALUE), '0:-1');
  assert.equal(formatDurationMs(-1000), '-1:-1');
  assert.equal(formatTrackDuration(-1000), '0:00');
  assert.equal(formatTrackDuration(65000), '1:05');
});

it('搜索和专辑保留各自的无效时长回退，个人歌曲和足迹仍保留来源', async () => {
  const { toLocalSearchItems } = await import('../frontend/src/services/music/search.ts');
  const { fetchAlbumTracks } = await import('../frontend/src/services/music/albums.ts');
  const { toPersonalSong } = await import('../frontend/src/services/music/personal-library.ts');
  const { toFootprintSong } = await import('../frontend/src/features/footprint/format.ts');
  const track = {
    source: 'local',
    sourceId: '2',
    trackKey: 'local:2',
    title: '隔离曲目',
    artist: '歌手',
    artists: [{ name: '歌手' }],
    album: { name: '专辑' },
    durationMs: 65000,
    coverUrl: null,
  };
  const personal = toPersonalSong(track);
  assert.equal(personal.duration, '1:05');
  assert.equal(personal.source, 'local');
  assert.equal(toFootprintSong({ ...track, album: '专辑' }).duration, '1:05');
  for (const durationMs of [-1, NaN, Infinity, undefined]) {
    assert.equal(
      toLocalSearchItems([{ ...track, durationMs }]).find((item) => item.kind === 'song').duration,
      '—',
    );
  }
  const album = await fetchAlbumTracks('12', async () => ({
    ok: true,
    json: async () => ({
      code: 200,
      songs: [
        { id: 1, name: '有效曲目', dt: 65000 },
        { id: 2, name: '未知时长', dt: -1 },
      ],
    }),
  }));
  assert.deepEqual(
    album.map((item) => item.duration),
    ['1:05', '0:00'],
  );
});
