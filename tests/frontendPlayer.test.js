const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { describe, it } = require('node:test')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')
const frontendModule = (name) => pathToFileURL(path.join(projectRoot, 'frontend/src', name)).href

describe('底部播放器与歌词画面', () => {
  it('按时间解析多时间戳歌词，忽略元信息与空行', async () => {
    const { parseLyrics, currentLyricIndex } = await import(frontendModule('player-lyrics.ts'))
    const lines = parseLyrics('[ar:歌手]\n[00:01.20][00:03.50]第一句\n[00:07.00]第二句\n[00:09.00]')
    assert.deepEqual(lines, [
      { time: 1.2, text: '第一句' },
      { time: 3.5, text: '第一句' },
      { time: 7, text: '第二句' },
    ])
    assert.equal(currentLyricIndex(lines, 0), -1)
    assert.equal(currentLyricIndex(lines, 4), 1)
    assert.equal(currentLyricIndex(lines, 9), 2)
  })

  it('网易云歌词仅使用现有白名单与同源会话，本地歌曲不请求网易云', async () => {
    const { loadTrackLyrics } = await import(frontendModule('player-lyrics.ts'))
    const calls = []
    const fetcher = async (url, options) => {
      calls.push({ url, options })
      return { ok: true, json: async () => ({ lrc: { lyric: '[00:01.00]测试歌词' } }) }
    }
    assert.deepEqual(await loadTrackLyrics({ source: 'netease', sourceId: '123' }, fetcher), [
      { time: 1, text: '测试歌词' },
    ])
    assert.equal(calls[0].url, '/api/netease/lyric?id=123')
    assert.equal(calls[0].options.credentials, 'same-origin')
    assert.deepEqual(await loadTrackLyrics({ source: 'local', sourceId: '123' }, fetcher), [])
    assert.equal(calls.length, 1)
  })

  it('没有歌词或接口失败时返回空列表，不暴露上游错误', async () => {
    const { loadTrackLyrics } = await import(frontendModule('player-lyrics.ts'))
    assert.deepEqual(await loadTrackLyrics({ source: 'netease', sourceId: '1' }, async () => ({
      ok: false, json: async () => ({ message: '内部错误' }),
    })), [])
    assert.deepEqual(await loadTrackLyrics({ source: 'netease', sourceId: '0' }, async () => {
      throw new Error('不应请求非法 ID')
    }), [])
  })

  it('底栏可从底部唤出，点击展开歌词画面，音量沿用细线进度条视觉', async () => {
    const { createAlbumArchiveMarkup } = await import(frontendModule('album-archive.ts'))
    const markup = createAlbumArchiveMarkup()
    const source = fs.readFileSync(path.join(projectRoot, 'frontend/src/album-archive.ts'), 'utf8')
    const css = fs.readFileSync(path.join(projectRoot, 'frontend/src/style.css'), 'utf8')
    assert.match(markup, /data-player-hotspot/)
    assert.match(markup, /data-player-expanded/)
    assert.match(markup, /data-player-lyrics/)
    assert.match(markup, /data-player-close/)
    assert.match(source, /classList\.toggle\('is-visible', visible \|\| playerExpanded\)/)
    assert.match(css, /\.global-player:not\(\.is-visible\)/)
    assert.match(css, /\.player-volume input::-webkit-slider-runnable-track/)
    assert.match(css, /\.player-expanded\s*\{[^}]*inset: 0 0 106px[^}]*visibility: hidden/)
    assert.match(css, /\.player-expanded::before\s*\{[^}]*transform-origin: (?:center bottom|bottom center)[^}]*transform: scaleY\(0\)[^}]*transition: transform (?:7|8|9)\d\dms/)
    assert.match(css, /\.player-expanded\.is-open::before\s*\{[^}]*transform: scaleY\(1\)/)
    assert.match(css, /\.player-expanded-header,\s*\.player-expanded-content\s*\{[^}]*opacity: 0[^}]*transform: translateY\(/)
    assert.match(css, /\.player-expanded\.is-open \.player-expanded-header,\s*\.player-expanded\.is-open \.player-expanded-content\s*\{[^}]*opacity: 1/)
    assert.match(css, /@media \(max-width: 900px\)\s*\{\s*\.player-expanded\s*\{[^}]*inset: 0 0 76px/)
    assert.match(css, /\.player-expanded\.is-open ~ \.global-player\s*\{[^}]*backdrop-filter: none/)
  })
})
