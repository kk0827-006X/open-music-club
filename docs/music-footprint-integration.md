# 音乐足迹接入与验收

## 范围与来源

- 集成分支：`codex/music-footprints-integration`，基线 `1c96639204bae2034fdb54c14611585c55bd5007`。
- 功能来源：`cxbcrj/open-music-club-wqh` 的 `8145f62c8671521ba617a4eb3af73825588e2aa8`，根目录内 `music footprint` 接入包。
- 未直接合并整个 Fork、应用整包补丁或覆盖共享文件；未修改 Fork、提交、推送或移动 `main`。
- 状态：后端与 React UI 已实现，本地隔离验收通过。真实公网、生产 Redis、真实网易云可用性仍待部署环境验收。
- 不新增依赖、环境变量、认证方式或通用 UI 库；不改原网易云/本地音源、档案墙算法或播放器动效。

## 适配方式

| Fork 职责 | 当前实现 | 复用/边界 |
| --- | --- | --- |
| 根目录功能包、旧 DOM 挂载页面与六个视图 | `features/footprint/FootprintPage.tsx` | 业务页面由 React 拥有；复用 Icon、IconButton、Modal、usePageVisibility、useLatest 和全站按钮动效 |
| 卡片 SVG 字符串与下载 | `features/footprint/CardArtwork.tsx` | 仅业务卡片图形，不新增通用组件；React 转义文字，不使用 innerHTML；下载后撤销 Object URL |
| 页面导航、主壳、播放器接线 | `app/Workspace.tsx`、`app/App.tsx` 中最小追加 | 现有懒加载/visited/active、MusicActions、唯一 Audio；不恢复旧协调器 |
| 足迹请求和数据 | `services/music/footprint.ts`、`features/footprint/format.ts` | 同源 Session、CSRF、安全错误、AbortSignal；SQLite 无时区时间按 UTC 解析后按站点偏移显示 |
| 表、服务、路由 | `src/db/footprint.js`、`src/services/footprint.service.js`、`src/routes/footprint.routes.js` | SQLite 参数绑定、事务；使用既有 requireLogin、CSRF、脱敏错误和限流工厂 |
| 足迹 CSS、图标 | 专属 `styles/footprint.css`，共享图标只追加 route/comment | 使用现有 Design Tokens；保留旧导出及 React 样式导入，原 2930 条样式基线不变 |

## 数据与权限

启动时幂等创建六张表：

- `playback_events`：按用户、来源和曲目保存开播快照，索引支持时间轴与同曲去重。
- `footprint_notes`：每个事件一篇随笔；复合外键保证随笔与事件属于同一用户。
- `footprint_cards`：标题、事件 ID 和生成时的 JSON 快照。
- `footprint_posts`：用户显式发布的卡片，一张卡片最多一条分享；复合外键保证作者一致。
- `footprint_likes`：成员对分享的唯一点赞。
- `footprint_comments`：分享下的评论。

私有记录、随笔与卡片只能本人访问/修改。显式分享后的卡片和其中随笔才向其他已登录成员可见；广场不是匿名公网入口。分享、卡片和评论仅本人可删除。外键级联清理关联数据。

所有足迹接口均经过现有完整登录检查：密码通过但 2FA 尚未完成、账号被禁用、失效 Session 不得访问。写请求复用全局 CSRF/Origin 检查；不另建登录系统，不放宽 Cookie、CORS、代理或 HTTPS 配置。

新增 `footprint` 限流命名空间：每用户 15 分钟最多 180 次写操作，使用既有生产 Redis Store 工厂；读请求仍受既有全局限流。错误响应保持脱敏，足迹校验错误附带请求 ID。

限制：每用户最多 100000 条开播记录、50 张卡片，每张卡片选择 1–12 条本人记录，每条分享最多 500 条评论。到达上限返回明确错误，不静默删除历史。每页最多 50 条；时间轴 offset 覆盖记录上限，其他列表 offset 最多 10000。

## API

