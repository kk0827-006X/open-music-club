import { demoAlbums } from './album-data.ts'

type Section = 'playlists' | 'favorites' | 'recent' | 'uploads'
type PreviewList = { id: number; title: string; note: string; cover: string }

const sections: { id: Section; number: string; label: string; english: string }[] = [
  { id: 'playlists', number: '01', label: '歌单', english: 'PLAYLISTS' },
  { id: 'favorites', number: '02', label: '喜爱', english: 'FAVORITES' },
  { id: 'recent', number: '03', label: '最近播放', english: 'RECENTLY PLAYED' },
  { id: 'uploads', number: '04', label: '我的上传', english: 'MY UPLOADS' },
]

const initialLists: PreviewList[] = [
  { id: 1, title: '深夜留声', note: '静下来，听见夜晚的形状', cover: demoAlbums[1].coverUrl },
  { id: 2, title: '周末循环', note: '为缓慢的周末留一张唱片', cover: demoAlbums[3].coverUrl },
  { id: 3, title: '沿途风景', note: '路上遇见的声音与故事', cover: demoAlbums[5].coverUrl },
]

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

export function createUserPageMarkup() {
  return `<section class="user-page" data-user-page hidden inert aria-label="个人音乐空间">
    <aside class="user-sidebar">
      <p class="user-eyebrow">MEMBER ARCHIVE / 个人音乐空间</p>
      <div class="user-profile">
        <div class="user-avatar" aria-label="默认用户头像"><span>OMC</span><i></i></div>
        <div><small>REGISTERED MEMBER / 社区成员</small><h2>音乐成员</h2><p>让喜欢的声音，在这里留下痕迹。</p></div>
      </div>
      <nav class="user-section-nav" aria-label="个人音乐分类">${sections.map(({ id, number, label, english }, index) => `
        <button type="button" data-user-tab="${id}"${index === 0 ? ' aria-current="page"' : ''}><span>${number}</span><strong>${label}</strong><small>${english}</small><b aria-hidden="true">↗</b></button>`).join('')}
      </nav>
      <p class="user-sidebar-foot"><i></i> YOUR MUSIC, YOUR ARCHIVE<br />音乐从这里开始归档</p>
    </aside>
    <div class="user-content-shell">
      <header class="user-content-header"><div><p>PERSONAL COLLECTION / 个人收藏</p><h2 data-user-heading>我的歌单</h2><span data-user-subtitle>把喜欢的音乐，收进自己的档案。</span></div><span class="user-preview-tag">UI PREVIEW / 界面预览</span></header>
      <div class="user-content" data-user-content aria-live="polite"></div>
      <p class="user-preview-note">仅供界面预览 · 本页尚未接入个人音乐数据，所有新建与编辑操作刷新后不会保留。</p>
    </div>
    <dialog class="user-create-dialog" data-user-dialog aria-labelledby="user-dialog-title">
      <form method="dialog" data-user-create-form><header><span>PERSONAL ARCHIVE / 01</span><button type="button" data-user-dialog-close aria-label="关闭歌单编辑窗口">×</button></header><h2 id="user-dialog-title" data-user-dialog-title>新建歌单</h2><p>先给这一份声音档案取个名字。</p><label for="user-playlist-name">歌单名称</label><input id="user-playlist-name" name="name" maxlength="40" required placeholder="例如：夜晚的留声机" /><div class="user-dialog-actions"><button type="button" data-user-dialog-cancel>取消</button><button type="submit"><span data-user-dialog-submit>创建预览歌单</span> <span>→</span></button></div></form>
    </dialog>
  </section>`
}

function renderPlaylists(lists: PreviewList[], selectedId: number | null) {
  if (selectedId !== null) {
    const list = lists.find((item) => item.id === selectedId)
    if (!list) return ''
    return `<div class="user-list-detail"><button class="user-back" type="button" data-user-back>← 返回歌单</button><div class="user-list-detail-main"><img src="${list.cover}" alt="${escapeHtml(list.title)} 的示意封面" /><div><small>PLAYLIST / PERSONAL ARCHIVE</small><h3>${escapeHtml(list.title)}</h3><p>${escapeHtml(list.note)}</p><span>界面示例 · 暂无已保存歌曲</span><div class="user-list-detail-actions"><button type="button" data-user-rename="${list.id}">重命名</button><button type="button" data-user-delete="${list.id}">删除预览</button></div></div></div><div class="user-list-empty"><span>01 / TRACKS</span><p>歌单还是空的。接入个人音乐数据后，可以从歌曲或播放队列添加。</p></div></div>`
  }
  return `<div class="user-collection-intro"><span>01 / MY PLAYLISTS</span><strong>${String(lists.length).padStart(2, '0')} <small>份声音档案示意</small></strong></div><div class="user-playlist-grid">${lists.map((list, index) => `<button type="button" class="user-playlist-card${index === 0 ? ' is-featured' : ''}" data-user-list="${list.id}"><span class="user-playlist-art"><img src="${list.cover}" alt="" loading="lazy" /><i>PREVIEW / ${String(index + 1).padStart(2, '0')}</i></span><span class="user-playlist-meta"><strong>${escapeHtml(list.title)}</strong><small>${escapeHtml(list.note)}</small><b aria-hidden="true">↗</b></span></button>`).join('')}<button type="button" class="user-new-card" data-user-create><span>＋</span><strong>新建歌单</strong><small>CREATE A NEW ARCHIVE</small></button></div>`
}

