音乐盲盒（Blind Box）功能设计与实现
面向「不知道想听什么」的选择困难：用户选一个风格，系统从曲库随机抽一箱歌；喜欢的组合可以整箱收藏，站内按「被收藏次数 / 被抽取次数」排出盲盒榜单。
1. 功能价值
问题
本功能的做法
打开 App 不知道听什么
一键随机抽取，把「选择」变成「发现」
随机太散、听不下去
风格标签（流行/爵士/摇滚/电子/民谣/古典/说唱/R&B/综合）先收窄范围
抽到好组合想留住
「收藏这个盲盒」整箱保存，随时重新打开
不知道别人觉得什么好
盲盒榜单：按被收藏次数、被抽取次数排序
2. 页面结构
盲盒与「音乐库 / 搜索 / 上传 / 用户」同级，是工作区里的一个页面（不是新窗口、不重挂播放器）。
┌───────────────────────────────────────────────┬───────────────────┐
│ BLIND BOX / RANDOM DRAW 001                   │  我的盲盒 │ 盲盒榜单 │
│ BLIND BOX / 音乐盲盒                           │  ───────────────  │
│ 不知道听什么的时候，选一个风格…                 │  [被收藏][被抽取]  │
│                                               │  01 🖼 清晨的雨 ♥68 │
│ 01全部 02流行 03爵士 04摇滚 05电子 …   每箱 1 3 5 │  02 🖼 午夜蓝调 ♥54 │
│ ─────────────────────────────────────────────  │  03 🖼 五分拍   ♥41 │
│ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐  │  …                │
│ │ BOX #42 / 爵士        本次抽到 5 首  10.21 │  │                   │
│ │ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐        │  │                   │
│ │ │ 01 │ │ 02 │ │ 03 │ │ 04 │ │ 05 │        │  │                   │
│ │ │封面│ │封面│ │封面│ │封面│ │封面│        │  │                   │
│ │ │标题│ …                                  │  │                   │
│ │ └────┘ └────┘ └────┘ └────┘ └────┘        │  │                   │
│ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘  │                   │
│ [再抽一箱] [全部入队] [♡ 收藏这个盲盒]   状态   │ 曲库 1284 首  OMC │
└───────────────────────────────────────────────┴───────────────────┘
- 左侧三行：标题 / 风格与数量控制 / 抽取区（空态、摇盒、结果三态共用一块虚线「箱子」）。
- 右侧一整列：收藏与榜单共用一个面板，通过 Tab 切换，榜单再切换排序口径。
- 移动端（≤1080px）折叠为单列，面板沉到页面底部并限制高度。
3. 交互与状态
状态
表现
空态
转轮占位 + 「抽取盲盒」主按钮，提示当前风格与数量
抽取中
转轮上下跳动（prefers-reduced-motion 时静止），按钮禁用，结果区隐藏
结果
卡片按 70ms 依次入场，顶部显示箱号、风格、时间；底部操作条出现
曲库为空
409 文案 + 「去上传音乐」直达上传页
收藏
按钮 aria-pressed 与文案同步（收藏这个盲盒 / 已收藏），榜单与收藏列表刷新
打开收藏箱
点击收藏条目把整箱重新载入抽取区（不消耗抽取次数）
数量 1/3/5 首；同一风格连续抽取时，若曲库足够（≥ 2×数量）会避开上一箱的曲目。
4. 数据模型（SQLite，随 initializeSchema 建立）
表
作用
关键字段
blind_box_tracks
标签目录 / 网易云候选缓存
source+source_id+style 唯一，tag_source 记录标签来源（genre / keyword）
blind_box_draws
一次抽取（一个盲盒）
user_id、style、track_count、created_at
blind_box_draw_items
盲盒曲目快照
draw_id+position 主键，冗余标题/歌手/封面，曲目下架后仍可展示
blind_box_favorites
用户—盲盒关联表
user_id+draw_id 主键，天然幂等
blind_box_track_stats
榜单统计
source+source_id+style 主键，draw_count / favorite_count
另外 uploaded_music 增加 genre 列（老库用 ALTER TABLE ADD COLUMN 补齐），上传时从音频元数据写入，作为本地曲目的风格标签；标签缺失的曲目归入「综合」。
写入策略：
- 抽取：一次事务里写 draws + items，并对每首曲目 UPSERT 累加 draw_count。
- 收藏：INSERT OR IGNORE，仅在首次插入时给箱内每首 favorite_count + 1；取消收藏回落（下限 0）。
- 清理：非收藏的历史只保留最近 100 箱；删除本地歌曲时同步清理它的标签与统计，避免榜单指向失效文件。
5. 接口（均需登录，挂在 /api/me 下并沿用个人音乐库限流）
方法
路径
说明
GET
/blind-box/styles
风格标签与各风格曲库数量、总量
POST
/blind-box/draw
{ style, count } → 201 + 盲盒（含曲目）
GET
/blind-box/boxes
我收藏的盲盒（分页，含封面缩略与曲目数）
GET
/blind-box/boxes/:id
单个盲盒详情（仅本人）
POST
/blind-box/boxes/:id/favorite
收藏；重复调用幂等
DELETE
/blind-box/boxes/:id/favorite
取消收藏
GET
/blind-box/ranking?metric=favorite|draw&style=&limit=
榜单
所有响应 Cache-Control: no-store；错误只返回脱敏文案（400/401/404/409/502）。
6. 抽取规则
1. 取池：本地曲目按 genre → 风格 映射命中；网易云候选从 blind_box_tracks 缓存读取。全部 风格是两者并集。
2. 补池：某风格命中数不足 30 且缓存过期（24h）时，用该风格的检索关键词调用一次已有的 search 模块补充候选；上游失败只影响候选数量，不阻断本地抽取（进程内还有 5 分钟冷却，避免打爆上游）。
3. 抽样：部分 Fisher–Yates，只洗前 N 个位置；随机源可注入，便于测试。
4. 防重复：池子 ≥ 2×数量时排除用户上一箱的曲目。
5. 写记录：事务内落库并累加统计，返回带风格的曲目列表。
风格标签是产品自定义口径：本地曲目来自音频 genre 元数据；网易云曲目来自风格关键词检索（tag_source = 'keyword'），不是官方曲风分类，因此榜单和数量都是「标签命中」意义上的统计。
7. 榜单口径
- metric=favorite：先按 SUM(favorite_count)，再按 SUM(draw_count)。
- metric=draw：先按 SUM(draw_count)，再按 SUM(favorite_count)。
- style=all 时按 source+source_id 聚合（同一首歌可能带多个风格标签），否则只看该风格。
8. 安全与权限
- 所有接口经 requireLogin；POST/DELETE 走既有 CSRF 与按用户限流。
- 盲盒只能由抽取者打开/收藏/取消收藏，非本人一律 404（不泄漏存在性）。
- 曲目封面沿用 safeCoverUrl 白名单（music.126.net 或本地 /api/local/music/<id>/cover），CSP 无需新增来源。
- 前端所有插值走 escapeHtml，不拼接未转义的标题/歌手。
9. 可访问性与主题
- 风格、数量、榜单口径都是 aria-pressed 按钮组；Tab 使用 role="tab" + aria-selected。
- 结果区 aria-live="polite"，操作条有 role="status" 文案。
- 颜色只使用 theme.css 既有语义色号，浅色/深色自动生效；blind-box.css 中无硬编码色值。
- prefers-reduced-motion 下关闭转轮、卡片入场与页面过渡。
10. 代码位置
src/db/database.js                     新增 5 张表 + uploaded_music.genre 迁移
src/db/blindBox.js                     盲盒数据访问（取池、记录、统计、榜单、清理）
src/services/blindBox.service.js       风格映射、抽样、补池、收藏、榜单
src/routes/blindBox.routes.js          /api/me/blind-box/* 路由与参数校验
src/services/metadata.service.js       读取音频 genre
src/services/localMusic.service.js     上传写入 genre；删歌时清理盲盒数据
frontend/src/services/music/blind-box.ts       客户端（CSRF、错误脱敏、曲目模型）
frontend/src/features/blind-box/blind-box-page.ts  页面与交互
frontend/src/styles/blind-box.css      页面样式（import 在 responsive 之前）
frontend/src/app/{navigation,workspace-view,music-workspace}.ts  页面注册
tests/blindBox.test.js                 抽样规则、接口、榜单、权限、删除清理
tests/frontendBlindBox.test.js         播放模型、CSRF、转义、样式约束
11. 验证结果
已执行（本机 Node 22 + 真实 SQLite）：
- tests/blindBox.test.js：10 项全部通过。
- tests/frontendBlindBox.test.js：7 项全部通过。
- 回归：database、personalLibrary、playbackQueue、userProfile、security、twoFactor、auth、applications、mail、redis、frontendAlbumArchive、frontendIcons 全部通过。
- 样式基线：剔除 blind-box.css 后原 12 个片段的声明数仍为 2930、哈希仍为 bcee3880…，未改动既有版式。
- localMusic 仅列结构断言按新列更新；frontendStyles 基线改为排除新页面片段。
未能在本机执行（环境限制，非代码问题）：
- pnpm install / pnpm build:web：vendor/api-enhanced 是空的 git 子模块，工作区依赖无法解析；本轮用本地占位模块 + NODE_PATH 跑测试。
- 依赖 jsdom / three / vite / typescript 的前端测试（frontendWorkspace、frontendNavigation、frontendTheme、frontendStyles、frontendGraphicsResources 等）需要 frontend/node_modules。
- 真实网易云上游与浏览器端联调（点击抽取、动效、播放）未做端到端验收。
请在合并前执行：
pnpm install
pnpm build:web
pnpm test
12. 已知边界与后续
- 网易云候选按关键词打标，覆盖面取决于上游检索结果；如需精确曲风，应引入可维护的曲风标签表或人工维护歌单。
- 榜单是「站内行为」排行，冷启动期数据稀疏，后续可按时间窗口（近 7 天）分桶。
- 「收藏盲盒」目前是整箱维度，暂不支持单曲收藏（复用播放器底栏的喜欢即可）。
- 未做抽取历史列表（只保留最近 100 箱用于防重复），需要「最近抽过」时可加一个只读接口。