前缀统一为 `/api/footprint`，响应沿用 `{ success, ... }`。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| POST | `/events` | 上报开播；来源 local/netease，正整数 sourceId、标题/歌手/专辑/安全封面与 durationMs |
| GET | `/timeline?limit=&offset=` | 本人事件、随笔、total、timezoneOffsetMinutes |
| PUT / DELETE | `/events/:id/note` | 保存/删除本人随笔 |
| GET | `/milestone` | 次数、曲目/歌手数、日期/连续天数、小时/月分布、最常播放曲目 |
| GET / POST | `/cards` | 分页读取/生成本人卡片 |
| GET / DELETE | `/cards/:id` | 读取/删除本人卡片 |
| GET / POST | `/posts` | 成员广场/显式发布本人卡片 |
| GET | `/posts/mine` | 本人分享 |
| GET / DELETE | `/posts/:id` | 成员可读详情/本人删除；详情带站点偏移及评论删除能力 |
| PUT / DELETE | `/posts/:id/like` | 点赞/取消点赞 |
| GET / POST | `/posts/:id/comments` | 分页读取/新增评论；最多每页 50 条 |
| DELETE | `/comments/:id` | 删除本人评论 |

默认站点偏移为 UTC+8（480 分钟）。时间轴、里程和详情返回偏移，前端不会依赖浏览器所在地进行分组。服务构造参数支持验证后的偏移；本轮不新增环境配置。

## 播放与生命周期

`player-core` 只增加可选成功开播回调，`audio.play()` 成功且仍属于当前请求才通知。App 负责调用足迹客户端；页面通过既有 MusicActions 播放或加入统一队列，不持有音频元素。后台/失败上报不会中断歌曲，退出取消在途上报。

同一用户、同来源、同曲 30 秒内去重；暂停恢复不新增记录。这是开播快照，不是精确收听计量：里程时长沿用原包的曲目全长累计，不表示实际听满的秒数。失败上报没有持久重试，不能作为可靠计费/审计日志。里程榜的播放项使用单曲时长，不能把累计时长再次上报。

足迹页访问后懒加载并保留实例。离页、切视图、卸载时取消请求并隔离迟到响应；后台开播 revision 在写操作结束后再消费，不能中断随笔、分享或评论保存。Modal 复用现有焦点围栏/Escape，不额外创建遮罩系统。评论支持继续分页，窄屏保留横向功能导航。

## 分工与验证（2026-10-23）

后端 Agent 与 React Agent 在独立工作树实现；主 Agent 审查、通过补丁整合至当前工作区、补齐播放器/导航与回归并集中运行验收。代码审查 Agent 与 TypeScript 审查 Agent 完成两轮静态审查。未自动创建提交。

| 检查 | 结果 |
| --- | --- |
| `git diff --check` | 通过 |
| `pnpm build:web` | TypeScript/Vite 通过；仍有既有大型 Three.js chunk 警告 |
| `pnpm test` | 350 项通过，0 失败/跳过（原基线 315 项） |
| `pnpm test:coverage` | 通过；后端 `src/**` lines/statements 97.23%、functions 97.48%、branches 89.22%；不是 React UI 的整体覆盖率 |
| `pnpm test:e2e` | 5 个完整浏览器流程通过，约 2.7 分钟；扩充现有成员旅程，未删除原断言 |
| 截图 | 已检查浅色/深色详情和窄屏时光轴布局；浏览器测试为低 DPR/低画质，不代表默认画质性能基准 |

测试覆盖：正式登录及 2FA、用户隔离/混合卡片拒绝、CSRF/CORS、Redis 限流命名空间及 429、输入/分页边界、重开数据库持久化、级联与容量、时区、真实 React 操作、取消/迟到响应、评论分页、开播回调竞态、revision 不打断写入。浏览器使用真实隔离后端、临时 SQLite、真实 Audio 与合成 WAV/模拟网易云 CDN，验证随笔、卡片、分享、点赞评论、SVG 下载、重新登录恢复，以及现有队列/主题/场景资源回归。

结果保存在被忽略的 `artifacts/footprint-integration/`，截图和浏览器报告在 `artifacts/e2e/`；这些产物不提交。首次测试因沙箱禁止本地 IPC 而未启动，授予本地测试权限后按同一命令运行通过。

足迹页面独立懒加载 chunk 为 26.32 kB（gzip 8.51 kB）。不新增 Audio、WebGL 或动画循环。未做新的设备 CPU/GPU 或大数据压力基准，因此不宣称性能提升。生产 Redis 实连、真实上游/VIP、公网部署以及已有非标准足迹表的升级迁移未验收；本轮按主仓库尚无足迹表的数据库基线接入。
