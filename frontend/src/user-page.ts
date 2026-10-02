import { createPersonalLibraryClient, PersonalLibraryError, toPersonalSong, type PersonalTrack, type UserPlaylist, type UserProfile } from './personal-library-client.ts'
import { safeCoverUrl, type SearchItem } from './music-search.ts'

type Section = 'playlists' | 'favorites' | 'recent' | 'uploads'
const sections: { id: Section; label: string; english: string }[] = [
  { id: 'playlists', label: '歌单', english: 'PLAYLISTS' },
  { id: 'favorites', label: '喜爱', english: 'FAVORITES' },
  { id: 'recent', label: '最近播放', english: 'RECENTLY PLAYED' },
  { id: 'uploads', label: '我的上传', english: 'MY UPLOADS' },
]
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)
const cover = '/images/album-placeholder-01.svg'

export function validateAvatarFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return '请选择 JPG、PNG 或 WebP 图片。'
  if (file.size === 0 || file.size > 5 * 1024 * 1024) return '请选择大小不超过 5 MB 的有效图片。'
  return null
}

export function createUserPageMarkup() {
  return `<section class="user-page" data-user-page hidden inert aria-label="个人音乐空间">
    <aside class="user-sidebar"><p class="user-eyebrow">MEMBER ARCHIVE / 个人音乐空间</p>
      <div class="user-profile"><button type="button" class="user-avatar" data-user-avatar-choose aria-label="选择本地图片作为头像"><span data-user-avatar-placeholder>OMC</span><img data-user-avatar-image hidden alt="用户头像" /><b>更换头像</b><i></i></button><input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" data-user-avatar-file aria-label="选择头像图片" tabindex="-1" /></div>
      <div class="user-identity"><small data-user-nickname>REGISTERED MEMBER / 社区成员</small><p data-user-avatar-feedback role="status">点击头像更换图片</p></div>
      <nav class="user-section-nav" aria-label="个人音乐分类">${sections.map(({ id, label, english }, index) => `<button type="button" data-user-tab="${id}"${index === 0 ? ' aria-current="page"' : ''}><strong>${label}</strong><small>${english}</small><b aria-hidden="true">↗</b></button>`).join('')}</nav>
      <p class="user-sidebar-foot"><i></i> YOUR MUSIC, YOUR ARCHIVE<br />音乐从这里开始归档</p></aside>
    <div class="user-content-shell"><header class="user-content-header"><div><p>PERSONAL COLLECTION / 个人收藏</p><h2 data-user-heading>我的歌单</h2><span data-user-subtitle>把喜欢的音乐，收进自己的档案。</span></div></header>
      <div class="user-content" data-user-content aria-live="polite"><button type="button" data-user-create>新建歌单</button></div>
      <p class="user-preview-note" data-user-feedback role="status">正在读取个人音乐数据…</p></div>
    <dialog class="user-create-dialog" data-user-dialog aria-labelledby="user-dialog-title"><form data-user-create-form><header><span>PERSONAL ARCHIVE</span><button type="button" data-user-dialog-close aria-label="关闭歌单编辑窗口">×</button></header><h2 id="user-dialog-title" data-user-dialog-title>新建歌单</h2><p>保存后，下次登录仍能看到这份声音档案。</p><label for="user-playlist-name">歌单名称</label><input id="user-playlist-name" name="name" maxlength="100" required placeholder="例如：夜晚的留声机" /><p data-user-dialog-feedback role="status"></p><div class="user-dialog-actions"><button type="button" data-user-dialog-cancel>取消</button><button type="submit"><span data-user-dialog-submit>创建歌单</span> <span>→</span></button></div></form></dialog>
  </section>`
}

function pagination(index: number, more: boolean) {
  return `<nav class="user-pagination" aria-label="个人音乐翻页"><button type="button" data-user-page-step="-1" aria-label="上一页"${index === 0 ? ' disabled' : ''}>←</button><span>第 ${index + 1} 页</span><button type="button" data-user-page-step="1" aria-label="下一页"${more ? '' : ' disabled'}>→</button></nav>`
}

