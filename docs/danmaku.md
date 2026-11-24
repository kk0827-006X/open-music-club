# 音乐热梗弹幕（Danmaku Wall + 播放器内嵌弹幕）

主打年轻化和社区互动：听歌时发一条弹幕（如「高能预警！」「这段吉他绝了」），系统记录当时的播放进度；别人听到同一秒时，这条弹幕准时从右往左飘过。弹幕支持**文字 / 图片**（同一板块，选图可配文）和**语音**两种形式。

## 功能总览

| 能力 | 说明 |
| --- | --- |
| 播放器内嵌弹幕 | 展开播放器右列顶部有「歌词 / 弹幕」切换开关；选弹幕后歌词区变成弹幕墙，弹幕从右向左飘过（约 9 秒），6 条泳道轮转 |
| 弹幕形式 | 播放器内嵌发送区只有两个板块：「文字 / 图片」（不选图发纯文字；选图后输入框变配文，图片带配文一起飘出）和「语音」（浏览器录音，最长 60 秒，气泡带声波动画，点击播放）。图片以卡片形式飘过 |
| 独立弹幕墙 | 弹幕墙整页：影院级大屏舞台，弹幕从右向左飘过，7 条泳道轮转，最多同时 40 条 |
| 时间戳定位 | 发送时记录 `position_ms`（当前播放进度，钳制在歌曲时长内）；进度推进到该时间戳时准时触发 |
| 拖动保护 | 一次进度跳变超过 5 秒（拖进度条/切歌）视为「错过」，不回放旧弹幕，避免刷屏 |
| 全站实时流 | 弹幕墙右侧栏展示跨歌曲的最新弹幕（`GET /api/me/danmaku/recent`），不播放歌曲也有内容可看，12 秒增量刷新 |
| 直达地址 | 支持页内 hash 路由：`#/danmaku` 直接打开弹幕墙（`#/blindbox`、`#/search` 等同理），刷新/分享链接落在同一页 |
| 弹幕开关 | 一键开关，关闭后舞台不再起飞新弹幕（时间轴列表仍可读）；开关/透明度/屏蔽词与内嵌弹幕共享同一份设置 |
| 透明度调节 | 20%–100% 滑杆，实时生效 |
| 关键词屏蔽 | 用户自选屏蔽词（逗号/顿号/换行分隔，忽略大小写），舞台与时间轴同时过滤，并提示隐藏条数 |
| 设置持久化 | 开关/透明度/屏蔽词存 `localStorage`（key `open-music-club.danmaku.settings`），隐私模式静默跳过 |
| 发送限速 | 同一用户 2 秒内只能发一条（服务端强校验，返回 429） |
| 撤回 | `DELETE /api/me/danmaku/:id` 只能删自己的；删他人返回 403 |

## 后端

- **表**：`danmaku_messages`（`src/db/danmaku.js` 初始化；`kind` 列区分 `text / voice / image`，`media_path`、`media_duration_ms` 存媒体信息；老库自动 `ALTER TABLE` 补列，无需删库重建；含 `(track_source, track_source_id, position_ms)` 与 `(user_id, created_at)` 两个索引）
- **服务**：`src/services/danmaku.service.js`——内容校验（去控制字符、1–60 字）、kind 校验、媒体文件名白名单（UUID + 扩展名）、语音时长 ≤60s、进度钳制、2 秒限速、错误脱敏
- **媒体上传**：`src/middleware/danmakuMediaGuard.js`（multer，白名单：语音 webm/mp3/ogg/m4a/wav、图片 jpg/png/webp/gif，单文件 ≤8MB），文件落在 `storage/danmaku/`
- **路由**：`src/routes/danmaku.routes.js`，挂在 `/api/me`（需登录），`Cache-Control: no-store`

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/me/danmaku?source=local&sourceId=8&afterId=0&limit=500` | 拉一首歌的弹幕时间轴；`afterId` 用于增量轮询 |
| GET | `/api/me/danmaku/recent?afterId=0&limit=30` | 全站实时弹幕流（跨歌曲，按 id 倒序），`afterId` 用于增量轮询 |
| POST | `/api/me/danmaku/media` | 上传语音/图片（multipart `file` 字段），返回 `{ path, kind, durationMs, url }` |
| GET | `/api/me/danmaku/media/:name` | 读取弹幕媒体（需登录，文件名必须是上传返回的 UUID 形式） |
| POST | `/api/me/danmaku` | 发送 `{ track, content, positionMs, durationMs, kind, mediaPath, mediaDurationMs }`；语音/图片先传媒体再带 `mediaPath` 发送，附言可空（服务端用类型占位） |
| DELETE | `/api/me/danmaku/:id` | 撤回自己的弹幕 |

### 为什么用轮询而不是 WebSocket

当前后端是 Express 单体 + better-sqlite3，没有 sticky-session / Redis pub/sub 基建；弹幕的同步粒度是「播放秒级进度」，前端以 `timeupdate`（约 250ms）驱动触发，配合 12–15 秒增量轮询即可秒级看到新弹幕，且断线自动恢复、无状态可水平扩展。接口结构（按 track + position 存取）已为 WebSocket 推送预留，后续可平滑升级。

## 前端

- **播放器内嵌弹幕**：`frontend/src/features/player/PlayerDanmaku.tsx`，由 `PlayerView.tsx` 在展开播放器右列按「歌词 / 弹幕」开关挂载；进度、暂停状态直接来自播放器状态，切歌自动重载时间轴
- **独立弹幕墙页面**：`frontend/src/features/danmaku/DanmakuPage.tsx`，注册为 Tab「弹幕墙」（`Workspace.tsx`），支持 `#/danmaku` hash 直达；通过 props 注入 `PlayerController`，与播放页共享同一播放状态
- **触发核心**：`dueMessages(messages, lastMs, currentMs)` 纯函数（可测试）；进度按 `timeupdate` 推进，跨过弹幕 `positionMs` 即起飞
- **接口适配**：`frontend/src/services/music/danmaku.ts`——`trackRefOf` 从播放条目 key 还原歌曲标识（`local:8` / `netease:song:11`），`uploadMedia` 走 CSRF + FormData 上传
- **样式**：`frontend/src/styles/danmaku.css`（弹幕墙 `danmaku-drift` 与内嵌弹幕 `player-dm-drift` 两套关键帧，`prefers-reduced-motion` 时缩短/停用动画）
- 语音播放用组件内独立的隐藏 `<audio>`，不占用播放器唯一的 Audio 实例

## 测试

- `tests/danmaku.test.js`：11 项（发送/校验/限速/增量拉取/全站实时流/越权删除/未登录 401/CSRF/语音图片媒体校验/媒体上传与读取）
- `tests/frontendPlayerDanmaku.test.js`：6 项（内嵌弹幕时间戳触发、语音气泡与图片卡片渲染、发送文字、文字/图片合并板块、显示开关、无歌曲禁用）
- `tests/frontendDanmaku.test.js`：11 项（客户端适配、全站实时流、时间戳触发、拖动跳过、屏蔽词、开关、切歌竞态）

## 与盲盒补丁的关系

本补丁基于「main + 音乐盲盒补丁」之后的代码：`app.js`、`database.js`、`style.css`、`tests/helpers/frontendSource.js` 等文件同时包含盲盒与弹幕的改动。**请先应用盲盒补丁，再应用弹幕补丁。**
