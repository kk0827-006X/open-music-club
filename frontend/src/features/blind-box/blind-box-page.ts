import { uiIcons } from '../../shared/ui/icons.ts'
import { escapeHtml } from '../../shared/html.ts'
import {
  createBlindBoxClient,
  toBlindBoxSong,
  type BlindBox,
  type BlindBoxClient,
  type BlindBoxStyle,
  type BlindBoxSummary,
  type BlindBoxTrack,
  type RankingEntry,
  type RankingMetric,
} from '../../services/music/blind-box.ts'
import type { MusicItem } from '../../shared/music.ts'

const COUNT_OPTIONS = [1, 3, 5] as const
// 首屏先用静态风格表渲染，接口返回后再用服务端标签与曲库数量覆盖。
const STYLE_CHIPS: BlindBoxStyle[] = [
  { key: 'all', label: '全部', count: 0 },
  { key: 'pop', label: '流行', count: 0 },
  { key: 'jazz', label: '爵士', count: 0 },
  { key: 'rock', label: '摇滚', count: 0 },
  { key: 'electronic', label: '电子', count: 0 },
  { key: 'folk', label: '民谣', count: 0 },
  { key: 'classical', label: '古典', count: 0 },
  { key: 'hiphop', label: '说唱', count: 0 },
  { key: 'rnb', label: 'R&B', count: 0 },
  { key: 'other', label: '综合', count: 0 },
]
const REEL_TOKENS = ['ALBUM', 'ARTIST', 'STYLE', 'BPM', 'MOOD', 'SIDE A', 'VINYL', 'TRACK']

function two(value: number) {
  return String(value).padStart(2, '0')
}