function renderEmpty(section: Exclude<Section, 'playlists'>) {
  const copy = {
    favorites: ['还没有喜欢的歌曲', '接入收藏数据后，你喜欢的每一首歌都会在这里出现。', '♡'],
    recent: ['播放记录尚未开启', '这里不会用临时播放队列冒充最近播放；历史记录功能将单独接入。', '↺'],
    uploads: ['我的上传尚未接入', '以后你上传的本地音乐会集中陈列于此，权限仍由服务端检查。', '↑'],
  }[section]
  return `<div class="user-empty-state"><span class="user-empty-symbol" aria-hidden="true">${copy[2]}</span><small>NO RECORDS / 暂无内容</small><h3>${copy[0]}</h3><p>${copy[1]}</p><div class="user-empty-rule"><i></i><span>OPEN MUSIC CLUB</span><i></i></div></div>`
}

export function mountUserPage(host: HTMLElement) {
  host.innerHTML = createUserPageMarkup()
  const page = host.querySelector<HTMLElement>('[data-user-page]')!
  const content = page.querySelector<HTMLElement>('[data-user-content]')!
  const dialog = page.querySelector<HTMLDialogElement>('[data-user-dialog]')!
  const form = page.querySelector<HTMLFormElement>('[data-user-create-form]')!
  let section: Section = 'playlists'
  let selectedId: number | null = null
  let lists = [...initialLists]
  let nextId = 4
  let editingId: number | null = null
  let changeTimer = 0

  const render = () => {
    const active = sections.find((item) => item.id === section)!
    page.querySelector<HTMLElement>('[data-user-heading]')!.textContent = ({ playlists: '我的歌单', favorites: '我的喜爱', recent: '最近播放', uploads: '我的上传' })[section]
    page.querySelector<HTMLElement>('[data-user-subtitle]')!.textContent = ({ playlists: '把喜欢的音乐，收进自己的档案。', favorites: '那些一次又一次想重听的声音。', recent: '沿着声音，回到刚刚经过的时刻。', uploads: '由你带进社区的每一首音乐。' })[section]
    page.querySelectorAll<HTMLButtonElement>('[data-user-tab]').forEach((button) => {
      if (button.dataset.userTab === active.id) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    })
    content.classList.remove('is-changing')
    content.innerHTML = section === 'playlists' ? renderPlaylists(lists, selectedId) : renderEmpty(section)
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null
    const tab = target?.closest<HTMLButtonElement>('[data-user-tab]')
    if (tab) {
      const next = tab.dataset.userTab as Section
      if (next === section && selectedId === null) return
      content.classList.add('is-changing')
      section = next
      selectedId = null
      window.clearTimeout(changeTimer)
      changeTimer = window.setTimeout(render, 130)
      return
    }
    if (target?.closest('[data-user-create]')) {
      editingId = null
      page.querySelector<HTMLElement>('[data-user-dialog-title]')!.textContent = '新建歌单'
      page.querySelector<HTMLElement>('[data-user-dialog-submit]')!.textContent = '创建预览歌单'
      form.reset()
      dialog.showModal()
      form.querySelector<HTMLInputElement>('input')?.focus()
      return
    }
    if (target?.closest('[data-user-dialog-close], [data-user-dialog-cancel]')) { dialog.close(); return }
    const card = target?.closest<HTMLButtonElement>('[data-user-list]')
    if (card) { selectedId = Number(card.dataset.userList); render(); return }
    if (target?.closest('[data-user-back]')) { selectedId = null; render(); return }
    const rename = target?.closest<HTMLButtonElement>('[data-user-rename]')
    if (rename) {
      const item = lists.find((entry) => entry.id === Number(rename.dataset.userRename))
      if (!item) return
      editingId = item.id
      page.querySelector<HTMLElement>('[data-user-dialog-title]')!.textContent = '重命名歌单'
      page.querySelector<HTMLElement>('[data-user-dialog-submit]')!.textContent = '保存预览名称'
      form.querySelector<HTMLInputElement>('input')!.value = item.title
      dialog.showModal()
      form.querySelector<HTMLInputElement>('input')?.focus()
      return
    }
    const remove = target?.closest<HTMLButtonElement>('[data-user-delete]')
    if (remove) { lists = lists.filter((entry) => entry.id !== Number(remove.dataset.userDelete)); selectedId = null; render() }
  }
  const onSubmit = (event: SubmitEvent) => {
    event.preventDefault()
    const name = new FormData(form).get('name')?.toString().trim()
    if (!name) return
    if (editingId !== null) {
      const item = lists.find((entry) => entry.id === editingId)
      if (item) item.title = name.slice(0, 40)
    } else {
      const id = nextId++
      lists = [{ id, title: name.slice(0, 40), note: '刚刚创建的空歌单 · 仅在本次预览显示', cover: '/images/album-placeholder-01.svg' }, ...lists]
      selectedId = id
    }
    dialog.close()
    form.reset()
    editingId = null
    section = 'playlists'
    render()
  }
  page.addEventListener('click', onClick)
  form.addEventListener('submit', onSubmit)
  render()
  return { destroy: () => { window.clearTimeout(changeTimer); page.removeEventListener('click', onClick); form.removeEventListener('submit', onSubmit); if (dialog.open) dialog.close(); host.innerHTML = '' } }
}