export function mountUserPage(host: HTMLElement, options: {
  play?: (song: SearchItem) => Promise<unknown>; enqueue?: (song: SearchItem) => void;
  choosePlaylist?: (song: SearchItem) => void; changed?: () => void;
  client?: ReturnType<typeof createPersonalLibraryClient>
} = {}) {
  const api = options.client || createPersonalLibraryClient()
  host.innerHTML = createUserPageMarkup()
  const page = host.querySelector<HTMLElement>('[data-user-page]')!
  const content = page.querySelector<HTMLElement>('[data-user-content]')!
  const feedback = page.querySelector<HTMLElement>('[data-user-feedback]')!
  const dialog = page.querySelector<HTMLDialogElement>('[data-user-dialog]')!
  const form = page.querySelector<HTMLFormElement>('[data-user-create-form]')!
  const avatarInput = page.querySelector<HTMLInputElement>('[data-user-avatar-file]')!
  const avatarFeedback = page.querySelector<HTMLElement>('[data-user-avatar-feedback]')!
  let section: Section = 'playlists', selectedId: number | null = null, editingId: number | null = null
  let lists: UserPlaylist[] = [], tracks: PersonalTrack[] = [], profile: UserProfile | null = null
  let pageIndex = 0, request = 0, disposed = false, busy = false, loading = false, avatarBusy = false, timer = 0
  const coverCache = new Map<number, string>()
  const notice = (message: string, error = false) => { if (!disposed) { feedback.textContent = message; feedback.dataset.error = String(error) } }
  const applyProfile = (value: UserProfile) => {
    profile = value
    page.querySelector<HTMLElement>('[data-user-nickname]')!.textContent = value.nickname
    const image = page.querySelector<HTMLImageElement>('[data-user-avatar-image]')!
    image.hidden = !value.avatarUrl
    // 头像仅从当前用户的受保护接口读取，不能使用响应中的任意地址。
    if (value.avatarUrl && /^\/api\/me\/avatar\?v=[a-z0-9-]+$/.test(value.avatarUrl)) image.src = value.avatarUrl
    page.querySelector<HTMLElement>('[data-user-avatar-placeholder]')!.hidden = !image.hidden
  }
  const renderTracks = (visible: PersonalTrack[]) => `<div class="user-track-list">${visible.map((track) => {
    const song = toPersonalSong(track)
    return `<article class="user-track-row"><img src="${song.coverUrl}" alt="" loading="lazy" /><div><strong>${escapeHtml(song.title)}</strong><small>${escapeHtml(song.artist)} / ${track.source.toUpperCase()}</small></div><time>${song.duration}</time><div class="user-track-actions"><button type="button" data-user-play="${track.trackKey}"${track.playable ? '' : ' disabled'}>${track.playable ? '播放' : '暂不可用'}</button><button type="button" data-user-enqueue="${track.trackKey}"${track.playable ? '' : ' disabled'}>＋队列</button><button type="button" data-user-save="${track.trackKey}">＋歌单</button><button type="button" data-user-like="${track.trackKey}" aria-pressed="${section === 'favorites' || Boolean(track.liked)}">${section === 'favorites' || track.liked ? '取消喜爱' : '♡ 喜爱'}</button>${selectedId ? `<button type="button" data-user-remove="${track.trackKey}">移除</button>` : ''}</div></article>`
  }).join('') || '<p class="user-data-empty">暂无歌曲。可从播放队列添加歌曲到歌单，或点击歌曲旁的心形收藏。</p>'}</div>`
  const render = () => {
    if (disposed) return
    page.querySelector<HTMLElement>('[data-user-heading]')!.textContent = ({ playlists: '我的歌单', favorites: '我的喜爱', recent: '最近播放', uploads: '我的上传' })[section]
    page.querySelector<HTMLElement>('[data-user-subtitle]')!.textContent = ({ playlists: '把喜欢的音乐，收进自己的档案。', favorites: '那些一次又一次想重听的声音。', recent: '沿着声音，回到刚刚经过的时刻。', uploads: '由你带进社区的每一首音乐。' })[section]
    page.querySelectorAll<HTMLButtonElement>('[data-user-tab]').forEach((button) => {
      if (button.dataset.userTab === section) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    })
    content.classList.remove('is-changing')
    if (section === 'playlists' && selectedId === null) {
      pageIndex = Math.min(pageIndex, Math.max(0, Math.ceil(lists.length / 3) - 1))
      content.innerHTML = `<div class="user-collection-intro"><span>MY PLAYLISTS</span><strong>${lists.length} <small>份声音档案</small></strong></div><div class="user-playlist-grid">${lists.slice(pageIndex * 3, pageIndex * 3 + 3).map((list, index) => `<button type="button" class="user-playlist-card${index === 0 ? ' is-featured' : ''}" data-user-list="${list.id}"><span class="user-playlist-art"><img src="${coverCache.get(list.id) || cover}" alt="" loading="lazy" /></span><span class="user-playlist-meta"><strong>${escapeHtml(list.name)}</strong><small>${list.trackCount} 首歌曲</small><b>↗</b></span></button>`).join('')}<button type="button" class="user-new-card" data-user-create><span>＋</span><strong>新建歌单</strong><small>CREATE A NEW ARCHIVE</small></button></div>${pagination(pageIndex, (pageIndex + 1) * 3 < lists.length)}`
    } else if (section === 'recent') {
      content.innerHTML = '<div class="user-empty-state"><span class="user-empty-symbol">↺</span><h3>播放记录尚未开启</h3><p>历史记录功能将单独接入，不使用临时队列冒充记录。</p></div>'
    } else {
      const list = lists.find((item) => item.id === selectedId)
      const header = list ? `<div class="user-real-list-header"><button type="button" class="user-back" data-user-back>← 返回歌单</button><h3>${escapeHtml(list.name)}</h3><div class="user-list-detail-actions"><button type="button" data-user-rename="${list.id}">重命名</button><button type="button" data-user-delete="${list.id}">删除歌单</button></div></div>` : ''
      const visible = section === 'favorites' ? tracks.slice(0, 5) : tracks.slice(pageIndex * 5, pageIndex * 5 + 5)
      content.innerHTML = `${header}${renderTracks(visible)}${pagination(pageIndex, section === 'favorites' ? tracks.length > 5 : (pageIndex + 1) * 5 < tracks.length)}`
    }
    content.setAttribute('aria-busy', String(loading || busy))
    if (busy || loading) content.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = true })
  }
  const refresh = async () => {
    const current = ++request
    loading = true
    render()
    notice('正在读取个人音乐数据…')
    try {
      const nextProfile = await api.profile()
      if (disposed || current !== request) return
      if (profile && profile.id !== nextProfile.id) { lists = []; tracks = []; selectedId = null; pageIndex = 0; coverCache.clear() }
      applyProfile(nextProfile)
      if (section === 'playlists') {
        const nextLists = await api.playlists()
        const detail = selectedId ? await api.playlist(selectedId) : null
        if (disposed || current !== request) return
        lists = nextLists
        tracks = detail?.tracks || []
        if (detail?.tracks[0]) coverCache.set(detail.playlist.id, safeCoverUrl(detail.tracks[0].coverUrl))
      } else if (section === 'favorites' || section === 'uploads') {
        const nextTracks = section === 'favorites' ? await api.likes(pageIndex * 5) : await api.uploads(nextProfile.id)
        if (disposed || current !== request) return
        tracks = nextTracks
      }
      notice('个人数据已同步 · 重新登录后仍会保留')
      return true
    } catch (error) {
      if (current === request) {
        if (error instanceof PersonalLibraryError && error.status === 401) {
          lists = []; tracks = []; selectedId = null; pageIndex = 0; profile = null; coverCache.clear()
          page.querySelector<HTMLImageElement>('[data-user-avatar-image]')!.hidden = true
          page.querySelector<HTMLElement>('[data-user-avatar-placeholder]')!.hidden = false
          page.querySelector<HTMLElement>('[data-user-nickname]')!.textContent = '会话已失效'
        }
        notice(error instanceof Error ? error.message : '读取失败，请重试', true)
      }
      return false
    }
    finally { if (!disposed && current === request) { loading = false; render() } }
  }
  const mutate = async (action: () => Promise<unknown>, message: string) => {
    if (busy) return
    busy = true
    render()
    try { await action(); if (disposed) return; if (await refresh()) notice(message); options.changed?.() }
    catch (error) { notice(error instanceof Error ? error.message : '保存失败，请重试', true) }
    finally { busy = false; render() }
  }
  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-user-avatar-choose]')) { if (!avatarBusy) avatarInput.click(); return }
    if (target?.closest('[data-user-dialog-close], [data-user-dialog-cancel]')) { dialog.close(); return }
    const tab = target?.closest<HTMLButtonElement>('[data-user-tab]')
    if (tab) {
      section = tab.dataset.userTab as Section; selectedId = null; pageIndex = 0; tracks = []
      request += 1
      content.classList.add('is-changing')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => { render(); void refresh() }, 130)
      return
    }
    if (busy) return
    const step = target?.closest<HTMLButtonElement>('[data-user-page-step]')
    if (step && !step.disabled) { pageIndex += Number(step.dataset.userPageStep); render(); if (section === 'favorites') void refresh(); return }
    const card = target?.closest<HTMLButtonElement>('[data-user-list]')
    if (card) { selectedId = Number(card.dataset.userList); pageIndex = 0; tracks = []; render(); void refresh(); return }
    if (target?.closest('[data-user-back]')) { selectedId = null; pageIndex = 0; render(); void refresh(); return }
    const rename = target?.closest<HTMLButtonElement>('[data-user-rename]')
    if (rename || target?.closest('[data-user-create]')) {
      editingId = rename ? Number(rename.dataset.userRename) : null
      page.querySelector<HTMLElement>('[data-user-dialog-title]')!.textContent = editingId ? '重命名歌单' : '新建歌单'
      page.querySelector<HTMLElement>('[data-user-dialog-submit]')!.textContent = editingId ? '保存名称' : '创建歌单'
      page.querySelector<HTMLElement>('[data-user-dialog-feedback]')!.textContent = ''
      form.reset()
      form.querySelector<HTMLInputElement>('input')!.value = lists.find((item) => item.id === editingId)?.name || ''
      dialog.showModal(); form.querySelector<HTMLInputElement>('input')?.focus(); return
    }
    const remove = target?.closest<HTMLButtonElement>('[data-user-delete]')
    if (remove && window.confirm('删除这份歌单？不会删除音乐文件。')) {
      const id = Number(remove.dataset.userDelete)
      void mutate(async () => { await api.deletePlaylist(id); selectedId = null; pageIndex = 0 }, '歌单已删除'); return
    }
    const action = target?.closest<HTMLButtonElement>('[data-user-play], [data-user-enqueue], [data-user-save], [data-user-like], [data-user-remove]')
    if (!action || action.disabled) return
    const key = Object.values(action.dataset)[0]
    const track = tracks.find((item) => item.trackKey === key)
    if (!track) return
    const song = toPersonalSong(track)
    if (action.hasAttribute('data-user-play')) void options.play?.(song).catch(() => notice('歌曲暂时无法播放，请稍后重试', true))
    else if (action.hasAttribute('data-user-enqueue')) { options.enqueue?.(song); notice('已加入播放队列') }
    else if (action.hasAttribute('data-user-save')) options.choosePlaylist?.(song)
    else if (action.hasAttribute('data-user-like')) {
      const liked = section === 'favorites' || Boolean(track.liked)
      void mutate(() => api.setLiked(track, !liked), liked ? '已取消喜爱' : '已保存到喜爱')
    }
    else if (selectedId) void mutate(() => api.removeTrack(selectedId!, track), '已从歌单移除')
  }
  const onAvatarChange = async () => {
    const file = avatarInput.files?.[0]; avatarInput.value = ''
    if (!file || avatarBusy) return
    const error = validateAvatarFile(file)
    if (error) { avatarFeedback.textContent = error; return }
    avatarBusy = true
    avatarFeedback.textContent = '正在保存头像…'
    try {
      const saved = await api.uploadAvatar(file)
      if (!disposed) { applyProfile(saved); avatarFeedback.textContent = '头像已保存，下次登录仍可见' }
    } catch (error) { if (!disposed) avatarFeedback.textContent = error instanceof Error ? error.message : '头像保存失败' }
    finally { avatarBusy = false }
  }
  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault()
    const name = new FormData(form).get('name')?.toString().trim()
    if (!name || busy) return
    busy = true
    const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!
    submit.disabled = true
    try {
      if (editingId) await api.renamePlaylist(editingId, name)
      else await api.createPlaylist(name)
      if (disposed) return
      dialog.close(); section = 'playlists'; selectedId = null; pageIndex = 0
      if (await refresh()) notice('歌单已保存'); options.changed?.()
    } catch (error) { if (!disposed) page.querySelector<HTMLElement>('[data-user-dialog-feedback]')!.textContent = error instanceof Error ? error.message : '保存失败' }
    finally { busy = false; submit.disabled = false; render() }
  }
  page.addEventListener('click', onClick)
  form.addEventListener('submit', onSubmit)
  avatarInput.addEventListener('change', onAvatarChange)
  render()
  return { refresh, destroy: () => {
    disposed = true; request += 1; window.clearTimeout(timer)
    page.removeEventListener('click', onClick); form.removeEventListener('submit', onSubmit)
    avatarInput.removeEventListener('change', onAvatarChange)
    if (dialog.open) dialog.close()
    host.innerHTML = ''
  } }
}