// SQLite 时间戳是 "YYYY-MM-DD HH:MM:SS"（UTC），只用于列表展示，失败时退回原文。
export function formatStamp(value: string | undefined): string {
  if (!value) return '—'
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return value
  return `${two(date.getMonth() + 1)}.${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

function trackCard(track: BlindBoxTrack, index: number, delay: number) {
  const title = escapeHtml(track.title)
  const cover = escapeHtml(track.coverUrl || '/images/album-placeholder-01.svg')
  return `<article class="blind-box-card" data-blind-box-card="${escapeHtml(track.key)}" style="--card-delay:${delay}ms">
    <div class="blind-box-card-cover"><img src="${cover}" alt="${title} 封面" loading="lazy" /><b>${two(index + 1)}</b></div>
    <p class="blind-box-card-style"><i data-style="${escapeHtml(track.style)}">${escapeHtml(track.styleLabel)}</i><time>${escapeHtml(track.duration)}</time></p>
    <h3>${title}</h3>
    <p class="blind-box-card-artist">${escapeHtml(track.artist)}<span>${escapeHtml(track.album)}</span></p>
    <div class="blind-box-card-actions">
      <button type="button" data-blind-box-play="${escapeHtml(track.key)}" aria-label="播放 ${title}">${uiIcons.play}<span>播放</span></button>
      <button type="button" data-blind-box-enqueue="${escapeHtml(track.key)}" aria-label="将 ${title} 加入队列">${uiIcons.plus}<span>队列</span></button>
    </div>
  </article>`
}

export function boxTracksMarkup(box: BlindBox): string {
  return `<div class="blind-box-result-head"><p>BOX #${two(box.id)} / ${escapeHtml(box.styleLabel)}</p>
      <strong>本次抽到 ${box.tracks.length} 首</strong><span>${escapeHtml(formatStamp(box.createdAt))}</span></div>
    <div class="blind-box-cards">${box.tracks.map((track, index) => trackCard(track, index, index * 70)).join('')}</div>`
}

export function favoritesMarkup(boxes: BlindBoxSummary[], total: number): string {
  if (!boxes.length) {
    return `<p class="blind-box-empty">还没有收藏的盲盒。<br /><span>抽到喜欢的组合后，点「收藏这个盲盒」就会出现在这里。</span></p>`
  }
  return `<ol class="blind-box-favorites">${boxes.map((box, index) => `
    <li>
      <button type="button" class="blind-box-favorite-open" data-blind-box-open="${box.id}" aria-label="打开第 ${index + 1} 个收藏盲盒">
        <span class="blind-box-favorite-index">${two(index + 1)}</span>
        <span class="blind-box-favorite-covers">${(box.covers.length ? box.covers : ['/images/album-placeholder-01.svg']).slice(0, 3)
          .map((cover) => `<img src="${escapeHtml(cover)}" alt="" loading="lazy" />`).join('')}</span>
        <span class="blind-box-favorite-copy"><b>${escapeHtml(box.styleLabel)} · ${box.trackCount} 首</b><small>${escapeHtml(box.titles[0] || '—')}${box.trackCount > 1 ? ' 等' : ''}</small></span>
        <time>${escapeHtml(formatStamp(box.favoritedAt))}</time>
      </button>
      <button type="button" class="blind-box-favorite-remove" data-blind-box-unfavorite="${box.id}" aria-label="取消收藏第 ${index + 1} 个盲盒">${uiIcons.close}</button>
    </li>`).join('')}</ol>
    <p class="blind-box-panel-foot">共 ${total} 个收藏盲盒 · 点击可重新打开</p>`
}

export function rankingMarkup(entries: RankingEntry[], metric: RankingMetric, styleLabel: string): string {
  if (!entries.length) {
    return `<p class="blind-box-empty">榜单还没有数据。<br /><span>${escapeHtml(styleLabel)}盲盒被抽取和收藏后，这里会排出值得听的歌。</span></p>`
  }
  return `<ol class="blind-box-ranking">${entries.map((entry) => `
    <li data-rank="${entry.rank}">
      <span class="blind-box-rank">${two(entry.rank)}</span>
      <img src="${escapeHtml(entry.coverUrl || '/images/album-placeholder-01.svg')}" alt="" loading="lazy" />
      <span class="blind-box-rank-copy"><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.artist)} · ${escapeHtml(entry.styleLabel)}</small></span>
      <span class="blind-box-rank-figures">
        <b title="被收藏次数">${uiIcons.heart}${entry.favoriteCount}</b>
        <small title="被抽取次数">${entry.drawCount}</small>
      </span>
      <button type="button" data-blind-box-rank-play="${escapeHtml(entry.key)}" aria-label="播放 ${escapeHtml(entry.title)}">${uiIcons.play}</button>
    </li>`).join('')}</ol>
    <p class="blind-box-panel-foot">按${metric === 'draw' ? '被抽取次数' : '被收藏次数'}排序 · ${escapeHtml(styleLabel)}</p>`
}

export function createBlindBoxMarkup() {
  return `<section class="blind-box-page" data-blind-box-page hidden inert aria-label="音乐盲盒">
    <header class="blind-box-heading">
      <p>BLIND BOX / RANDOM DRAW 001</p>
      <h2>BLIND BOX <span>/</span> 音乐盲盒</h2>
      <small>不知道听什么的时候，选一个风格，让系统替你从曲库里抽一箱。</small>
    </header>
    <div class="blind-box-controls">
      <div class="blind-box-styles" role="group" aria-label="风格筛选" data-blind-box-styles>
        ${STYLE_CHIPS.map((style, index) => `<button type="button" data-blind-box-style="${style.key}" aria-pressed="${style.key === 'pop'}"><i>${two(index + 1)}</i>${escapeHtml(style.label)}<b data-style-count="${style.key}">—</b></button>`).join('')}
      </div>
      <div class="blind-box-count" role="group" aria-label="每箱歌曲数量"><span>每箱</span>
        ${COUNT_OPTIONS.map((value) => `<button type="button" data-blind-box-count="${value}" aria-pressed="${value === 3}">${value}</button>`).join('')}
        <span>首</span>
      </div>
    </div>
    <section class="blind-box-stage" data-blind-box-stage aria-label="抽取区">
      <div class="blind-box-stage-idle" data-blind-box-idle>
        <p class="blind-box-kicker">READY TO DRAW</p>
        <div class="blind-box-reels" aria-hidden="true"><span data-reel>ALBUM</span><span data-reel>ARTIST</span><span data-reel>STYLE</span><span data-reel>VINYL</span></div>
        <p class="blind-box-hint" data-blind-box-hint>当前风格「流行」，点一下抽取，系统会随机取出 3 首。</p>
        <button type="button" class="blind-box-draw" data-blind-box-draw>${uiIcons.play}<span>抽取盲盒</span><i>PRESS / DRAW</i></button>
      </div>
      <div class="blind-box-stage-drawing" data-blind-box-drawing hidden aria-hidden="true">
        <div class="blind-box-reels"><span data-reel>ALBUM</span><span data-reel>ARTIST</span><span data-reel>STYLE</span><span data-reel>VINYL</span></div>
        <p>正在从曲库里抽取…</p>
      </div>
      <div class="blind-box-stage-result" data-blind-box-result hidden aria-live="polite"></div>
    </section>
    <div class="blind-box-actions" data-blind-box-actions hidden>
      <button type="button" data-blind-box-again>${uiIcons.dice}<span>再抽一箱</span></button>
      <button type="button" data-blind-box-queue-all>${uiIcons.plus}<span>全部入队</span></button>
      <button type="button" data-blind-box-save aria-pressed="false">${uiIcons.heart}<span>收藏这个盲盒</span></button>
      <p data-blind-box-status role="status"></p>
    </div>
    <aside class="blind-box-panel" aria-label="盲盒收藏与榜单">
      <div class="blind-box-tabs" role="tablist" aria-label="盲盒面板">
        <button type="button" role="tab" data-blind-box-tab="favorites" aria-selected="true">我的盲盒</button>
        <button type="button" role="tab" data-blind-box-tab="ranking" aria-selected="false">盲盒榜单</button>
      </div>
      <div class="blind-box-metric" role="group" aria-label="榜单排序" data-blind-box-metric-bar hidden>
        <button type="button" data-blind-box-metric="favorite" aria-pressed="true">被收藏</button>
        <button type="button" data-blind-box-metric="draw" aria-pressed="false">被抽取</button>
      </div>
      <div class="blind-box-panel-body" data-blind-box-panel-body><p class="blind-box-empty">正在读取…</p></div>
      <footer><span data-blind-box-pool>曲库 —</span><span>OMC / BLIND BOX</span></footer>
    </aside>
  </section>`
}

export function mountBlindBoxPage(root: HTMLElement, options: {
  client?: BlindBoxClient
  actions: { play(track: MusicItem): Promise<void> | void; enqueue(track: MusicItem): void }
  onNavigate?: (page: 'upload') => void
  reduced?: boolean
}) {
  root.innerHTML = createBlindBoxMarkup()
  const client = options.client ?? createBlindBoxClient()
  const controller = new AbortController()
  const listen = { signal: controller.signal }
  const page = root.querySelector<HTMLElement>('[data-blind-box-page]')!
  const chipHost = root.querySelector<HTMLElement>('[data-blind-box-styles]')!
  const idle = root.querySelector<HTMLElement>('[data-blind-box-idle]')!
  const drawing = root.querySelector<HTMLElement>('[data-blind-box-drawing]')!
  const result = root.querySelector<HTMLElement>('[data-blind-box-result]')!
  const actionsBar = root.querySelector<HTMLElement>('[data-blind-box-actions]')!
  const status = root.querySelector<HTMLElement>('[data-blind-box-status]')!
  const hint = root.querySelector<HTMLElement>('[data-blind-box-hint]')!
  const drawButton = root.querySelector<HTMLButtonElement>('[data-blind-box-draw]')!
  const saveButton = root.querySelector<HTMLButtonElement>('[data-blind-box-save]')!
  const panelBody = root.querySelector<HTMLElement>('[data-blind-box-panel-body]')!
  const pool = root.querySelector<HTMLElement>('[data-blind-box-pool]')!
  const metricBar = root.querySelector<HTMLElement>('[data-blind-box-metric-bar]')!
  const reduced = options.reduced ?? false

  let styles: BlindBoxStyle[] = STYLE_CHIPS.map((style) => ({ ...style }))
  let style = 'pop'
  let count = 3
  let box: BlindBox | null = null
  let busy = false
  let disposed = false
  let serial = 0
  let tab: 'favorites' | 'ranking' = 'favorites'
  let metric: RankingMetric = 'favorite'
  let favorites: BlindBoxSummary[] = []
  let ranking: RankingEntry[] = []
  let favoritesTotal = 0
  let stylesLoaded = false
  let rankingLoaded = false
  let ticker = 0

  const styleLabel = (key: string) => styles.find((entry) => entry.key === key)?.label ?? '综合'
  const setStatus = (message: string) => { status.textContent = message }
  const findTrack = (key: string) => box?.tracks.find((track) => track.key === key)

  function renderChips() {
    chipHost.innerHTML = styles.map((entry, index) => `<button type="button" data-blind-box-style="${entry.key}" aria-pressed="${entry.key === style}"><i>${two(index + 1)}</i>${escapeHtml(entry.label)}<b data-style-count="${entry.key}">${stylesLoaded ? entry.count : '—'}</b></button>`).join('')
  }

  function renderCount() {
    root.querySelectorAll<HTMLButtonElement>('[data-blind-box-count]').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.blindBoxCount) === count))
    })
    hint.textContent = `当前风格「${styleLabel(style)}」，点一下抽取，系统会随机取出 ${count} 首。`
  }

  function renderStage() {
    const hasBox = Boolean(box)
    idle.hidden = hasBox || busy
    drawing.hidden = !busy
    result.hidden = !hasBox || busy
    actionsBar.hidden = !hasBox
    if (box) {
      result.innerHTML = boxTracksMarkup(box)
      saveButton.setAttribute('aria-pressed', String(box.favorited))
      saveButton.querySelector('span')!.textContent = box.favorited ? '已收藏' : '收藏这个盲盒'
    }
    page.classList.toggle('is-busy', busy)
    drawButton.disabled = busy
  }

  function startTicker() {
    if (reduced) return
    window.clearInterval(ticker)
    const spans = Array.from(drawing.querySelectorAll<HTMLElement>('[data-reel]'))
    spans.forEach((span, index) => { span.textContent = REEL_TOKENS[index % REEL_TOKENS.length] })
    ticker = window.setInterval(() => {
      spans.forEach((span) => { span.textContent = REEL_TOKENS[Math.floor(Math.random() * REEL_TOKENS.length)] })
    }, 90)
  }

  function stopTicker() {
    window.clearInterval(ticker)
    ticker = 0
  }

  function renderPanel() {
    metricBar.hidden = tab !== 'ranking'
    panelBody.innerHTML = tab === 'favorites'
      ? favoritesMarkup(favorites, favoritesTotal)
      : rankingMarkup(ranking, metric, styleLabel(style))
  }

  async function loadStyles() {
    try {
      const data = await client.styles()
      if (disposed) return
      styles = data.styles.length ? data.styles : styles
      stylesLoaded = true
      pool.textContent = `曲库 ${data.total} 首`
      renderChips(); renderCount(); renderPanel()
    } catch (error) {
      if (disposed) return
      pool.textContent = '曲库 —'
      setStatus(error instanceof Error ? error.message : '曲库读取失败')
    }
  }

  async function loadFavorites() {
    try {
      const data = await client.favorites()
      if (disposed) return
      favorites = data.boxes
      favoritesTotal = data.total
      if (tab === 'favorites') renderPanel()
    } catch {
      if (disposed || tab !== 'favorites') return
      panelBody.innerHTML = `<p class="blind-box-empty">收藏读取失败，请稍后刷新。</p>`
    }
  }

  async function loadRanking() {
    try {
      const data = await client.ranking(metric, style)
      if (disposed) return
      ranking = data.entries
      rankingLoaded = true
      if (tab === 'ranking') renderPanel()
    } catch {
      if (disposed) return
      panelBody.innerHTML = `<p class="blind-box-empty">榜单读取失败，请稍后刷新。</p>`
    }
  }

  async function draw() {
    if (busy || disposed) return
    const current = ++serial
    busy = true
    setStatus('正在抽取…')
    renderStage()
    startTicker()
    const startedAt = Date.now()
    try {
      const next = await client.draw(style, count)
      if (disposed || current !== serial) return
      // 动效至少留出可感知的时长，但没有结果时不做无意义等待。
      const remaining = reduced ? 0 : Math.max(0, 620 - (Date.now() - startedAt))
      if (remaining) await new Promise((resolve) => window.setTimeout(resolve, remaining))
      if (disposed || current !== serial) return
      box = next
      busy = false
      stopTicker()
      renderStage()
      setStatus(`已抽到 ${next.tracks.length} 首 · 风格「${next.styleLabel}」`)
      void loadRanking()
    } catch (error) {
      if (disposed || current !== serial) return
      busy = false
      stopTicker()
      box = null
      renderStage()
      const message = error instanceof Error ? error.message : '抽取失败，请稍后重试'
      setStatus(message)
      hint.innerHTML = `${escapeHtml(message)}${options.onNavigate ? ' <button type="button" class="blind-box-inline-link" data-blind-box-upload>去上传音乐</button>' : ''}`
    }
  }

  async function toggleFavorite(id: number, next: boolean) {
    try {
      const updated = next ? await client.favorite(id) : await client.unfavorite(id)
      if (disposed) return
      if (box?.id === updated.id) box = updated
      renderStage()
      setStatus(next ? '已收藏这个盲盒' : '已取消收藏')
      await Promise.all([loadFavorites(), loadRanking()])
    } catch (error) {
      if (disposed) return
      setStatus(error instanceof Error ? error.message : '收藏失败，请稍后重试')
    }
  }

  async function openBox(id: number) {
    try {
      const opened = await client.box(id)
      if (disposed) return
      box = opened
      renderStage()
      setStatus(`已打开收藏的盲盒 #${id}`)
    } catch (error) {
      if (disposed) return
      setStatus(error instanceof Error ? error.message : '打开失败，请稍后重试')
    }
  }

  async function playTrack(track: BlindBoxTrack) {
    setStatus('正在获取播放地址…')
    try {
      await options.actions.play(toBlindBoxSong(track))
      if (!disposed) setStatus('正在播放')
    } catch (error) {
      if (!disposed) setStatus(error instanceof Error ? error.message : '歌曲暂不可播放')
    }
  }

  root.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const styleButton = target.closest<HTMLButtonElement>('[data-blind-box-style]')
    const countButton = target.closest<HTMLButtonElement>('[data-blind-box-count]')
    const tabButton = target.closest<HTMLButtonElement>('[data-blind-box-tab]')
    const metricButton = target.closest<HTMLButtonElement>('[data-blind-box-metric]')
    const playButton = target.closest<HTMLButtonElement>('[data-blind-box-play]')
    const enqueueButton = target.closest<HTMLButtonElement>('[data-blind-box-enqueue]')
    const openButton = target.closest<HTMLButtonElement>('[data-blind-box-open]')
    const removeButton = target.closest<HTMLButtonElement>('[data-blind-box-unfavorite]')
    const rankPlay = target.closest<HTMLButtonElement>('[data-blind-box-rank-play]')

    if (styleButton) {
      style = styleButton.dataset.blindBoxStyle || 'pop'
      root.querySelectorAll('[data-blind-box-style]').forEach((button) => button.setAttribute('aria-pressed', String(button === styleButton)))
      renderCount()
      setStatus(`已切换到「${styleLabel(style)}」`)
      if (tab === 'ranking') { rankingLoaded = false; void loadRanking() }
      return
    }
    if (countButton) {
      count = Number(countButton.dataset.blindBoxCount)
      renderCount()
      return
    }
    if (tabButton) {
      tab = tabButton.dataset.blindBoxTab === 'ranking' ? 'ranking' : 'favorites'
      root.querySelectorAll('[data-blind-box-tab]').forEach((button) => button.setAttribute('aria-selected', String(button === tabButton)))
      if (tab === 'ranking') { metricBar.hidden = false; if (!rankingLoaded) void loadRanking() }
      renderPanel()
      return
    }
    if (metricButton) {
      metric = metricButton.dataset.blindBoxMetric === 'draw' ? 'draw' : 'favorite'
      root.querySelectorAll('[data-blind-box-metric]').forEach((button) => button.setAttribute('aria-pressed', String(button === metricButton)))
      rankingLoaded = false
      void loadRanking()
      return
    }
    if (target.closest('[data-blind-box-draw]') || target.closest('[data-blind-box-again]')) { void draw(); return }
    if (target.closest('[data-blind-box-save]')) {
      if (!box) return
      void toggleFavorite(box.id, !box.favorited)
      return
    }
    if (target.closest('[data-blind-box-queue-all]')) {
      if (!box) return
      box.tracks.forEach((track) => options.actions.enqueue(toBlindBoxSong(track)))
      setStatus(`已把 ${box.tracks.length} 首加入播放队列`)
      return
    }
    if (target.closest('[data-blind-box-upload]')) { options.onNavigate?.('upload'); return }
    if (playButton) {
      const track = findTrack(playButton.dataset.blindBoxPlay || '')
      if (track) void playTrack(track)
      return
    }
    if (enqueueButton) {
      const track = findTrack(enqueueButton.dataset.blindBoxEnqueue || '')
      if (track) { options.actions.enqueue(toBlindBoxSong(track)); setStatus(`已加入队列：${track.title}`) }
      return
    }
    if (rankPlay) {
      const entry = ranking.find((item) => item.key === rankPlay.dataset.blindBoxRankPlay)
      if (entry) {
        void playTrack({
          key: entry.key, source: entry.source, sourceId: entry.sourceId, title: entry.title,
          artist: entry.artist, album: '未归档', coverUrl: entry.coverUrl, durationMs: 0, duration: '—',
          style: entry.style, styleLabel: entry.styleLabel,
        })
      }
      return
    }
    if (openButton) { void openBox(Number(openButton.dataset.blindBoxOpen)); return }
    if (removeButton) { void toggleFavorite(Number(removeButton.dataset.blindBoxUnfavorite), false) }
  }, listen)

  renderChips(); renderCount(); renderStage(); renderPanel()
  void loadStyles(); void loadFavorites()

  return {
    element: page,
    refresh: () => { if (!disposed) { void loadStyles(); void loadFavorites(); if (tab === 'ranking') void loadRanking() } },
    destroy: () => {
      if (disposed) return
      disposed = true
      serial += 1
      stopTicker()
      controller.abort()
      root.replaceChildren()
    },
  }
}
