const assert = require('node:assert/strict')
const { it } = require('node:test')
const { withReactHarness } = require('./helpers/reactHarness')
const song = id => ({ id, name: `歌曲${id}`, ar: [{ name: '歌手' }], al: { name: '专辑' }, dt: 60000 })
it('统一搜索展开最匹配歌手与专辑，歌曲去重、来源分离并按页加载', async () => {
 const { createSongSearch } = await import('../frontend/src/services/music/song-search.ts')
 const calls = []
 const fetcher = async address => {
  calls.push(address); const url = new URL(address, 'http://localhost'); let body
  if (url.pathname === '/api/local/music') body = { success: true, tracks: [{ sourceId:'1',title:'匹配',artists:[],album:{name:'本地'},durationMs:1 }] }
  else if (url.pathname.endsWith('/album')) body = {code:200,songs:[song(1),song(3)]}
  else if (url.pathname.endsWith('/artist/songs')) body = {code:200,songs:[song(1),song(2)],more:false}
  else if (url.searchParams.get('type') === '100') body = {code:200,result:{artists:[{id:10,name:'歌手'}]}}
  else if (url.searchParams.get('type') === '10') body = {code:200,result:{albums:[{id:20,name:'专辑'}]}}
  else body = {code:200,result:{songs:[song(url.searchParams.get('offset') === '0' ? 1 : 4)],songCount:31}}
  return {ok:true,status:200,json:async()=>body}
 }
 const search = createSongSearch('匹配',fetcher)
 const first = await search.next()
 assert.deepEqual(first.items.map(item=>item.key),['netease:1','netease:2','local:1','netease:3'])
 assert.equal(first.hasMore,true); assert.ok(first.items.every(item=>item.kind==='song'))
 const second = await search.next()
 assert.deepEqual(second.items.map(item=>item.key),['netease:4']);assert.equal(second.hasMore,false)
 assert.equal(calls.filter(url=>url.includes('type=100')).length,1)
})
it('搜索来源部分失败时保留其他来源，取消请求不会被当成空结果', async () => {
 const {createSongSearch}=await import('../frontend/src/services/music/song-search.ts')
 const controller=new AbortController()
 const fetcher=async url=>{ if(url==='/api/local/music')return{ok:true,json:async()=>({success:true,tracks:[]})};throw Error('隔离错误') }
 const result=await createSongSearch('词',fetcher).next();assert.match(result.warning,/暂时不可用/)
 controller.abort();await assert.rejects(createSongSearch('词',fetcher,controller.signal).next())
})
it('搜索结果复用队列组件，仅播放和加入歌单，不提供排序清空移除',async()=>{
 await withReactHarness(async h=>{
  const {QueuePanel}=await import('../frontend/src/features/queue/QueuePanel.tsx')
  const calls=[];const item={kind:'song',key:'netease:1',source:'netease',sourceId:'1',title:'歌曲',artist:'歌手',album:'专辑',coverUrl:'',duration:'1:00',year:'',description:''}
  await h.render(h.React.createElement(QueuePanel,{mode:'search',open:true,items:[item],reduced:true,likes:new Map(),pendingLikes:new Set(),orderStatus:'',onClose(){},onFocusToggle(){},onClear(){throw Error('不得清空')},onRemove(){throw Error('不得删除')},onLike(){},onReorder(){throw Error('不得排序')},onPlay:track=>calls.push(['play',track.key]),onSave:track=>calls.push(['save',track.key])}))
  assert.equal(h.query('[data-queue-clear]'),null);assert.equal(h.query('[data-queue-remove]'),null);assert.equal(h.query('[data-queue-like]'),null)
  assert.equal(h.query('[data-queue-drag]'),null)
  await h.click('[data-queue-play]');await h.click('[data-queue-save]');assert.deepEqual(calls,[['play','netease:1'],['save','netease:1']])
 })
})

it('Gooey 仅在非中文组字的 Enter 提交非空关键词，不随输入自动请求', async () => {
 await withReactHarness(async h => {
  const {GooeySearch}=await import('../frontend/src/shared/react/aceternity/GooeySearch.tsx')
  const queries=[]
  await h.render(h.React.createElement(GooeySearch,{onSearch:query=>queries.push(query)}))
  await h.click('[data-nav="search"]')
  const enter=async composing=>h.React.act(async()=>h.require('input').dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:composing})))
  await enter(false);assert.deepEqual(queries,[])
  await h.input('input','  周杰伦  ');assert.deepEqual(queries,[])
  await enter(true);assert.deepEqual(queries,[])
  await enter(false);assert.deepEqual(queries,['周杰伦'])
 })
})
